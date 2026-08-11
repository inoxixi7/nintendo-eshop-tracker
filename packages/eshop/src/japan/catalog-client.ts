import type { CatalogItem } from '@eshop-tracker/shared';
import { EshopError } from '../errors.js';
import { requestJson, type FetchLike } from '../upstream-json.js';
import { validateCatalogBatch } from '../validate-batch.js';
import {
  JapanCatalogPageSchema,
  type JapanCatalogPage
} from './catalog-schema.js';
import { normalizeJapanCatalogItem } from './normalize-catalog-item.js';

interface JapanCatalogClientOptions {
  fetch: FetchLike;
}

const CATALOG_URL = 'https://search.nintendo.jp/nintendo_soft/search.json';

function invalidPayload(cause: unknown): EshopError {
  return new EshopError({
    code: 'INVALID_PAYLOAD',
    message: 'Nintendo JP catalog payload is invalid',
    country: 'JP',
    cause
  });
}

function pageSignature(page: JapanCatalogPage): string {
  return JSON.stringify(page.result.items.map((item) => item.id));
}

export class JapanCatalogClient {
  constructor(private readonly options: JapanCatalogClientOptions) {}

  async fetchPage(page: number, signal?: AbortSignal): Promise<JapanCatalogPage> {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw invalidPayload(new Error('Japanese catalog page must be a positive safe integer'));
    }

    const url = new URL(CATALOG_URL);
    url.searchParams.set('opt_hard', '1_HAC');
    url.searchParams.set('limit', '400');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'hdate desc');

    const raw = await requestJson({
      fetch: this.options.fetch,
      url,
      country: 'JP',
      ...(signal === undefined ? {} : { signal })
    });

    try {
      return JapanCatalogPageSchema.parse(raw);
    } catch (cause) {
      throw invalidPayload(cause);
    }
  }

  async fetchAll(signal?: AbortSignal): Promise<CatalogItem[]> {
    const items = new Map<string, CatalogItem>();
    const seenDirectoryIds = new Set<string>();
    const signatures = new Set<string>();
    let expectedTotal: number | undefined;
    let pageNumber = 1;

    while (true) {
      const page = await this.fetchPage(pageNumber, signal);

      try {
        if (expectedTotal === undefined) {
          expectedTotal = page.result.total;
        } else if (page.result.total !== expectedTotal) {
          throw new Error('Japanese catalog total changed during pagination');
        }

        const signature = pageSignature(page);
        const repeatedSignature = signatures.has(signature);
        signatures.add(signature);

        const sizeBeforePage = seenDirectoryIds.size;
        for (const rawItem of page.result.items) {
          if (seenDirectoryIds.has(rawItem.id)) continue;
          seenDirectoryIds.add(rawItem.id);

          if (rawItem.nsuid === null) continue;
          const item = normalizeJapanCatalogItem(rawItem);
          if (!items.has(rawItem.nsuid)) items.set(rawItem.nsuid, item);
        }

        if (seenDirectoryIds.size > expectedTotal) {
          throw new Error('Japanese catalog unique item count exceeded total');
        }

        if (seenDirectoryIds.size === expectedTotal) {
          return validateCatalogBatch([...items.values()], 'JP');
        }

        if (repeatedSignature) {
          throw new Error('Japanese catalog page signature repeated before completion');
        }

        if (seenDirectoryIds.size === sizeBeforePage) {
          throw new Error('Japanese catalog page made no unique progress');
        }
      } catch (cause) {
        throw invalidPayload(cause);
      }

      pageNumber += 1;
    }
  }
}
