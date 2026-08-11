import type { PriceObservation } from '@eshop-tracker/shared';

export interface PriceFetchResult {
  observations: PriceObservation[];
  unavailableSourceIds: string[];
}
