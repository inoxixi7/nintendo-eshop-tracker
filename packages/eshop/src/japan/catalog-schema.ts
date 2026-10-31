import { z } from 'zod';
import { NintendoSourceIdSchema } from '../nintendo-source-id.js';

const NullableTrimmedString = z.string().trim().nullable().optional();
// Most rows carry a CDN hash; some Switch 2 DLC rows carry a full Nintendo-hosted image URL instead.
const ImageHashSchema = z.string()
  .trim()
  .pipe(z.union([
    z.string().regex(/^(?:[a-f0-9]{64})?$/),
    z.url({ protocol: /^https$/, hostname: /(?:^|\.)nintendo\.(?:com|co\.jp|net)$/ })
  ]))
  .nullable()
  .optional();

export const JapanCatalogItemSchema = z.object({
  id: z.string().trim().min(1),
  nsuid: NintendoSourceIdSchema,
  title: z.string().trim().min(1),
  icode: NullableTrimmedString,
  maker: NullableTrimmedString,
  text: NullableTrimmedString,
  siurl: ImageHashSchema,
  iurl: ImageHashSchema,
  dsdate: NullableTrimmedString,
  sdate: NullableTrimmedString,
  sform: z.string().trim().nullable().optional(),
  hard: z.enum(['1_HAC', '05_BEE'])
}).loose();

// Directory-only variants (e.g. "70010000039949_2", "4039") cannot be priced; their base titles are listed separately.
const NonPriceNsuidSchema = z.string()
  .regex(/^(?:[1-9]\d{13}_[A-Za-z0-9]+|\d{1,13})$/)
  .transform(() => null);

const JapanUnpriceableCatalogItemSchema = z.object({
  id: z.string().trim().min(1),
  nsuid: z.union([z.null(), NonPriceNsuidSchema])
}).loose();

const JapanCatalogPageEntrySchema = z.union([
  JapanCatalogItemSchema,
  JapanUnpriceableCatalogItemSchema
]);

export const JapanCatalogPageSchema = z.object({
  result: z.object({
    total: z.number().int().nonnegative(),
    items: z.array(JapanCatalogPageEntrySchema)
  }).loose(),
  status: z.number().optional()
}).loose();

export type JapanCatalogItem = z.infer<typeof JapanCatalogItemSchema>;
export type JapanCatalogPageEntry = z.infer<typeof JapanCatalogPageEntrySchema>;
export type JapanCatalogPage = z.infer<typeof JapanCatalogPageSchema>;
