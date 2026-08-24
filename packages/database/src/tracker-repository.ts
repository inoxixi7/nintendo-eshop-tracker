import type { CatalogItem, CountryCode, PriceObservation } from '@eshop-tracker/shared';
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
  upsertCatalog(items: readonly CatalogItem[], seenAt: Date): Promise<number>;
  activeSourceIds(country: CountryCode, source: string): Promise<string[]>;
  /** Older observations are ignored and are not included in the returned count. */
  recordPrices(observations: readonly PriceObservation[]): Promise<number>;
  close(): Promise<void>;
}

/** Internal test seam; it keeps pg-specific objects outside repository tests. */
export type TrackerDatabase = DatabaseClient;

const MIGRATION_LOCK_KEY = 'eshop-tracker:migrations:v1';
const schemaMigrationsBootstrapSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

function jobLockKey(jobType: JobType, country: CountryCode): string {
  return `eshop-tracker:job:${jobType}:${country}`;
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
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

async function releaseClient(client: { release(): void | Promise<void> }): Promise<void> {
  await client.release();
}

class PostgresTrackerRepository implements TrackerRepository {
  private readonly heldJobLocks = new Map<string, Awaited<ReturnType<TrackerDatabase['checkout']>>>();
  private readonly pendingJobLocks = new Set<string>();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly database: TrackerDatabase,
    private readonly getMigrations: () => Promise<Migration[]>
  ) {}

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Tracker repository is closed');
    }
  }

  async migrate(): Promise<void> {
    this.ensureOpen();
    const client = await this.database.checkout();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      locked = true;
      await client.query(schemaMigrationsBootstrapSql);

      const migrations = await this.getMigrations();
      const knownMigrationNames = new Set(migrations.map((migration) => migration.name));
      const applied = await this.database.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name ASC');
      for (const migration of applied.rows) {
        if (!knownMigrationNames.has(migration.name)) {
          throw new Error('An applied migration is missing locally');
        }
      }

      const appliedNames = new Set(applied.rows.map((migration) => migration.name));
      for (const migration of migrations) {
        if (appliedNames.has(migration.name)) {
          continue;
        }
        await this.database.transaction(async (transaction) => {
          await transaction.query(migration.sql);
          await transaction.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        });
      }
    } finally {
      if (locked) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
        } finally {
          await releaseClient(client);
        }
      } else {
        await releaseClient(client);
      }
    }
  }

  async tryJobLock(jobType: JobType, country: CountryCode): Promise<boolean> {
    this.ensureOpen();
    const key = jobLockKey(jobType, country);
    if (this.heldJobLocks.has(key) || this.pendingJobLocks.has(key)) {
      return false;
    }
    this.pendingJobLocks.add(key);
    let client: Awaited<ReturnType<TrackerDatabase['checkout']>> | undefined;
    try {
      client = await this.database.checkout();
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [key]
      );
      if (result.rows[0]?.acquired !== true) {
        await releaseClient(client);
        client = undefined;
        return false;
      }
      if (this.closed) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
        await releaseClient(client);
        client = undefined;
        return false;
      }
      this.heldJobLocks.set(key, client);
      return true;
    } catch (error) {
      if (client) {
        await releaseClient(client);
      }
      throw error;
    } finally {
      this.pendingJobLocks.delete(key);
    }
  }

  async releaseJobLock(jobType: JobType, country: CountryCode): Promise<void> {
    const key = jobLockKey(jobType, country);
    const client = this.heldJobLocks.get(key);
    if (!client) {
      return;
    }
    this.heldJobLocks.delete(key);
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    } finally {
      await releaseClient(client);
    }
  }

  async startSyncRun(jobType: JobType, country: CountryCode, startedAt: Date): Promise<number> {
    this.ensureOpen();
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

  async finishSyncRun(id: number, result: SyncRunResult): Promise<void> {
    this.ensureOpen();
    assertSafeNonnegativeInteger(id, 'id');
    if (result.status !== 'success' && result.status !== 'partial' && result.status !== 'failed') {
      throw new Error('status must be success, partial, or failed');
    }
    assertSafeNonnegativeInteger(result.itemsRead, 'itemsRead');
    assertSafeNonnegativeInteger(result.itemsWritten, 'itemsWritten');
    await this.database.query(
      `UPDATE sync_runs
       SET finished_at = now(), status = $2, items_read = $3, items_written = $4,
           error_code = $5, error_message = $6
       WHERE id = $1`,
      [
        id,
        result.status,
        result.itemsRead,
        result.itemsWritten,
        result.errorCode ?? null,
        result.errorMessage ?? null
      ]
    );
  }

  async upsertCatalog(items: readonly CatalogItem[], seenAt: Date): Promise<number> {
    this.ensureOpen();
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

    await this.database.transaction(async (transaction) => {
      for (const item of parsed) {
        await transaction.query(
          `INSERT INTO regional_listings (
             country, source, source_id, product_code, title, publisher, developer,
             description, image_url, release_date, product_type, source_url, source_payload, last_seen_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
           ON CONFLICT (country, source, source_id) DO UPDATE SET
             product_code = EXCLUDED.product_code,
             title = EXCLUDED.title,
             publisher = EXCLUDED.publisher,
             developer = EXCLUDED.developer,
             description = EXCLUDED.description,
             image_url = EXCLUDED.image_url,
             release_date = EXCLUDED.release_date,
             product_type = EXCLUDED.product_type,
             source_url = EXCLUDED.source_url,
             source_payload = EXCLUDED.source_payload,
             is_active = TRUE,
             last_seen_at = EXCLUDED.last_seen_at,
             updated_at = now()`,
          [
            item.country, item.source, item.sourceId, item.productCode, item.title,
            item.publisher, item.developer, item.description, item.imageUrl, item.releaseDate,
            item.productType, item.sourceUrl, JSON.stringify(item.sourcePayload), seenAt
          ]
        );
      }
      await transaction.query(
        `UPDATE regional_listings
         SET is_active = FALSE, updated_at = now()
         WHERE country = $1 AND source = $2 AND is_active = TRUE
           AND last_seen_at < $3 - interval '7 days'`,
        [first.country, first.source, seenAt]
      );
    });
    return parsed.length;
  }

  async activeSourceIds(country: CountryCode, source: string): Promise<string[]> {
    this.ensureOpen();
    const result = await this.database.query<{ source_id: string }>(
      `SELECT source_id FROM regional_listings
       WHERE country = $1 AND source = $2 AND is_active = TRUE
       ORDER BY source_id ASC`,
      [country, source]
    );
    return result.rows.map((row) => row.source_id);
  }

  async recordPrices(observations: readonly PriceObservation[]): Promise<number> {
    this.ensureOpen();
    const parsed = await parseObservations(observations);
    if (parsed.length === 0) {
      return 0;
    }

    return this.database.transaction(async (transaction) => {
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
      const heldLocks = [...this.heldJobLocks.entries()];
      this.heldJobLocks.clear();
      for (const [key, client] of heldLocks) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
        } catch (error) {
          firstError ??= error;
        } finally {
          try {
            await releaseClient(client);
          } catch (error) {
            firstError ??= error;
          }
        }
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
