import type { EshopAdapter } from '../adapter.js';
import { NintendoPriceClient } from '../nintendo-price/client.js';
import type { FetchLike } from '../upstream-json.js';
import { JapanCatalogClient } from './catalog-client.js';

export interface JapanEshopAdapterOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

export function createJapanEshopAdapter(
  options: JapanEshopAdapterOptions = {}
): EshopAdapter {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => new Date());
  const catalog = new JapanCatalogClient({ fetch });
  const prices = new NintendoPriceClient({ fetch, now });

  return {
    country: 'JP',
    fetchCatalog: (signal) => catalog.fetchAll(signal),
    fetchPrices: (sourceIds, signal) => prices.fetchPrices(sourceIds, signal)
  };
}
