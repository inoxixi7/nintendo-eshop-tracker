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
    const [receivedUrl, receivedInit] = fetch.mock.calls[0]!;
    expect(receivedUrl).toBe(url);
    expect(receivedInit?.signal).toBe(signal);
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

  it('wraps native invalid JSON errors as INVALID_PAYLOAD', async () => {
    const responseBody = 'not-json';
    const response = new Response(responseBody, {
      headers: { 'content-type': 'application/json' }
    });
    const fetch: FetchLike = async () => response;

    const error = await rejectionFrom(() => requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP'
    }));

    expect(error).toBeInstanceOf(EshopError);
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD', country: 'JP' });
    expect((error as EshopError).cause).toBeInstanceOf(SyntaxError);
    expect((error as Error).message).not.toContain(responseBody);
  });

  it('throws the signal reason when cancellation happens while reading the body', async () => {
    const bodyCause = new DOMException('body aborted', 'AbortError');
    const reason = { source: 'caller' };
    const controller = new AbortController();
    const { response, readStarted, failBody } = controlledBodyResponse();
    const fetch: FetchLike = async () => response;

    const request = requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP',
      signal: controller.signal
    });
    await readStarted;
    controller.abort(reason);
    failBody(bodyCause);

    const error = await rejectionFrom(() => request);

    expect(error).toBe(reason);
    expect(error).not.toBe(bodyCause);
  });

  it('propagates an AbortError thrown while reading the body without an aborted signal', async () => {
    const cause = new DOMException('body aborted', 'AbortError');
    const { response, readStarted, failBody } = controlledBodyResponse();
    const fetch: FetchLike = async () => response;

    const request = requestJson({
      fetch,
      url: new URL('https://example.com/catalog'),
      country: 'JP'
    });
    await readStarted;
    failBody(cause);

    const error = await rejectionFrom(() => request);

    expect(error).toBe(cause);
    expect(error).not.toBeInstanceOf(EshopError);
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
