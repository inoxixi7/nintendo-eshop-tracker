import { expectTypeOf, test } from 'vitest';
import type { EshopAdapter, PriceFetchResult } from '../src/index.js';

test('exposes the unavailable price IDs separately from observations', () => {
  expectTypeOf<EshopAdapter['fetchPrices']>().returns.toEqualTypeOf<Promise<PriceFetchResult>>();
  expectTypeOf<PriceFetchResult['unavailableSourceIds']>().toEqualTypeOf<string[]>();
});
