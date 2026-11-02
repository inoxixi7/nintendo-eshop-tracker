import type { CatalogItem } from '@eshop-tracker/shared';
import { EshopError } from '../errors.js';
import { requestJson, type FetchLike } from '../upstream-json.js';
import { validateCatalogBatch } from '../validate-batch.js';
import { GbCatalogPageSchema, type GbCatalogDoc } from './catalog-schema.js';
import { normalizeGbCatalogItem } from './normalize-catalog-item.js';

// Nintendo Europe's public site search, in UK English; the same index already feeds the English search names.
const SEARCH_URL = 'https://searching.nintendo-europe.com/en/select';
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

interface GbCatalogClientOptions {
  fetch: FetchLike;
}

function invalidPayload(cause: unknown): EshopError {
  return new EshopError({ code: 'INVALID_PAYLOAD', message: 'Nintendo Europe catalog payload is invalid', country: 'GB', cause });
}

export class GbCatalogClient {
  constructor(private readonly options: GbCatalogClientOptions) {}

  async fetchAll(signal?: AbortSignal): Promise<CatalogItem[]> {
    const docs: GbCatalogDoc[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(SEARCH_URL);
      url.searchParams.set('q', '*');
      url.searchParams.set('fq', 'type:GAME AND (playable_on_txt:HAC OR playable_on_txt:BEE)');
      // a stable order, so pages neither skip nor repeat documents
      url.searchParams.set('sort', 'fs_id asc');
      url.searchParams.set('rows', String(PAGE_SIZE));
      url.searchParams.set('start', String(page * PAGE_SIZE));
      url.searchParams.set('wt', 'json');
      const raw = await requestJson({ fetch: this.options.fetch, url, country: 'GB', signal });
      const parsed = GbCatalogPageSchema.safeParse(raw);
      if (!parsed.success) throw invalidPayload(parsed.error);
      docs.push(...parsed.data.response.docs);
      if ((page + 1) * PAGE_SIZE >= parsed.data.response.numFound || parsed.data.response.docs.length === 0) {
        try {
          const items = new Map<string, CatalogItem>();
          for (const doc of docs) {
            const item = normalizeGbCatalogItem(doc);
            if (item !== null && !items.has(item.sourceId)) items.set(item.sourceId, item);
          }
          return validateCatalogBatch([...items.values()], 'GB');
        } catch (cause) {
          throw invalidPayload(cause);
        }
      }
    }
    throw invalidPayload(new Error('Europe search index did not finish within the page limit'));
  }
}
