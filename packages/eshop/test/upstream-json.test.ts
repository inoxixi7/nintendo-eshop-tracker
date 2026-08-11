import { describe, expect, it, vi } from 'vitest';
import { EshopError } from '../src/errors.js';
import { requestJson, type FetchLike } from '../src/upstream-json.js';

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

describe('requestJson', () => {
  it('returns unknown JSON from a successful response', async () => {
    const payload = { games: [{ id: 42 }], cursor: null };
    const fetch: FetchLike = async () => jsonResponse(payload);

    await expect(requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP'
    })).resolves.toEqual(payload);
  });

  it('passes the same URL and signal to fetch', async () => {
    const url = new URL('https://example.com/catalog');
    const signal = new AbortController().signal;
    const fetch = vi.fn<FetchLike>(async () => jsonResponse([]));

    await requestJson({ fetch, url, country: 'JP', signal });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(url, { signal });
  });

  it('wraps ordinary fetch failures as NETWORK errors and retains the cause', async () => {
    const cause = new Error('connection reset');
    const fetch: FetchLike = async () => { throw cause; };

    const error = await rejectionFrom(() => requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP'
    }));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'NETWORK', country: 'JP' });
    expect((error as EshopError).cause).toBe(cause);
  });

  it.each([404, 503])('retains HTTP status %i in an UPSTREAM_HTTP error', async (status) => {
    const responseBody = `private upstream response ${status}`;
    const fetch: FetchLike = async () => new Response(responseBody, { status });

    const error = await rejectionFrom(() => requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP'
    }));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'UPSTREAM_HTTP', country: 'JP', status });
    expect((error as Error).message).not.toContain(responseBody);
  });

  it('wraps response JSON failures as INVALID_PAYLOAD and retains the cause', async () => {
    const cause = new SyntaxError('private response body');
    const response = jsonResponse(null);
    response.json = async () => { throw cause; };
    const fetch: FetchLike = async () => response;

    const error = await rejectionFrom(() => requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP'
    }));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD', country: 'JP' });
    expect((error as EshopError).cause).toBe(cause);
    expect((error as Error).message).not.toContain(cause.message);
  });

  it('throws an aborted signal reason unchanged', async () => {
    const fetchCause = new Error('fetch aborted');
    const reason = new Error('caller cancelled');
    const controller = new AbortController();
    controller.abort(reason);
    const fetch: FetchLike = async () => { throw fetchCause; };

    const error = await rejectionFrom(() => requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP',
      signal: controller.signal
    }));

    expect(error).toBe(reason);
  });

  it('throws a null aborted signal reason unchanged', async () => {
    const fetchCause = new Error('fetch aborted');
    const controller = new AbortController();
    controller.abort(null);
    const fetch: FetchLike = async () => { throw fetchCause; };

    const error = await rejectionFrom(() => requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP',
      signal: controller.signal
    }));

    expect(error).toBe(null);
    expect(error).not.toBe(fetchCause);
  });

  it('falls back to the fetch cause when an aborted signal has no reason', async () => {
    const cause = new Error('fetch aborted');
    const signal = { aborted: true, reason: undefined } as AbortSignal;
    const fetch: FetchLike = async () => { throw cause; };

    const error = await rejectionFrom(() => requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP',
      signal
    }));

    expect(error).toBe(cause);
  });

  it('propagates an AbortError unchanged when no signal is aborted', async () => {
    const cause = new DOMException('operation aborted', 'AbortError');
    const fetch: FetchLike = async () => { throw cause; };

    const error = await rejectionFrom(() => requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP'
    }));

    expect(error).toBe(cause);
    expect(error).not.toBeInstanceOf(EshopError);
  });
});
