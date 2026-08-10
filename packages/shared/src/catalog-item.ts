import { z } from 'zod';
import { CountryCodeSchema } from './country.js';

export const ProductTypeSchema = z.enum(['game', 'bundle', 'dlc', 'unknown']);
export type ProductType = z.infer<typeof ProductTypeSchema>;

type JsonValue = null | string | boolean | number | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

type TraversalEntry =
  | { kind: 'enter'; value: unknown }
  | { kind: 'leave'; value: object };

const HttpUrlSchema = z.url({ protocol: /^https?$/ });

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || !isPlainObject(value)) {
    return false;
  }

  const ancestors = new Set<object>();
  const stack: TraversalEntry[] = [{ kind: 'enter', value }];

  try {
    while (stack.length > 0) {
      const entry = stack.pop();

      if (entry === undefined) {
        return false;
      }

      if (entry.kind === 'leave') {
        ancestors.delete(entry.value);
        continue;
      }

      const current = entry.value;

      if (current === null || typeof current === 'string' || typeof current === 'boolean') {
        continue;
      }

      if (typeof current === 'number') {
        if (!Number.isFinite(current)) {
          return false;
        }
        continue;
      }

      if (typeof current !== 'object' || current === null) {
        return false;
      }

      if (!Array.isArray(current) && !isPlainObject(current)) {
        return false;
      }

      if (ancestors.has(current)) {
        return false;
      }

      ancestors.add(current);
      stack.push({ kind: 'leave', value: current });

      if (Array.isArray(current)) {
        for (let index = current.length - 1; index >= 0; index -= 1) {
          stack.push({ kind: 'enter', value: current[index] });
        }
      } else {
        for (const key of Object.keys(current)) {
          stack.push({ kind: 'enter', value: current[key] });
        }
      }
    }
  } catch {
    return false;
  }

  return true;
}

const JsonObjectSchema = z.custom<JsonObject>(isJsonObject, {
  message: 'sourcePayload must be a JSON object'
});

export const CatalogItemSchema = z.object({
  country: CountryCodeSchema,
  source: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  productCode: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1),
  publisher: z.string().trim().min(1).nullable(),
  developer: z.string().trim().min(1).nullable(),
  description: z.string().trim().min(1).nullable(),
  imageUrl: HttpUrlSchema.nullable(),
  releaseDate: z.string().date().nullable(),
  productType: ProductTypeSchema,
  sourceUrl: HttpUrlSchema.nullable(),
  sourcePayload: JsonObjectSchema
});

export type CatalogItem = z.infer<typeof CatalogItemSchema>;
