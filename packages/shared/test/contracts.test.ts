import { describe, expect, it } from 'vitest';
import {
  CatalogItemSchema,
  CountryCodeSchema,
  CurrencyCodeSchema,
  PriceObservationSchema
} from '../src/index.js';

const validCatalogItem = {
  country: 'JP',
  source: 'nintendo-jp',
  sourceId: '70010000000141',
  productCode: 'HAC-P-AAAAA',
  title: 'Sample Game',
  publisher: 'Sample Publisher',
  developer: null,
  description: null,
  imageUrl: 'https://example.com/game.jpg',
  releaseDate: '2026-08-10',
  productType: 'game',
  sourceUrl: 'https://example.com/game',
  sourcePayload: { originalTitle: 'Sample Game' }
};

const validPriceObservation = {
  country: 'US',
  source: 'nintendo-price-api',
  sourceId: '70010000000185',
  currency: 'USD',
  regularAmountMinor: 3999,
  discountAmountMinor: 2999,
  discountStartAt: '2026-08-01T00:00:00.000Z',
  discountEndAt: '2026-08-15T23:59:59.000Z',
  salesStatus: 'onsale',
  observedAt: '2026-08-10T06:00:00.000Z'
};

describe('CountryCodeSchema', () => {
  it.each(['JP', 'US', 'GB'])('accepts %s', (country) => {
    expect(CountryCodeSchema.parse(country)).toBe(country);
  });

  it('rejects a country outside phase 1', () => {
    expect(() => CountryCodeSchema.parse('DE')).toThrow();
  });
});

describe('CurrencyCodeSchema', () => {
  it.each(['JPY', 'USD', 'GBP'])('accepts %s', (currency) => {
    expect(CurrencyCodeSchema.parse(currency)).toBe(currency);
  });
});

describe('CatalogItemSchema', () => {
  it('accepts a normalized listing', () => {
    expect(CatalogItemSchema.parse(validCatalogItem)).toEqual(validCatalogItem);
  });

  it('rejects an empty source ID', () => {
    expect(() => CatalogItemSchema.parse({ ...validCatalogItem, sourceId: '' })).toThrow();
  });

  it.each([
    ['undefined', undefined],
    ['Date', new Date('2026-08-10T00:00:00.000Z')],
    ['bigint', 1n],
    ['symbol', Symbol('invalid')],
    ['function', () => undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('rejects %s values in source payloads', (_name, value) => {
    expect(CatalogItemSchema.safeParse({
      ...validCatalogItem,
      sourcePayload: { invalid: value }
    }).success).toBe(false);
  });

  it('rejects a cyclic source payload', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(CatalogItemSchema.safeParse({ ...validCatalogItem, sourcePayload: cyclic }).success).toBe(false);
  });

  it.each([
    ['array', []],
    ['Date', new Date('2026-08-10T00:00:00.000Z')],
    ['class instance', new (class Payload {})()]
  ])('rejects a non-plain-object source payload root: %s', (_name, sourcePayload) => {
    expect(CatalogItemSchema.safeParse({ ...validCatalogItem, sourcePayload }).success).toBe(false);
  });

  it('accepts a shared non-cyclic object in sibling source payload properties', () => {
    const shared = { nested: 'value' };

    expect(CatalogItemSchema.safeParse({
      ...validCatalogItem,
      sourcePayload: { first: shared, second: shared }
    }).success).toBe(true);
  });

  it('accepts deeply nested JSON source payloads without overflowing', () => {
    const sourcePayload: Record<string, unknown> = {};
    let current = sourcePayload;

    for (let depth = 0; depth < 10_000; depth += 1) {
      const next: Record<string, unknown> = {};
      current.child = next;
      current = next;
    }

    expect(CatalogItemSchema.safeParse({ ...validCatalogItem, sourcePayload }).success).toBe(true);
  });

  it.each([
    ['imageUrl', '/game.jpg'],
    ['imageUrl', 'not a url'],
    ['imageUrl', 'javascript:alert(1)'],
    ['imageUrl', 'data:text/plain,hello'],
    ['imageUrl', 'ftp://example.com/game.jpg'],
    ['sourceUrl', '/game'],
    ['sourceUrl', 'not a url'],
    ['sourceUrl', 'javascript:alert(1)'],
    ['sourceUrl', 'data:text/plain,hello'],
    ['sourceUrl', 'ftp://example.com/game']
  ] as const)('safely rejects invalid %s: %s', (field, url) => {
    expect(CatalogItemSchema.safeParse({ ...validCatalogItem, [field]: url }).success).toBe(false);
  });
});

describe('PriceObservationSchema', () => {
  it('accepts a valid price observation', () => {
    expect(PriceObservationSchema.parse(validPriceObservation)).toEqual(validPriceObservation);
  });

  it('rejects floating-point minor-unit amounts', () => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      regularAmountMinor: 39.99
    }).success).toBe(false);
  });

  it('rejects discounts higher than the regular amount', () => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      discountAmountMinor: 4999
    }).success).toBe(false);
  });

  it('rejects discount end times that are not later than start times', () => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      discountEndAt: validPriceObservation.discountStartAt
    }).success).toBe(false);
  });

  it.each([
    ['discountStartAt', '2026-08-01'],
    ['discountEndAt', 'not-a-date'],
    ['observedAt', '2026-08-10T06:00:00']
  ] as const)('safely rejects invalid %s datetimes', (field, value) => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      [field]: value
    }).success).toBe(false);
  });

  it('accepts null optional discount fields', () => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      discountAmountMinor: null,
      discountStartAt: null,
      discountEndAt: null
    }).success).toBe(true);
  });

  it('accepts zero-value amounts at the boundary', () => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      regularAmountMinor: 0,
      discountAmountMinor: 0
    }).success).toBe(true);
  });
});
