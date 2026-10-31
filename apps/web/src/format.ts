import type { Price } from './api';

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
});
const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' });

// JPY has no minor unit, so the API's minor amount is already whole yen.
export function formatYen(amountMinor: number): string {
  return amountMinor === 0 ? '免费' : yen.format(amountMinor);
}

export function currentAmount(price: Price): number {
  return price.discountAmountMinor ?? price.regularAmountMinor;
}

/** Shows store times in Tokyo time, since sale windows are set by the JP eShop. */
export function formatTokyo(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatTokyoDate(iso: string): string {
  return date.format(new Date(iso));
}

export function endsIn(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return '已结束';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return hours < 1 ? '不到 1 小时后结束' : `${hours} 小时后结束`;
  return `${Math.floor(hours / 24)} 天后结束`;
}

export const PLATFORM_LABEL = { switch: 'Switch', switch2: 'Switch 2' } as const;

export const SALES_STATUS_LABEL: Record<string, string> = {
  onsale: '发售中',
  preorder: '预约中',
  unreleased: '未发售',
  sales_termination: '已停售',
  not_found: '未上架'
};
