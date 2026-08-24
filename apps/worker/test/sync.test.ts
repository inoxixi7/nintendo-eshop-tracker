import { describe, expect, it, vi } from 'vitest';
import { EshopError, type EshopAdapter } from '@eshop-tracker/eshop';
import type { CatalogItem, PriceObservation } from '@eshop-tracker/shared';
import type { TrackerRepository } from '@eshop-tracker/database';
import { runCatalogSync, runPriceSync } from '../src/sync.js';

const startedAt = new Date('2026-08-24T03:00:00.000Z');

const catalogItem: CatalogItem = {
  country: 'JP', source: 'nintendo', sourceId: '70010000000001', productCode: null,
  title: 'Example Game', publisher: null, developer: null, description: null, imageUrl: null,
  releaseDate: null, productType: 'game', sourceUrl: 'https://example.test/game', sourcePayload: {}
};

const observation: PriceObservation = {
  country: 'JP', source: 'nintendo', sourceId: '70010000000001', currency: 'JPY',
  regularAmountMinor: 1_000, discountAmountMinor: null, discountStartAt: null,
  discountEndAt: null, salesStatus: 'ON_SALE', observedAt: startedAt.toISOString()
};

function createRepository(overrides: Partial<TrackerRepository> = {}): TrackerRepository {
  return {
    migrate: vi.fn(async () => undefined),
    tryJobLock: vi.fn(async () => true),
    releaseJobLock: vi.fn(async () => undefined),
    startSyncRun: vi.fn(async () => 17),
    finishSyncRun: vi.fn(async () => undefined),
    upsertCatalog: vi.fn(async () => 1),
    activeSourceIds: vi.fn(async () => ['70010000000001']),
    recordPrices: vi.fn(async () => 1),
    close: vi.fn(async () => undefined),
    ...overrides
  };
}

function createAdapter(overrides: Partial<EshopAdapter> = {}): EshopAdapter {
  return {
    country: 'JP',
    fetchCatalog: vi.fn(async () => [catalogItem]),
    fetchPrices: vi.fn(async () => ({ observations: [observation], unavailableSourceIds: [] })),
    ...overrides
  };
}

function options(adapter: EshopAdapter, repository: TrackerRepository) {
  return {
    adapter,
    repository,
    source: 'nintendo',
    now: () => new Date(startedAt),
    retry: { baseDelayMs: 1, sleep: async () => undefined, random: () => 0.5 }
  };
}

describe('synchronization jobs', () => {
  it('writes catalog in one batch, records success, then releases its lock', async () => {
    const repository = createRepository();
    const adapter = createAdapter();

    await expect(runCatalogSync(options(adapter, repository))).resolves.toMatchObject({
      status: 'success', itemsRead: 1, itemsWritten: 1
    });

    expect(repository.upsertCatalog).toHaveBeenCalledWith([catalogItem], startedAt);
    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, {
      status: 'success', itemsRead: 1, itemsWritten: 1
    });
    expect(vi.mocked(repository.releaseJobLock).mock.invocationCallOrder[0])
      .toBeGreaterThan(vi.mocked(repository.finishSyncRun).mock.invocationCallOrder[0] ?? 0);
  });

  it('records available prices and marks unavailable listings partial without exposing IDs', async () => {
    const repository = createRepository({ activeSourceIds: vi.fn(async () => ['70010000000001', '70010000000002']) });
    const adapter = createAdapter({
      fetchPrices: vi.fn(async () => ({ observations: [observation], unavailableSourceIds: ['70010000000002'] }))
    });

    await expect(runPriceSync(options(adapter, repository))).resolves.toMatchObject({
      status: 'partial', itemsRead: 2, itemsWritten: 1
    });

    expect(adapter.fetchPrices).toHaveBeenCalledWith(['70010000000001', '70010000000002']);
    expect(repository.recordPrices).toHaveBeenCalledWith([observation]);
    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, {
      status: 'partial', itemsRead: 2, itemsWritten: 1,
      errorCode: 'UNAVAILABLE_LISTINGS',
      errorMessage: 'One or more requested listings were unavailable upstream'
    });
  });

  it('succeeds with no price fetch for an empty active listing set', async () => {
    const repository = createRepository({ activeSourceIds: vi.fn(async () => []) });
    const adapter = createAdapter();

    await expect(runPriceSync(options(adapter, repository))).resolves.toMatchObject({
      status: 'success', itemsRead: 0, itemsWritten: 0
    });

    expect(adapter.fetchPrices).not.toHaveBeenCalled();
    expect(repository.recordPrices).not.toHaveBeenCalled();
  });

  it('returns a skipped summary without creating a run when the job lock is unavailable', async () => {
    const repository = createRepository({ tryJobLock: vi.fn(async () => false) });
    const adapter = createAdapter();

    await expect(runCatalogSync(options(adapter, repository))).resolves.toMatchObject({
      status: 'skipped', itemsRead: 0, itemsWritten: 0
    });

    expect(adapter.fetchCatalog).not.toHaveBeenCalled();
    expect(repository.startSyncRun).not.toHaveBeenCalled();
    expect(repository.releaseJobLock).not.toHaveBeenCalled();
  });

  it('retries only the upstream catalog fetch, accounts for its failure, and preserves the original error', async () => {
    const upstreamError = new EshopError({ code: 'UPSTREAM_HTTP', status: 503, message: 'postgresql://user:secret@example.test/db', country: 'JP' });
    const repository = createRepository();
    const adapter = createAdapter({ fetchCatalog: vi.fn(async () => { throw upstreamError; }) });

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBe(upstreamError);

    expect(adapter.fetchCatalog).toHaveBeenCalledTimes(3);
    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, {
      status: 'failed', itemsRead: 0, itemsWritten: 0,
      errorCode: 'UPSTREAM_HTTP', errorMessage: '[redacted url]'
    });
    expect(repository.releaseJobLock).toHaveBeenCalledOnce();
  });

  it('redacts libpq-style connection strings from failed run accounting', async () => {
    const upstreamError = new EshopError({
      code: 'NETWORK',
      message: 'database host=localhost user=tracker password=secret dbname=eshop',
      country: 'JP'
    });
    const repository = createRepository();
    const adapter = createAdapter({ fetchCatalog: vi.fn(async () => { throw upstreamError; }) });

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBe(upstreamError);

    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, expect.objectContaining({
      status: 'failed', errorMessage: '[redacted connection string]'
    }));
  });

  it('does not retry a repository failure and preserves it if failure accounting also fails', async () => {
    const writeError = new Error('write failed');
    const finishError = new Error('finish failed');
    const repository = createRepository({
      upsertCatalog: vi.fn(async () => { throw writeError; }),
      finishSyncRun: vi.fn(async (id, result) => {
        if (result.status === 'failed') throw finishError;
      })
    });
    const adapter = createAdapter();

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBe(writeError);

    expect(adapter.fetchCatalog).toHaveBeenCalledOnce();
    expect(repository.releaseJobLock).toHaveBeenCalledOnce();
  });

  it('rejects contradictory price classifications before persistence', async () => {
    const repository = createRepository();
    const adapter = createAdapter({
      fetchPrices: vi.fn(async () => ({ observations: [observation], unavailableSourceIds: ['70010000000001'] }))
    });

    await expect(runPriceSync(options(adapter, repository))).rejects.toThrow('inconsistent source ID classifications');

    expect(repository.recordPrices).not.toHaveBeenCalled();
    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, expect.objectContaining({ status: 'failed' }));
  });
});
