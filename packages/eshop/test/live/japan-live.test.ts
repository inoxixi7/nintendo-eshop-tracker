import { describe, expect, it } from 'vitest';
import {
  createJapanEshopAdapter,
  validatePriceBatch
} from '../../src/index.js';
import { JapanCatalogClient } from '../../src/japan/catalog-client.js';
import { normalizeJapanCatalogItem } from '../../src/japan/normalize-catalog-item.js';

describe('Nintendo JP live endpoints', () => {
  it('returns a catalog item and classifies current prices', async () => {
    const fetch = globalThis.fetch.bind(globalThis);
    const signal = AbortSignal.timeout(15_000);
    const catalog = new JapanCatalogClient({ fetch });

    const page = await catalog.fetchPage(1, signal);
    expect(page.result.items.length).toBeGreaterThan(0);

    const normalizedItems = page.result.items
      .filter((entry) => entry.nsuid !== null)
      .map(normalizeJapanCatalogItem);
    expect(normalizedItems.length).toBeGreaterThan(0);
    expect(normalizedItems[0]).toEqual(expect.objectContaining({
      country: 'JP',
      source: 'nintendo-jp-search',
      sourceId: expect.stringMatching(/^\d{14}$/),
      title: expect.stringMatching(/\S/)
    }));

    const sourceIds = [...new Set(normalizedItems.map((item) => item.sourceId))]
      .slice(0, 3);
    expect(sourceIds.length).toBeGreaterThan(0);

    const adapter = createJapanEshopAdapter({ fetch });
    const prices = await adapter.fetchPrices(sourceIds, signal);
    expect(prices.observations.length).toBeGreaterThan(0);
    expect(validatePriceBatch(prices.observations, 'JP')).toEqual(prices.observations);

    const classifiedSourceIds = [
      ...prices.observations.map((observation) => observation.sourceId),
      ...prices.unavailableSourceIds
    ];
    expect(classifiedSourceIds).toHaveLength(sourceIds.length);
    expect(new Set(classifiedSourceIds)).toEqual(new Set(sourceIds));
  });
});
