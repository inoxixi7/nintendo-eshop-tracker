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
  platform: 'switch',
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

  it.each([
    ['getPrototypeOf', new Proxy({}, { getPrototypeOf() { throw new Error('blocked'); } })],
    ['ownKeys', new Proxy({}, { ownKeys() { throw new Error('blocked'); } })],
    ['get', new Proxy({ nested: 'value' }, { get() { throw new Error('blocked'); } })],
    ['revoked', (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })()]
  ])('safely rejects source payload roots with a throwing %s trap', (_name, sourcePayload) => {
    const result = CatalogItemSchema.safeParse({ ...validCatalogItem, sourcePayload });

    expect(result.success).toBe(false);
  });

  it('safely rejects a nested source payload proxy with a throwing trap', () => {
    const sourcePayload = {
      nested: new Proxy({}, { ownKeys() { throw new Error('blocked'); } })
    };
    const result = CatalogItemSchema.safeParse({ ...validCatalogItem, sourcePayload });

    expect(result.success).toBe(false);
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

  it.each([
    ['JP', 'JPY'],
    ['US', 'USD'],
    ['GB', 'GBP']
  ] as const)('accepts the %s and %s currency relationship', (country, currency) => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      country,
      currency
    }).success).toBe(true);
  });

  it.each([
    ['JP', 'USD'],
    ['US', 'GBP'],
    ['GB', 'JPY']
  ] as const)('rejects the %s and %s currency mismatch at currency', (country, currency) => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      country,
      currency
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        path: ['currency'],
        message: 'currency must match country'
      }));
    }
  });

  it('finds a country and currency mismatch despite an unrelated aborting field', () => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      source: 123,
      currency: 'GBP'
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        path: ['currency'],
        message: 'currency must match country'
      }));
    }
  });

  it.each([
    ['country', 'DE', 'JPY'],
    ['currency', 'JP', 'EUR']
  ] as const)('does not add a currency relationship issue when %s is invalid', (_field, country, currency) => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      country,
      currency
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).not.toContainEqual(expect.objectContaining({
        message: 'currency must match country'
      }));
    }
  });

  it('rejects floating-point minor-unit amounts', () => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      regularAmountMinor: 39.99,
      discountAmountMinor: null
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        path: ['regularAmountMinor'],
        code: 'invalid_type'
      }));
    }
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

  it.each([
    ['no fractional seconds', '2026-08-10T06:00:00Z'],
    ['one fractional digit', '2026-08-10T06:00:00.1Z'],
    ['two fractional digits', '2026-08-10T06:00:00.12Z'],
    ['three fractional digits', '2026-08-10T06:00:00.123Z']
  ])('accepts datetimes with %s', (_name, observedAt) => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      observedAt
    }).success).toBe(true);
  });

  it.each([
    ['discountStartAt', '2026-08-10T15:00:00.123+09:00'],
    ['discountEndAt', '2026-08-10T01:00:00.123-05:00'],
    ['observedAt', '2026-08-10T15:00:00.123+09:00']
  ] as const)('safely rejects non-UTC offsets for %s', (field, value) => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      [field]: value
    }).success).toBe(false);
  });

  it('rejects datetime precision finer than milliseconds', () => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      observedAt: '2026-08-10T06:00:00.0001Z'
    }).success).toBe(false);
  });

  it('compares valid millisecond-precision discount timestamps accurately', () => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      discountStartAt: '2026-08-01T00:00:00.001Z',
      discountEndAt: '2026-08-01T00:00:00.002Z'
    }).success).toBe(true);
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

  it('accepts Number.MAX_SAFE_INTEGER amounts at the boundary', () => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      regularAmountMinor: Number.MAX_SAFE_INTEGER,
      discountAmountMinor: Number.MAX_SAFE_INTEGER
    }).success).toBe(true);
  });

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('safely rejects %s amounts', (_name, regularAmountMinor) => {
    expect(PriceObservationSchema.safeParse({
      ...validPriceObservation,
      regularAmountMinor,
      discountAmountMinor: null
    }).success).toBe(false);
  });

  it('rejects an unsafe integer with one regular amount issue', () => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      regularAmountMinor: Number.MAX_SAFE_INTEGER + 1,
      discountAmountMinor: null
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.filter((issue) => (
        issue.path.length === 1 && issue.path[0] === 'regularAmountMinor'
      ))).toHaveLength(1);
    }
  });

  it('does not add a discount relationship issue when the regular amount is invalid', () => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      regularAmountMinor: -1,
      discountAmountMinor: 0
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).not.toContainEqual([
        'discountAmountMinor'
      ]);
    }
  });

  it('does not add a time relationship issue when the start datetime is malformed', () => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      discountStartAt: 'not-a-date',
      discountEndAt: '2026-07-01T00:00:00.000Z'
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).not.toContainEqual([
        'discountEndAt'
      ]);
    }
  });

  it('finds valid-field relationships despite an unrelated invalid field', () => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      salesStatus: '',
      discountAmountMinor: 4999,
      discountEndAt: validPriceObservation.discountStartAt
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
        ['discountAmountMinor'],
        ['discountEndAt']
      ]));
    }
  });

  it.each([
    ['country', 123],
    ['salesStatus', 123]
  ] as const)('finds discount relationships with an aborting invalid %s field', (field, value) => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      [field]: value,
      discountAmountMinor: 4999
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        'discountAmountMinor'
      ]);
    }
  });

  it.each([
    ['country', 123],
    ['salesStatus', 123]
  ] as const)('finds time relationships with an aborting invalid %s field', (field, value) => {
    const result = PriceObservationSchema.safeParse({
      ...validPriceObservation,
      [field]: value,
      discountEndAt: validPriceObservation.discountStartAt
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        'discountEndAt'
      ]);
    }
  });
});
