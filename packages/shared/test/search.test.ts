import { describe, expect, it } from 'vitest';
import { normalizeSearchText, productKey, searchTokens } from '../src/index.js';

describe('normalizeSearchText', () => {
  it.each([
    ['ゼルダの伝説', 'ぜるだの传说'],
    ['薩爾達傳說 曠野之息', '萨尔达传说旷野之息'],
    ['塞尔达传说', '萨尔达传说'],
    ['超级马力欧兄弟', '超级玛利欧兄弟'],
    ['ＰＯＫＥＭＯＮ　Ｌｅｇｅｎｄｓ', 'pokemonlegends'],
    ['The Legend of Zelda: Tears of the Kingdom', 'thelegendofzeldatearsofthekingdom'],
    ['ﾎﾟｹﾓﾝ', 'ぽけもん'],
    ['Pokémon Café ReMix', 'pokemoncaferemix'],
    ['The Legend of Zelda™: Link’s Awakening', 'thelegendofzeldalinksawakening'],
    ['ゼルダ ガイド', 'ぜるだがいど']
  ])('folds %s', (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected);
  });

  it('matches a hiragana query against a katakana title', () => {
    expect(normalizeSearchText('スプラトゥーン3')).toContain(normalizeSearchText('すぷらとぅーん'));
  });
});

describe('searchTokens', () => {
  it('splits on any whitespace and drops punctuation-only tokens', () => {
    expect(searchTokens('  Zelda　ティアーズ - ')).toEqual(['zelda', 'てぃあーず']);
  });
});

describe('productKey', () => {
  it.each([
    ['HACPAXN7B', { platform: 'switch', productCore: 'AXN7' }],
    ['HAC-P-AXN7A', { platform: 'switch', productCore: 'AXN7' }],
    ['\r\nhacpar3na', { platform: 'switch', productCore: 'AR3N' }],
    ['BEEPAAABA', { platform: 'switch2', productCore: 'AAAB' }],
    ['AXN7A', null],
    ['RVL-FAKP', null],
    ['', null]
  ])('reads %j', (code, key) => {
    expect(productKey(code)).toEqual(key);
  });
});
