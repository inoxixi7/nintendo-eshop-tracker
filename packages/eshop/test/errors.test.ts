import { describe, expect, it } from 'vitest';
import { EshopError } from '../src/index.js';

describe('EshopError', () => {
  it.each([
    'NETWORK',
    'UPSTREAM_HTTP',
    'INVALID_PAYLOAD',
    'UNSUPPORTED_COUNTRY'
  ] as const)('retains the %s error code', (code) => {
    const error = new EshopError({
      code,
      message: 'Unable to fetch eShop data',
      country: 'JP'
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EshopError);
    expect(error.name).toBe('EshopError');
    expect(error.message).toBe('Unable to fetch eShop data');
    expect(error.code).toBe(code);
    expect(error.country).toBe('JP');
    expect(error.cause).toBeUndefined();
  });

  it('retains the original cause identity', () => {
    const cause = new Error('connection reset');
    const error = new EshopError({
      code: 'NETWORK',
      message: 'Unable to fetch eShop data',
      country: 'US',
      cause
    });

    expect(error.cause).toBe(cause);
  });
});
