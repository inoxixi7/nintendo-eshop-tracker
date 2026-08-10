import { describe, expect, it } from 'vitest';
import {
  CatalogItemSchema,
  CountryCodeSchema,
  CurrencyCodeSchema
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

  it('rejects a relative image URL', () => {
    expect(() => CatalogItemSchema.parse({ ...validCatalogItem, imageUrl: '/game.jpg' })).toThrow();
  });
});
