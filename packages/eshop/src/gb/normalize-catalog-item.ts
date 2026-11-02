import { CatalogItemSchema, productKey, type CatalogItem, type Platform } from '@eshop-tracker/shared';
import type { GbCatalogDoc } from './catalog-schema.js';

// Europe's (stemmed) category names onto the JP genre names the API filters by.
const GENRES: Record<string, string> = {
  action: 'アクション',
  adventure: 'アドベンチャー',
  arcade: 'アーケード',
  puzzle: 'パズル',
  simulation: 'シミュレーション',
  rpg: 'ロールプレイング',
  strategy: 'ストラテジー',
  platformer: 'アクション',
  shooter: 'シューティング',
  first_person_shooter: 'シューティング',
  party: 'パーティー',
  board_game: 'テーブル',
  racing: 'レース',
  sports: 'スポーツ',
  football: 'スポーツ',
  golf: 'スポーツ',
  education: '学習',
  study: '学習',
  fighting: '格闘',
  lifestyle: '実用',
  training: 'トレーニング',
  health_and_fitness: 'トレーニング',
  music: '音楽',
  communication: 'コミュニケーション',
  utility: '実用',
  tool: '実用'
};

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

/** The first Switch software code, preferring the plain game code ("P") over bundle or update codes. */
function softwareCode(doc: GbCatalogDoc): string | null {
  const codes = (doc.product_code_txt ?? []).map((code) => code.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .filter((code) => productKey(code) !== null);
  return codes.find((code) => code[3] === 'P') ?? codes[0] ?? null;
}

function platform(doc: GbCatalogDoc, code: string | null): Platform | null {
  if (code !== null) return productKey(code)!.platform;
  const systems = (doc.playable_on_txt ?? []).map((system) => system.toUpperCase());
  if (systems.includes('HAC')) return 'switch';
  return systems.includes('BEE') ? 'switch2' : null;
}

/** Returns null for documents the price API cannot price or the tracker does not cover (older systems). */
export function normalizeGbCatalogItem(doc: GbCatalogDoc): CatalogItem | null {
  // a document also lists its bundles' ids (7007…); the game's own is the 7001… one
  const nsuid = (doc.nsuid_txt ?? []).find((id) => /^7001\d{10}$/.test(id));
  const code = softwareCode(doc);
  const itemPlatform = platform(doc, code);
  const title = text(doc.title);
  if (nsuid === undefined || itemPlatform === null || title === null) return null;

  const releaseDate = doc.dates_released_dts?.[0]?.slice(0, 10) ?? null;
  const url = text(doc.url);
  const genres = [...new Set((doc.game_categories_txt ?? []).map((category) => GENRES[category.toLowerCase()] ?? 'その他'))];

  return CatalogItemSchema.parse({
    country: 'GB',
    source: 'nintendo-eu-search',
    sourceId: nsuid,
    // stored like the JP catalog's codes (AV5JA): the 4-character game code first, so aliases join on it
    productCode: code?.slice(4) ?? null,
    title,
    publisher: text(doc.publisher),
    developer: text(doc.developer),
    description: text(doc.product_catalog_description_s) ?? text(doc.excerpt),
    imageUrl: text(doc.image_url_sq_s),
    releaseDate: releaseDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : null,
    // shortcut: Europe's index lists games only (bundles appear as games, DLC not at all); split types if it ever adds them
    productType: 'game',
    platform: itemPlatform,
    sourceUrl: url === null ? null : new URL(url, 'https://www.nintendo.com').href,
    sourcePayload: { ...doc, genre: genres }
  });
}
