import { CatalogItemSchema } from '@eshop-tracker/shared';
import { describe, expect, it, vi } from 'vitest';
import { EshopError } from '../src/errors.js';
import { JapanCatalogClient } from '../src/japan/catalog-client.js';
import type { FetchLike } from '../src/upstream-json.js';

const IMAGE_HASH = 'a'.repeat(64);

function rawItem(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `directory-item-${index}`,
    nsuid: `700100${index.toString().padStart(8, '0')}`,
    title: `Synthetic Item ${index}`,
    icode: `HAC-A${index.toString().padStart(4, '0')}`,
    maker: 'Synthetic Publisher',
    text: `Synthetic description ${index}`,
    siurl: IMAGE_HASH,
    dsdate: '2026-08-11',
    sform: 'HAC_DL',
    ...overrides
  };
}

function unpriceableItem(id = 'V-2780_j') {
  return {
    id,
    nsuid: null,
    sform: 'HAC_VB',
    iurl: '/software/feature/nintendo-classics/detail/img/synthetic.jpg',
    siurl: null,
    ssitu: 'not_found'
  };
}

function page(total: number, items: unknown[]) {
  return { status: 0, result: { total, items } };
}

const jsonResponse = (value: unknown, status = 200) => new Response(
  JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json' } }
);

async function rejectionFrom(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  throw new Error('expected operation to reject');
}

function clientForPages(pages: unknown[]) {
  let index = 0;
  const fetch = vi.fn<FetchLike>(async () => {
    const value = pages[index];
    index += 1;
    if (value === undefined) throw new Error('unexpected page request');
    return jsonResponse(value);
  });

  return { client: new JapanCatalogClient({ fetch }), fetch };
}

function expectInvalidPayload(error: unknown): asserts error is EshopError {
  expect(error).toBeInstanceOf(EshopError);
  expect(error).toMatchObject({ code: 'INVALID_PAYLOAD', country: 'JP' });
}

function expectPaginationError(error: unknown, causeMessage: string): asserts error is EshopError {
  expectInvalidPayload(error);
  expect(error.cause).toBeInstanceOf(Error);
  expect((error.cause as Error).message).toBe(causeMessage);
}

describe('JapanCatalogClient.fetchPage', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1]
  ])('rejects a %s page before calling fetch', async (_label, invalidPage) => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(page(0, [])));
    const client = new JapanCatalogClient({ fetch });

    const error = await rejectionFrom(() => client.fetchPage(invalidPage));

    expectPaginationError(error, 'Japanese catalog page must be a positive safe integer');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests the exact Nintendo JP search URL and passes through the signal identity', async () => {
    const payload = page(1, [rawItem(1)]);
    const signal = new AbortController().signal;
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(payload));
    const client = new JapanCatalogClient({ fetch });

    await expect(client.fetchPage(7, signal)).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledOnce();
    const [receivedUrl, receivedInit] = fetch.mock.calls[0]!;
    expect(receivedUrl).toBeInstanceOf(URL);
    if (!(receivedUrl instanceof URL)) throw new Error('expected URL request input');
    expect(receivedUrl.toString()).toBe(
      'https://search.nintendo.jp/nintendo_soft/search.json?opt_hard=1_HAC&limit=400&page=7&sort=hdate+desc'
    );
    expect(receivedUrl.searchParams.get('opt_hard')).toBe('1_HAC');
    expect(receivedUrl.searchParams.get('limit')).toBe('400');
    expect(receivedUrl.searchParams.get('page')).toBe('7');
    expect(receivedUrl.searchParams.get('sort')).toBe('hdate desc');
    expect(receivedInit?.signal).toBe(signal);
  });

  it('wraps a malformed catalog envelope with a stable public message and cause', async () => {
    const malformed = { privatePayload: 'must not leak' };
    const fetch: FetchLike = async () => jsonResponse(malformed);
    const client = new JapanCatalogClient({ fetch });

    const error = await rejectionFrom(() => client.fetchPage(1));

    expectInvalidPayload(error);
    expect(error.message).toBe('Nintendo JP catalog payload is invalid');
    expect(error.message).not.toContain(JSON.stringify(malformed));
    expect(error.cause).toBeDefined();
  });

  it('preserves an ordinary fetch failure as a NETWORK error', async () => {
    const cause = new Error('connection reset');
    const fetch: FetchLike = async () => { throw cause; };
    const client = new JapanCatalogClient({ fetch });

    const error = await rejectionFrom(() => client.fetchPage(1));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'NETWORK', country: 'JP', cause });
  });

  it.each([404, 503])('preserves HTTP %i as an UPSTREAM_HTTP error', async (status) => {
    const fetch: FetchLike = async () => new Response('private body', { status });
    const client = new JapanCatalogClient({ fetch });

    const error = await rejectionFrom(() => client.fetchPage(1));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'UPSTREAM_HTTP', country: 'JP', status });
    expect((error as Error).message).not.toContain('private body');
  });

  it('preserves requestJson invalid-JSON classification without double wrapping', async () => {
    const fetch: FetchLike = async () => new Response('private invalid json');
    const client = new JapanCatalogClient({ fetch });

    const error = await rejectionFrom(() => client.fetchPage(1));

    expectInvalidPayload(error);
    expect(error.message).toBe('Nintendo eShop returned invalid JSON');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('preserves caller abort identity', async () => {
    const reason = new Error('caller cancelled');
    const controller = new AbortController();
    controller.abort(reason);
    const fetch: FetchLike = async () => { throw new Error('fetch aborted'); };
    const client = new JapanCatalogClient({ fetch });

    await expect(client.fetchPage(1, controller.signal)).rejects.toBe(reason);
  });
});

