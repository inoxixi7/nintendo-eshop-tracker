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
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2_000);
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
