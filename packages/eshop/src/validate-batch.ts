import {
  CatalogItemSchema,
  PriceObservationSchema,
  type CatalogItem,
  type CountryCode,
  type PriceObservation
} from '@eshop-tracker/shared';
import { z } from 'zod';

function withExpectedCountry<T extends { country: CountryCode }>(schema: z.ZodArray<z.ZodType<T>>, expectedCountry: CountryCode) {
  return schema.superRefine((items, context) => {
    items.forEach((item, index) => {
      if (item.country !== expectedCountry) {
        context.addIssue({
          code: 'custom',
          path: [index, 'country'],
          message: 'country must match expected country'
        });
      }
    });
  });
}

export function validateCatalogBatch(value: unknown, expectedCountry: CountryCode): CatalogItem[] {
  return withExpectedCountry(z.array(CatalogItemSchema), expectedCountry).parse(value);
}

export function validatePriceBatch(value: unknown, expectedCountry: CountryCode): PriceObservation[] {
  return withExpectedCountry(z.array(PriceObservationSchema), expectedCountry).parse(value);
}
