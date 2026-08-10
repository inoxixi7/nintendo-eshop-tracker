import { describe, expect, it } from 'vitest';
import {
  calculateDiscountPercent,
  effectiveAmountMinor,
  isOnSale,
  type PriceObservation
} from '../src/index.js';

function price(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    country: 'US',
    source: 'nintendo-price-api',
    sourceId: '70010000000185',
    currency: 'USD',
    regularAmountMinor: 5000,
    discountAmountMinor: 3500,
    discountStartAt: null,
    discountEndAt: null,
    salesStatus: 'onsale',
    observedAt: '2026-08-10T06:00:00.000Z',
    ...overrides
  };
}

describe('pricing derivations', () => {
  it('identifies a reduced price as a sale', () => {
    expect(isOnSale(price())).toBe(true);
  });

  it('uses the discounted amount for a sale', () => {
    expect(effectiveAmountMinor(price())).toBe(3500);
  });

  it('calculates the discount percentage for a sale', () => {
    expect(calculateDiscountPercent(price())).toBe(30);
  });

  it('treats a null discount as not on sale', () => {
    const observation = price({ discountAmountMinor: null });

    expect(isOnSale(observation)).toBe(false);
    expect(effectiveAmountMinor(observation)).toBe(5000);
    expect(calculateDiscountPercent(observation)).toBeNull();
  });

  it('treats an equal discount and regular amount as not on sale', () => {
    const observation = price({ discountAmountMinor: 5000 });

    expect(isOnSale(observation)).toBe(false);
    expect(effectiveAmountMinor(observation)).toBe(5000);
    expect(calculateDiscountPercent(observation)).toBeNull();
  });

  it('returns no percentage for a free game', () => {
    const observation = price({ regularAmountMinor: 0, discountAmountMinor: 0 });

    expect(isOnSale(observation)).toBe(false);
    expect(effectiveAmountMinor(observation)).toBe(0);
    expect(calculateDiscountPercent(observation)).toBeNull();
  });

  it('rounds a non-whole discount percentage', () => {
    expect(calculateDiscountPercent(price({ regularAmountMinor: 400, discountAmountMinor: 298 }))).toBe(26);
  });

  it('reports a zero discounted amount as 100 percent off', () => {
    const observation = price({ discountAmountMinor: 0 });

    expect(isOnSale(observation)).toBe(true);
    expect(effectiveAmountMinor(observation)).toBe(0);
    expect(calculateDiscountPercent(observation)).toBe(100);
  });

  it('does not modify the input observation', () => {
    const observation = price();
    const before = structuredClone(observation);

    isOnSale(observation);
    effectiveAmountMinor(observation);
    calculateDiscountPercent(observation);

    expect(observation).toEqual(before);
  });
});
