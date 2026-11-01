import { CurrencyCodeSchema } from '@eshop-tracker/shared';
import { z } from 'zod';

// The client checks that the currency matches the requested country.
const MoneySchema = z.object({
  amount: z.string(),
  currency: CurrencyCodeSchema,
  raw_value: z.string().min(1)
}).loose();

const DiscountMoneySchema = MoneySchema.extend({
  start_datetime: z.string().datetime({ offset: false }),
  end_datetime: z.string().datetime({ offset: false })
}).loose();

const TitleIdSchema = z.number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const AvailablePriceSchema = z.object({
  title_id: TitleIdSchema,
  sales_status: z.string()
    .trim()
    .min(1)
    .refine((value) => value !== 'not_found'),
  regular_price: MoneySchema,
  discount_price: DiscountMoneySchema.optional()
}).loose();

// Unreleased or terminated titles may carry no price; delisted (not_found) titles may keep their last price. All are unpriced.
const UnavailablePriceSchema = z.union([
  z.object({
    title_id: TitleIdSchema,
    sales_status: z.enum(['not_found', 'unreleased', 'sales_termination']),
    regular_price: z.never().optional(),
    discount_price: z.never().optional()
  }).loose(),
  z.object({
    title_id: TitleIdSchema,
    sales_status: z.literal('not_found'),
    regular_price: MoneySchema,
    discount_price: z.never().optional()
  }).loose()
]);

export const NintendoPriceResponseSchema = z.object({
  country: z.string(),
  prices: z.array(z.union([UnavailablePriceSchema, AvailablePriceSchema]))
}).loose();

export type NintendoAvailablePrice = z.infer<typeof AvailablePriceSchema>;
export type NintendoPriceResponse = z.infer<typeof NintendoPriceResponseSchema>;
