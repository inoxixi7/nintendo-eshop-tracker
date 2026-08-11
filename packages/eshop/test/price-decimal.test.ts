import type { CurrencyCode } from '@eshop-tracker/shared';
import { describe, expect, it } from 'vitest';
import { parseMinorAmount } from '../src/nintendo-price/decimal.js';

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

  it.each([
    ['90071992547409.92', 'USD'],
    ['9007199254740992', 'JPY']
  ] as const)('rejects %s %s above the safe integer range', (raw, currency) => {
    expect(() => parseMinorAmount(raw, currency)).toThrow('Price exceeds safe integer range');
  });

  it('does not include the raw price in an error message', () => {
    const raw = '9'.repeat(200);

    expect(() => parseMinorAmount(raw, 'JPY')).toThrow('Price exceeds safe integer range');
    try {
      parseMinorAmount(raw, 'JPY');
    } catch (error) {
      expect((error as Error).message).not.toContain(raw);
    }
  });
});
