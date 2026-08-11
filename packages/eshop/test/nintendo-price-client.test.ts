import { describe, expect, it, vi } from 'vitest';
import { EshopError } from '../src/errors.js';
import { NintendoPriceClient } from '../src/nintendo-price/client.js';
import type { FetchLike } from '../src/upstream-json.js';

const OBSERVED_AT = '2026-08-11T01:02:03.456Z';

function sourceId(index: number): string {
  return (70010000000000 + index).toString();
}

function money(rawValue = '7980', overrides: Record<string, unknown> = {}) {
  return {
    amount: `JPY ${rawValue}`,
    currency: 'JPY',
    raw_value: rawValue,
    ...overrides
  };
}

function availablePrice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    title_id: Number(id),
    sales_status: 'onsale',
    regular_price: money(),
    ...overrides
  };
}

function unavailablePrice(id: string) {
  return {
    title_id: Number(id),
    sales_status: 'not_found'
  };
}

function priceResponse(prices: unknown[]) {
  return { country: 'JP', prices };
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

function expectInvalidPayload(error: unknown): asserts error is EshopError {
  expect(error).toBeInstanceOf(EshopError);
  expect(error).toMatchObject({ code: 'INVALID_PAYLOAD', country: 'JP' });
}

function expectInvalidPayloadCause(error: unknown, causeMessage: string): void {
  expectInvalidPayload(error);
  expect(error.message).toBe('Nintendo price payload is invalid');
  expect(error.cause).toBeInstanceOf(Error);
  expect((error.cause as Error).message).toBe(causeMessage);
}

function clientForPayload(payload: unknown, now = vi.fn(() => new Date(OBSERVED_AT))) {
  const fetch = vi.fn<FetchLike>(async () => jsonResponse(payload));
  return {
    client: new NintendoPriceClient({ fetch, now }),
    fetch,
    now
  };
}

function controlledBodyResponse() {
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  let markReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      bodyController = controller;
      markReadStarted();
      return new Promise<void>(() => {});
    }
  }, { highWaterMark: 0 });

  return {
    response: new Response(body, {
      headers: { 'content-type': 'application/json' }
    }),
    readStarted,
    failBody(cause: unknown) {
      bodyController.error(cause);
    }
  };
}

