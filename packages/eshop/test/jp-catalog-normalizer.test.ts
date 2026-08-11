import { describe, expect, it } from 'vitest';
import {
  JapanCatalogItemSchema,
  JapanCatalogPageSchema
} from '../src/japan/catalog-schema.js';
import { normalizeJapanCatalogItem } from '../src/japan/normalize-catalog-item.js';
import { readJsonFixture } from './fixture.js';

function rawItem(overrides: Record<string, unknown> = {}) {
  return JapanCatalogItemSchema.parse({
    nsuid: '70010000009999',
    title: 'Synthetic Test Item',
    ...overrides
  });
}

describe('Japanese catalog normalization', () => {
  it('validates and exactly normalizes representative catalog items without mutating the input', async () => {
    const input = await readJsonFixture('jp-catalog-page.json');
    const before = structuredClone(input);
    const page = JapanCatalogPageSchema.parse(input);

    const normalized = page.result.items.map(normalizeJapanCatalogItem);

    expect(normalized).toEqual([
      {
        country: 'JP',
        source: 'nintendo-jp-search',
        sourceId: '70010000000001',
        productCode: 'HAC-A0001',
        title: 'Synthetic Game',
        publisher: 'Sample Publisher A',
        developer: null,
        description: 'Synthetic game description.',
        imageUrl: 'https://img-eshop.cdn.nintendo.net/i/synthetic-game-primary.jpg',
        releaseDate: '2026-08-21',
        productType: 'game',
        sourceUrl: 'https://store-jp.nintendo.com/item/software/D70010000000001',
        sourcePayload: expect.objectContaining({ fixtureMarker: 'game-extra' })
      },
      {
        country: 'JP',
        source: 'nintendo-jp-search',
        sourceId: '70010000000002',
        productCode: null,
        title: 'Synthetic Bundle',
        publisher: 'Sample Publisher B',
        developer: null,
        description: 'Synthetic bundle description.',
        imageUrl: 'https://img-eshop.cdn.nintendo.net/i/synthetic-bundle.jpg',
        releaseDate: '2026-08-27',
        productType: 'bundle',
        sourceUrl: 'https://store-jp.nintendo.com/item/software/D70010000000002',
        sourcePayload: expect.objectContaining({ fixtureMarker: 'bundle-extra' })
      },
      {
        country: 'JP',
        source: 'nintendo-jp-search',
        sourceId: '70010000000003',
        productCode: 'DLC-A0003',
        title: 'Synthetic DLC',
        publisher: null,
        developer: null,
        description: null,
        imageUrl: null,
        releaseDate: null,
        productType: 'dlc',
        sourceUrl: 'https://store-jp.nintendo.com/item/software/D70010000000003',
        sourcePayload: expect.objectContaining({ fixtureMarker: 'dlc-extra' })
      },
      {
        country: 'JP',
        source: 'nintendo-jp-search',
        sourceId: '70010000000004',
        productCode: null,
        title: 'Synthetic Mystery',
        publisher: null,
        developer: null,
        description: null,
        imageUrl: null,
        releaseDate: null,
        productType: 'unknown',
        sourceUrl: 'https://store-jp.nintendo.com/item/software/D70010000000004',
        sourcePayload: expect.objectContaining({ fixtureMarker: 'unknown-extra' })
      }
    ]);
    expect(normalized.map((item) => item.sourcePayload)).toEqual(page.result.items);
    expect(input).toEqual(before);
  });

  it('trims optional text fields before producing the final mapping', () => {
    const item = rawItem({
      icode: '  HAC-A0999  ',
      maker: '  Sample Publisher  ',
      text: '  Synthetic description.  ',
      siurl: '  preferred-image  ',
      iurl: '  fallback-image  ',
      dsdate: '  2026-08-07  ',
      sdate: '  2026.8.27  '
    });
    const fallbackItem = rawItem({
      siurl: '   ',
      iurl: '  fallback-image  ',
      dsdate: '   ',
      sdate: '  2026.8.27  '
    });

    expect(item).toEqual(expect.objectContaining({
      icode: 'HAC-A0999',
      maker: 'Sample Publisher',
      text: 'Synthetic description.',
      siurl: 'preferred-image',
      iurl: 'fallback-image',
      dsdate: '2026-08-07',
      sdate: '2026.8.27'
    }));
    expect(normalizeJapanCatalogItem(item)).toEqual(expect.objectContaining({
      productCode: 'HAC-A0999',
      publisher: 'Sample Publisher',
      description: 'Synthetic description.',
      imageUrl: 'https://img-eshop.cdn.nintendo.net/i/preferred-image.jpg',
      releaseDate: '2026-08-07'
    }));
    expect(fallbackItem).toEqual(expect.objectContaining({
      siurl: '',
      iurl: 'fallback-image',
      dsdate: '',
      sdate: '2026.8.27'
    }));
    expect(normalizeJapanCatalogItem(fallbackItem)).toEqual(expect.objectContaining({
      imageUrl: 'https://img-eshop.cdn.nintendo.net/i/fallback-image.jpg',
      releaseDate: '2026-08-27'
    }));
  });

  it.each([
    ['missing NSUID', { title: 'Valid title' }],
    ['blank NSUID', { nsuid: '   ', title: 'Valid title' }],
    ['blank title', { nsuid: '70010000009999', title: '   ' }]
  ])('rejects a raw item with %s', (_name, item) => {
    expect(JapanCatalogItemSchema.safeParse(item).success).toBe(false);
  });

  it.each([
    ['missing result', { status: 0 }],
    ['missing total', { result: { items: [] } }],
    ['negative total', { result: { total: -1, items: [] } }],
    ['non-array items', { result: { total: 0, items: {} } }]
  ])('rejects a malformed page envelope with %s', (_name, page) => {
    expect(JapanCatalogPageSchema.safeParse(page).success).toBe(false);
  });

  it.each([
    ['2026-08-07', { dsdate: '2026-08-07' }],
    ['2026-08-07', { dsdate: '2026-08-07 00:00:00' }],
    ['2026-08-07', { sdate: '2026.8.7' }],
    ['2026-08-07', { sdate: '2026-8-7' }]
  ])('normalizes a supported release date shape to %s', (expected, dateFields) => {
    expect(normalizeJapanCatalogItem(rawItem(dateFields)).releaseDate).toBe(expected);
  });

  it('prefers a valid dsdate over sdate', () => {
    const item = rawItem({ dsdate: '2026-08-07', sdate: '2026.8.27' });

    expect(normalizeJapanCatalogItem(item).releaseDate).toBe('2026-08-07');
  });

  it.each([
    '2026-02-31',
    '2026-02-31 00:00:00',
    '2026/08/27',
    '27.8.2026',
    '2026-8-27 00:00:00',
    '2026.8-7',
    '2026-8.7'
  ])('rejects an invalid or unsupported dsdate %s', (dsdate) => {
    expect(() => normalizeJapanCatalogItem(rawItem({ dsdate }))).toThrow();
  });

  it('does not hide an invalid dsdate behind a valid sdate fallback', () => {
    const item = rawItem({ dsdate: 'not-a-date', sdate: '2026.8.27' });

    expect(() => normalizeJapanCatalogItem(item)).toThrow();
  });

  it('rejects a calendar-invalid sdate used after a blank dsdate', () => {
    const item = rawItem({ dsdate: '   ', sdate: '2026.2.31' });

    expect(() => normalizeJapanCatalogItem(item)).toThrow();
  });

  it('rejects additive source payload fields that are not JSON values', () => {
    const item = rawItem({ fixtureDate: new Date('2026-08-11T00:00:00Z') });

    expect(() => normalizeJapanCatalogItem(item)).toThrow();
  });

  it.each([
    ['DLC', 'dlc'],
    ['DL_DLC', 'dlc'],
    ['set', 'bundle'],
    ['HAC_DOWNLOAD', 'game'],
    ['mystery_form', 'unknown'],
    [null, 'unknown']
  ] as const)('maps the %s software form to %s', (sform, expected) => {
    expect(normalizeJapanCatalogItem(rawItem({ sform })).productType).toBe(expected);
  });

  it('maps a missing software form to unknown', () => {
    expect(normalizeJapanCatalogItem(rawItem()).productType).toBe('unknown');
  });

  it('maps an ambiguous blank software form to unknown', () => {
    expect(normalizeJapanCatalogItem(rawItem({ sform: '   ' })).productType).toBe('unknown');
  });
});
