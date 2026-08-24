import type { EshopAdapter, PriceFetchResult } from '@eshop-tracker/eshop';
import { EshopError } from '@eshop-tracker/eshop';
import type { CountryCode, PriceObservation } from '@eshop-tracker/shared';
import type { JobType, SyncRunResult, TrackerRepository } from '@eshop-tracker/database';
import { withRetry, type RetryOptions } from './retry.js';

export interface SyncOptions {
  adapter: EshopAdapter;
  repository: TrackerRepository;
  /** JP catalog provenance and durable regional-listing identity: `nintendo-jp-search`. */
  listingSource: string;
  /** JP price API provenance before observations are linked to a regional listing: `nintendo-price-api`. */
  priceSource: string;
  now: () => Date;
  retry?: RetryOptions;
}

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

const FAILURE_CODE = 'SYNC_FAILURE';
const PARTIAL_CODE = 'UNAVAILABLE_LISTINGS';
const PARTIAL_MESSAGE = 'One or more requested listings were unavailable upstream';

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

async function runSync(
  jobType: JobType,
  options: SyncOptions,
  execute: (startedAt: Date) => Promise<CompletedSync>
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
  try {
    try {
      // One timestamp makes the catalog batch's last_seen_at and run start auditable together.
      const startedAt = readNow(options.now);
      runId = await repository.startSyncRun(jobType, country, startedAt);
      const completed = await execute(startedAt);
      await repository.finishSyncRun(runId, completed.result);
      summary = { jobType, country, status: completed.status, itemsRead: completed.itemsRead, itemsWritten: completed.itemsWritten };
    } catch (error) {
      hasPrimaryError = true;
      primaryError = error;
      if (runId !== undefined) {
        try {
          await repository.finishSyncRun(runId, {
            status: 'failed',
            itemsRead: 0,
            itemsWritten: 0,
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
  return runSync('catalog', options, async (startedAt) => {
    const items = await withRetry(() => options.adapter.fetchCatalog(), options.retry);
    if (items.some((item) => item.country !== options.adapter.country || item.source !== options.listingSource)) {
      throw new Error('Catalog fetch result does not match the configured listing source');
    }
    const itemsWritten = await options.repository.upsertCatalog(items, startedAt);
    return {
      status: 'success',
      itemsRead: items.length,
      itemsWritten,
      result: { status: 'success', itemsRead: items.length, itemsWritten }
    };
  });
}

export function runPriceSync(options: SyncOptions): Promise<SyncSummary> {
  return runSync('prices', options, async () => {
    const sourceIds = await options.repository.activeSourceIds(options.adapter.country, options.listingSource);
    if (sourceIds.length === 0) {
      return {
        status: 'success',
        itemsRead: 0,
        itemsWritten: 0,
        result: { status: 'success', itemsRead: 0, itemsWritten: 0 }
      };
    }

    const result = await withRetry(() => options.adapter.fetchPrices(sourceIds), options.retry);
    const observations = validatePriceResult(result, sourceIds, options.adapter.country, options.priceSource);
    const itemsWritten = await options.repository.recordPrices(
      mapObservationsToListingSource(observations, options.listingSource)
    );
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
