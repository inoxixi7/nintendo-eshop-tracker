import type { EshopAdapter, PriceFetchResult } from '@eshop-tracker/eshop';
import { EshopError } from '@eshop-tracker/eshop';
import type { CountryCode, PriceObservation, TitleAlias } from '@eshop-tracker/shared';
import type { JobType, SyncRunResult, TrackerRepository } from '@eshop-tracker/database';
import { withRetry, type RetryOptions } from './retry.js';

export interface SyncOptions {
  adapter: EshopAdapter;
  repository: TrackerRepository;
  /** Catalog provenance and durable regional-listing identity, e.g. `nintendo-jp-search`. */
  listingSource: string;
  /** Price API provenance before observations are linked to a regional listing: `nintendo-price-api`. */
  priceSource: string;
  now: () => Date;
  retry?: Omit<RetryOptions, 'signal'>;
  signal?: AbortSignal;
  /** Other-language titles for search; refreshed after each catalog sync when provided. */
  fetchTitleAliases?: (signal?: AbortSignal) => Promise<TitleAlias[]>;
  /** Hand-kept names per exact JP title, read at the start of each catalog sync. */
  loadSearchNames?: () => Promise<ReadonlyMap<string, readonly string[]>>;
}

/** One store's adapter and provenance; the worker syncs each in turn. */
export type RegionSync = Pick<SyncOptions, 'adapter' | 'listingSource' | 'priceSource' | 'fetchTitleAliases' | 'loadSearchNames'>;

export interface SyncSummary {
  jobType: JobType;
  country: CountryCode;
  status: 'success' | 'partial' | 'skipped';
  itemsRead: number;
  itemsWritten: number;
}

type CompletedSync = Omit<SyncSummary, 'jobType' | 'country' | 'status'> & {
  status: 'success' | 'partial';
  result: SyncRunResult;
};

interface SyncProgress {
  itemsRead: number;
  itemsWritten: number;
}

const FAILURE_CODE = 'SYNC_FAILURE';
const PARTIAL_CODE = 'UNAVAILABLE_LISTINGS';
const PARTIAL_MESSAGE = 'One or more requested listings were unavailable upstream';
const ALIASES_CODE = 'TITLE_ALIASES_FAILED';
const ALIASES_MESSAGE = 'Catalog saved; other-language titles were not refreshed';

function assertSource(source: string, name: string): void {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function readNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('now must return a valid Date');
  }
  return value;
}

function sanitizedFailure(error: unknown): Pick<SyncRunResult, 'errorCode' | 'errorMessage'> {
  if (!(error instanceof EshopError)) {
    return { errorCode: FAILURE_CODE, errorMessage: 'Synchronization failed' };
  }

  switch (error.code) {
    case 'NETWORK':
      return { errorCode: 'NETWORK', errorMessage: 'Network request failed' };
    case 'INVALID_PAYLOAD':
      return { errorCode: 'INVALID_PAYLOAD', errorMessage: 'Upstream response was invalid' };
    case 'UNSUPPORTED_COUNTRY':
      return { errorCode: 'UNSUPPORTED_COUNTRY', errorMessage: 'Country is not supported' };
    case 'UPSTREAM_HTTP':
      return {
        errorCode: 'UPSTREAM_HTTP',
        errorMessage: Number.isSafeInteger(error.status)
          ? `Upstream HTTP request failed (status ${error.status})`
          : 'Upstream HTTP request failed'
      };
    default:
      return { errorCode: FAILURE_CODE, errorMessage: 'Synchronization failed' };
  }
}

function inconsistentPriceResult(): never {
  throw new Error('Price fetch result has inconsistent source ID classifications');
}

/**
 * The adapter returns normalized observations; this verifies that its two result
 * classifications are disjoint and cover exactly the requested source IDs before
 * writing any price data.
 */
function validatePriceResult(
  result: PriceFetchResult,
  requestedSourceIds: readonly string[],
  country: CountryCode,
  priceSource: string
): readonly PriceObservation[] {
  if (!Array.isArray(result.observations) || !Array.isArray(result.unavailableSourceIds)) {
    return inconsistentPriceResult();
  }
  const requested = new Set(requestedSourceIds);
  if (requested.size !== requestedSourceIds.length) {
    return inconsistentPriceResult();
  }

  const unavailable = new Set<string>();
  for (const sourceId of result.unavailableSourceIds) {
    if (typeof sourceId !== 'string' || unavailable.has(sourceId) || !requested.has(sourceId)) {
      return inconsistentPriceResult();
    }
    unavailable.add(sourceId);
  }

  const observed = new Set<string>();
  for (const observation of result.observations) {
    if (
      observation.country !== country
      || observation.source !== priceSource
      || typeof observation.sourceId !== 'string'
      || !requested.has(observation.sourceId)
      || unavailable.has(observation.sourceId)
      || observed.has(observation.sourceId)
    ) {
      return inconsistentPriceResult();
    }
    observed.add(observation.sourceId);
  }

  for (const sourceId of requested) {
    if (!unavailable.has(sourceId) && !observed.has(sourceId)) {
      return inconsistentPriceResult();
    }
  }
  return result.observations;
}

/**
 * Price observations retain the upstream API provenance through validation, then
 * are intentionally reassigned to the catalog source before persistence because
 * TrackerRepository resolves price identity through regional_listings.
 */
