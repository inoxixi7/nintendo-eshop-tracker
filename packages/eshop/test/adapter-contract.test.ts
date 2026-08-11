import { expectTypeOf, test } from 'vitest';
import type { PriceObservation } from '@eshop-tracker/shared';
import type { EshopAdapter, PriceFetchResult } from '../src/index.js';

test('exposes the unavailable price IDs separately from observations', () => {
  expectTypeOf<EshopAdapter['fetchPrices']>().toEqualTypeOf<(
    sourceIds: readonly string[],
    signal?: AbortSignal
  ) => Promise<PriceFetchResult>>();
  expectTypeOf<PriceFetchResult>().toEqualTypeOf<{
    observations: PriceObservation[];
    unavailableSourceIds: string[];
  }>();
});
