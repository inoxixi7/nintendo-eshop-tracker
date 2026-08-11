import type { EshopAdapter, EshopErrorOptions, PriceFetchResult } from '../src/index.js';

declare const adapter: EshopAdapter;
declare const signal: AbortSignal;
declare const sourceIds: readonly ['70010000000141', '70010000000185'];

adapter.fetchCatalog(signal);
const result: Promise<PriceFetchResult> = adapter.fetchPrices(sourceIds, signal);

void result;

const upstreamHttpError: EshopErrorOptions = {
  code: 'UPSTREAM_HTTP',
  message: 'eShop returned an error response',
  country: 'JP',
  status: 503
};

void upstreamHttpError;

// @ts-expect-error UPSTREAM_HTTP errors must provide the upstream status.
const missingUpstreamStatus: EshopErrorOptions = {
  code: 'UPSTREAM_HTTP',
  message: 'eShop returned an error response',
  country: 'JP'
};

// @ts-expect-error Non-HTTP errors cannot claim an HTTP status.
const networkErrorWithStatus: EshopErrorOptions = {
  code: 'NETWORK',
  message: 'Network request failed',
  country: 'JP',
  status: 503
};

void missingUpstreamStatus;
void networkErrorWithStatus;
