import type { CountryCode } from '@eshop-tracker/shared';
import { EshopError } from './errors.js';

export type FetchLike = typeof globalThis.fetch;

interface RequestJsonOptions {
  fetch: FetchLike;
  url: URL;
  country: CountryCode;
  signal?: AbortSignal | undefined;
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}

function rethrowCancellation(cause: unknown, signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    const reason = signal.reason;
    throw reason === undefined ? cause : reason;
  }
  if (isAbortError(cause)) throw cause;
}

export async function requestJson(options: RequestJsonOptions): Promise<unknown> {
  let response: Response;

  try {
    const init = options.signal === undefined ? undefined : { signal: options.signal };
    response = await options.fetch(options.url, init);
  } catch (cause) {
    rethrowCancellation(cause, options.signal);

    throw new EshopError({
      code: 'NETWORK',
      message: 'Nintendo eShop request failed',
      country: options.country,
      cause
    });
  }

  if (!response.ok) {
    throw new EshopError({
      code: 'UPSTREAM_HTTP',
      message: 'Nintendo eShop returned an error response',
      country: options.country,
      status: response.status
    });
  }

  try {
    return await response.json();
  } catch (cause) {
    rethrowCancellation(cause, options.signal);

    throw new EshopError({
      code: 'INVALID_PAYLOAD',
      message: 'Nintendo eShop returned invalid JSON',
      country: options.country,
      cause
    });
  }
}
