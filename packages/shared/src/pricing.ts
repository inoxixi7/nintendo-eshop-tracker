import type { PriceObservation } from './price-observation.js';

export function isOnSale(price: PriceObservation): boolean {
  const discountAmountMinor = price.discountAmountMinor;

  return discountAmountMinor !== null && discountAmountMinor < price.regularAmountMinor;
}

export function effectiveAmountMinor(price: PriceObservation): number {
  const discountAmountMinor = price.discountAmountMinor;

  return discountAmountMinor !== null && discountAmountMinor < price.regularAmountMinor
    ? discountAmountMinor
    : price.regularAmountMinor;
}

export function calculateDiscountPercent(price: PriceObservation): number | null {
  const discountAmountMinor = price.discountAmountMinor;

  if (
    discountAmountMinor === null ||
    discountAmountMinor >= price.regularAmountMinor ||
    price.regularAmountMinor === 0
  ) {
    return null;
  }

  const numerator = BigInt(price.regularAmountMinor - discountAmountMinor) * 100n;
  const denominator = BigInt(price.regularAmountMinor);
  let percent = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder * 2n >= denominator) {
    percent += 1n;
  }

  return Number(percent);
}
