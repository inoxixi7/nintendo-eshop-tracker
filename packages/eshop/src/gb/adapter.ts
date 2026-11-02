import type { EshopAdapter } from '../adapter.js';
import { NintendoPriceClient } from '../nintendo-price/client.js';
import type { FetchLike } from '../upstream-json.js';
import { GbCatalogClient } from './catalog-client.js';

export interface GbEshopAdapterOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

export function createGbEshopAdapter(options: GbEshopAdapterOptions = {}): EshopAdapter {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const catalog = new GbCatalogClient({ fetch });
  const prices = new NintendoPriceClient({ fetch, now: options.now ?? (() => new Date()), country: 'GB' });

  return {
    country: 'GB',
    fetchCatalog: (signal) => catalog.fetchAll(signal),
    fetchPrices: (sourceIds, signal) => prices.fetchPrices(sourceIds, signal)
  };
}
