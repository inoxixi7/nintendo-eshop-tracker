import type { PriceObservation } from '@eshop-tracker/shared';
import type { PriceFetchResult } from '../price-fetch-result.js';
import { validatePriceBatch } from '../validate-batch.js';
import { parseMinorAmount } from './decimal.js';
import type {
  NintendoAvailablePrice,
  NintendoPriceResponse
} from './price-schema.js';

type NintendoPrice = NintendoPriceResponse['prices'][number];

function isAvailablePrice(price: NintendoPrice): price is NintendoAvailablePrice {
  return price.sales_status !== 'not_found';
}

export function normalizeNintendoPriceResponse(
  response: NintendoPriceResponse,
  observedAt: string
): PriceFetchResult {
  const observations: PriceObservation[] = [];
  const unavailableSourceIds: string[] = [];

  for (const price of response.prices) {
    const sourceId = String(price.title_id);

    if (!isAvailablePrice(price)) {
      unavailableSourceIds.push(sourceId);
      continue;
    }

    const discount = price.discount_price;
    observations.push({
      country: 'JP',
      source: 'nintendo-price-api',
      sourceId,
      currency: 'JPY',
      regularAmountMinor: parseMinorAmount(price.regular_price.raw_value, 'JPY'),
      discountAmountMinor: discount === undefined
        ? null
        : parseMinorAmount(discount.raw_value, 'JPY'),
      discountStartAt: discount?.start_datetime ?? null,
      discountEndAt: discount?.end_datetime ?? null,
      salesStatus: price.sales_status,
      observedAt
    });
  }

  return {
    observations: validatePriceBatch(observations, 'JP'),
    unavailableSourceIds
  };
}
