import { z } from 'zod';

const Texts = z.array(z.string()).optional();

// Only the fields the tracker reads; the whole document is kept as the source payload.
export const GbCatalogDocSchema = z.object({
  fs_id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  nsuid_txt: Texts,
  product_code_txt: Texts,
  playable_on_txt: Texts,
  game_categories_txt: Texts,
  publisher: z.string().optional(),
  developer: z.string().optional(),
  excerpt: z.string().optional(),
  product_catalog_description_s: z.string().optional(),
  image_url_sq_s: z.string().optional(),
  image_url_h2x1_s: z.string().optional(),
  dates_released_dts: Texts,
  url: z.string().optional()
}).loose();

export const GbCatalogPageSchema = z.object({
  response: z.object({
    numFound: z.number().int().nonnegative(),
    docs: z.array(GbCatalogDocSchema)
  })
});

export type GbCatalogDoc = z.infer<typeof GbCatalogDocSchema>;
