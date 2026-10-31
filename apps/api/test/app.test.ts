import type { QueryClient } from '@eshop-tracker/database';
import { describe, expect, it } from 'vitest';
import { buildApp, RATE_LIMIT_PER_MINUTE } from '../src/app.js';

const ID = '11111111-2222-4333-8444-555555555555';
const RECENT = new Date(Date.now() - 60 * 60 * 1000);

type Call = { sql: string; values: readonly unknown[] };

function fakeDb(respond: (sql: string) => Record<string, unknown>[] = () => []) {
  const calls: Call[] = [];
  const db: QueryClient = {
    async query<Row extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });
      const rows = respond(sql) as Row[];
      return { rows, rowCount: rows.length };
    }
  };
  return { db, calls };
}

const listingRow = {
  id: ID,
  country: 'JP',
  platform: 'switch2',
  product_type: 'game',
  title: 'Sword of the Sea',
  publisher: 'Giant Squid',
  image_url: 'https://img-eshop.cdn.nintendo.net/i/a.jpg',
  release_date: '2026-08-19',
  source_url: 'https://store-jp.nintendo.com/item/software/D70010000000001',
  is_active: true,
  currency: 'JPY',
  regular_amount_minor: 4380,
  discount_amount_minor: 3480,
  discount_start_at: new Date('2026-10-28T15:00:00Z'),
  discount_end_at: new Date('2026-12-23T14:59:59Z'),
  sales_status: 'onsale',
  observed_at: RECENT,
  discount_percent: 21
};

function listingsDb(rows: Record<string, unknown>[] = [listingRow]) {
  return fakeDb((sql) => (sql.startsWith('SELECT count(*)') ? [{ total: String(rows.length) }] : rows));
}

describe('GET /v1/listings', () => {
  it('returns active JP listings with price DTOs and pagination', async () => {
    const { db, calls } = listingsDb();
    const response = await buildApp(db).inject('/v1/listings?platform=switch2&page=2&pageSize=10');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [{
        id: ID,
        country: 'JP',
        platform: 'switch2',
        productType: 'game',
        title: 'Sword of the Sea',
        publisher: 'Giant Squid',
        imageUrl: 'https://img-eshop.cdn.nintendo.net/i/a.jpg',
        releaseDate: '2026-08-19',
        sourceUrl: 'https://store-jp.nintendo.com/item/software/D70010000000001',
        isActive: true,
        price: {
          currency: 'JPY',
          regularAmountMinor: 4380,
          discountAmountMinor: 3480,
          discountPercent: 21,
          discountStartAt: '2026-10-28T15:00:00.000Z',
          discountEndAt: '2026-12-23T14:59:59.000Z',
          salesStatus: 'onsale',
          observedAt: RECENT.toISOString(),
          stale: false
        }
      }],
      page: 2,
      pageSize: 10,
      total: 1
    });
    expect(calls[1]?.sql).toMatch(/l\.is_active = TRUE/);
    expect(calls[1]?.values).toEqual(['switch2', 10, 10]);
  });

  it('hides a scheduled discount and flags a stale price', async () => {
    const { db } = listingsDb([{
      ...listingRow,
      discount_percent: null,
      observed_at: new Date(Date.now() - 13 * 60 * 60 * 1000)
    }]);
    const price = (await buildApp(db).inject('/v1/listings')).json().items[0].price;

    expect(price).toMatchObject({ discountAmountMinor: null, discountPercent: null, stale: true });
  });

  it('returns a null price for a listing that has never been priced', async () => {
    const { db } = listingsDb([{ ...listingRow, currency: null, discount_percent: null }]);

    expect((await buildApp(db).inject('/v1/listings')).json().items[0].price).toBeNull();
  });

  it('matches every normalized word against titles and other-language aliases', async () => {
    const { db, calls } = listingsDb([]);
    await buildApp(db).inject(`/v1/listings?q=${encodeURIComponent('塞尔达  50%_off')}`);

    expect(calls[0]?.values.slice(0, 2)).toEqual(['%萨尔达%', '%50off%']);
    expect(calls[0]?.sql).toMatch(/l\.title_norm LIKE \$1 OR \(l\.platform, left\(l\.product_code, 4\)\) IN \(SELECT platform, product_core FROM title_aliases WHERE title_norm LIKE \$1\)/);
  });

  it('matches nothing when the query has no searchable characters', async () => {
    const { db, calls } = listingsDb([]);
    await buildApp(db).inject('/v1/listings?q=%21%21');

    expect(calls[0]?.sql).toMatch(/AND FALSE/);
  });

  it.each([
    ['pageSize above the maximum', 'pageSize=101', 'pageSize'],
    ['an unknown platform', 'platform=wii', 'platform'],
    ['an unknown parameter', 'debug=1', 'query'],
    ['a non-boolean onSale', 'onSale=yes', 'onSale']
  ])('rejects %s with the shared error format', async (_label, query, field) => {
    const { db, calls } = listingsDb();
    const response = await buildApp(db).inject(`/v1/listings?${query}`);

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: 'INVALID_QUERY',
      message: expect.stringContaining(field),
      requestId: expect.any(String)
    });
    expect(calls).toHaveLength(0);
  });
});

