import { z } from 'zod';

const NullableTrimmedString = z.string().nullable().optional();

export const JapanCatalogItemSchema = z.object({
  nsuid: z.string().trim().min(1),
  title: z.string().trim().min(1),
  icode: NullableTrimmedString,
  maker: NullableTrimmedString,
  text: NullableTrimmedString,
  siurl: NullableTrimmedString,
  iurl: NullableTrimmedString,
  dsdate: NullableTrimmedString,
  sdate: NullableTrimmedString,
  sform: z.string().trim().min(1).nullable().optional()
}).loose();

export const JapanCatalogPageSchema = z.object({
  result: z.object({
    total: z.number().int().nonnegative(),
    items: z.array(JapanCatalogItemSchema)
  }).loose(),
  status: z.number().optional()
}).loose();

export type JapanCatalogItem = z.infer<typeof JapanCatalogItemSchema>;
export type JapanCatalogPage = z.infer<typeof JapanCatalogPageSchema>;