describe('NintendoPriceClient input and requests', () => {
  it('returns an empty result without fetching or reading the clock', async () => {
    const fetch = vi.fn<FetchLike>();
    const now = vi.fn(() => new Date(OBSERVED_AT));
    const client = new NintendoPriceClient({ fetch, now });

    await expect(client.fetchPrices([])).resolves.toEqual({
      observations: [],
      unavailableSourceIds: []
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it.each([
    ['blank', ''],
    ['nondecimal', '70010000000abc'],
    ['plus sign', '+7001000000001'],
    ['minus sign', '-0010000000001'],
    ['leading whitespace', ' 7001000000001'],
    ['trailing whitespace', '7001000000001 '],
    ['query text', '70010000000001?x'],
    ['path text', '70010000000001/x'],
    ['13 digits', '7001000000001'],
    ['15 digits', '700100000000001'],
    ['non-ASCII digits', '７００１０００００００００１']
  ])('rejects a %s source ID before any network or clock access', async (_label, invalidId) => {
    const fetch = vi.fn<FetchLike>();
    const now = vi.fn(() => new Date(OBSERVED_AT));
    const client = new NintendoPriceClient({ fetch, now });

    const error = await rejectionFrom(() => client.fetchPrices([
      sourceId(1),
      invalidId
    ]));

    expectInvalidPayloadCause(
      error,
      'Nintendo price source ID must be a 14-digit integer'
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('deduplicates in first-seen order without mutating the caller array', async () => {
    const first = sourceId(1);
    const second = sourceId(2);
    const input: readonly string[] = Object.freeze([second, first, second, first]);
    const inputBefore = [...input];
    const { client, fetch } = clientForPayload(priceResponse([
      availablePrice(second),
      availablePrice(first)
    ]));

    const result = await client.fetchPrices(input);

    expect((fetch.mock.calls[0]?.[0] as URL).searchParams.get('ids')).toBe(
      `${second},${first}`
    );
    expect(result.observations.map((item) => item.sourceId)).toEqual([second, first]);
    expect(input).toEqual(inputBefore);
  });

  it('requests the exact Nintendo JP price URL and preserves signal identity', async () => {
    const first = sourceId(1);
    const second = sourceId(2);
    const signal = new AbortController().signal;
    const { client, fetch } = clientForPayload(priceResponse([
      availablePrice(first),
      availablePrice(second)
    ]));

    await client.fetchPrices([first, second], signal);

    expect(fetch).toHaveBeenCalledOnce();
    const [receivedUrl, receivedInit] = fetch.mock.calls[0]!;
    expect(receivedUrl).toBeInstanceOf(URL);
    expect((receivedUrl as URL).toString()).toBe(
      `https://api.ec.nintendo.com/v1/price?country=JP&lang=ja&ids=${first}%2C${second}`
    );
    expect(receivedInit?.signal).toBe(signal);
  });

  it('fetches 51 IDs in sequential 50 and 1 item batches in exact request order', async () => {
    const sourceIds = Array.from({ length: 51 }, (_, index) => sourceId(index + 1));
    const requestedBatches: string[][] = [];
    let active = 0;
    let maximumActive = 0;
    const fetch: FetchLike = async (input) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const ids = ((input as URL).searchParams.get('ids') ?? '').split(',');
      requestedBatches.push(ids);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return jsonResponse(priceResponse(ids.map((id) => availablePrice(id))));
    };
    const now = vi.fn(() => new Date(OBSERVED_AT));
    const client = new NintendoPriceClient({ fetch, now });

    const result = await client.fetchPrices(sourceIds);

    expect(requestedBatches).toEqual([sourceIds.slice(0, 50), sourceIds.slice(50)]);
    expect(maximumActive).toBe(1);
    expect(result.observations.map((item) => item.sourceId)).toEqual(sourceIds);
  });

  it('reads the clock once and shares the exact ISO timestamp across all batches', async () => {
    const sourceIds = Array.from({ length: 51 }, (_, index) => sourceId(index + 1));
    const fetch: FetchLike = async (input) => {
      const ids = ((input as URL).searchParams.get('ids') ?? '').split(',');
      return jsonResponse(priceResponse(ids.map((id) => availablePrice(id))));
    };
    const now = vi.fn(() => new Date(OBSERVED_AT));
    const client = new NintendoPriceClient({ fetch, now });

    const result = await client.fetchPrices(sourceIds);

    expect(now).toHaveBeenCalledOnce();
    expect(new Set(result.observations.map((item) => item.observedAt))).toEqual(
      new Set([OBSERVED_AT])
    );
  });
});

describe('NintendoPriceClient reconciliation and normalization', () => {
  it('restores requested order when the upstream response is shuffled', async () => {
    const sourceIds = [sourceId(1), sourceId(2), sourceId(3)];
    const { client } = clientForPayload(priceResponse([
      availablePrice(sourceIds[2]!),
      availablePrice(sourceIds[0]!),
      availablePrice(sourceIds[1]!)
    ]));

    const result = await client.fetchPrices(sourceIds);

    expect(result.observations.map((item) => item.sourceId)).toEqual(sourceIds);
  });

  it('classifies each requested ID exactly once and orders each result array by request order', async () => {
    const sourceIds = [sourceId(1), sourceId(2), sourceId(3), sourceId(4)];
    const { client } = clientForPayload(priceResponse([
      unavailablePrice(sourceIds[3]!),
      availablePrice(sourceIds[2]!),
      unavailablePrice(sourceIds[1]!),
      availablePrice(sourceIds[0]!)
    ]));

    const result = await client.fetchPrices(sourceIds);

    expect(result.observations.map((item) => item.sourceId)).toEqual([
      sourceIds[0],
      sourceIds[2]
    ]);
    expect(result.unavailableSourceIds).toEqual([sourceIds[1], sourceIds[3]]);
    expect([
      ...result.observations.map((item) => item.sourceId),
      ...result.unavailableSourceIds
    ].sort()).toEqual([...sourceIds].sort());
  });

  it('rejects an unexpected upstream source ID with a stable cause', async () => {
    const requested = sourceId(1);
    const { client } = clientForPayload(priceResponse([availablePrice(sourceId(2))]));

    expectInvalidPayloadCause(
      await rejectionFrom(() => client.fetchPrices([requested])),
      'Nintendo price response contained an unexpected source ID'
    );
  });

  it('rejects an omitted requested source ID with a stable cause', async () => {
    const requested = [sourceId(1), sourceId(2)];
    const { client } = clientForPayload(priceResponse([availablePrice(requested[0]!)]));

    expectInvalidPayloadCause(
      await rejectionFrom(() => client.fetchPrices(requested)),
      'Nintendo price response omitted a requested source ID'
    );
  });

  it('rejects a duplicate upstream source ID before normalization', async () => {
    const requested = sourceId(1);
    const { client } = clientForPayload(priceResponse([
      availablePrice(requested),
      unavailablePrice(requested)
    ]));

    expectInvalidPayloadCause(
      await rejectionFrom(() => client.fetchPrices([requested])),
      'Nintendo price response contained a duplicate source ID'
    );
  });

  it.each([
    ['malformed envelope', { privatePayload: 'do not leak' }],
    ['wrong currency', priceResponse([availablePrice(sourceId(1), {
      regular_price: money('7980', { currency: 'USD' })
    })])],
    ['invalid raw value', priceResponse([availablePrice(sourceId(1), {
      regular_price: money('79.80')
    })])],
    ['invalid discount relationship', priceResponse([availablePrice(sourceId(1), {
      regular_price: money('100'),
      discount_price: {
        ...money('200'),
        start_datetime: '2026-08-01T00:00:00Z',
        end_datetime: '2026-08-31T00:00:00Z'
      }
    })])]
  ])('wraps %s failures as a safe INVALID_PAYLOAD error', async (_label, payload) => {
    const { client } = clientForPayload(payload);

    const error = await rejectionFrom(() => client.fetchPrices([sourceId(1)]));

    expectInvalidPayload(error);
    expect(error.message).toBe('Nintendo price payload is invalid');
    expect(error.cause).toBeDefined();
    expect(error.message).not.toContain(JSON.stringify(payload));
  });

  it('rejects the whole operation when batch two fails instead of returning partial data', async () => {
    const sourceIds = Array.from({ length: 51 }, (_, index) => sourceId(index + 1));
    const cause = new Error('batch two disconnected');
    let request = 0;
    const fetch: FetchLike = async (input) => {
      request += 1;
      if (request === 2) throw cause;
      const ids = ((input as URL).searchParams.get('ids') ?? '').split(',');
      return jsonResponse(priceResponse(ids.map((id) => availablePrice(id))));
    };
    const client = new NintendoPriceClient({
      fetch,
      now: () => new Date(OBSERVED_AT)
    });

    const error = await rejectionFrom(() => client.fetchPrices(sourceIds));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'NETWORK', country: 'JP', cause });
    expect(request).toBe(2);
  });
});

describe('NintendoPriceClient transport error preservation', () => {
  it('preserves an ordinary fetch failure as a NETWORK error with cause identity', async () => {
    const cause = new Error('connection reset');
    const fetch: FetchLike = async () => { throw cause; };
    const client = new NintendoPriceClient({ fetch, now: () => new Date(OBSERVED_AT) });

    const error = await rejectionFrom(() => client.fetchPrices([sourceId(1)]));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'NETWORK', country: 'JP', cause });
  });

  it.each([404, 503])('preserves HTTP %i as an UPSTREAM_HTTP error', async (status) => {
    const fetch: FetchLike = async () => new Response('private body', { status });
    const client = new NintendoPriceClient({ fetch, now: () => new Date(OBSERVED_AT) });

    const error = await rejectionFrom(() => client.fetchPrices([sourceId(1)]));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'UPSTREAM_HTTP', country: 'JP', status });
  });

  it('preserves requestJson invalid-JSON classification without double wrapping', async () => {
    const fetch: FetchLike = async () => new Response('private invalid json');
    const client = new NintendoPriceClient({ fetch, now: () => new Date(OBSERVED_AT) });

    const error = await rejectionFrom(() => client.fetchPrices([sourceId(1)]));

    expectInvalidPayload(error);
    expect(error.message).toBe('Nintendo eShop returned invalid JSON');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('preserves caller abort reason identity', async () => {
    const reason = new Error('caller cancelled');
    const controller = new AbortController();
    controller.abort(reason);
    const fetch: FetchLike = async () => { throw new Error('fetch aborted'); };
    const client = new NintendoPriceClient({ fetch, now: () => new Date(OBSERVED_AT) });

    await expect(client.fetchPrices([sourceId(1)], controller.signal)).rejects.toBe(reason);
  });

  it('preserves body AbortError identity when no signal is aborted', async () => {
    const cause = new DOMException('body aborted', 'AbortError');
    const { response, readStarted, failBody } = controlledBodyResponse();
    const fetch: FetchLike = async () => response;
    const client = new NintendoPriceClient({ fetch, now: () => new Date(OBSERVED_AT) });

    const request = client.fetchPrices([sourceId(1)]);
    await readStarted;
    failBody(cause);

    await expect(request).rejects.toBe(cause);
  });
});
