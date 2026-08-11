import type { CatalogItem, CountryCode } from '@eshop-tracker/shared';
import type { PriceFetchResult } from './price-fetch-result.js';

export interface EshopAdapter {
  readonly country: CountryCode;

  /**
   * If the supplied signal cancels the request, propagate its reason or AbortError unchanged.
   * Do not wrap cancellation in a NETWORK EshopError.
   */
  fetchCatalog(signal?: AbortSignal): Promise<CatalogItem[]>;

  /**
   * If the supplied signal cancels the request, propagate its reason or AbortError unchanged.
   * Do not wrap cancellation in a NETWORK EshopError.
   */
  fetchPrices(sourceIds: readonly string[], signal?: AbortSignal): Promise<PriceFetchResult>;
}
