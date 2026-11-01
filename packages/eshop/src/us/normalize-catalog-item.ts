import {
  CatalogItemSchema,
  type CatalogItem,
  type Platform,
  type ProductType
} from '@eshop-tracker/shared';
import type { UsCatalogHit } from './catalog-schema.js';

const PLATFORMS: Record<string, Platform> = { 'Nintendo Switch': 'switch', 'Nintendo Switch 2': 'switch2' };

// US genre codes onto the JP genre names the API filters by.
const GENRES: Record<string, string> = {
  ACTION: 'アクション',
  ADVENTURE: 'アドベンチャー',
  TEXT_ADVENTURE: 'アドベンチャー',
  PINBALL: 'アーケード',
  PUZZLE: 'パズル',
  SIMULATION: 'シミュレーション',
  ROLE_PLAYING: 'ロールプレイング',
  STRATEGY: 'ストラテジー',
  SHOOTING: 'シューティング',
  PARTY: 'パーティー',
  TABLETOP: 'テーブル',
  RACING: 'レース',
  SPORTS: 'スポーツ',
  FIGHTING: '格闘',
  MUSIC: '音楽',
  EDUCATION: '学習',
  TRAINING: 'トレーニング',
  TOOL: '実用'
};

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

function productType(hit: UsCatalogHit): ProductType {
  if (hit.dlcType === 'Individual') return 'dlc';
  if (hit.dlcType === 'Bundle' || hit.dlcType === 'ROM Bundle') return 'bundle';
  const type = hit.eshopDetails?.productType;
  if (type === 'TITLE') return 'game';
  if (type === 'ADD_ON_CONTENT') return 'dlc';
  if (type === 'BUNDLE') return 'bundle';
  return 'unknown';
}

function imageUrl(hit: UsCatalogHit): string | null {
  const square = nullableText(hit.productImageSquare);
  if (square?.startsWith('https://') === true) return square;
  const id = nullableText(hit.productImage);
  return id === null ? null : `https://assets.nintendo.com/image/upload/q_auto/f_auto/${encodeURI(id)}`;
}

/** Returns null for records the price API cannot price or the tracker does not cover (mobile). */
export function normalizeUsCatalogItem(hit: UsCatalogHit): CatalogItem | null {
  const nsuid = nullableText(hit.nsuid);
  const platform = PLATFORMS[hit.platform ?? ''];
  const title = nullableText(hit.title);
  if (nsuid === null || !/^[1-9]\d{13}$/.test(nsuid) || platform === undefined || title === null) return null;

  const releaseDate = nullableText(hit.releaseDate)?.slice(0, 10) ?? null;
  const url = nullableText(hit.url);
  const { _highlightResult: _ignoredHighlight, _distinctSeqID: _ignoredSeq, ...payload } = hit;
  const genres = [...new Set((hit.gameGenres ?? []).map((genre) => GENRES[genre.code] ?? 'その他'))];

  return CatalogItemSchema.parse({
    country: 'US',
    source: 'nintendo-us-algolia',
    sourceId: nsuid,
    productCode: null,
    title,
    publisher: nullableText(hit.softwarePublisher),
    developer: nullableText(hit.softwareDeveloper),
    description: nullableText(hit.description),
    imageUrl: imageUrl(hit),
    releaseDate: releaseDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : null,
    productType: productType(hit),
    platform,
    sourceUrl: url === null ? null : new URL(url, 'https://www.nintendo.com').href,
    // shortcut: `genre` is derived, not upstream, so the JP genre filter and index cover US too; move genres to a column if a third region needs its own mapping
    sourcePayload: { ...payload, genre: genres }
  });
}
