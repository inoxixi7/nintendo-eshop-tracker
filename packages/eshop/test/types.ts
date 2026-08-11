import { createJapanEshopAdapter } from '../src/index.js';
import type {
  EshopAdapter,
  EshopErrorOptions,
  JapanEshopAdapterOptions,
  PriceFetchResult
} from '../src/index.js';

declare const adapter: EshopAdapter;
declare const signal: AbortSignal;
declare const sourceIds: readonly ['70010000000141', '70010000000185'];

adapter.fetchCatalog(signal);
adapter.fetchPrices(sourceIds);
const result: Promise<PriceFetchResult> = adapter.fetchPrices(sourceIds, signal);

void result;

const japanAdapter: EshopAdapter = createJapanEshopAdapter();
const injectedAdapter: EshopAdapter = createJapanEshopAdapter({
  fetch: globalThis.fetch,
  now: () => new Date('2026-08-11T00:00:00Z')
});
const readonlyOptions: Readonly<JapanEshopAdapterOptions> = {
  fetch: globalThis.fetch,
  now: () => new Date('2026-08-11T00:00:00Z')
};
const readonlyOptionsAdapter: EshopAdapter = createJapanEshopAdapter(readonlyOptions);
declare const japanOptions: JapanEshopAdapterOptions;

// @ts-expect-error Injected fetch is immutable after options construction.
japanOptions.fetch = globalThis.fetch;
// @ts-expect-error Injected clock is immutable after options construction.
japanOptions.now = () => new Date();

// @ts-expect-error The public factory only accepts dependency injection options.
createJapanEshopAdapter({ country: 'JP' });

void japanAdapter;
void injectedAdapter;
void readonlyOptionsAdapter;

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
