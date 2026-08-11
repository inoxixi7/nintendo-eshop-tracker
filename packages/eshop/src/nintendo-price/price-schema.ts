import { z } from 'zod';

const MoneySchema = z.object({
  amount: z.string(),
  currency: z.literal('JPY'),
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

const UnavailablePriceSchema = z.object({
  title_id: TitleIdSchema,
  sales_status: z.literal('not_found')
}).loose();

export const NintendoPriceResponseSchema = z.object({
  country: z.literal('JP'),
  prices: z.array(z.union([UnavailablePriceSchema, AvailablePriceSchema]))
}).loose();

export type NintendoAvailablePrice = z.infer<typeof AvailablePriceSchema>;
export type NintendoPriceResponse = z.infer<typeof NintendoPriceResponseSchema>;
