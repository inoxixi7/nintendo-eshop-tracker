import type { CurrencyCode } from '@eshop-tracker/shared';

const scaleByCurrency = {
  JPY: 0,
  USD: 2,
  GBP: 2
} satisfies Record<CurrencyCode, number>;
const maxSafeIntegerDigits = String(Number.MAX_SAFE_INTEGER).length;
const maxSafeMinorAmount = BigInt(Number.MAX_SAFE_INTEGER);

export function parseMinorAmount(raw: string, currency: CurrencyCode): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (match === null) throw new Error('Invalid raw price');

  if (!Object.hasOwn(scaleByCurrency, currency)) throw new Error('Unsupported currency');
  const scale = scaleByCurrency[currency];

  const major = match[1];
  if (major === undefined) throw new Error('Invalid raw price');

  const fraction = match[2] ?? '';
  if (fraction.length > scale) throw new Error('Excess price precision');
  if (major.length + scale > maxSafeIntegerDigits) {
    throw new Error('Price exceeds safe integer range');
  }

  const minor = BigInt(major) * 10n ** BigInt(scale)
    + BigInt(fraction.padEnd(scale, '0') || '0');
  if (minor > maxSafeMinorAmount) {
    throw new Error('Price exceeds safe integer range');
  }

  return Number(minor);
}
