import type { CatalogItem, CountryCode, PriceObservation, TitleAlias } from '@eshop-tracker/shared';
import { PgDatabaseClient, type DatabaseClient, type QueryClient } from './database.js';
import { loadMigrations, type Migration } from './migrations.js';

export type JobType = 'catalog' | 'prices';

export type SyncRunResult = {
  status: 'success' | 'partial' | 'failed';
  itemsRead: number;
  itemsWritten: number;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export interface TrackerRepository {
  migrate(): Promise<void>;
  tryJobLock(jobType: JobType, country: CountryCode): Promise<boolean>;
  releaseJobLock(jobType: JobType, country: CountryCode): Promise<void>;
  startSyncRun(jobType: JobType, country: CountryCode, startedAt: Date): Promise<number>;
  finishSyncRun(id: number, result: SyncRunResult): Promise<void>;
  /** searchNames: extra names per exact title, appended to the listing's search text. */
  upsertCatalog(items: readonly CatalogItem[], seenAt: Date, searchNames?: ReadonlyMap<string, readonly string[]>): Promise<number>;
  activeSourceIds(country: CountryCode, source: string): Promise<string[]>;
  /** Older observations are ignored and are not included in the returned count. */
  recordPrices(observations: readonly PriceObservation[]): Promise<number>;
  /** Replaces every alias in one transaction; returns the number stored. */
  replaceTitleAliases(aliases: readonly TitleAlias[]): Promise<number>;
  close(): Promise<void>;
}

/** Internal test seam; it keeps pg-specific objects outside repository tests. */
export type TrackerDatabase = DatabaseClient;

const MIGRATION_LOCK_NAMESPACE = 41_420;
const JOB_LOCK_NAMESPACE = 41_421;
const PERSISTENCE_LOCK_NAMESPACE = 41_422;
const MIGRATION_LOCK_ID = 1;
const schemaMigrationsBootstrapSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

const COUNTRY_LOCK_IDS = { JP: 1, US: 2, GB: 3, CA: 4, MX: 5, BR: 6 } satisfies Record<CountryCode, number>;

function countryLockId(country: CountryCode): number {
  return COUNTRY_LOCK_IDS[country];
}

function jobLockId(jobType: JobType, country: CountryCode): number {
  return (jobType === 'catalog' ? 1 : 2) * 10 + countryLockId(country);
}

function heldJobLockKey(jobType: JobType, country: CountryCode): string {
  return `${jobType}:${country}`;
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
}

function assertSafePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function assertSafeNonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
}

function readSafeIdentifier(value: unknown, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} is outside JavaScript's safe integer range`);
  }
  return parsed;
}

function readTimestamp(value: unknown): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (Number.isNaN(timestamp)) {
    throw new Error('Database returned an invalid observed_at timestamp');
  }
  return timestamp;
}

async function parseCatalog(items: readonly CatalogItem[]): Promise<CatalogItem[]> {
  const { CatalogItemSchema } = await import('@eshop-tracker/shared');
  return items.map((item) => CatalogItemSchema.parse(item));
}

async function searchNormalizer(): Promise<(text: string) => string> {
  return (await import('@eshop-tracker/shared')).normalizeSearchText;
}

