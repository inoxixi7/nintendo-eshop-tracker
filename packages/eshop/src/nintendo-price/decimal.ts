import type { CurrencyCode } from '@eshop-tracker/shared';

const scaleByCurrency: Record<CurrencyCode, number> = {
  JPY: 0,
  USD: 2,
  GBP: 2
};

export function parseMinorAmount(raw: string, currency: CurrencyCode): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (match === null) throw new Error('Invalid raw price');

  const scale = scaleByCurrency[currency];
  if (scale === undefined) throw new Error('Unsupported currency');

  const major = match[1];
  if (major === undefined) throw new Error('Invalid raw price');

  const fraction = match[2] ?? '';
  if (fraction.length > scale) throw new Error('Excess price precision');

  const minor = BigInt(major) * 10n ** BigInt(scale)
    + BigInt(fraction.padEnd(scale, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Price exceeds safe integer range');
  }

  return Number(minor);
}
