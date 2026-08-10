import type {
  CatalogItem,
  CountryCode,
  PriceObservation
} from '@eshop-tracker/shared';

export interface EshopAdapter {
  readonly country: CountryCode;
  fetchCatalog(signal?: AbortSignal): Promise<CatalogItem[]>;
  fetchPrices(sourceIds: readonly string[], signal?: AbortSignal): Promise<PriceObservation[]>;
}
