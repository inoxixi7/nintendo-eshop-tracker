import { z } from 'zod';
import { CountryCodeSchema, CurrencyCodeSchema } from './country.js';

const IsoDateTimeSchema = z.string()
  .datetime({ offset: true })
  .refine((value) => {
    const fractionalSeconds = value.match(/\.(\d+)/)?.[1];
    return fractionalSeconds === undefined || fractionalSeconds.length <= 3;
  }, {
    message: 'datetime precision cannot exceed milliseconds'
  });

const MinorAmountSchema = z.number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const NullableMinorAmountSchema = MinorAmountSchema.nullable();

const DiscountAmountPairSchema = z.object({
  regularAmountMinor: MinorAmountSchema,
  discountAmountMinor: NullableMinorAmountSchema
});
const DiscountTimeRangeSchema = z.object({
  discountStartAt: IsoDateTimeSchema.nullable(),
  discountEndAt: IsoDateTimeSchema.nullable()
});

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
  regularAmountMinor: MinorAmountSchema,
  discountAmountMinor: NullableMinorAmountSchema,
  discountStartAt: IsoDateTimeSchema.nullable(),
  discountEndAt: IsoDateTimeSchema.nullable(),
  salesStatus: z.string().trim().min(1),
  observedAt: IsoDateTimeSchema
}).superRefine((value, context) => {
  if (DiscountAmountPairSchema.safeParse(value).success &&
    value.discountAmountMinor !== null &&
    value.discountAmountMinor > value.regularAmountMinor
  ) {
    context.addIssue({
      code: 'custom',
      path: ['discountAmountMinor'],
      message: 'discountAmountMinor cannot exceed regularAmountMinor'
    });
  }

  if (
    DiscountTimeRangeSchema.safeParse(value).success &&
    value.discountStartAt !== null &&
    value.discountEndAt !== null
  ) {
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
