import type { CatalogItem } from '@eshop-tracker/shared';
import type { AmericasCountry } from './normalize-catalog-item.js';
import { EshopError } from '../errors.js';
import { requestJson, type FetchLike } from '../upstream-json.js';
import { validateCatalogBatch } from '../validate-batch.js';
import { UsCatalogPageSchema, type UsCatalogHit, type UsCatalogPage } from './catalog-schema.js';
import { normalizeUsCatalogItem } from './normalize-catalog-item.js';

// nintendo.com's own storefront search, one index per store; the key is the public search-only key its pages ship with.
const INDEXES = { US: 'store_game_en_us', CA: 'store_game_en_ca', MX: 'store_game_es_mx', BR: 'store_game_pt_br' } as const;
const APP_ID = 'U3B6GR4UA3';
const SEARCH_KEY = 'a29c6927638bfd8cee23993e51e721c9';
const PAGE_SIZE = 500;
// Algolia serves at most this many hits per query, so bigger sets are split into narrower filters.
const REACHABLE_HITS = 1000;
const SPLIT_FACETS = ['platform', 'contentRatingCode', 'dlcType', 'availability'] as const;
// in minor units of the store's currency; Mexican and Brazilian prices run into the thousands
const MAX_PRICE_CENTS = 10_000_000;
// Hits lost to the price split (records without a price inside a still-too-big bucket) stay below this share.
const MIN_COVERAGE = 0.95;

interface UsCatalogClientOptions {
  fetch: FetchLike;
  country?: AmericasCountry;
}

function invalidPayload(cause: unknown, country: AmericasCountry): EshopError {
  return new EshopError({ code: 'INVALID_PAYLOAD', message: `Nintendo ${country} catalog payload is invalid`, country, cause });
}

const quote = (value: string) => `"${value.replace(/["\\]/g, (character) => `\\${character}`)}"`;

export class UsCatalogClient {
  private readonly country: AmericasCountry;

  constructor(private readonly options: UsCatalogClientOptions) {
    this.country = options.country ?? 'US';
  }

  async query(filters: readonly string[], page: number, facet?: string, signal?: AbortSignal): Promise<UsCatalogPage> {
    const url = new URL(`https://U3B6GR4UA3-dsn.algolia.net/1/indexes/${INDEXES[this.country]}`);
    url.searchParams.set('x-algolia-application-id', APP_ID);
    url.searchParams.set('x-algolia-api-key', SEARCH_KEY);
    url.searchParams.set('hitsPerPage', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('attributesToHighlight', '[]');
    if (filters.length > 0) url.searchParams.set('filters', filters.join(' AND '));
    if (facet !== undefined) url.searchParams.set('facets', JSON.stringify([facet]));

    const raw = await requestJson({ fetch: this.options.fetch, url, country: this.country, signal });
    try {
      return UsCatalogPageSchema.parse(raw);
    } catch (cause) {
      throw invalidPayload(cause, this.country);
    }
  }

  async fetchAll(signal?: AbortSignal): Promise<CatalogItem[]> {
    const hits = new Map<string, UsCatalogHit>();
    const take = (page: UsCatalogPage) => {
      for (const hit of page.hits) hits.set(hit.objectID, hit);
    };

    const collect = async (filters: readonly string[], depth: number): Promise<number> => {
      const facet = SPLIT_FACETS[depth];
      const first = await this.query(filters, 0, facet, signal);
      if (first.nbHits <= REACHABLE_HITS) {
        take(first);
        for (let page = 1; page * PAGE_SIZE < Math.min(first.nbHits, REACHABLE_HITS); page += 1) {
          take(await this.query(filters, page, undefined, signal));
        }
      } else if (facet !== undefined) {
        const values = Object.keys(first.facets?.[facet] ?? {}).map((value) => `${facet}:${quote(value)}`);
        for (const value of values) await collect([...filters, value], depth + 1);
        // records with none of the values (e.g. games have no dlcType)
        await collect([...filters, ...values.map((value) => `NOT ${value}`)], depth + 1);
      } else {
        await collectPrices(filters, 0, MAX_PRICE_CENTS);
      }
      return first.nbHits;
    };

    // shortcut: a bucket split by price drops its records that have no price, and a single price with more than
    // 1000 records keeps only the first 1000; the coverage check below fails the run if that ever grows large
    const collectPrices = async (filters: readonly string[], from: number, to: number): Promise<void> => {
      const range = to - from === 1
        ? [`price.finalPrice=${from / 100}`]
        : [`price.finalPrice>=${from / 100}`, `price.finalPrice<${to / 100}`];
      const first = await this.query([...filters, ...range], 0, undefined, signal);
      if (first.nbHits <= REACHABLE_HITS || to - from === 1) {
        take(first);
        for (let page = 1; page * PAGE_SIZE < Math.min(first.nbHits, REACHABLE_HITS); page += 1) {
          take(await this.query([...filters, ...range], page, undefined, signal));
        }
        return;
      }
      const middle = Math.floor((from + to) / 2);
      await collectPrices(filters, from, middle);
      await collectPrices(filters, middle, to);
    };

    const total = await collect([], 0);
    try {
      if (hits.size < total * MIN_COVERAGE) throw new Error(`US catalog reached ${hits.size} of ${total} records`);
      const items = new Map<string, CatalogItem>();
      for (const hit of hits.values()) {
        const item = normalizeUsCatalogItem(hit, this.country);
        if (item !== null && !items.has(item.sourceId)) items.set(item.sourceId, item);
      }
      return validateCatalogBatch([...items.values()], this.country);
    } catch (cause) {
      throw invalidPayload(cause, this.country);
    }
  }
}