describe('GET /v1/deals', () => {
  it('only queries active discounts and sorts by ending time on request', async () => {
    const { db, calls } = listingsDb();
    const response = await buildApp(db).inject('/v1/deals?minDiscountPercent=50&sort=endingSoon');

    expect(response.statusCode).toBe(200);
    expect(calls[1]?.sql).toMatch(/p\.discount_start_at <= now\(\)/);
    expect(calls[1]?.sql).toMatch(/ORDER BY p\.discount_end_at ASC NULLS LAST/);
    expect(calls[1]?.values).toEqual([50, 20, 0]);
  });
});

describe('GET /v1/listings/:id', () => {
  it('returns detail fields for an existing listing', async () => {
    const { db } = fakeDb(() => [{
      ...listingRow,
      product_code: 'BEE-P-AAAAA',
      description: 'A surfing adventure',
      last_seen_at: RECENT
    }]);
    const body = (await buildApp(db).inject(`/v1/listings/${ID}`)).json();

    expect(body).toMatchObject({ id: ID, productCode: 'BEE-P-AAAAA', lastSeenAt: RECENT.toISOString() });
  });

  it('rejects a malformed id before querying', async () => {
    const { db, calls } = fakeDb();
    const response = await buildApp(db).inject('/v1/listings/not-a-uuid');

    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('returns 404 for an unknown listing', async () => {
    const response = await buildApp(fakeDb().db).inject(`/v1/listings/${ID}`);

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});

describe('GET /v1/listings/:id/price-history', () => {
  it('returns ascending points and the lowest effective price', async () => {
    const { db, calls } = fakeDb((sql) => (sql.startsWith('SELECT 1') ? [{ '?column?': 1 }] : [
      { currency: 'JPY', regular_amount_minor: 4380, discount_amount_minor: null, sales_status: 'onsale', observed_at: '2026-10-01T00:00:00Z' },
      { currency: 'JPY', regular_amount_minor: 4380, discount_amount_minor: 3480, sales_status: 'onsale', observed_at: '2026-10-29T00:00:00Z' }
    ]));
    const body = (await buildApp(db).inject(`/v1/listings/${ID}/price-history?from=2026-10-01T00:00:00Z`)).json();

    expect(body).toEqual({
      currency: 'JPY',
      lowestAmountMinor: 3480,
      points: [
        { regularAmountMinor: 4380, discountAmountMinor: null, salesStatus: 'onsale', observedAt: '2026-10-01T00:00:00.000Z' },
        { regularAmountMinor: 4380, discountAmountMinor: 3480, salesStatus: 'onsale', observedAt: '2026-10-29T00:00:00.000Z' }
      ]
    });
    expect(calls[1]?.values).toEqual([ID, '2026-10-01T00:00:00Z', null, 500]);
  });

  it('returns 404 when the listing does not exist', async () => {
    expect((await buildApp(fakeDb().db).inject(`/v1/listings/${ID}/price-history`)).statusCode).toBe(404);
  });
});

describe('GET /v1/health and errors', () => {
  it('reports the last successful syncs and staleness', async () => {
    const { db } = fakeDb(() => [
      { job_type: 'catalog', finished_at: RECENT },
      { job_type: 'prices', finished_at: RECENT }
    ]);
    const body = (await buildApp(db).inject('/v1/health')).json();

    expect(body).toEqual({
      status: 'ok',
      database: 'ok',
      lastSuccessfulSync: { JP: { catalog: RECENT.toISOString(), prices: RECENT.toISOString() } },
      stale: false
    });
  });

  it('hides internal error details', async () => {
    const db: QueryClient = {
      query: async () => { throw new Error('password authentication failed for user eshop_tracker'); }
    };
    const response = await buildApp(db).inject('/v1/health');

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toMatchObject({ code: 'INTERNAL', message: 'internal error' });
    expect(response.body).not.toMatch(/password/);
  });

  it('uses the shared error format for unknown routes', async () => {
    const response = await buildApp(fakeDb().db).inject('/v2/anything');

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});

describe('web app hosting', () => {
  it('serves the PWA shell with revalidation and keeps API 404s as JSON', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'eshop-web-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><div id="app"></div>');
    writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
    const app = buildApp(fakeDb().db, { webRoot: root });

    const shell = await app.inject('/');
    expect(shell.statusCode).toBe(200);
    expect(shell.headers['cache-control']).toBe('no-cache');
    expect(shell.body).toContain('id="app"');

    const asset = await app.inject('/assets/app-abc123.js');
    expect(asset.headers['cache-control']).toContain('immutable');

    const missing = await app.inject('/v1/nope');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });
});

describe('rate limiting', () => {
  const from = (ip: string) => ({ url: '/v1/health', headers: { 'x-forwarded-for': ip } });

  it('limits each visitor behind the proxies separately and leaves static files alone', async () => {
    const app = buildApp(fakeDb(() => [{ job_type: 'prices', finished_at: RECENT }]).db, { trustProxy: 2 });

    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i += 1) expect((await app.inject(from('203.0.113.7, 100.118.225.127'))).statusCode).toBe(200);
    const limited = await app.inject(from('203.0.113.7, 100.118.225.127'));
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();

    // a spoofed leftmost address does not escape the limit; another visitor is unaffected
    expect((await app.inject(from('198.51.100.1, 203.0.113.7, 100.118.225.127'))).statusCode).toBe(429);
    expect((await app.inject(from('198.51.100.9, 100.118.225.127'))).statusCode).toBe(200);
    expect((await app.inject('/')).statusCode).toBe(404);
  });
});
