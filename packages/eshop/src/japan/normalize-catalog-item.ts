import {
  CatalogItemSchema,
  type CatalogItem,
  type ProductType
} from '@eshop-tracker/shared';
import type { JapanCatalogItem } from './catalog-schema.js';

const GAME_SOFTWARE_FORMS = new Set([
  'HAC_DL',
  'HAC_DOWNLOADABLE',
  'HAC_CARD',
  'HAC_FC/NES',
  'HAC_SFC/SNES',
  'HAC_MD',
  'HAC_N64',
  'HAC_AGB',
  'HAC_DMG',
  'HAC_VB',
  'HAC_CGB'
]);

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

function normalizeReleaseDate(item: JapanCatalogItem): string | null {
  const raw = nullableText(item.dsdate) ?? nullableText(item.sdate);
  if (raw === null) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})(?: 00:00:00)?$/.exec(raw)
    ?? /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(raw)
    ?? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (match === null) throw new Error('Unsupported Japanese release date');

  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('Unsupported Japanese release date');
  }

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function productType(sform: string | null | undefined): ProductType {
  if (sform === 'DLC' || sform === 'DL_DLC') return 'dlc';
  if (sform === 'set') return 'bundle';
  if (sform !== null && sform !== undefined && GAME_SOFTWARE_FORMS.has(sform)) return 'game';
  return 'unknown';
}

export function normalizeJapanCatalogItem(item: JapanCatalogItem): CatalogItem {
  const imageHash = nullableText(item.siurl) ?? nullableText(item.iurl);

  return CatalogItemSchema.parse({
    country: 'JP',
    source: 'nintendo-jp-search',
    sourceId: item.nsuid,
    productCode: nullableText(item.icode),
    title: item.title,
    publisher: nullableText(item.maker),
    developer: null,
    description: nullableText(item.text),
    imageUrl: imageHash === null
      ? null
      : `https://img-eshop.cdn.nintendo.net/i/${imageHash}.jpg`,
    releaseDate: normalizeReleaseDate(item),
    productType: productType(item.sform),
    sourceUrl: `https://store-jp.nintendo.com/item/software/D${item.nsuid}`,
    sourcePayload: item
  });
}
