import type { EshopAdapter, PriceFetchResult } from '@eshop-tracker/eshop';
import { EshopError } from '@eshop-tracker/eshop';
import type { CountryCode, PriceObservation } from '@eshop-tracker/shared';
import type { JobType, SyncRunResult, TrackerRepository } from '@eshop-tracker/database';
import { withRetry, type RetryOptions } from './retry.js';

export interface SyncOptions {
  adapter: EshopAdapter;
  repository: TrackerRepository;
  /** JP adapter source: `nintendo`. */
  source: string;
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
const MAX_ERROR_MESSAGE_LENGTH = 500;

function assertSource(source: string): void {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error('source must be a non-empty string');
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
  const errorCode = error instanceof EshopError && /^[A-Z_]{1,64}$/.test(error.code)
    ? error.code
    : FAILURE_CODE;
  const originalMessage = error instanceof Error ? error.message : 'Synchronization failed';
  const firstLine = originalMessage.split(/[\r\n]/, 1)[0] ?? 'Synchronization failed';
  if (/\b(?:host|port|dbname|database|user|username|sslmode)\s*=/i.test(firstLine)) {
    return { errorCode, errorMessage: '[redacted connection string]' };
  }
  const sanitized = firstLine
    .replace(/\b[a-z][a-z\d+.-]*:\/\/\S+/gi, '[redacted url]')
    .replace(/\b(password|passwd|token|secret|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    errorCode,
    errorMessage: (sanitized || 'Synchronization failed').slice(0, MAX_ERROR_MESSAGE_LENGTH)
  };
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
  source: string
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
      || observation.source !== source
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

async function runSync(
  jobType: JobType,
  options: SyncOptions,
  execute: (startedAt: Date) => Promise<CompletedSync>
): Promise<SyncSummary> {
  assertSource(options.source);
  const { adapter, repository } = options;
  const country = adapter.country;
  const acquired = await repository.tryJobLock(jobType, country);
  if (!acquired) {
    return { jobType, country, status: 'skipped', itemsRead: 0, itemsWritten: 0 };
  }

  let runId: number | undefined;
  let summary: SyncSummary | undefined;
  let primaryError: unknown;
  try {
    try {
      // One timestamp makes the catalog batch's last_seen_at and run start auditable together.
      const startedAt = readNow(options.now);
      runId = await repository.startSyncRun(jobType, country, startedAt);
      const completed = await execute(startedAt);
      await repository.finishSyncRun(runId, completed.result);
      summary = { jobType, country, status: completed.status, itemsRead: completed.itemsRead, itemsWritten: completed.itemsWritten };
    } catch (error) {
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
      if (primaryError === undefined) {
        primaryError = releaseError;
      }
    }
  }

  if (primaryError !== undefined) {
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
    const sourceIds = await options.repository.activeSourceIds(options.adapter.country, options.source);
    if (sourceIds.length === 0) {
      return {
        status: 'success',
        itemsRead: 0,
        itemsWritten: 0,
        result: { status: 'success', itemsRead: 0, itemsWritten: 0 }
      };
    }

    const result = await withRetry(() => options.adapter.fetchPrices(sourceIds), options.retry);
    const observations = validatePriceResult(result, sourceIds, options.adapter.country, options.source);
    const itemsWritten = await options.repository.recordPrices(observations);
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
