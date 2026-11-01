import type { EshopAdapter } from '../adapter.js';
import { NintendoPriceClient } from '../nintendo-price/client.js';
import type { FetchLike } from '../upstream-json.js';
import { UsCatalogClient } from './catalog-client.js';

export interface UsEshopAdapterOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

export function createUsEshopAdapter(options: UsEshopAdapterOptions = {}): EshopAdapter {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const catalog = new UsCatalogClient({ fetch });
  const prices = new NintendoPriceClient({ fetch, now: options.now ?? (() => new Date()), country: 'US' });

  return {
    country: 'US',
    fetchCatalog: (signal) => catalog.fetchAll(signal),
    fetchPrices: (sourceIds, signal) => prices.fetchPrices(sourceIds, signal)
  };
}
