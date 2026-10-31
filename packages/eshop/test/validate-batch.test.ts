import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  validateCatalogBatch,
  validatePriceBatch
} from '../src/index.js';

function catalogItem(overrides: Record<string, unknown> = {}) {
  return {
    country: 'JP',
    source: ' Nintendo eShop ',
    sourceId: ' game-1 ',
    productCode: ' ABC-123 ',
    title: ' Example Game ',
    publisher: ' Nintendo ',
    developer: null,
    description: null,
    imageUrl: 'https://example.com/image.jpg',
    releaseDate: '2026-08-10',
    productType: 'game',
    platform: 'switch',
    sourceUrl: 'https://example.com/game-1',
    sourcePayload: { genre: 'action' },
    ...overrides
  };
}

function priceObservation(overrides: Record<string, unknown> = {}) {
  return {
    country: 'JP',
    source: ' Nintendo eShop ',
    sourceId: ' game-1 ',
    currency: 'JPY',
    regularAmountMinor: 6000,
    discountAmountMinor: 4800,
    discountStartAt: '2026-08-10T00:00:00.000Z',
    discountEndAt: '2026-08-11T00:00:00.000Z',
    salesStatus: ' available ',
    observedAt: '2026-08-10T01:02:03.000Z',
    ...overrides
  };
}

describe('batch validation', () => {
  it('parses and normalizes valid catalog items', () => {
    const batch = [catalogItem()];

    expect(validateCatalogBatch(batch, 'JP')).toEqual([
      expect.objectContaining({
        source: 'Nintendo eShop',
        sourceId: 'game-1',
        productCode: 'ABC-123',
        title: 'Example Game',
        publisher: 'Nintendo'
      })
    ]);
  });

  it('parses and normalizes valid price observations', () => {
    const batch = [priceObservation()];

    expect(validatePriceBatch(batch, 'JP')).toEqual([
      expect.objectContaining({
        source: 'Nintendo eShop',
        sourceId: 'game-1',
        salesStatus: 'available'
      })
    ]);
  });

  it.each([
    ['catalog', validateCatalogBatch],
    ['price', validatePriceBatch]
  ] as const)('returns an empty %s batch unchanged', (_name, validate) => {
    expect(validate([], 'JP')).toEqual([]);
  });

  it.each([
    ['catalog', validateCatalogBatch],
    ['price', validatePriceBatch]
  ] as const)('rejects a non-array %s batch with a ZodError', (_name, validate) => {
    try {
      validate({}, 'JP');
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
    }
  });

  it('rejects the whole catalog batch and keeps the invalid item index and field in its ZodError', () => {
    try {
      validateCatalogBatch([catalogItem(), catalogItem({ title: '   ' })], 'JP');
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: [1, 'title'] })
      ]));
    }
  });

  it('rejects the whole price batch and keeps the invalid item index and field in its ZodError', () => {
    try {
      validatePriceBatch([priceObservation(), priceObservation({ salesStatus: '   ' })], 'JP');
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: [1, 'salesStatus'] })
      ]));
    }
  });

  it.each([
    ['catalog', catalogItem(), validateCatalogBatch],
    ['price', priceObservation(), validatePriceBatch]
  ] as const)('does not mutate the input %s batch while parsing', (_name, item, validate) => {
    const batch = [item];
    const before = structuredClone(batch);

    validate(batch, 'JP');

    expect(batch).toEqual(before);
  });

  it.each([
    ['unsafe URL', catalogItem({ sourceUrl: 'ftp://example.com/game-1' }), [0, 'sourceUrl']],
    ['non-JSON source payload', catalogItem({ sourcePayload: { date: new Date() } }), [0, 'sourcePayload']]
  ] as const)('enforces catalog %s rules within a batch', (_name, item, path) => {
    try {
      validateCatalogBatch([item], 'JP');
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path })
      ]));
    }
  });

  it('enforces price cross-field rules within a batch', () => {
    try {
      validatePriceBatch([priceObservation({ discountAmountMinor: 6001 })], 'JP');
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: [0, 'discountAmountMinor'] })
      ]));
    }
  });

  it.each([
    ['catalog', validateCatalogBatch, catalogItem],
    ['price', validatePriceBatch, priceObservation]
  ] as const)('rejects a single %s item from an unexpected country at its country path', (_name, validate, item) => {
    try {
      validate([item({ country: 'US' })], 'JP');
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: [0, 'country'] })
      ]));
    }
  });

  it.each([
    ['catalog', validateCatalogBatch, catalogItem],
    ['price', validatePriceBatch, priceObservation]
  ] as const)('rejects a mixed-country %s batch at each mismatched country path', (_name, validate, item) => {
    try {
      validate([item(), item({ country: 'US' }), item({ country: 'GB' })], 'JP');
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: [1, 'country'] }),
        expect.objectContaining({ path: [2, 'country'] })
      ]));
    }
  });
});