async function parseObservations(observations: readonly PriceObservation[]): Promise<PriceObservation[]> {
  const { PriceObservationSchema } = await import('@eshop-tracker/shared');
  const parsed = observations.map((observation) => PriceObservationSchema.parse(observation));
  const identities = new Set<string>();
  for (const observation of parsed) {
    const identity = JSON.stringify([observation.country, observation.source, observation.sourceId]);
    if (identities.has(identity)) {
      throw new Error('Price batch contains a duplicate listing identity');
    }
    identities.add(identity);
  }
  return parsed;
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

async function releaseClient(
  client: { release(error?: Error): void | Promise<void> },
  error?: Error
): Promise<Error | undefined> {
  try {
    await client.release(error);
    return error;
  } catch (releaseError) {
    const cleanupError = error ?? asError(releaseError, 'Database session cleanup failed');
    try {
      await client.release(cleanupError);
    } catch {
      // The caller receives the first useful cleanup failure.
    }
    return cleanupError;
  }
}

async function unlockAndRelease(
  client: Awaited<ReturnType<TrackerDatabase['checkout']>>,
  namespace: number,
  lockId: number
): Promise<Error | undefined> {
  let cleanupError: Error | undefined;
  try {
    const result = await client.query<{ unlocked: boolean }>(
      'SELECT pg_advisory_unlock($1, $2) AS unlocked',
      [namespace, lockId]
    );
    if (result.rows[0]?.unlocked !== true) {
      cleanupError = new Error('PostgreSQL advisory lock was not released');
    }
  } catch (error) {
    cleanupError = asError(error, 'PostgreSQL advisory unlock failed');
  }
  return releaseClient(client, cleanupError);
}

class PostgresTrackerRepository implements TrackerRepository {
  private readonly heldJobLocks = new Map<string, Awaited<ReturnType<TrackerDatabase['checkout']>>>();
  private readonly pendingJobLocks = new Set<string>();
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private activeOperations = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly database: TrackerDatabase,
    private readonly getMigrations: () => Promise<Migration[]>
  ) {}

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Tracker repository is closed');
    }
  }

  private async runOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.ensureOpen();
    this.activeOperations += 1;
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of waiters) {
          resolve();
        }
      }
    }
  }

  private async waitForIdleOperations(): Promise<void> {
    if (this.activeOperations === 0) {
      return;
    }
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  migrate(): Promise<void> {
    return this.runOperation(() => this.migrateInternal());
  }

  private async migrateInternal(): Promise<void> {
    const client = await this.database.checkout();
    let locked = false;
    let primaryError: unknown;
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID]);
      locked = true;
      await client.query(schemaMigrationsBootstrapSql);

      const migrations = [...await this.getMigrations()].sort((left, right) => left.name.localeCompare(right.name));
      const applied = await this.database.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name ASC');
      const isExactPrefix = applied.rows.length <= migrations.length && applied.rows.every(
        (migration, index) => migration.name === migrations[index]?.name
      );
      if (!isExactPrefix) {
        throw new Error('Applied migrations must be an exact lexical prefix of local migrations');
      }

      for (const migration of migrations.slice(applied.rows.length)) {
        await this.database.transaction(async (transaction) => {
          await transaction.query(migration.sql);
          await transaction.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        });
      }
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupError = locked
        ? await unlockAndRelease(client, MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID)
        : await releaseClient(client);
      if (primaryError === undefined && cleanupError !== undefined) {
        primaryError = cleanupError;
      }
    }
    if (primaryError !== undefined) {
      throw primaryError;
    }
  }

  tryJobLock(jobType: JobType, country: CountryCode): Promise<boolean> {
    return this.runOperation(() => this.tryJobLockInternal(jobType, country));
  }

  private async tryJobLockInternal(jobType: JobType, country: CountryCode): Promise<boolean> {
    const key = heldJobLockKey(jobType, country);
    const lockId = jobLockId(jobType, country);
    if (this.heldJobLocks.has(key) || this.pendingJobLocks.has(key)) {
      return false;
    }
    this.pendingJobLocks.add(key);
    let client: Awaited<ReturnType<TrackerDatabase['checkout']>> | undefined;
    try {
      client = await this.database.checkout();
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [JOB_LOCK_NAMESPACE, lockId]
      );
      if (result.rows[0]?.acquired !== true) {
        const cleanupError = await releaseClient(client);
        client = undefined;
        if (cleanupError) {
          throw cleanupError;
        }
        return false;
      }
      if (this.closed) {
        const cleanupError = await unlockAndRelease(client, JOB_LOCK_NAMESPACE, lockId);
        client = undefined;
        if (cleanupError) {
          throw cleanupError;
        }
        return false;
      }
      this.heldJobLocks.set(key, client);
      return true;
    } catch (error) {
      if (client) {
        await releaseClient(client, asError(error, 'Job advisory lock failed'));
      }
      throw error;
    } finally {
      this.pendingJobLocks.delete(key);
    }
  }

  releaseJobLock(jobType: JobType, country: CountryCode): Promise<void> {
    return this.runOperation(() => this.releaseJobLockInternal(jobType, country));
  }

  private async releaseJobLockInternal(jobType: JobType, country: CountryCode): Promise<void> {
    const key = heldJobLockKey(jobType, country);
    const client = this.heldJobLocks.get(key);
    if (!client) {
      return;
    }
    this.heldJobLocks.delete(key);
    const cleanupError = await unlockAndRelease(client, JOB_LOCK_NAMESPACE, jobLockId(jobType, country));
    if (cleanupError) {
      throw cleanupError;
    }
  }

  startSyncRun(jobType: JobType, country: CountryCode, startedAt: Date): Promise<number> {
    return this.runOperation(() => this.startSyncRunInternal(jobType, country, startedAt));
  }

  private async startSyncRunInternal(jobType: JobType, country: CountryCode, startedAt: Date): Promise<number> {
    assertValidDate(startedAt, 'startedAt');
    const result = await this.database.query<{ id: string | number }>(
      `INSERT INTO sync_runs (job_type, country, started_at, status)
       VALUES ($1, $2, $3, 'running')
       RETURNING id`,
      [jobType, country, startedAt]
    );
    const id = result.rows[0]?.id;
    return readSafeIdentifier(id, 'sync run id');
  }

  finishSyncRun(id: number, result: SyncRunResult): Promise<void> {
    return this.runOperation(() => this.finishSyncRunInternal(id, result));
  }

  private async finishSyncRunInternal(id: number, result: SyncRunResult): Promise<void> {
    assertSafePositiveInteger(id, 'id');
    if (result.status !== 'success' && result.status !== 'partial' && result.status !== 'failed') {
      throw new Error('status must be success, partial, or failed');
    }
    assertSafeNonnegativeInteger(result.itemsRead, 'itemsRead');
    assertSafeNonnegativeInteger(result.itemsWritten, 'itemsWritten');
    const update = await this.database.query(
      `UPDATE sync_runs
       SET finished_at = now(), status = $2, items_read = $3, items_written = $4,
           error_code = $5, error_message = $6
       WHERE id = $1 AND status = 'running'`,
      [
        id,
        result.status,
        result.itemsRead,
        result.itemsWritten,
        result.errorCode ?? null,
        result.errorMessage ?? null
      ]
    );
    if (update.rowCount !== 1) {
      throw new Error('Expected exactly one running sync run to finish');
    }
  }

  upsertCatalog(items: readonly CatalogItem[], seenAt: Date, searchNames: ReadonlyMap<string, readonly string[]> = new Map()): Promise<number> {
    return this.runOperation(() => this.upsertCatalogInternal(items, seenAt, searchNames));
  }

  private async upsertCatalogInternal(
    items: readonly CatalogItem[],
    seenAt: Date,
    searchNames: ReadonlyMap<string, readonly string[]>
  ): Promise<number> {
    assertValidDate(seenAt, 'seenAt');
    const parsed = await parseCatalog(items);
    if (parsed.length === 0) {
      return 0;
    }
    const first = parsed[0];
    if (!first) {
      return 0;
    }
    if (parsed.some((item) => item.country !== first.country || item.source !== first.source)) {
      throw new Error('Catalog batch must contain the same country and source');
    }

    const normalize = await searchNormalizer();
    return this.database.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock($1, $2)', [PERSISTENCE_LOCK_NAMESPACE, countryLockId(first.country)]);
      let accepted = 0;
      for (const item of parsed) {
        const upsert = await transaction.query(
          `INSERT INTO regional_listings (
             country, source, source_id, product_code, title, publisher, developer,
             description, image_url, release_date, product_type, platform, source_url, source_payload, last_seen_at, title_norm
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16)
           ON CONFLICT (country, source, source_id) DO UPDATE SET
             product_code = EXCLUDED.product_code,
             title = EXCLUDED.title,
             title_norm = EXCLUDED.title_norm,
             publisher = EXCLUDED.publisher,
             developer = EXCLUDED.developer,
             description = EXCLUDED.description,
             image_url = EXCLUDED.image_url,
             release_date = EXCLUDED.release_date,
             product_type = EXCLUDED.product_type,
             platform = EXCLUDED.platform,
             source_url = EXCLUDED.source_url,
             source_payload = EXCLUDED.source_payload,
             is_active = TRUE,
             last_seen_at = EXCLUDED.last_seen_at,
             updated_at = now()
           WHERE regional_listings.last_seen_at <= EXCLUDED.last_seen_at
           RETURNING id`,
          [
            item.country, item.source, item.sourceId, item.productCode, item.title,
            item.publisher, item.developer, item.description, item.imageUrl, item.releaseDate,
            item.productType, item.platform, item.sourceUrl, JSON.stringify(item.sourcePayload), seenAt,
            // newline-separated so a search word never matches across two names
            [item.title, ...(searchNames.get(item.title) ?? [])].map(normalize).join('\n')
          ]
        );
        accepted += upsert.rowCount ?? 0;
      }
      await transaction.query(
        `UPDATE regional_listings
         SET is_active = FALSE, updated_at = now()
         WHERE country = $1 AND source = $2 AND is_active = TRUE
           AND last_seen_at < $3::timestamptz - interval '7 days'`,
        [first.country, first.source, seenAt]
      );
      return accepted;
    });
  }

  replaceTitleAliases(aliases: readonly TitleAlias[]): Promise<number> {
    return this.runOperation(() => this.replaceTitleAliasesInternal(aliases));
  }

  private async replaceTitleAliasesInternal(aliases: readonly TitleAlias[]): Promise<number> {
    const normalize = await searchNormalizer();
    const rows = new Map<string, TitleAlias & { titleNorm: string }>();
    for (const alias of aliases) {
      if (
        !/^[A-Z0-9]{4}$/.test(alias.productCore)
        || (alias.platform !== 'switch' && alias.platform !== 'switch2')
        || (alias.language !== 'en' && alias.language !== 'zh')
      ) {
        throw new Error('Title alias has an invalid platform, product core or language');
      }
      const title = alias.title.trim();
      const titleNorm = normalize(title);
      if (titleNorm.length > 0) rows.set(JSON.stringify([alias.platform, alias.productCore, alias.language, title]), { ...alias, title, titleNorm });
    }
    const values = [...rows.values()];
    // An empty fetch would wipe every alias; keep the previous set instead.
    if (values.length === 0) throw new Error('Refusing to replace title aliases with an empty set');
    return this.database.transaction(async (transaction) => {
      await transaction.query('DELETE FROM title_aliases');
      await transaction.query(
        `INSERT INTO title_aliases (platform, product_core, language, title, title_norm)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])`,
        [
          values.map((row) => row.platform), values.map((row) => row.productCore), values.map((row) => row.language),
          values.map((row) => row.title), values.map((row) => row.titleNorm)
        ]
      );
      return values.length;
    });
  }

  activeSourceIds(country: CountryCode, source: string): Promise<string[]> {
    return this.runOperation(() => this.activeSourceIdsInternal(country, source));
  }

  private async activeSourceIdsInternal(country: CountryCode, source: string): Promise<string[]> {
    const result = await this.database.query<{ source_id: string }>(
      `SELECT source_id FROM regional_listings
       WHERE country = $1 AND source = $2 AND is_active = TRUE
       ORDER BY source_id ASC`,
      [country, source]
    );
    return result.rows.map((row) => row.source_id);
  }

  recordPrices(observations: readonly PriceObservation[]): Promise<number> {
    return this.runOperation(() => this.recordPricesInternal(observations));
  }

  private async recordPricesInternal(observations: readonly PriceObservation[]): Promise<number> {
    const parsed = await parseObservations(observations);
    if (parsed.length === 0) {
      return 0;
    }

    const countries = [...new Set(parsed.map((observation) => observation.country))]
      .sort((left, right) => countryLockId(left) - countryLockId(right));
    return this.database.transaction(async (transaction) => {
      for (const country of countries) {
        await transaction.query('SELECT pg_advisory_xact_lock($1, $2)', [PERSISTENCE_LOCK_NAMESPACE, countryLockId(country)]);
      }
      let accepted = 0;
      for (const observation of parsed) {
        const listing = await transaction.query<{ id: string }>(
          `SELECT id FROM regional_listings
           WHERE country = $1 AND source = $2 AND source_id = $3
           FOR UPDATE`,
          [observation.country, observation.source, observation.sourceId]
        );
        const listingId = listing.rows[0]?.id;
        if (!listingId) {
          throw new Error('Unknown listing');
        }

        const current = await transaction.query<{
          currency: string;
          regular_amount_minor: number;
          discount_amount_minor: number | null;
          discount_start_at: Date | string | null;
          discount_end_at: Date | string | null;
          sales_status: string;
          observed_at: Date | string;
        }>(
          `SELECT currency, regular_amount_minor, discount_amount_minor, discount_start_at,
                  discount_end_at, sales_status, observed_at
           FROM current_prices WHERE regional_listing_id = $1 FOR UPDATE`,
          [listingId]
        );
        const existing = current.rows[0];
        if (existing && new Date(observation.observedAt).getTime() < readTimestamp(existing.observed_at)) {
          continue;
        }

        const values = [
          listingId,
          observation.currency,
          observation.regularAmountMinor,
          observation.discountAmountMinor,
          observation.discountStartAt,
          observation.discountEndAt,
          observation.salesStatus,
          new Date(observation.observedAt)
        ];
        if (!existing) {
          await transaction.query(
            `INSERT INTO price_history (
               regional_listing_id, currency, regular_amount_minor, discount_amount_minor,
               discount_start_at, discount_end_at, sales_status, observed_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            values
          );
        } else {
          await transaction.query(
            `INSERT INTO price_history (
               regional_listing_id, currency, regular_amount_minor, discount_amount_minor,
               discount_start_at, discount_end_at, sales_status, observed_at
             )
             SELECT $1, $2, $3, $4, $5, $6, $7, $8
             FROM current_prices AS previous
             WHERE previous.regional_listing_id = $1
               AND ROW(
                 previous.currency,
                 previous.regular_amount_minor,
                 previous.discount_amount_minor,
                 previous.discount_start_at,
                 previous.discount_end_at,
                 previous.sales_status
               ) IS DISTINCT FROM ROW($2, $3, $4, $5, $6, $7)`,
            values
          );
        }
        await transaction.query(
          `INSERT INTO current_prices (
             regional_listing_id, currency, regular_amount_minor, discount_amount_minor,
             discount_start_at, discount_end_at, sales_status, observed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (regional_listing_id) DO UPDATE SET
             currency = EXCLUDED.currency,
             regular_amount_minor = EXCLUDED.regular_amount_minor,
             discount_amount_minor = EXCLUDED.discount_amount_minor,
             discount_start_at = EXCLUDED.discount_start_at,
             discount_end_at = EXCLUDED.discount_end_at,
             sales_status = EXCLUDED.sales_status,
             observed_at = EXCLUDED.observed_at,
             updated_at = now()`,
          values
        );
        accepted += 1;
      }
      return accepted;
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closed = true;
    this.closePromise = (async () => {
      let firstError: unknown;
      // close owns held locks after the in-flight operation barrier; public releaseJobLock
      // calls begun before close are allowed to finish, and new operations are rejected.
      await this.waitForIdleOperations();
      const heldLocks = [...this.heldJobLocks.entries()];
      this.heldJobLocks.clear();
      for (const [key, client] of heldLocks) {
        const [jobType, country] = key.split(':');
        if ((jobType !== 'catalog' && jobType !== 'prices') || country === undefined || !Object.hasOwn(COUNTRY_LOCK_IDS, country)) {
          const cleanupError = await releaseClient(client, new Error('Invalid held job lock'));
          firstError ??= cleanupError;
          continue;
        }
        const cleanupError = await unlockAndRelease(client, JOB_LOCK_NAMESPACE, jobLockId(jobType, country as CountryCode));
        firstError ??= cleanupError;
      }
      try {
        await this.database.close();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError !== undefined) {
        throw firstError;
      }
    })();
    return this.closePromise;
  }
}

export function createTrackerRepository(databaseUrl: string): TrackerRepository {
  return new PostgresTrackerRepository(new PgDatabaseClient(databaseUrl), loadMigrations);
}

export function createTrackerRepositoryWithDatabase(
  database: TrackerDatabase,
  getMigrations: () => Promise<Migration[]> = loadMigrations
): TrackerRepository {
  return new PostgresTrackerRepository(database, getMigrations);
}
