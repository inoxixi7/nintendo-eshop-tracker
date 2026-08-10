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

  return Math.round((1 - discountAmountMinor / price.regularAmountMinor) * 100);
}
