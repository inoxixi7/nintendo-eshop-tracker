import { describe, expect, it } from 'vitest';
import { EshopError, type EshopErrorOptions } from '../src/index.js';

const errorOptions = [
  { code: 'NETWORK', message: 'Unable to fetch eShop data', country: 'JP' },
  { code: 'UPSTREAM_HTTP', message: 'Unable to fetch eShop data', country: 'JP', status: 503 },
  { code: 'INVALID_PAYLOAD', message: 'Unable to fetch eShop data', country: 'JP' },
  { code: 'UNSUPPORTED_COUNTRY', message: 'Unable to fetch eShop data', country: 'JP' }
] as const satisfies readonly EshopErrorOptions[];

describe('EshopError', () => {
  it.each(errorOptions)('retains the $code error code', (options) => {
    const error = new EshopError(options);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EshopError);
    expect(error.name).toBe('EshopError');
    expect(error.message).toBe('Unable to fetch eShop data');
    expect(error.code).toBe(options.code);
    expect(error.country).toBe('JP');
    expect(error.cause).toBeUndefined();
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  it.each([404, 503])('retains the upstream HTTP status %i', (status) => {
    const error = new EshopError({
      code: 'UPSTREAM_HTTP',
      message: 'eShop returned an error response',
      country: 'US',
      status
    });

    expect(error.status).toBe(status);
  });

  it.each(['NETWORK', 'INVALID_PAYLOAD', 'UNSUPPORTED_COUNTRY'] as const)(
    'does not create a status property for %s errors',
    (code) => {
      const error = new EshopError({
        code,
        message: 'Unable to fetch eShop data',
        country: 'GB'
      });

      expect(Object.hasOwn(error, 'status')).toBe(false);
    }
  );

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
