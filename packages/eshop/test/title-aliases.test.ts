import { describe, expect, it } from 'vitest';
import { EshopError } from '../src/errors.js';
import { fetchTitleAliases } from '../src/title-aliases.js';
import type { FetchLike } from '../src/upstream-json.js';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function fakeFetch(europePages: unknown[][], numFound: number, chinese: unknown[] = []) {
  const urls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.hostname === 'searching.nintendo-europe.com') {
      const page = Number(url.searchParams.get('start')) / 1000;
      return json({ response: { numFound, docs: europePages[page] ?? [] } });
    }
    return json(url.pathname.startsWith('/hk/') ? chinese : []);
  };
  return { fetch, urls };
}

describe('fetchTitleAliases', () => {
  it('pages through the Europe index and keys titles by game code', async () => {
    const page: Array<{ title: string; product_code_txt: string[] }> = Array.from({ length: 1000 }, (_, index) => ({ title: `Game ${index}`, product_code_txt: [] }));
    page[0] = { title: 'The Legend of Zelda: Tears of the Kingdom', product_code_txt: ['HACPAXN7B', 'HACPAXN7A'] };
    const { fetch, urls } = fakeFetch([page, [{ title: 'Kirby Air Riders', product_code_txt: ['BEEPAAB3A'] }, { title: 'Wii Sports' }]], 1002);

    const aliases = await fetchTitleAliases(fetch);

    expect(urls.filter((url) => url.hostname === 'searching.nintendo-europe.com')).toHaveLength(2);
    expect(aliases).toEqual([
      { platform: 'switch', productCore: 'AXN7', language: 'en', title: 'The Legend of Zelda: Tears of the Kingdom' },
      { platform: 'switch2', productCore: 'AAB3', language: 'en', title: 'Kirby Air Riders' }
    ]);
  });

  it('reads traditional and simplified HK titles, tolerating whitespace in codes', async () => {
    const { fetch } = fakeFetch([[]], 0, [
      { title: '薩爾達傳說 織夢島', title_sc: '', product_code: '\r\nHACPAR3NA', media: 'eshop' },
      { title: '劍與魔法與學園任務', product_code: '', thumb_img: 'HAC-P-A585C.jpg' },
      { title: '忍者寶盒', product_code: '', thumb_img: '70010000046398.jpeg' }
    ]);

    expect(await fetchTitleAliases(fetch)).toEqual([
      { platform: 'switch', productCore: 'AR3N', language: 'zh', title: '薩爾達傳說 織夢島' },
      { platform: 'switch', productCore: 'A585', language: 'zh', title: '劍與魔法與學園任務' }
    ]);
  });

  it('rejects an unexpected payload shape', async () => {
    const fetch: FetchLike = async () => json({ unexpected: true });

    await expect(fetchTitleAliases(fetch)).rejects.toBeInstanceOf(EshopError);
  });
});
