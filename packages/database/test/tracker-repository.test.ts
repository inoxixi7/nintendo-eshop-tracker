import { describe, expect, it } from 'vitest';
import type { CatalogItem, CountryCode, PriceObservation } from '@eshop-tracker/shared';
import {
  createTrackerRepositoryWithDatabase,
  type TrackerDatabase
} from '../src/tracker-repository.js';

type Call = { sql: string; values: readonly unknown[] };
type Row = Record<string, unknown>;

class FakeDatabase implements TrackerDatabase {
  readonly calls: Call[] = [];
  readonly transactions: Call[][] = [];
  readonly checkedOutClients: FakeLockClient[] = [];
  closed = 0;
  private readonly responses: Row[][];

  constructor(
    responses: Row[][] = [],
    private readonly beforeCheckout?: () => Promise<void>
  ) {
    this.responses = [...responses];
  }

  async query<T extends Row>(sql: string, values: readonly unknown[] = []) {
    this.calls.push({ sql, values });
    return { rows: (this.responses.shift() ?? []) as T[], rowCount: 1 };
  }

  async transaction<T>(operation: (client: FakeTransactionClient) => Promise<T>): Promise<T> {
    const calls: Call[] = [];
    this.transactions.push(calls);
    return operation(new FakeTransactionClient(calls, this.responses));
  }

  async checkout() {
    await this.beforeCheckout?.();
    const client = new FakeLockClient();
    this.checkedOutClients.push(client);
    return client;
  }

  async close() {
    this.closed += 1;
  }
}

class FakeTransactionClient {
  constructor(
    private readonly calls: Call[],
    private readonly responses: Row[][]
  ) {}

  async query<T extends Row>(sql: string, values: readonly unknown[] = []) {
    this.calls.push({ sql, values });
    return { rows: (this.responses.shift() ?? []) as T[], rowCount: 1 };
  }
}

class FakeLockClient {
  readonly calls: Call[] = [];
  released = 0;

  async query<T extends Row>(sql: string, values: readonly unknown[] = []) {
    this.calls.push({ sql, values });
    const rows = sql.includes('pg_try_advisory_lock') ? [{ acquired: true }] : [{ released: true }];
    return { rows: rows as unknown as T[], rowCount: 1 };
  }

  release() {
    this.released += 1;
  }
}

const catalogItem: CatalogItem = {
  country: 'JP',
  source: 'nintendo',
  sourceId: '70010000000001',
  productCode: 'HAC-P-TEST1',
  title: 'Test game',
  publisher: 'Nintendo',
  developer: null,
  description: null,
  imageUrl: 'https://example.com/game.jpg',
  releaseDate: '2026-08-01',
  productType: 'game',
  sourceUrl: 'https://example.com/game',
  sourcePayload: { id: '70010000000001' }
};

const observation: PriceObservation = {
  country: 'JP',
  source: 'nintendo',
  sourceId: '70010000000001',
  currency: 'JPY',
  regularAmountMinor: 5_980,
  discountAmountMinor: null,
  discountStartAt: null,
  discountEndAt: null,
  salesStatus: 'onsale',
  observedAt: '2026-08-24T10:00:00.000Z'
};

