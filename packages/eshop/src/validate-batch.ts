import {
  CatalogItemSchema,
  PriceObservationSchema,
  type CatalogItem,
  type PriceObservation
} from '@eshop-tracker/shared';
import { z } from 'zod';

const CatalogBatchSchema = z.array(CatalogItemSchema);
const PriceBatchSchema = z.array(PriceObservationSchema);

export function validateCatalogBatch(value: unknown): CatalogItem[] {
  return CatalogBatchSchema.parse(value);
}

export function validatePriceBatch(value: unknown): PriceObservation[] {
  return PriceBatchSchema.parse(value);
}
