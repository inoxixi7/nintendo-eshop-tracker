import { z } from 'zod';
import { CountryCodeSchema, CurrencyCodeSchema } from './country.js';

const IsoDateTimeSchema = z.string().datetime({ offset: true });

function toTimestamp(value: string): number | null {
  try {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  } catch {
    return null;
  }
}

export const PriceObservationSchema = z.object({
  country: CountryCodeSchema,
  source: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  currency: CurrencyCodeSchema,
  regularAmountMinor: z.number().int().nonnegative(),
  discountAmountMinor: z.number().int().nonnegative().nullable(),
  discountStartAt: IsoDateTimeSchema.nullable(),
  discountEndAt: IsoDateTimeSchema.nullable(),
  salesStatus: z.string().trim().min(1),
  observedAt: IsoDateTimeSchema
}).superRefine((value, context) => {
  if (
    value.discountAmountMinor !== null &&
    value.discountAmountMinor > value.regularAmountMinor
  ) {
    context.addIssue({
      code: 'custom',
      path: ['discountAmountMinor'],
      message: 'discountAmountMinor cannot exceed regularAmountMinor'
    });
  }

  if (value.discountStartAt !== null && value.discountEndAt !== null) {
    const discountStartAt = toTimestamp(value.discountStartAt);
    const discountEndAt = toTimestamp(value.discountEndAt);

    if (
      discountStartAt !== null &&
      discountEndAt !== null &&
      discountEndAt <= discountStartAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['discountEndAt'],
        message: 'discountEndAt must be later than discountStartAt'
      });
    }
  }
});

export type PriceObservation = z.infer<typeof PriceObservationSchema>;