describe('tracker repository', () => {
  it('bootstraps migrations, rejects missing applied files, and applies each migration in a transaction', async () => {
    const database = new FakeDatabase([[{ name: '001_initial.sql' }]]);
    const repository = createTrackerRepositoryWithDatabase(database, async () => [
      { name: '001_initial.sql', sql: 'SELECT 1' },
      { name: '002_more.sql', sql: 'SELECT 2' }
    ]);

    await repository.migrate();

    expect(database.checkedOutClients).toHaveLength(1);
    expect(database.checkedOutClients[0]?.calls.map((call) => call.sql)).toEqual([
      expect.stringMatching(/pg_advisory_lock/),
      expect.stringMatching(/CREATE TABLE IF NOT EXISTS schema_migrations/),
      expect.stringMatching(/pg_advisory_unlock/)
    ]);
    expect(database.transactions).toHaveLength(1);
    expect(database.transactions[0]?.map((call) => call.values)).toEqual([[], ['002_more.sql']]);

    const missing = createTrackerRepositoryWithDatabase(
      new FakeDatabase([[{ name: '999_removed.sql' }]]),
      async () => [{ name: '001_initial.sql', sql: 'SELECT 1' }]
    );
    await expect(missing.migrate()).rejects.toThrow(/missing locally/);
  });

  it('keeps a job advisory lock on its checked-out session and prevents duplicate attempts', async () => {
    const database = new FakeDatabase([[{ acquired: true }], [{ released: true }]]);
    const repository = createTrackerRepositoryWithDatabase(database);

    await expect(repository.tryJobLock('catalog', 'JP')).resolves.toBe(true);
    await expect(repository.tryJobLock('catalog', 'JP')).resolves.toBe(false);
    expect(database.checkedOutClients).toHaveLength(1);
    expect(database.checkedOutClients[0]?.calls[0]?.values).toEqual(['eshop-tracker:job:catalog:JP']);

    await repository.releaseJobLock('catalog', 'JP');
    expect(database.checkedOutClients[0]?.calls[1]?.sql).toMatch(/pg_advisory_unlock/);
    expect(database.checkedOutClients[0]?.released).toBe(1);

    let allowCheckout: (() => void) | undefined;
    const checkoutGate = new Promise<void>((resolve) => { allowCheckout = resolve; });
    const concurrentDatabase = new FakeDatabase([], async () => checkoutGate);
    const concurrentRepository = createTrackerRepositoryWithDatabase(concurrentDatabase);
    const firstAttempt = concurrentRepository.tryJobLock('prices', 'US');
    await Promise.resolve();
    await expect(concurrentRepository.tryJobLock('prices', 'US')).resolves.toBe(false);
    allowCheckout?.();
    await expect(firstAttempt).resolves.toBe(true);
    expect(concurrentDatabase.checkedOutClients).toHaveLength(1);
  });

  it('starts and finishes sync runs with safe integer validation and parameters', async () => {
    const database = new FakeDatabase([[{ id: '42' }]]);
    const repository = createTrackerRepositoryWithDatabase(database);

    await expect(repository.startSyncRun('prices', 'GB', new Date('2026-08-24T10:00:00Z'))).resolves.toBe(42);
    await repository.finishSyncRun(42, {
      status: 'partial',
      itemsRead: 3,
      itemsWritten: 2,
      errorCode: 'UPSTREAM',
      errorMessage: 'one listing failed'
    });
    await expect(repository.finishSyncRun(42, {
      status: 'success', itemsRead: -1, itemsWritten: 0
    })).rejects.toThrow(/nonnegative safe integer/);
    await expect(repository.finishSyncRun(42, {
      status: 'running' as never, itemsRead: 0, itemsWritten: 0
    })).rejects.toThrow(/success, partial, or failed/);

    expect(database.calls[0]?.values).toEqual(['prices', 'GB', new Date('2026-08-24T10:00:00Z')]);
    expect(database.calls[1]?.values).toEqual([42, 'partial', 3, 2, 'UPSTREAM', 'one listing failed']);
  });

  it('upserts one homogeneous catalog batch in one transaction and expires only stale matching rows', async () => {
    const database = new FakeDatabase();
    const repository = createTrackerRepositoryWithDatabase(database);
    const seenAt = new Date('2026-08-24T10:00:00Z');

    await expect(repository.upsertCatalog([catalogItem], seenAt)).resolves.toBe(1);

    expect(database.transactions).toHaveLength(1);
    expect(database.transactions[0]?.[0]?.sql).toMatch(/ON CONFLICT \(country, source, source_id\) DO UPDATE/);
    expect(database.transactions[0]?.[0]?.values).toEqual(expect.arrayContaining([
      catalogItem.sourceId,
      JSON.stringify(catalogItem.sourcePayload),
      seenAt
    ]));
    expect(database.transactions[0]?.[1]?.sql).toMatch(/last_seen_at < \$3 - interval '7 days'/);
    expect(database.transactions[0]?.[1]?.values).toEqual(['JP', 'nintendo', seenAt]);
  });

  it('rejects a nonempty catalog batch that mixes listing scopes without writing', async () => {
    const database = new FakeDatabase();
    const repository = createTrackerRepositoryWithDatabase(database);

    await expect(repository.upsertCatalog([
      catalogItem,
      { ...catalogItem, country: 'US', sourceId: 'different' }
    ], new Date())).rejects.toThrow(/same country and source/);
    expect(database.transactions).toHaveLength(0);
  });

  it('returns active source IDs in ascending order', async () => {
    const database = new FakeDatabase([[{ source_id: '2' }, { source_id: '10' }]]);
    const repository = createTrackerRepositoryWithDatabase(database);

    await expect(repository.activeSourceIds('US', 'nintendo')).resolves.toEqual(['2', '10']);
    expect(database.calls[0]?.sql).toMatch(/ORDER BY source_id ASC/);
    expect(database.calls[0]?.values).toEqual(['US', 'nintendo']);
  });

  it('records a new price, compares every price field for history changes, and parameterizes observations', async () => {
    const database = new FakeDatabase([[{ id: 'listing-1' }], []]);
    const repository = createTrackerRepositoryWithDatabase(database);

    await expect(repository.recordPrices([observation])).resolves.toBe(1);

    const calls = database.transactions[0] ?? [];
    expect(calls).toHaveLength(4);
    expect(calls[2]?.sql).toMatch(/INSERT INTO price_history/);
    expect(calls[2]?.values).toEqual(expect.arrayContaining(['listing-1', 'JPY', 5_980]));
    expect(calls[3]?.sql).toMatch(/ON CONFLICT \(regional_listing_id\) DO UPDATE/);

    const existing = new FakeDatabase([[{ id: 'listing-1' }], [{
      currency: 'JPY', regular_amount_minor: 5_980, discount_amount_minor: null,
      discount_start_at: null, discount_end_at: null, sales_status: 'onsale',
      observed_at: '2026-08-23T10:00:00.000Z'
    }]]);
    await expect(createTrackerRepositoryWithDatabase(existing).recordPrices([
      { ...observation, discountAmountMinor: 4_980 }
    ])).resolves.toBe(1);
    expect(existing.transactions[0]?.[2]?.sql).toMatch(/IS DISTINCT FROM/);
    expect(existing.transactions[0]?.[2]?.sql).toMatch(/discount_start_at/);
    expect(existing.transactions[0]?.[2]?.sql).toMatch(/discount_end_at/);
    expect(existing.transactions[0]?.[2]?.sql).toMatch(/sales_status/);
  });

  it('rejects unknown and duplicate price listings, while ignoring stale observations', async () => {
    const unknown = createTrackerRepositoryWithDatabase(new FakeDatabase([[]]));
    await expect(unknown.recordPrices([observation])).rejects.toThrow(/Unknown listing/);

    const duplicate = createTrackerRepositoryWithDatabase(new FakeDatabase());
    await expect(duplicate.recordPrices([observation, { ...observation, observedAt: '2026-08-24T11:00:00.000Z' }]))
      .rejects.toThrow(/duplicate listing identity/);

    const database = new FakeDatabase([[{ id: 'listing-1' }], [{
      currency: 'JPY', regular_amount_minor: 5_980, discount_amount_minor: null,
      discount_start_at: null, discount_end_at: null, sales_status: 'onsale',
      observed_at: '2026-08-25T10:00:00.000Z'
    }]]);
    await expect(createTrackerRepositoryWithDatabase(database).recordPrices([observation])).resolves.toBe(0);
    expect(database.transactions[0]).toHaveLength(2);
  });

  it('releases held job sessions before closing once', async () => {
    const database = new FakeDatabase([[{ acquired: true }], [{ released: true }]]);
    const repository = createTrackerRepositoryWithDatabase(database);
    await repository.tryJobLock('prices', 'US');

    await repository.close();
    await repository.close();

    expect(database.checkedOutClients[0]?.released).toBe(1);
    expect(database.closed).toBe(1);
  });
});
