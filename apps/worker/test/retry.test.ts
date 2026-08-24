import { describe, expect, it, vi } from 'vitest';
import { EshopError } from '@eshop-tracker/eshop';
import { withRetry } from '../src/retry.js';

describe('withRetry', () => {
  it('retries network failures with exponential delays and injected jitter', async () => {
    const error = new EshopError({ code: 'NETWORK', message: 'offline', country: 'JP' });
    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue('catalog');
    const sleep = vi.fn(async () => undefined);

    await expect(withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitterMs: 100,
      sleep,
      random: () => 0.5
    })).resolves.toBe('catalog');

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000, undefined);
    expect(sleep).toHaveBeenNthCalledWith(2, 2_000, undefined);
  });

  it('uses both inclusive jitter endpoints without negative bias', async () => {
    const error = new EshopError({ code: 'NETWORK', message: 'offline', country: 'JP' });
    const lowSleep = vi.fn(async () => undefined);
    await expect(withRetry(vi.fn().mockRejectedValueOnce(error).mockResolvedValue('low'), {
      baseDelayMs: 100, maxDelayMs: 200, jitterMs: 10, sleep: lowSleep, random: () => 0
    })).resolves.toBe('low');
    expect(lowSleep).toHaveBeenCalledWith(90, undefined);

    const highSleep = vi.fn(async () => undefined);
    await expect(withRetry(vi.fn().mockRejectedValueOnce(error).mockResolvedValue('high'), {
      baseDelayMs: 100, maxDelayMs: 200, jitterMs: 10, sleep: highSleep,
      random: () => 1 - Number.EPSILON
    })).resolves.toBe('high');
    expect(highSleep).toHaveBeenCalledWith(110, undefined);
  });

  it('stops before an attempt when its signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn(async () => 'unexpected');

    await expect(withRetry(operation, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('stops during injected backoff without another attempt', async () => {
    const controller = new AbortController();
    const reason = new Error('stop during backoff');
    const operation = vi.fn().mockRejectedValue(new EshopError({ code: 'NETWORK', message: 'offline', country: 'JP' }));
    const sleep = vi.fn(async (_delayMs: number, signal?: AbortSignal) => {
      controller.abort(reason);
      expect(signal).toBe(controller.signal);
    });

    await expect(withRetry(operation, { signal: controller.signal, sleep })).rejects.toBe(reason);
    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('interrupts the default backoff sleep immediately on abort', async () => {
    const controller = new AbortController();
    const reason = new Error('stop default backoff');
    const operation = vi.fn(async () => {
      setTimeout(() => controller.abort(reason), 0);
      throw new EshopError({ code: 'NETWORK', message: 'offline', country: 'JP' });
    });

    await expect(withRetry(operation, {
      signal: controller.signal, baseDelayMs: 10_000, jitterMs: 0
    })).rejects.toBe(reason);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('does not retry an abort reason even when it is retryable-looking', async () => {
    const controller = new AbortController();
    const reason = new EshopError({ code: 'NETWORK', message: 'cancelled', country: 'JP' });
    const operation = vi.fn(async () => {
      controller.abort(reason);
      throw reason;
    });

    await expect(withRetry(operation, { signal: controller.signal, sleep: async () => undefined })).rejects.toBe(reason);
    expect(operation).toHaveBeenCalledOnce();
  });

  it.each([
    new EshopError({ code: 'NETWORK', message: 'network', country: 'JP' }),
    new EshopError({ code: 'UPSTREAM_HTTP', status: 429, message: 'rate limited', country: 'JP' }),
    new EshopError({ code: 'UPSTREAM_HTTP', status: 503, message: 'unavailable', country: 'JP' })
  ])('retries retryable upstream failures up to three total attempts', async (error) => {
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => undefined);

    await expect(withRetry(operation, { baseDelayMs: 1, sleep, random: () => 0 })).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it.each([
    new EshopError({ code: 'INVALID_PAYLOAD', message: 'bad payload', country: 'JP' }),
    new EshopError({ code: 'UPSTREAM_HTTP', status: 404, message: 'not found', country: 'JP' }),
    new EshopError({ code: 'UNSUPPORTED_COUNTRY', message: 'unsupported', country: 'JP' }),
    new Error('programming failure'),
    new DOMException('cancelled', 'AbortError')
  ])('does not retry non-retryable failures', async (error) => {
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => undefined);

    await expect(withRetry(operation, { sleep })).rejects.toBe(error);

    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('rejects invalid numeric options and random output', async () => {
    await expect(withRetry(async () => 'ok', { maxAttempts: 0 })).rejects.toThrow('maxAttempts');
    await expect(withRetry(async () => 'ok', { maxAttempts: 4 })).rejects.toThrow('maxAttempts');
    await expect(withRetry(async () => 'ok', { baseDelayMs: 1.5 })).rejects.toThrow('baseDelayMs');
    await expect(withRetry(async () => 'ok', { maxDelayMs: -1 })).rejects.toThrow('maxDelayMs');
    await expect(withRetry(async () => 'ok', { jitterMs: -1 })).rejects.toThrow('jitterMs');

    const error = new EshopError({ code: 'NETWORK', message: 'offline', country: 'JP' });
    await expect(withRetry(async () => { throw error; }, {
      sleep: async () => undefined,
      random: () => 1
    })).rejects.toThrow('random');
  });
});
