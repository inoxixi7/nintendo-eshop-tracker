import { describe, expect, it } from 'vitest';
import {
  JapanCatalogItemSchema,
  JapanCatalogPageSchema
} from '../src/japan/catalog-schema.js';
import { normalizeJapanCatalogItem } from '../src/japan/normalize-catalog-item.js';
import { readJsonFixture } from './fixture.js';

const PRIMARY_IMAGE_HASH = 'a'.repeat(64);
const FALLBACK_IMAGE_HASH = 'b'.repeat(64);

function pageWithItems(items: unknown[]) {
  return { status: 0, result: { total: items.length, items } };
}

function rawItem(overrides: Record<string, unknown> = {}) {
  return JapanCatalogItemSchema.parse({
    id: 'synthetic-item',
    nsuid: '70010000009999',
    title: 'Synthetic Test Item',
    hard: '1_HAC',
    ...overrides
  });
}

describe('Japanese catalog normalization', () => {
  it('validates and exactly normalizes representative catalog items without mutating the input', async () => {
    const input = await readJsonFixture('jp-catalog-page.json');
    const before = structuredClone(input);
    const page = JapanCatalogPageSchema.parse(input);
    const trackableItems = page.result.items.filter((item) => item.nsuid !== null);

    const normalized = trackableItems.map(normalizeJapanCatalogItem);

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
        imageUrl: 'https://img-eshop.cdn.nintendo.net/i/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
        releaseDate: '2026-08-21',
        productType: 'game',
        platform: 'switch',
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
        imageUrl: 'https://img-eshop.cdn.nintendo.net/i/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg',
        releaseDate: '2026-08-27',
        productType: 'bundle',
        platform: 'switch',
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
        platform: 'switch',
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
        platform: 'switch',
        sourceUrl: 'https://store-jp.nintendo.com/item/software/D70010000000004',
        sourcePayload: expect.objectContaining({ fixtureMarker: 'unknown-extra' })
      }
    ]);
    expect(normalized.map((item) => item.sourcePayload)).toEqual(trackableItems);
    expect(input).toEqual(before);
  });

  it('trims optional text fields before producing the final mapping', () => {
    const item = rawItem({
      icode: '  HAC-A0999  ',
      maker: '  Sample Publisher  ',
      text: '  Synthetic description.  ',
      siurl: `  ${PRIMARY_IMAGE_HASH}  `,
      iurl: `  ${FALLBACK_IMAGE_HASH}  `,
      dsdate: '  2026-08-07  ',
      sdate: '  2026.8.27  '
    });
    const fallbackItem = rawItem({
      siurl: '   ',
      iurl: `  ${FALLBACK_IMAGE_HASH}  `,
      dsdate: '   ',
      sdate: '  2026.8.27  '
    });

    expect(item).toEqual(expect.objectContaining({
      icode: 'HAC-A0999',
      maker: 'Sample Publisher',
      text: 'Synthetic description.',
      siurl: PRIMARY_IMAGE_HASH,
      iurl: FALLBACK_IMAGE_HASH,
      dsdate: '2026-08-07',
      sdate: '2026.8.27'
    }));
    expect(normalizeJapanCatalogItem(item)).toEqual(expect.objectContaining({
      productCode: 'HAC-A0999',
      publisher: 'Sample Publisher',
      description: 'Synthetic description.',
      imageUrl: 'https://img-eshop.cdn.nintendo.net/i/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
      releaseDate: '2026-08-07'
    }));
    expect(fallbackItem).toEqual(expect.objectContaining({
      siurl: '',
      iurl: FALLBACK_IMAGE_HASH,
      dsdate: '',
      sdate: '2026.8.27'
    }));
    expect(normalizeJapanCatalogItem(fallbackItem)).toEqual(expect.objectContaining({
      imageUrl: 'https://img-eshop.cdn.nintendo.net/i/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg',
      releaseDate: '2026-08-27'
    }));
  });

  it.each([
    ['missing NSUID', { id: 'synthetic-item', title: 'Valid title' }],
    ['blank NSUID', { id: 'synthetic-item', nsuid: '   ', title: 'Valid title' }],
    ['blank title', { id: 'synthetic-item', nsuid: '70010000009999', title: '   ' }]
  ])('rejects a raw item with %s', (_name, item) => {
    expect(JapanCatalogItemSchema.safeParse(item).success).toBe(false);
  });

  it.each([
    ['letters', '7001000000000a'],
    ['13 digits', '7001000000000'],
    ['15 digits', '700100000000001'],
    ['query injection', '7001000000000?'],
    ['fragment injection', '7001000000000#'],
    ['path traversal', '7001000/../../']
  ])('rejects an NSUID containing %s', (_name, nsuid) => {
    expect(JapanCatalogItemSchema.safeParse({
      id: 'synthetic-item',
      nsuid,
      title: 'Synthetic Test Item'
    }).success).toBe(false);
  });

  it.each(['siurl', 'iurl'] as const)('rejects unsafe values in %s', (field) => {
    const invalidHashes = [
      `${'a'.repeat(63)}?`,
      `${'a'.repeat(63)}#`,
      '../',
      `${'a'.repeat(31)}\u0000${'a'.repeat(32)}`,
      `${'a'.repeat(31)} ${'a'.repeat(32)}`,
      'A'.repeat(64),
      'http://www.nintendo.com/jp/data/img/hero/x.jpg',
      'https://evil.example/x.jpg',
      'https://nintendo.com.evil.example/x.jpg',
      '/software/feature/nintendo-classics/detail/img/x.jpg'
    ];

    for (const value of invalidHashes) {
      expect(JapanCatalogItemSchema.safeParse({
        id: 'synthetic-item',
        nsuid: '70010000009999',
        title: 'Synthetic Test Item',
        [field]: value
      }).success).toBe(false);
    }
  });

  it('builds the exact CDN URL from a valid image hash', () => {
    const hash = '0123456789abcdef'.repeat(4);

    expect(normalizeJapanCatalogItem(rawItem({ siurl: hash })).imageUrl).toBe(
      'https://img-eshop.cdn.nintendo.net/i/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.jpg'
    );
  });

  it('keeps a Nintendo-hosted absolute image URL as is', () => {
    const url = 'https://www.nintendo.com/jp/data/img/hero/dk_bananza_dlc_s.jpg';

    expect(normalizeJapanCatalogItem(rawItem({ siurl: url })).imageUrl).toBe(url);
  });

  it.each([
    ['missing result', { status: 0 }],
    ['missing total', { result: { items: [] } }],
    ['negative total', { result: { total: -1, items: [] } }],
    ['non-array items', { result: { total: 0, items: {} } }]
  ])('rejects a malformed page envelope with %s', (_name, page) => {
    expect(JapanCatalogPageSchema.safeParse(page).success).toBe(false);
  });

  it.each(['70010000039949_2', '70010000012085_sora', '4039'])(
    'treats directory-only NSUID variant %s as unpriceable',
    (nsuid) => {
      const parsed = JapanCatalogPageSchema.parse(pageWithItems([{ id: nsuid, nsuid, title: 'Variant' }]));

      expect(parsed.result.items[0]?.nsuid).toBeNull();
    }
  );

  it('accepts a live-shaped unpriceable directory row without validating its ignored image path', () => {
    const unpriceable = {
      id: 'V-2780_j',
      nsuid: null,
      sform: 'HAC_VB',
      iurl: '/software/feature/nintendo-classics/detail/img/synthetic.jpg',
      siurl: null,
      ssitu: 'not_found'
    };

    expect(JapanCatalogPageSchema.parse(pageWithItems([unpriceable]))).toEqual(
      pageWithItems([unpriceable])
    );
  });

  it.each([
    ['missing NSUID', { id: 'V-2780_j', sform: 'HAC_VB' }],
    ['invalid non-null NSUID', {
      id: 'V-2780_j',
      nsuid: 'not-priceable',
      title: 'Synthetic Test Item'
    }],
    ['missing unpriceable directory id', { nsuid: null, sform: 'HAC_VB' }],
    ['blank unpriceable directory id', { id: '   ', nsuid: null, sform: 'HAC_VB' }],
    ['missing trackable directory id', {
      nsuid: '70010000009999',
      title: 'Synthetic Test Item'
    }],
    ['blank trackable directory id', {
      id: '   ',
      nsuid: '70010000009999',
      title: 'Synthetic Test Item'
    }]
  ])('rejects a directory row with %s', (_name, item) => {
    expect(JapanCatalogPageSchema.safeParse(pageWithItems([item])).success).toBe(false);
  });

  it.each([
    ['2026-08-07', { dsdate: '2026-08-07' }],
    ['2026-08-07', { dsdate: '2026-08-07 00:00:00' }],
    ['2026-08-07', { sdate: '2026.8.7' }],
    ['2026-08-07', { sdate: '2026-8-7' }]
  ])('normalizes a supported release date shape to %s', (expected, dateFields) => {
    expect(normalizeJapanCatalogItem(rawItem(dateFields)).releaseDate).toBe(expected);
  });

  it.each([
    ['1_HAC', 'switch'],
    ['05_BEE', 'switch2']
  ])('maps hardware %s to platform %s', (hard, platform) => {
    expect(normalizeJapanCatalogItem(rawItem({ hard })).platform).toBe(platform);
  });

  it('rejects a priceable row without a known hardware code', () => {
    expect(JapanCatalogItemSchema.safeParse({
      id: 'synthetic-item',
      nsuid: '70010000009999',
      title: 'Synthetic Test Item',
      hard: '2_CTR'
    }).success).toBe(false);
  });

  it('treats a year-only announcement as an unknown release date', () => {
    expect(normalizeJapanCatalogItem(rawItem({ dsdate: '', sdate: '2027' })).releaseDate).toBeNull();
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
    ['HAC_DL', 'game'],
    ['HAC_DOWNLOADABLE', 'game'],
    ['HAC_CARD', 'game'],
    ['HAC_FC/NES', 'game'],
    ['HAC_SFC/SNES', 'game'],
    ['HAC_MD', 'game'],
    ['HAC_N64', 'game'],
    ['HAC_AGB', 'game'],
    ['HAC_DMG', 'game'],
    ['HAC_VB', 'game'],
    ['HAC_CGB', 'game'],
    ['BEE_DL', 'game'],
    ['BEE_DOWNLOADABLE', 'game'],
    ['BEE_CARD', 'game'],
    ['BEE_GC', 'game'],
    ['HAC_DLC', 'unknown'],
    ['HAC_FUTURE', 'unknown'],
    ['HAC_DOWNLOAD', 'unknown'],
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
