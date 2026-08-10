import { z } from 'zod';
import { CountryCodeSchema } from './country.js';

export const ProductTypeSchema = z.enum(['game', 'bundle', 'dlc', 'unknown']);
export type ProductType = z.infer<typeof ProductTypeSchema>;

export const CatalogItemSchema = z.object({
  country: CountryCodeSchema,
  source: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  productCode: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1),
  publisher: z.string().trim().min(1).nullable(),
  developer: z.string().trim().min(1).nullable(),
  description: z.string().trim().min(1).nullable(),
  imageUrl: z.string().url().nullable(),
  releaseDate: z.string().date().nullable(),
  productType: ProductTypeSchema,
  sourceUrl: z.string().url().nullable(),
  sourcePayload: z.record(z.string(), z.unknown())
});

export type CatalogItem = z.infer<typeof CatalogItemSchema>;
