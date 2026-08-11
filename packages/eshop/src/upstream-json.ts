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

export async function requestJson(options: RequestJsonOptions): Promise<unknown> {
  let response: Response;

  try {
    const init = options.signal === undefined ? undefined : { signal: options.signal };
    response = await options.fetch(options.url, init);
  } catch (cause) {
    if (options.signal?.aborted === true) throw options.signal.reason ?? cause;
    if (isAbortError(cause)) throw cause;

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
    throw new EshopError({
      code: 'INVALID_PAYLOAD',
      message: 'Nintendo eShop returned invalid JSON',
      country: options.country,
      cause
    });
  }
}
