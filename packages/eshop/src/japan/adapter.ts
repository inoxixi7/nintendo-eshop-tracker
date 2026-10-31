import type { CatalogItem } from '@eshop-tracker/shared';
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
  const catalogs = [
    new JapanCatalogClient({ fetch, hardware: '1_HAC' }),
    new JapanCatalogClient({ fetch, hardware: '05_BEE' })
  ];
  const prices = new NintendoPriceClient({ fetch, now });

  return {
    country: 'JP',
    fetchCatalog: async (signal) => {
      const items = new Map<string, CatalogItem>();
      for (const catalog of catalogs) {
        for (const item of await catalog.fetchAll(signal)) {
          if (!items.has(item.sourceId)) items.set(item.sourceId, item);
        }
      }
      return [...items.values()];
    },
    fetchPrices: (sourceIds, signal) => prices.fetchPrices(sourceIds, signal)
  };
}
