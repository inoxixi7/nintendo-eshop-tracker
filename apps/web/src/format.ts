import type { Price } from './api';
import { intlLocale, t } from './i18n';

// Each currency in its home style (¥7,980, $59.99, R$ 329,90) whatever the interface language; Canadian and Mexican dollars keep their CA$ / MX$ prefix.
const CURRENCY_LOCALE: Record<string, string> = { JPY: 'ja-JP', USD: 'en-US', GBP: 'en-GB', CAD: 'en-US', MXN: 'en-US', BRL: 'pt-BR' };

export function formatPrice(amountMinor: number, currency: string): string {
  if (amountMinor === 0) return t('price.free');
  const format = new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-US', { style: 'currency', currency });
  // the API sends minor units: yen has none, dollars have cents
  return format.format(amountMinor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 0));
}

export function currentAmount(price: Price): number {
  return price.discountAmountMinor ?? price.regularAmountMinor;
}

/** Shows times in the viewer's own time zone, whichever store set them. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  // a bare release date is a calendar date, not a moment, so it must not shift by time zone
  const timeZone = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : undefined;
  return new Intl.DateTimeFormat(intlLocale(), { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
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