function mapObservationsToListingSource(
  observations: readonly PriceObservation[],
  listingSource: string
): PriceObservation[] {
  return observations.map((observation) => ({ ...observation, source: listingSource }));
}

function retryOptions(options: SyncOptions): RetryOptions | undefined {
  const retry = options.retry as RetryOptions | undefined;
  if (retry === undefined) {
    return options.signal === undefined ? undefined : { signal: options.signal };
  }
  const { signal: _ignoredNestedSignal, ...policy } = retry;
  return options.signal === undefined ? policy : { ...policy, signal: options.signal };
}

async function runSync(
  jobType: JobType,
  options: SyncOptions,
  execute: (startedAt: Date, progress: SyncProgress) => Promise<CompletedSync>
): Promise<SyncSummary> {
  assertSource(options.listingSource, 'listingSource');
  assertSource(options.priceSource, 'priceSource');
  const { adapter, repository } = options;
  const country = adapter.country;
  const acquired = await repository.tryJobLock(jobType, country);
  if (!acquired) {
    return { jobType, country, status: 'skipped', itemsRead: 0, itemsWritten: 0 };
  }

  let runId: number | undefined;
  let summary: SyncSummary | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;
  const progress: SyncProgress = { itemsRead: 0, itemsWritten: 0 };
  try {
    try {
      // One timestamp makes the catalog batch's last_seen_at and run start auditable together.
      const startedAt = readNow(options.now);
      runId = await repository.startSyncRun(jobType, country, startedAt);
      const completed = await execute(startedAt, progress);
      await repository.finishSyncRun(runId, completed.result);
      summary = { jobType, country, status: completed.status, itemsRead: completed.itemsRead, itemsWritten: completed.itemsWritten };
    } catch (error) {
      hasPrimaryError = true;
      primaryError = error;
      if (runId !== undefined) {
        try {
          await repository.finishSyncRun(runId, {
            status: 'failed',
            itemsRead: progress.itemsRead,
            itemsWritten: progress.itemsWritten,
            ...sanitizedFailure(error)
          });
        } catch {
          // Keep the operation error identifiable; accounting failure is secondary.
        }
      }
    }
  } finally {
    try {
      await repository.releaseJobLock(jobType, country);
    } catch (releaseError) {
      if (!hasPrimaryError) {
        hasPrimaryError = true;
        primaryError = releaseError;
      }
    }
  }

  if (hasPrimaryError) {
    throw primaryError;
  }
  if (summary === undefined) {
    throw new Error('Synchronization did not produce a result');
  }
  return summary;
}

export function runCatalogSync(options: SyncOptions): Promise<SyncSummary> {
  return runSync('catalog', options, async (startedAt, progress) => {
    // read first so a broken table fails the run before any catalog request
    const searchNames = await options.loadSearchNames?.();
    const items = await withRetry(() => options.adapter.fetchCatalog(options.signal), retryOptions(options));
    progress.itemsRead = items.length;
    if (items.some((item) => item.country !== options.adapter.country || item.source !== options.listingSource)) {
      throw new Error('Catalog fetch result does not match the configured listing source');
    }
    const itemsWritten = await options.repository.upsertCatalog(items, startedAt, searchNames);
    progress.itemsWritten = itemsWritten;
    if (options.fetchTitleAliases !== undefined) {
      const fetchAliases = options.fetchTitleAliases;
      try {
        const aliases = await withRetry(() => fetchAliases(options.signal), retryOptions(options));
        await options.repository.replaceTitleAliases(aliases);
      } catch (error) {
        if (options.signal?.aborted === true) throw error;
        // Search keeps the previous aliases; the catalog itself is already saved.
        return {
          status: 'partial',
          itemsRead: items.length,
          itemsWritten,
          result: { status: 'partial', itemsRead: items.length, itemsWritten, errorCode: ALIASES_CODE, errorMessage: ALIASES_MESSAGE }
        };
      }
    }
    return {
      status: 'success',
      itemsRead: items.length,
      itemsWritten,
      result: { status: 'success', itemsRead: items.length, itemsWritten }
    };
  });
}

export function runPriceSync(options: SyncOptions): Promise<SyncSummary> {
  return runSync('prices', options, async (_startedAt, progress) => {
    const sourceIds = await options.repository.activeSourceIds(options.adapter.country, options.listingSource);
    if (sourceIds.length === 0) {
      return {
        status: 'success',
        itemsRead: 0,
        itemsWritten: 0,
        result: { status: 'success', itemsRead: 0, itemsWritten: 0 }
      };
    }

    const result = await withRetry(
      () => options.adapter.fetchPrices(sourceIds, options.signal),
      retryOptions(options)
    );
    progress.itemsRead = sourceIds.length;
    const observations = validatePriceResult(result, sourceIds, options.adapter.country, options.priceSource);
    const itemsWritten = await options.repository.recordPrices(
      mapObservationsToListingSource(observations, options.listingSource)
    );
    progress.itemsWritten = itemsWritten;
    const status = result.unavailableSourceIds.length > 0 ? 'partial' : 'success';
    const accounting: SyncRunResult = status === 'partial'
      ? {
          status,
          itemsRead: sourceIds.length,
          itemsWritten,
          errorCode: PARTIAL_CODE,
          errorMessage: PARTIAL_MESSAGE
        }
      : { status, itemsRead: sourceIds.length, itemsWritten };
    return { status, itemsRead: sourceIds.length, itemsWritten, result: accounting };
  });
}
