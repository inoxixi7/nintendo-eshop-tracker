import { describe, expect, it, vi } from 'vitest';
import { UsCatalogClient } from '../src/us/catalog-client.js';
import { normalizeUsCatalogItem } from '../src/us/normalize-catalog-item.js';
import type { UsCatalogHit } from '../src/us/catalog-schema.js';
import type { FetchLike } from '../src/upstream-json.js';

function hit(index: number, overrides: Partial<UsCatalogHit> = {}): UsCatalogHit {
  return {
    objectID: `obj-${index}`,
    nsuid: String(70010000000000 + index),
    title: `Game ${index}`,
    platform: 'Nintendo Switch',
    url: `/us/store/products/game-${index}-switch/`,
    releaseDate: '2026-11-05T00:00:00.000Z',
    eshopDetails: { productType: 'TITLE' },
    ...overrides
  };
}

describe('normalizeUsCatalogItem', () => {
  it('maps a storefront record onto a US catalog item with JP genre names', () => {
    const item = normalizeUsCatalogItem(hit(1, {
      platform: 'Nintendo Switch 2',
      softwarePublisher: 'Nintendo',
      productImage: 'store/software/switch2/70010000000001/abc',
      gameGenres: [{ code: 'ACTION' }, { code: 'TEXT_ADVENTURE' }, { code: 'ADVENTURE' }, { code: 'NEW_THING' }]
    }));

    expect(item).toMatchObject({
      country: 'US',
      source: 'nintendo-us-algolia',
      sourceId: '70010000000001',
      platform: 'switch2',
      productType: 'game',
      publisher: 'Nintendo',
      releaseDate: '2026-11-05',
      imageUrl: 'https://assets.nintendo.com/image/upload/q_auto/f_auto/store/software/switch2/70010000000001/abc',
      sourceUrl: 'https://www.nintendo.com/us/store/products/game-1-switch/',
      sourcePayload: expect.objectContaining({ genre: ['アクション', 'アドベンチャー', 'その他'] })
    });
  });

  it('classifies add-ons and bundles, whatever language the store names them in', () => {
    expect(normalizeUsCatalogItem(hit(1, { dlcType: 'Individual' }))?.productType).toBe('dlc');
    expect(normalizeUsCatalogItem(hit(1, { dlcType: 'ROM Bundle' }))?.productType).toBe('bundle');
    expect(normalizeUsCatalogItem(hit(1, { dlcType: 'Paquete' }), 'MX')?.productType).toBe('bundle');
  });

  it('labels Canadian, Mexican and Brazilian records with their own store', () => {
    expect(normalizeUsCatalogItem(hit(1, { url: '/pt-br/store/products/game-1-switch/' }), 'BR')).toMatchObject({
      country: 'BR',
      sourceUrl: 'https://www.nintendo.com/pt-br/store/products/game-1-switch/'
    });
  });

  it('skips records the tracker cannot price or does not cover', () => {
    expect(normalizeUsCatalogItem(hit(1, { nsuid: null }))).toBeNull();
    expect(normalizeUsCatalogItem(hit(1, { platform: 'iOS/Android' }))).toBeNull();
  });
});

function algolia(records: UsCatalogHit[]) {
  return vi.fn<FetchLike>(async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    const filters = url.searchParams.get('filters') ?? '';
    const matches = records.filter((record) => filters.split(' AND ').every((filter) => {
      if (filter === '') return true;
      const [, negate, facet, value] = /^(NOT )?(\w+):"(.*)"$/.exec(filter) ?? [];
      if (facet === undefined) throw new Error(`unexpected filter ${filter}`);
      return ((record as Record<string, unknown>)[facet] === value) !== (negate !== undefined);
    }));
    const facet = (JSON.parse(url.searchParams.get('facets') ?? '[]') as string[])[0];
    const facets = facet === undefined ? undefined : {
      [facet]: Object.fromEntries([...new Set(matches.map((record) => (record as Record<string, unknown>)[facet]))]
        .filter((value): value is string => typeof value === 'string').map((value) => [value, 1]))
    };
    // Algolia never pages past 1000 hits
    const reachable = matches.slice(0, 1000);
    return new Response(JSON.stringify({ hits: reachable.slice(page * 500, page * 500 + 500), nbHits: matches.length, facets }));
  });
}

describe('UsCatalogClient', () => {
  it('splits a catalog bigger than one query can reach by facet, including records without the facet', async () => {
    const records = Array.from({ length: 1500 }, (_, index) => hit(index + 1, {
      platform: index < 700 ? 'Nintendo Switch 2' : 'Nintendo Switch',
      ...(index % 3 === 0 ? { contentRatingCode: 'E' } : {})
    }));
    const fetch = algolia(records);

    const items = await new UsCatalogClient({ fetch }).fetchAll();

    expect(items).toHaveLength(1500);
    expect(new Set(items.map((item) => item.sourceId)).size).toBe(1500);
    const first = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(first.searchParams.get('x-algolia-api-key')).toMatch(/^[a-f0-9]{32}$/);
  });

  it('fails instead of returning a catalog it could only partly reach', async () => {
    // one facet value over 1000 with no further facet to split on and no prices to bisect
    const records = Array.from({ length: 1200 }, (_, index) => hit(index + 1, {
      contentRatingCode: 'E', dlcType: 'Individual', availability: 'Available now'
    } as Partial<UsCatalogHit>));
    const fetch = vi.fn<FetchLike>(async (input) => {
      const filters = new URL(String(input)).searchParams.get('filters') ?? '';
      // price-filtered buckets are empty: these records carry no price
      if (filters.includes('price.finalPrice')) return new Response(JSON.stringify({ hits: [], nbHits: 0 }));
      return algolia(records)(input);
    });

    await expect(new UsCatalogClient({ fetch }).fetchAll()).rejects.toMatchObject({ code: 'INVALID_PAYLOAD', country: 'US' });
  });
});

describe('UsCatalogClient for other nintendo.com stores', () => {
  it('reads the store\'s own index', async () => {
    const fetch = algolia([hit(1)]);

    const items = await new UsCatalogClient({ fetch, country: 'MX' }).fetchAll();

    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe('/1/indexes/store_game_es_mx');
    expect(items[0]?.country).toBe('MX');
  });
});
