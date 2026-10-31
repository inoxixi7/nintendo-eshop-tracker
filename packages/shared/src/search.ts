import * as OpenCC from 'opencc-js';
import type { Platform } from './catalog-item.js';

// Japanese shinjitai and traditional Chinese both fold to simplified Chinese, so 伝説, 傳說 and 传说 compare equal.
const toSimplified = OpenCC.Converter({ from: 'jp', to: 'cn' });

// shortcut: mainland names for the biggest franchises only, mapped onto the HK/TW names Nintendo publishes; extend when a search misses
const MAINLAND_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/马力欧|马里奥/g, '玛利欧'],
  [/塞尔达/g, '萨尔达'],
  [/喷射战士/g, '斯普拉遁'],
  [/路易基/g, '路易吉']
];

/**
 * Folds width, case, kana, Chinese script and punctuation so the same title typed in
 * Japanese, Chinese or English shares one form. Spaces are dropped; callers split
 * queries into tokens first.
 */
export function normalizeSearchText(text: string): string {
  let folded = text.normalize('NFKC').toLowerCase();
  folded = folded.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
  folded = toSimplified(folded);
  for (const [pattern, replacement] of MAINLAND_NAMES) folded = folded.replace(pattern, replacement);
  return folded.replace(/[\s\p{P}\p{S}]/gu, '');
}

export function searchTokens(query: string): string[] {
  return query.split(/\s+/u).map(normalizeSearchText).filter((token) => token.length > 0);
}

/** A title for the same game from another region, keyed by platform and game code. */
export type TitleAlias = { platform: Platform; productCore: string; language: 'en' | 'zh'; title: string };

/**
 * Reads a full product code such as `HACPAXN7B`. The 4-character game code (AXN7) matches the first
 * four characters of a JP listing's code; Switch 2 restarts numbering, so the platform is part of the key.
 */
export function productKey(productCode: string): { platform: Platform; productCore: string } | null {
  const code = productCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const match = /^(HAC|BEE)[A-Z]([A-Z0-9]{4})[A-Z0-9]$/.exec(code);
  if (match === null) return null;
  return { platform: match[1] === 'BEE' ? 'switch2' : 'switch', productCore: match[2]! };
}
