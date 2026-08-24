import { EshopError } from '@eshop-tracker/eshop';

export interface RetryOptions {
  /** Includes the initial request. Defaults to three total attempts. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Adds a uniformly distributed delay in the range [-jitterMs, +jitterMs]. */
  jitterMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_JITTER_MS = 100;

function assertNonnegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > DEFAULT_MAX_ATTEMPTS) {
    throw new Error(`${name} must be a positive safe integer no greater than ${DEFAULT_MAX_ATTEMPTS}`);
  }
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof EshopError)) {
    return false;
  }
  return error.code === 'NETWORK'
    || (error.code === 'UPSTREAM_HTTP' && (error.status === 429 || (error.status !== undefined && error.status >= 500 && error.status <= 599)));
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Retries only explicitly classified transient upstream failures. */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
  assertPositiveSafeInteger(maxAttempts, 'maxAttempts');
  assertNonnegativeSafeInteger(baseDelayMs, 'baseDelayMs');
  assertNonnegativeSafeInteger(maxDelayMs, 'maxDelayMs');
  assertNonnegativeSafeInteger(jitterMs, 'jitterMs');

  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }

      const randomValue = random();
      if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
        throw new Error('random must return a finite number in [0, 1)');
      }
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const jitter = Math.floor((randomValue * 2 - 1) * jitterMs);
      const delayMs = Math.max(0, Math.min(maxDelayMs, exponentialDelay + jitter));
      await sleep(delayMs);
    }
  }

  throw new Error('Retry attempts were exhausted');
}
