import type { Price } from './api';
import { intlLocale, t } from './i18n';

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

// JPY has no minor unit, so the API's minor amount is already whole yen.
export function formatYen(amountMinor: number): string {
  return amountMinor === 0 ? t('price.free') : yen.format(amountMinor);
}

export function currentAmount(price: Price): number {
  return price.discountAmountMinor ?? price.regularAmountMinor;
}

/** Shows store times in Tokyo time, since sale windows are set by the JP eShop. */
export function formatTokyo(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(iso));
}

export function formatTokyoDate(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' })
    .format(new Date(iso));
}

export function endsIn(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return t('ends.over');
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return hours < 1 ? t('ends.underHour') : t('ends.hours', { n: hours });
  return t('ends.days', { n: Math.floor(hours / 24) });
}

export const PLATFORM_LABEL = { switch: 'Switch', switch2: 'Switch 2' } as const;

const STATUSES = ['onsale', 'preorder', 'unreleased', 'sales_termination', 'not_found'] as const;

export function salesStatusLabel(status: string): string {
  return (STATUSES as readonly string[]).includes(status) ? t(`status.${status as (typeof STATUSES)[number]}`) : status;
}
