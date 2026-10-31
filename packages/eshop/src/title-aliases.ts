import { productKey, type TitleAlias } from '@eshop-tracker/shared';
import { z } from 'zod';
import { EshopError } from './errors.js';
import { requestJson, type FetchLike } from './upstream-json.js';

// Nintendo's own public catalogs: Europe's search index (English) and the HK/TW software lists (Chinese).
const EUROPE_SEARCH_URL = 'https://searching.nintendo-europe.com/en/select';
const CHINESE_LISTS = [
  'https://www.nintendo.com/hk/data/json/switch_software.json',
  'https://www.nintendo.com/tw/data/json/switch_software.json'
];
const EUROPE_PAGE_SIZE = 1000;
const EUROPE_MAX_PAGES = 100;

const EuropePageSchema = z.object({
  response: z.object({
    numFound: z.number().int().nonnegative(),
    docs: z.array(z.object({
      title: z.string().optional(),
      product_code_txt: z.array(z.string()).optional()
    }))
  })
});

const ChineseListSchema = z.array(z.object({
  title: z.string().optional(),
  title_sc: z.string().optional(),
  product_code: z.string().optional()
}).loose());

function invalidPayload(cause: unknown): EshopError {
  return new EshopError({ code: 'INVALID_PAYLOAD', message: 'Nintendo title alias payload is invalid', country: 'JP', cause });
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw invalidPayload(result.error);
  return result.data;
}

function aliasesFor(codes: readonly string[], language: TitleAlias['language'], titles: ReadonlyArray<string | undefined>): TitleAlias[] {
  const keys = new Map(codes.map(productKey).filter((key) => key !== null).map((key) => [`${key.platform}:${key.productCore}`, key]));
  return [...keys.values()].flatMap((key) => titles
    .filter((title): title is string => title !== undefined && title.trim().length > 0)
    .map((title) => ({ ...key, language, title: title.trim() })));
}

export async function fetchEuropeTitleAliases(fetch: FetchLike, signal?: AbortSignal): Promise<TitleAlias[]> {
  const aliases: TitleAlias[] = [];
  for (let page = 0; page < EUROPE_MAX_PAGES; page += 1) {
    const url = new URL(EUROPE_SEARCH_URL);
    url.searchParams.set('q', '*');
    url.searchParams.set('fq', 'type:GAME AND system_type:nintendoswitch*');
    url.searchParams.set('fl', 'title,product_code_txt');
    url.searchParams.set('rows', String(EUROPE_PAGE_SIZE));
    url.searchParams.set('start', String(page * EUROPE_PAGE_SIZE));
    url.searchParams.set('wt', 'json');
    const { response } = parse(EuropePageSchema, await requestJson({ fetch, url, country: 'GB', signal }));
    for (const doc of response.docs) aliases.push(...aliasesFor(doc.product_code_txt ?? [], 'en', [doc.title]));
    if ((page + 1) * EUROPE_PAGE_SIZE >= response.numFound || response.docs.length === 0) return aliases;
  }
  throw invalidPayload(new Error('Europe search index did not finish within the page limit'));
}

export async function fetchChineseTitleAliases(fetch: FetchLike, signal?: AbortSignal): Promise<TitleAlias[]> {
  const aliases: TitleAlias[] = [];
  for (const list of CHINESE_LISTS) {
    const items = parse(ChineseListSchema, await requestJson({ fetch, url: new URL(list), country: 'JP', signal }));
    for (const item of items) aliases.push(...aliasesFor([item.product_code ?? ''], 'zh', [item.title, item.title_sc]));
  }
  return aliases;
}

export async function fetchTitleAliases(fetch: FetchLike = globalThis.fetch, signal?: AbortSignal): Promise<TitleAlias[]> {
  const [english, chinese] = await Promise.all([
    fetchEuropeTitleAliases(fetch, signal),
    fetchChineseTitleAliases(fetch, signal)
  ]);
  return [...english, ...chinese];
}