describe('JapanCatalogClient.fetchAll', () => {
  it('fetches pages sequentially and returns normalized first-seen order', async () => {
    const responses = [
      page(3, [rawItem(1)]),
      page(3, [rawItem(2)]),
      page(3, [rawItem(3)])
    ];
    const requestedPages: string[] = [];
    let nextResponse = 0;
    let active = 0;
    let maximumActive = 0;
    const fetch: FetchLike = async (input) => {
      active += 1;
      if (active > 1) throw new Error('catalog pages overlapped');
      maximumActive = Math.max(maximumActive, active);
      requestedPages.push((input as URL).searchParams.get('page') ?? 'missing');
      const response = responses[nextResponse];
      nextResponse += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active -= 1;
      if (response === undefined) throw new Error('unexpected page request');
      return jsonResponse(response);
    };
    const client = new JapanCatalogClient({ fetch });

    const result = await client.fetchAll();

    expect(result.map((item) => item.sourceId)).toEqual([
      '70010000000001',
      '70010000000002',
      '70010000000003'
    ]);
    expect(requestedPages).toEqual(['1', '2', '3']);
    expect(maximumActive).toBe(1);
    expect(result).toEqual(result.map((item) => CatalogItemSchema.parse(item)));
    expect(result.every((item) => item.country === 'JP')).toBe(true);
  });

  it('uses limit 400 on every page URL', async () => {
    const { client, fetch } = clientForPages([
      page(2, [rawItem(1)]),
      page(2, [rawItem(2)])
    ]);

    await client.fetchAll();

    expect(fetch.mock.calls.map(([url]) => (url as URL).searchParams.get('limit'))).toEqual([
      '400',
      '400'
    ]);
  });

  it('accepts cross-page duplicates when the page makes progress and retains the first occurrence', async () => {
    const first = rawItem(1, { title: 'First title' });
    const duplicate = rawItem(1, {
      id: 'directory-duplicate-nsuid',
      title: 'Later title'
    });
    const { client } = clientForPages([
      page(4, [first, rawItem(2)]),
      page(4, [duplicate, rawItem(3)])
    ]);

    const result = await client.fetchAll();

    expect(result.map((item) => [item.sourceId, item.title])).toEqual([
      ['70010000000001', 'First title'],
      ['70010000000002', 'Synthetic Item 2'],
      ['70010000000003', 'Synthetic Item 3']
    ]);
  });

  it('counts an unpriceable directory row toward completeness but skips catalog output', async () => {
    const { client, fetch } = clientForPages([
      page(2, [rawItem(1), unpriceableItem()])
    ]);

    const result = await client.fetchAll();

    expect(result.map((item) => item.sourceId)).toEqual(['70010000000001']);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('treats a new unpriceable directory row as pagination progress', async () => {
    const { client, fetch } = clientForPages([
      page(3, [rawItem(1)]),
      page(3, [unpriceableItem()]),
      page(3, [rawItem(2)])
    ]);

    const result = await client.fetchAll();

    expect(result.map((item) => item.sourceId)).toEqual([
      '70010000000001',
      '70010000000002'
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('counts duplicate directory ids once while retaining first-seen trackable output', async () => {
    const first = rawItem(1, { title: 'First title' });
    const duplicateDirectoryRow = rawItem(1, { title: 'Later title' });
    const { client } = clientForPages([
      page(2, [first]),
      page(2, [duplicateDirectoryRow, rawItem(2)])
    ]);

    const result = await client.fetchAll();

    expect(result.map((item) => [item.sourceId, item.title])).toEqual([
      ['70010000000001', 'First title'],
      ['70010000000002', 'Synthetic Item 2']
    ]);
  });

  it('returns an empty batch for a stable zero-total first page', async () => {
    const { client, fetch } = clientForPages([page(0, [])]);

    await expect(client.fetchAll()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a changed total instead of returning a partial result', async () => {
    const { client } = clientForPages([
      page(3, [rawItem(1), rawItem(2)]),
      page(4, [rawItem(3), rawItem(4)])
    ]);

    expectPaginationError(
      await rejectionFrom(() => client.fetchAll()),
      'Japanese catalog total changed during pagination'
    );
  });

  it('rejects an identical page signature before completion', async () => {
    const { client } = clientForPages([
      page(3, [rawItem(1), rawItem(2)]),
      page(3, [rawItem(1), rawItem(2)])
    ]);

    expectPaginationError(
      await rejectionFrom(() => client.fetchAll()),
      'Japanese catalog page signature repeated before completion'
    );
  });

  it('does not confuse distinct directory id arrays whose comma-joined signatures collide', async () => {
    const { client, fetch } = clientForPages([
      page(5, [
        rawItem(1, { id: 'a,b' }),
        rawItem(2, { id: 'c' })
      ]),
      page(5, [
        rawItem(3, { id: 'a' }),
        rawItem(4, { id: 'b,c' })
      ]),
      page(5, [rawItem(5, { id: 'd' })])
    ]);

    const result = await client.fetchAll();

    expect(result.map((item) => item.sourceId)).toEqual([
      '70010000000001',
      '70010000000002',
      '70010000000003',
      '70010000000004',
      '70010000000005'
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects a non-identical page that makes zero unique progress', async () => {
    const { client } = clientForPages([
      page(3, [rawItem(1), rawItem(2)]),
      page(3, [rawItem(2), rawItem(1), rawItem(2)])
    ]);

    expectPaginationError(
      await rejectionFrom(() => client.fetchAll()),
      'Japanese catalog page made no unique progress'
    );
  });

  it('rejects an empty page before the expected total is reached', async () => {
    const { client } = clientForPages([
      page(2, [rawItem(1)]),
      page(2, [])
    ]);

    expectPaginationError(
      await rejectionFrom(() => client.fetchAll()),
      'Japanese catalog page made no unique progress'
    );
  });

  it('rejects when unique items overshoot the page-one total', async () => {
    const { client } = clientForPages([
      page(1, [rawItem(1), rawItem(2)])
    ]);

    expectPaginationError(
      await rejectionFrom(() => client.fetchAll()),
      'Japanese catalog unique item count exceeded total'
    );
  });

  it('wraps normalizer failures without leaking the raw payload', async () => {
    const privateDate = 'private-unsupported-date';
    const { client } = clientForPages([
      page(1, [rawItem(1, { dsdate: privateDate })])
    ]);

    const error = await rejectionFrom(() => client.fetchAll());

    expectInvalidPayload(error);
    expect(error.cause).toBeDefined();
    expect(error.message).not.toContain(privateDate);
  });

  it('does not mutate caller-owned fixture objects', async () => {
    const fixtures = [
      page(3, [rawItem(1), rawItem(2)]),
      page(3, [rawItem(2), rawItem(3)])
    ];
    const before = structuredClone(fixtures);
    let index = 0;
    const fetch: FetchLike = async () => {
      const fixture = fixtures[index];
      index += 1;
      if (fixture === undefined) throw new Error('unexpected page request');
      const response = new Response();
      vi.spyOn(response, 'json').mockResolvedValue(fixture);
      return response;
    };
    const client = new JapanCatalogClient({ fetch });

    await client.fetchAll();

    expect(fixtures).toEqual(before);
  });

  it('does not return partial data when a later transport request fails', async () => {
    let request = 0;
    const cause = new Error('connection reset on page two');
    const fetch: FetchLike = async () => {
      request += 1;
      if (request === 1) return jsonResponse(page(2, [rawItem(1)]));
      throw cause;
    };
    const client = new JapanCatalogClient({ fetch });

    const error = await rejectionFrom(() => client.fetchAll());

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'NETWORK', country: 'JP', cause });
  });
});
