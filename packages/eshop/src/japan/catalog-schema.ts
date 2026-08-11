import { z } from 'zod';

const NullableTrimmedString = z.string().trim().nullable().optional();
const ImageHashSchema = z.string()
  .trim()
  .regex(/^(?:[a-f0-9]{64})?$/)
  .nullable()
  .optional();

export const JapanCatalogItemSchema = z.object({
  id: z.string().trim().min(1),
  nsuid: z.string().trim().regex(/^\d{14}$/),
  title: z.string().trim().min(1),
  icode: NullableTrimmedString,
  maker: NullableTrimmedString,
  text: NullableTrimmedString,
  siurl: ImageHashSchema,
  iurl: ImageHashSchema,
  dsdate: NullableTrimmedString,
  sdate: NullableTrimmedString,
  sform: z.string().trim().nullable().optional()
}).loose();

const JapanUnpriceableCatalogItemSchema = z.object({
  id: z.string().trim().min(1),
  nsuid: z.null()
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
