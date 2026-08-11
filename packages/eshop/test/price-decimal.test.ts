import type { CurrencyCode } from '@eshop-tracker/shared';
import { describe, expect, it, vi } from 'vitest';
import { parseMinorAmount } from '../src/nintendo-price/decimal.js';

function expectParseError(
  raw: string,
  currency: CurrencyCode,
  expectedMessage: string
): void {
  try {
    parseMinorAmount(raw, currency);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(expectedMessage);
    expect((error as Error).message).not.toContain(raw);
    return;
  }

  throw new Error('expected price parsing to throw');
}

describe('parseMinorAmount', () => {
  it.each([
    ['0', 'JPY', 0],
    ['7980', 'JPY', 7980],
    ['17.00', 'USD', 1700],
    ['17.5', 'GBP', 1750],
    ['0.00', 'USD', 0],
    ['0.0', 'GBP', 0],
    ['90071992547409.90', 'USD', 9007199254740990],
    ['90071992547409.91', 'USD', Number.MAX_SAFE_INTEGER],
    ['9007199254740991', 'JPY', Number.MAX_SAFE_INTEGER]
  ] as const)('parses %s %s exactly', (raw, currency, expected) => {
    expect(parseMinorAmount(raw, currency)).toBe(expected);
  });

  it.each([
    ['negative', '-1'],
    ['leading plus', '+1'],
    ['leading whitespace', ' 1'],
    ['trailing whitespace', '1 '],
    ['localized comma amount', '7,980円'],
    ['scientific notation', '1e3'],
    ['empty string', ''],
    ['NaN', 'NaN'],
    ['positive infinity', 'Infinity'],
    ['ambiguous zero', '00'],
    ['ambiguous leading zero', '01']
  ])('rejects %s syntax', (_label, raw) => {
    expect(() => parseMinorAmount(raw, 'JPY')).toThrow('Invalid raw price');
  });

  it.each(['1.0', '0.0'])('rejects fractional JPY input %s', (raw) => {
    expect(() => parseMinorAmount(raw, 'JPY')).toThrow('Excess price precision');
  });

  it.each([
    ['USD', '1.001'],
    ['GBP', '1.234']
  ] as const)('rejects excess %s precision', (currency, raw) => {
    expect(() => parseMinorAmount(raw, currency)).toThrow('Excess price precision');
  });

  it('rejects an unsupported currency at runtime', () => {
    const unsupportedCurrency = 'EUR' as CurrencyCode;

    expect(() => parseMinorAmount('1', unsupportedCurrency)).toThrow('Unsupported currency');
  });

  it.each(['constructor', '__proto__'])('rejects prototype property currency %s', (currency) => {
    expectParseError('7', currency as CurrencyCode, 'Unsupported currency');
  });

  it.each([
    ['90071992547409.92', 'USD'],
    ['9007199254740992', 'JPY']
  ] as const)('rejects %s %s above the safe integer range', (raw, currency) => {
    expect(() => parseMinorAmount(raw, currency)).toThrow('Price exceeds safe integer range');
  });

  it('does not include the raw price in an error message', () => {
    const raw = '9'.repeat(100_000);

    expectParseError(raw, 'JPY', 'Price exceeds safe integer range');
  });

  it('rejects an obviously oversized major amount before BigInt conversion', () => {
    const bigIntSpy = vi.spyOn(globalThis, 'BigInt');

    try {
      expectParseError('10000000000000000', 'JPY', 'Price exceeds safe integer range');
      expect(bigIntSpy).not.toHaveBeenCalled();
    } finally {
      bigIntSpy.mockRestore();
    }
  });

  it.each([
    ['01', 'JPY', 'Invalid raw price'],
    ['1.0', 'JPY', 'Excess price precision'],
    ['7', 'EUR', 'Unsupported currency'],
    ['9007199254740992', 'JPY', 'Price exceeds safe integer range']
  ] as const)('uses the exact stable error for %s %s', (raw, currency, expectedMessage) => {
    expectParseError(raw, currency as CurrencyCode, expectedMessage);
  });
});
