import type { CountryCode } from '@eshop-tracker/shared';

export type EshopErrorCode =
  | 'NETWORK'
  | 'UPSTREAM_HTTP'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_COUNTRY';

interface EshopErrorOptionsBase {
  message: string;
  country: CountryCode;
  cause?: unknown;
}

interface UpstreamHttpEshopErrorOptions extends EshopErrorOptionsBase {
  code: 'UPSTREAM_HTTP';
  status: number;
}

interface NonHttpEshopErrorOptions extends EshopErrorOptionsBase {
  code: Exclude<EshopErrorCode, 'UPSTREAM_HTTP'>;
  status?: never;
}

export type EshopErrorOptions =
  | UpstreamHttpEshopErrorOptions
  | NonHttpEshopErrorOptions;

export class EshopError extends Error {
  readonly code: EshopErrorCode;
  readonly country: CountryCode;
  declare readonly status?: number;

  constructor(options: EshopErrorOptions) {
    if (options.cause === undefined) {
      super(options.message);
    } else {
      super(options.message, { cause: options.cause });
    }

    this.name = 'EshopError';
    this.code = options.code;
    this.country = options.country;

    if (options.code === 'UPSTREAM_HTTP') {
      this.status = options.status;
    }
  }
}
