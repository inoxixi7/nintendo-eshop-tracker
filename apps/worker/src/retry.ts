import { EshopError } from '@eshop-tracker/eshop';

export interface RetryOptions {
  /** Includes the initial request. Defaults to three total attempts. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Adds a uniformly distributed delay in the range [-jitterMs, +jitterMs]. */
  jitterMs?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  signal?: AbortSignal;
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

function abortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException('The operation was aborted', 'AbortError')
    : signal.reason;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, delayMs);
    function done(): void {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted(): void {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', aborted);
      if (signal === undefined) {
        reject(new DOMException('The operation was aborted', 'AbortError'));
        return;
      }
      reject(abortReason(signal));
    }
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) {
      aborted();
    }
  });
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
  const signal = options.signal;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await operation();
    } catch (error) {
      throwIfAborted(signal);
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }

      const randomValue = random();
      if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
        throw new Error('random must return a finite number in [0, 1)');
      }
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const jitter = Math.floor(randomValue * (jitterMs * 2 + 1)) - jitterMs;
      const delayMs = Math.max(0, Math.min(maxDelayMs, exponentialDelay + jitter));
      await sleep(delayMs, signal);
      throwIfAborted(signal);
    }
  }

  throw new Error('Retry attempts were exhausted');
}
