import { describe, expect, it, vi } from 'vitest';
import { GbCatalogClient } from '../src/gb/catalog-client.js';
import type { GbCatalogDoc } from '../src/gb/catalog-schema.js';
import { normalizeGbCatalogItem } from '../src/gb/normalize-catalog-item.js';
import type { FetchLike } from '../src/upstream-json.js';

function doc(index: number, overrides: Partial<GbCatalogDoc> = {}): GbCatalogDoc {
  return {
    fs_id: String(index),
    title: `Game ${index}`,
    nsuid_txt: [String(70010000000000 + index)],
    product_code_txt: [`HACPA${String(index).padStart(3, '0')}A`],
    playable_on_txt: ['HAC'],
    url: `/en-gb/Games/Nintendo-Switch-games/Game-${index}.html`,
    dates_released_dts: ['2022-09-09T00:00:00Z'],
    ...overrides
  };
}

describe('normalizeGbCatalogItem', () => {
  it('maps a Europe search document onto a GB item keyed like JP product codes', () => {
    const item = normalizeGbCatalogItem(doc(1, {
      title: 'Splatoon 3',
      nsuid_txt: ['70070000016779', '70010000046396'],
      product_code_txt: ['HACYAV5JE', 'HACPAV5JA'],
      publisher: 'Nintendo',
      game_categories_txt: ['action', 'shooter', 'platformer', 'something_new'],
      image_url_sq_s: 'https://www.nintendo.com/eu/media/images/sq.jpg'
    }));

    expect(item).toMatchObject({
      country: 'GB',
      source: 'nintendo-eu-search',
      sourceId: '70010000046396',
      productCode: 'AV5JA',
      platform: 'switch',
      productType: 'game',
      publisher: 'Nintendo',
      releaseDate: '2022-09-09',
      imageUrl: 'https://www.nintendo.com/eu/media/images/sq.jpg',
      sourceUrl: 'https://www.nintendo.com/en-gb/Games/Nintendo-Switch-games/Game-1.html',
      sourcePayload: expect.objectContaining({ genre: ['アクション', 'シューティング', 'その他'] })
    });
  });

  it('reads Switch 2 from the product code, or from the system when there is none', () => {
    expect(normalizeGbCatalogItem(doc(1, { product_code_txt: ['BEEPAAAAA'] }))?.platform).toBe('switch2');
    expect(normalizeGbCatalogItem(doc(1, { product_code_txt: [], playable_on_txt: ['BEE'] }))).toMatchObject({ platform: 'switch2', productCode: null });
  });

  it('skips documents without a priceable game id or a Switch system', () => {
    expect(normalizeGbCatalogItem(doc(1, { nsuid_txt: ['70070000016779'] }))).toBeNull();
    expect(normalizeGbCatalogItem(doc(1, { product_code_txt: ['CTRNQAAP'], playable_on_txt: ['CTR'] }))).toBeNull();
  });
});

describe('GbCatalogClient', () => {
  it('pages through the index in a stable order', async () => {
    const docs = Array.from({ length: 1500 }, (_, index) => doc(index + 1));
    const fetch = vi.fn<FetchLike>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('sort')).toBe('fs_id asc');
      const start = Number(url.searchParams.get('start'));
      const body = { response: { numFound: docs.length, docs: docs.slice(start, start + Number(url.searchParams.get('rows'))) } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const items = await new GbCatalogClient({ fetch }).fetchAll();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(1500);
  });
});
