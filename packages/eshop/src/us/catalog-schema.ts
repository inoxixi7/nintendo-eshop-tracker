import { z } from 'zod';

const NullableText = z.string().nullable().optional();

// A record without a 14-digit nsuid (hardware, physical-only items) cannot be priced and is skipped.
export const UsCatalogHitSchema = z.object({
  objectID: z.string().min(1),
  nsuid: NullableText,
  title: z.string(),
  platform: NullableText,
  softwarePublisher: NullableText,
  softwareDeveloper: NullableText,
  description: NullableText,
  productImage: NullableText,
  productImageSquare: NullableText,
  releaseDate: NullableText,
  url: NullableText,
  dlcType: NullableText,
  eshopDetails: z.object({ productType: NullableText }).loose().nullable().optional(),
  gameGenres: z.array(z.object({ code: z.string() }).loose()).nullable().optional()
}).loose();

export const UsCatalogPageSchema = z.object({
  hits: z.array(UsCatalogHitSchema),
  nbHits: z.number().int().nonnegative(),
  facets: z.record(z.string(), z.record(z.string(), z.number())).optional()
}).loose();

export type UsCatalogHit = z.infer<typeof UsCatalogHitSchema>;
export type UsCatalogPage = z.infer<typeof UsCatalogPageSchema>;
