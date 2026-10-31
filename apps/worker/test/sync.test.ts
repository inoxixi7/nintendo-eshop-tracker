import { describe, expect, it, vi } from 'vitest';
import { EshopError, type EshopAdapter } from '@eshop-tracker/eshop';
import type { CatalogItem, PriceObservation } from '@eshop-tracker/shared';
import type { TrackerRepository } from '@eshop-tracker/database';
import { runCatalogSync, runPriceSync, type SyncOptions } from '../src/sync.js';

const startedAt = new Date('2026-08-24T03:00:00.000Z');

// @ts-expect-error cancellation belongs to SyncOptions.signal, never retry policy.
const invalidRetryPolicy: NonNullable<SyncOptions['retry']> = { signal: new AbortController().signal };
void invalidRetryPolicy;

const catalogItem: CatalogItem = {
  country: 'JP', source: 'nintendo-jp-search', sourceId: '70010000000001', productCode: null,
  title: 'Example Game', publisher: null, developer: null, description: null, imageUrl: null,
  releaseDate: null, productType: 'game', platform: 'switch', sourceUrl: 'https://example.test/game', sourcePayload: {}
};

const observation: PriceObservation = {
  country: 'JP', source: 'nintendo-price-api', sourceId: '70010000000001', currency: 'JPY',
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
    listingSource: 'nintendo-jp-search',
    priceSource: 'nintendo-price-api',
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

  it('passes an optional abort signal to both upstream adapter calls', async () => {
    const controller = new AbortController();
    const catalogRepository = createRepository();
    const priceRepository = createRepository();
    const adapter = createAdapter();

    await runCatalogSync({ ...options(adapter, catalogRepository), signal: controller.signal });
    await runPriceSync({ ...options(adapter, priceRepository), signal: controller.signal });

    expect(adapter.fetchCatalog).toHaveBeenCalledWith(controller.signal);
    expect(adapter.fetchPrices).toHaveBeenCalledWith(['70010000000001'], controller.signal);
  });

  it('ignores untyped nested retry signals and uses only the top-level signal', async () => {
    const nestedController = new AbortController();
    nestedController.abort(new EshopError({ code: 'NETWORK', message: 'nested cancellation', country: 'JP' }));
    const topLevelController = new AbortController();
    const nestedOnlyRepository = createRepository();
    const topLevelRepository = createRepository();
    const adapter = createAdapter();
    const nestedRetry = { ...options(adapter, nestedOnlyRepository).retry, signal: nestedController.signal };

    await expect(runCatalogSync({
      ...options(adapter, nestedOnlyRepository), retry: nestedRetry
    } as unknown as SyncOptions)).resolves.toMatchObject({ status: 'success' });
    await expect(runCatalogSync({
      ...options(adapter, topLevelRepository), retry: nestedRetry, signal: topLevelController.signal
    } as unknown as SyncOptions)).resolves.toMatchObject({ status: 'success' });

    expect(adapter.fetchCatalog).toHaveBeenNthCalledWith(1, undefined);
    expect(adapter.fetchCatalog).toHaveBeenNthCalledWith(2, topLevelController.signal);
  });

  it('records available prices and marks unavailable listings partial without exposing IDs', async () => {
    const repository = createRepository({ activeSourceIds: vi.fn(async () => ['70010000000001', '70010000000002']) });
    const adapter = createAdapter({
      fetchPrices: vi.fn(async () => ({ observations: [observation], unavailableSourceIds: ['70010000000002'] }))
    });

    await expect(runPriceSync(options(adapter, repository))).resolves.toMatchObject({
      status: 'partial', itemsRead: 2, itemsWritten: 1
    });

    expect(repository.activeSourceIds).toHaveBeenCalledWith('JP', 'nintendo-jp-search');
    expect(adapter.fetchPrices).toHaveBeenCalledWith(['70010000000001', '70010000000002'], undefined);
    expect(repository.recordPrices).toHaveBeenCalledWith([{ ...observation, source: 'nintendo-jp-search' }]);
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

  it('maps JP price provenance back to listing identity when every listing is unavailable', async () => {
    const repository = createRepository({
      activeSourceIds: vi.fn(async () => ['70010000000001', '70010000000002']),
      recordPrices: vi.fn(async () => 0)
    });
    const adapter = createAdapter({
      fetchPrices: vi.fn(async () => ({ observations: [], unavailableSourceIds: ['70010000000001', '70010000000002'] }))
    });

    await expect(runPriceSync(options(adapter, repository))).resolves.toMatchObject({
      status: 'partial', itemsRead: 2, itemsWritten: 0
    });

    expect(repository.activeSourceIds).toHaveBeenCalledWith('JP', 'nintendo-jp-search');
    expect(repository.recordPrices).toHaveBeenCalledWith([]);
    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, expect.objectContaining({
      status: 'partial', errorCode: 'UNAVAILABLE_LISTINGS'
    }));
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
      errorCode: 'UPSTREAM_HTTP', errorMessage: 'Upstream HTTP request failed (status 503)'
    });
    expect(repository.releaseJobLock).toHaveBeenCalledOnce();
  });

  it('does not persist a libpq-style connection string from failed run accounting', async () => {
    const upstreamError = new EshopError({
      code: 'NETWORK',
      message: 'database host=localhost user=tracker dbname=eshop',
      country: 'JP'
    });
    const repository = createRepository();
    const adapter = createAdapter({ fetchCatalog: vi.fn(async () => { throw upstreamError; }) });

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBe(upstreamError);

    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, expect.objectContaining({
      status: 'failed', errorMessage: 'Network request failed'
    }));
  });

  it.each([
    'Authorization: Bearer bearer-value',
    'Authorization = Bearer bearer-value',
    'Proxy-Authorization: Basic basic-value',
    'Cookie: session=cookie-value',
    'Set-Cookie: session=cookie-value',
    'client_secret=client-secret-value',
    'access_token=access-token-value',
    'refresh_token=refresh-token-value',
    'id_token=id-token-value',
    'password=password-value',
    'passwd=passwd-value',
    'token=token-value',
    'secret=secret-value',
    'api_key=api-key-value',
    'AWS_SECRET_ACCESS_KEY=aws-secret-value',
    'PGPASSWORD=pg-password-value',
    'credential=credential-value'
  ])('never persists a failed run message that contains a secret (%s)', async (message) => {
    const error = new EshopError({ code: 'NETWORK', message, country: 'JP' });
    const repository = createRepository();
    const adapter = createAdapter({ fetchCatalog: vi.fn(async () => { throw error; }) });

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBe(error);

    const result = vi.mocked(repository.finishSyncRun).mock.calls[0]?.[1];
    expect(result).toEqual(expect.objectContaining({ errorMessage: 'Network request failed' }));
    expect(result?.errorMessage).not.toContain(message);
  });

  it('uses a fixed safe message for arbitrary unknown failures', async () => {
    const message = 'internal credential=unknown-secret-value';
    const error = new Error(message);
    const repository = createRepository();
    const adapter = createAdapter({ fetchCatalog: vi.fn(async () => { throw error; }) });

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBe(error);

    const result = vi.mocked(repository.finishSyncRun).mock.calls[0]?.[1];
    expect(result).toEqual(expect.objectContaining({
      errorCode: 'SYNC_FAILURE', errorMessage: 'Synchronization failed'
    }));
    expect(result?.errorMessage).not.toContain(message);
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
    expect(repository.upsertCatalog).toHaveBeenCalledOnce();
    expect(repository.releaseJobLock).toHaveBeenCalledOnce();
  });

  it('accounts for catalog items read when catalog persistence fails', async () => {
    const writeError = new Error('catalog write failed');
    const repository = createRepository({ upsertCatalog: vi.fn(async () => { throw writeError; }) });
    const adapter = createAdapter();

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBe(writeError);

    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, expect.objectContaining({
      status: 'failed', itemsRead: 1, itemsWritten: 0
    }));
  });

  it('accounts for price items read when price persistence fails', async () => {
    const writeError = new Error('price write failed');
    const repository = createRepository({ recordPrices: vi.fn(async () => { throw writeError; }) });
    const adapter = createAdapter();

    await expect(runPriceSync(options(adapter, repository))).rejects.toBe(writeError);

    expect(repository.finishSyncRun).toHaveBeenCalledWith(17, expect.objectContaining({
      status: 'failed', itemsRead: 1, itemsWritten: 0
    }));
  });

  it('uses completed catalog counts when success finalization fails', async () => {
    const finalizationError = new Error('catalog finalization failed');
    const repository = createRepository({
      finishSyncRun: vi.fn(async (_id, result) => {
        if (result.status === 'success') throw finalizationError;
      })
    });
    const adapter = createAdapter();

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBe(finalizationError);

    expect(repository.finishSyncRun).toHaveBeenLastCalledWith(17, expect.objectContaining({
      status: 'failed', itemsRead: 1, itemsWritten: 1
    }));
  });

  it('uses completed price counts when success finalization fails', async () => {
    const finalizationError = new Error('price finalization failed');
    const repository = createRepository({
      finishSyncRun: vi.fn(async (_id, result) => {
        if (result.status === 'success') throw finalizationError;
      })
    });
    const adapter = createAdapter();

    await expect(runPriceSync(options(adapter, repository))).rejects.toBe(finalizationError);

    expect(repository.finishSyncRun).toHaveBeenLastCalledWith(17, expect.objectContaining({
      status: 'failed', itemsRead: 1, itemsWritten: 1
    }));
  });

  it('does not retry a repository active-listing read failure', async () => {
    const readError = new Error('database read failed');
    const repository = createRepository({ activeSourceIds: vi.fn(async () => { throw readError; }) });
    const adapter = createAdapter();

    await expect(runPriceSync(options(adapter, repository))).rejects.toBe(readError);

    expect(repository.activeSourceIds).toHaveBeenCalledOnce();
    expect(adapter.fetchPrices).not.toHaveBeenCalled();
  });

  it('does not retry a repository price-persistence failure', async () => {
    const writeError = new Error('database price write failed');
    const repository = createRepository({ recordPrices: vi.fn(async () => { throw writeError; }) });
    const adapter = createAdapter();

    await expect(runPriceSync(options(adapter, repository))).rejects.toBe(writeError);

    expect(adapter.fetchPrices).toHaveBeenCalledOnce();
    expect(repository.recordPrices).toHaveBeenCalledOnce();
  });

  it('preserves an undefined primary failure when lock release also fails', async () => {
    const releaseError = new Error('lock release failed');
    const repository = createRepository({ releaseJobLock: vi.fn(async () => { throw releaseError; }) });
    const adapter = createAdapter({ fetchCatalog: vi.fn(async () => { throw undefined; }) });

    await expect(runCatalogSync(options(adapter, repository))).rejects.toBeUndefined();

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
