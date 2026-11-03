import type { EshopAdapter } from '../adapter.js';
import { NintendoPriceClient } from '../nintendo-price/client.js';
import type { FetchLike } from '../upstream-json.js';
import { UsCatalogClient } from './catalog-client.js';
import type { AmericasCountry } from './normalize-catalog-item.js';

export interface UsEshopAdapterOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
  /** Canada, Mexico and Brazil use the same storefront and title IDs as the US. */
  readonly country?: AmericasCountry;
}

export function createUsEshopAdapter(options: UsEshopAdapterOptions = {}): EshopAdapter {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const country = options.country ?? 'US';
  const catalog = new UsCatalogClient({ fetch, country });
  const prices = new NintendoPriceClient({ fetch, now: options.now ?? (() => new Date()), country });

  return {
    country,
    fetchCatalog: (signal) => catalog.fetchAll(signal),
    fetchPrices: (sourceIds, signal) => prices.fetchPrices(sourceIds, signal)
  };
}
