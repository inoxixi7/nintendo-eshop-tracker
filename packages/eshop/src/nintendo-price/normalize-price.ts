import type { CountryCode, CurrencyCode, PriceObservation } from '@eshop-tracker/shared';
import type { PriceFetchResult } from '../price-fetch-result.js';
import { validatePriceBatch } from '../validate-batch.js';
import { parseMinorAmount } from './decimal.js';
import type {
  NintendoAvailablePrice,
  NintendoPriceResponse
} from './price-schema.js';

type NintendoPrice = NintendoPriceResponse['prices'][number];

function isAvailablePrice(price: NintendoPrice): price is NintendoAvailablePrice {
  return price.sales_status !== 'not_found' && price.regular_price !== undefined;
}

export function normalizeNintendoPriceResponse(
  response: NintendoPriceResponse,
  observedAt: string,
  country: CountryCode = 'JP',
  currency: CurrencyCode = 'JPY'
): PriceFetchResult {
  if (response.country !== country) throw new Error('Nintendo price response is for another country');
  const observations: PriceObservation[] = [];
  const unavailableSourceIds: string[] = [];

  for (const price of response.prices) {
    const sourceId = String(price.title_id);

    if (!isAvailablePrice(price)) {
      unavailableSourceIds.push(sourceId);
      continue;
    }

    const discount = price.discount_price;
    if (price.regular_price.currency !== currency || (discount !== undefined && discount.currency !== currency)) {
      throw new Error('Nintendo price currency does not match the country');
    }
    observations.push({
      country,
      source: 'nintendo-price-api',
      sourceId,
      currency,
      regularAmountMinor: parseMinorAmount(price.regular_price.raw_value, currency),
      discountAmountMinor: discount === undefined
        ? null
        : parseMinorAmount(discount.raw_value, currency),
      discountStartAt: discount?.start_datetime ?? null,
      discountEndAt: discount?.end_datetime ?? null,
      salesStatus: price.sales_status,
      observedAt
    });
  }

  return {
    observations: validatePriceBatch(observations, country),
    unavailableSourceIds
  };
}
