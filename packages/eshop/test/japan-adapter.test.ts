import { afterEach, describe, expect, it, vi } from 'vitest';
import * as eshop from '../src/index.js';
import {
  createJapanEshopAdapter,
  validateCatalogBatch,
  validatePriceBatch
} from '../src/index.js';
import type { FetchLike } from '../src/upstream-json.js';

const FIRST_SOURCE_ID = '70010000000141';
const SECOND_SOURCE_ID = '70010000000185';
const SWITCH_2_SOURCE_ID = '70010000000200';
const IMAGE_HASH = 'a'.repeat(64);
const OBSERVED_AT = '2026-08-11T00:00:00.000Z';

function catalogItem(sourceId: string, title: string, hard = '1_HAC') {
  return {
    id: sourceId,
    nsuid: sourceId,
    title,
    icode: `HAC-A${sourceId.slice(-4)}`,
    maker: 'Synthetic Publisher',
    text: `${title} description`,
    siurl: IMAGE_HASH,
    dsdate: '2026-08-11',
    sform: 'HAC_DL',
    hard
  };
}

function catalogPage(items: unknown[]) {
  return { status: 0, result: { total: 2, items } };
}

function priceResponse(sourceIds: readonly string[]) {
  return {
    country: 'JP',
    prices: sourceIds.map((sourceId) => sourceId === SECOND_SOURCE_ID
      ? { title_id: Number(sourceId), sales_status: 'not_found' }
      : {
          title_id: Number(sourceId),
          sales_status: 'onsale',
          regular_price: {
            amount: 'JPY 7980',
            currency: 'JPY',
            raw_value: '7980'
          }
        })
  };
}

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  headers: { 'content-type': 'application/json' }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createJapanEshopAdapter', () => {
  it('binds the default fetch receiver and remains offline under a stub', async () => {
    const signal = new AbortController().signal;
    let callCount = 0;
    let receivedThis: unknown;
    let receivedSignal: AbortSignal | null | undefined;
    const fetch: FetchLike = function (
      this: unknown,
      _input: RequestInfo | URL,
      init?: RequestInit
    ) {
      callCount += 1;
      receivedThis = this;
      receivedSignal = init?.signal;
      if (this !== globalThis) throw new Error('wrong fetch receiver');
      return Promise.resolve(jsonResponse({
        status: 0,
        result: { total: 0, items: [] }
      }));
    };
    vi.stubGlobal('fetch', fetch);

    try {
      const adapter = createJapanEshopAdapter();

      expect(adapter.country).toBe('JP');
      expect(callCount).toBe(0);
      await expect(adapter.fetchCatalog(signal)).resolves.toEqual([]);
      expect(callCount).toBe(2);
      expect(receivedThis).toBe(globalThis);
      expect(receivedSignal).toBe(signal);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('composes the catalog and price clients with one injected fetch and clock', async () => {
    const catalogSignal = new AbortController().signal;
    const priceSignal = new AbortController().signal;
    const now = vi.fn(() => new Date(OBSERVED_AT));
    const fetch = vi.fn<FetchLike>(async (input) => {
      const url = input instanceof URL ? input : new URL(input.toString());

      if (
        url.hostname === 'search.nintendo.jp'
        && url.pathname === '/nintendo_soft/search.json'
      ) {
        const page = url.searchParams.get('page');
        if (url.searchParams.get('opt_hard') === '05_BEE') {
          // repeats FIRST_SOURCE_ID to prove cross-hardware rows are deduplicated
          return jsonResponse(catalogPage([
            catalogItem(SWITCH_2_SOURCE_ID, 'Synthetic Switch 2', '05_BEE'),
            catalogItem(FIRST_SOURCE_ID, 'Synthetic First duplicate')
          ]));
        }
        if (page === '1') {
          return jsonResponse(catalogPage([
            catalogItem(FIRST_SOURCE_ID, 'Synthetic First')
          ]));
        }
        if (page === '2') {
          return jsonResponse(catalogPage([
            catalogItem(SECOND_SOURCE_ID, 'Synthetic Second')
          ]));
        }
      }

      if (
        url.hostname === 'api.ec.nintendo.com'
        && url.pathname === '/v1/price'
      ) {
        const sourceIds = url.searchParams.get('ids')?.split(',') ?? [];
        return jsonResponse(priceResponse(sourceIds));
      }

      throw new Error(`unexpected request: ${url.toString()}`);
    });
    const options = Object.freeze({ fetch, now });
    const adapter = createJapanEshopAdapter(options);

    const catalog = await adapter.fetchCatalog(catalogSignal);
    const sourceIds: readonly string[] = Object.freeze(
      catalog.map((item) => item.sourceId)
    );
    const sourceIdsBefore = [...sourceIds];
    const prices = await adapter.fetchPrices(sourceIds, priceSignal);

    expect(validateCatalogBatch(catalog, 'JP')).toEqual(catalog);
    expect(validatePriceBatch(prices.observations, 'JP')).toEqual(prices.observations);
    expect(catalog.map((item) => [item.sourceId, item.title, item.platform])).toEqual([
      [FIRST_SOURCE_ID, 'Synthetic First', 'switch'],
      [SECOND_SOURCE_ID, 'Synthetic Second', 'switch'],
      [SWITCH_2_SOURCE_ID, 'Synthetic Switch 2', 'switch2']
    ]);
    expect(prices.observations.map((item) => item.sourceId)).toEqual([
      FIRST_SOURCE_ID,
      SWITCH_2_SOURCE_ID
    ]);
    expect(prices.unavailableSourceIds).toEqual([SECOND_SOURCE_ID]);
    expect(prices.observations[0]?.observedAt).toBe(OBSERVED_AT);
    expect(now).toHaveBeenCalledOnce();
    expect(sourceIds).toEqual(sourceIdsBefore);
    expect(fetch).toHaveBeenCalledTimes(4);

    const catalogCalls = fetch.mock.calls.filter(([input]) => (
      input instanceof URL && input.hostname === 'search.nintendo.jp'
    ));
    const priceCalls = fetch.mock.calls.filter(([input]) => (
      input instanceof URL && input.hostname === 'api.ec.nintendo.com'
    ));
    expect(catalogCalls).toHaveLength(3);
    expect(catalogCalls.every(([, init]) => init?.signal === catalogSignal)).toBe(true);
    expect(priceCalls).toHaveLength(1);
    expect((priceCalls[0]?.[0] as URL).searchParams.get('ids')).toBe(
      sourceIdsBefore.join(',')
    );
    expect(priceCalls[0]?.[1]?.signal).toBe(priceSignal);
  });

  it('rejects a leading-zero catalog NSUID before it can become a price request', async () => {
    const fetch = vi.fn<FetchLike>(async (input) => {
      const url = input as URL;

      if (url.hostname === 'search.nintendo.jp') {
        return jsonResponse({
          status: 0,
          result: {
            total: 1,
            items: [catalogItem('00000000000001', 'Invalid source ID')]
          }
        });
      }

      throw new Error(`unexpected price request: ${url.toString()}`);
    });
    const adapter = createJapanEshopAdapter({
      fetch,
      now: () => new Date(OBSERVED_AT)
    });

    await expect(adapter.fetchCatalog()).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
      country: 'JP'
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.every(([input]) => (
      (input as URL).hostname !== 'api.ec.nintendo.com'
    ))).toBe(true);
  });

  it('keeps separately configured adapter instances isolated', async () => {
    const makeFetch = () => vi.fn<FetchLike>(async (input) => {
      const url = input as URL;
      const sourceIds = url.searchParams.get('ids')?.split(',') ?? [];
      return jsonResponse(priceResponse(sourceIds));
    });
    const firstFetch = makeFetch();
    const secondFetch = makeFetch();
    const firstAdapter = createJapanEshopAdapter({
      fetch: firstFetch,
      now: () => new Date('2026-08-11T01:00:00.000Z')
    });
    const secondAdapter = createJapanEshopAdapter({
      fetch: secondFetch,
      now: () => new Date('2026-08-11T02:00:00.000Z')
    });

    const secondResult = await secondAdapter.fetchPrices([FIRST_SOURCE_ID]);
    const firstResult = await firstAdapter.fetchPrices([FIRST_SOURCE_ID]);

    expect(secondResult.observations[0]?.observedAt).toBe(
      '2026-08-11T02:00:00.000Z'
    );
    expect(firstResult.observations[0]?.observedAt).toBe(
      '2026-08-11T01:00:00.000Z'
    );
    expect(firstFetch).toHaveBeenCalledOnce();
    expect(secondFetch).toHaveBeenCalledOnce();
  });
});

it('keeps the root runtime surface minimal and stable', () => {
  expect(Object.keys(eshop).sort()).toEqual([
    'EshopError',
    'createJapanEshopAdapter',
    'fetchTitleAliases',
    'validateCatalogBatch',
    'validatePriceBatch'
  ]);
  expect(eshop).not.toHaveProperty('JapanCatalogClient');
  expect(eshop).not.toHaveProperty('NintendoPriceClient');
  expect(eshop).not.toHaveProperty('requestJson');
});
