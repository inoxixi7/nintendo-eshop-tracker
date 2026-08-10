import type { CountryCode } from '@eshop-tracker/shared';

export type EshopErrorCode =
  | 'NETWORK'
  | 'UPSTREAM_HTTP'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_COUNTRY';

interface EshopErrorOptions {
  code: EshopErrorCode;
  message: string;
  country: CountryCode;
  cause?: unknown;
}

export class EshopError extends Error {
  readonly code: EshopErrorCode;
  readonly country: CountryCode;

  constructor(options: EshopErrorOptions) {
    if (options.cause === undefined) {
      super(options.message);
    } else {
      super(options.message, { cause: options.cause });
    }

    this.name = 'EshopError';
    this.code = options.code;
    this.country = options.country;
  }
}
