# Phase 2 Japan eShop Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a production-shaped, read-only Japan Nintendo eShop adapter that fetches the live catalog and prices, normalizes them into Phase 1 contracts, and remains completely offline and deterministic under the standard test suite.

**Architecture:** Keep upstream response schemas and normalizers internal to `packages/eshop`. A shared JSON transport converts fetch/HTTP/JSON failures to the existing error boundary. `JapanCatalogClient` handles one search page, `NintendoPriceClient` handles deduplicated 50-ID batches, and `JapanEshopAdapter` composes both while enforcing catalog completeness and final normalized batch validation. Inject `fetch` and `now` so tests need no mocking framework.

**Tech Stack:** Node.js 24, TypeScript 5.9 in strict NodeNext mode, pnpm 10.15.1, Zod 4, Vitest 3, native Fetch API.

---

## Ground rules

- Run every automatic test without contacting Nintendo. Only `test:live:jp` may use the network.
- Follow RED → GREEN for every task: add the test first, run it and observe the expected failure, then write the smallest implementation.
- Do not add storage, scheduling, retries, caching, API routes, UI, logging of full upstream bodies, or support for regions other than JP.
- Keep fixtures reduced and synthetic, based on the observed field shapes; do not commit full Nintendo responses.
- Use `raw_value`, never localized `amount`, for monetary conversion.
- Do not wrap abort cancellation in `EshopError`.
- After each task, run `git diff --check` and commit only that task's files.

## Task 1: Correct the public price result boundary

**Files:**

- Create: `packages/eshop/src/price-fetch-result.ts`
- Modify: `packages/eshop/src/adapter.ts`
- Modify: `packages/eshop/src/index.ts`
- Modify: `packages/eshop/test/types.ts`
- Create: `packages/eshop/test/adapter-contract.test.ts`

- [ ] **Step 1: Add compile-time and runtime contract tests**

Update the type fixture so callers must receive the two-array result:

```ts
import type {
  EshopAdapter,
  EshopErrorOptions,
  PriceFetchResult
} from '../src/index.js';

declare const adapter: EshopAdapter;
declare const signal: AbortSignal;
declare const sourceIds: readonly ['70010000000141', '70010000000185'];

const result: Promise<PriceFetchResult> = adapter.fetchPrices(sourceIds, signal);
void result;
```

Add `adapter-contract.test.ts` with a type-only implementation that proves `sourceIds` stays readonly and the result has exactly the public fields used by consumers:

```ts
import { expectTypeOf, test } from 'vitest';
import type { EshopAdapter, PriceFetchResult } from '../src/index.js';

test('exposes the unavailable price IDs separately from observations', () => {
  expectTypeOf<EshopAdapter['fetchPrices']>().returns.toEqualTypeOf<Promise<PriceFetchResult>>();
  expectTypeOf<PriceFetchResult['unavailableSourceIds']>().toEqualTypeOf<string[]>();
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- adapter-contract.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
```

Expected: the test/typecheck fails because `PriceFetchResult` does not exist and `fetchPrices` still returns `PriceObservation[]`.

- [ ] **Step 3: Add the result type and revise the adapter interface**

Create `price-fetch-result.ts`:

```ts
import type { PriceObservation } from '@eshop-tracker/shared';

export interface PriceFetchResult {
  observations: PriceObservation[];
  unavailableSourceIds: string[];
}
```

Change `adapter.ts` to:

```ts
import type { CatalogItem, CountryCode } from '@eshop-tracker/shared';
import type { PriceFetchResult } from './price-fetch-result.js';

export interface EshopAdapter {
  readonly country: CountryCode;
  fetchCatalog(signal?: AbortSignal): Promise<CatalogItem[]>;
  fetchPrices(
    sourceIds: readonly string[],
    signal?: AbortSignal
  ): Promise<PriceFetchResult>;
}
```

Export `PriceFetchResult` as a type from the package root.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- adapter-contract.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
git diff --check
git add packages/eshop/src packages/eshop/test
git commit -m "feat(eshop): define price fetch result"
```

Expected: focused tests and typecheck pass.

## Task 2: Add the upstream JSON transport boundary

**Files:**

- Create: `packages/eshop/src/upstream-json.ts`
- Create: `packages/eshop/test/upstream-json.test.ts`

- [ ] **Step 1: Write transport behavior tests**

Cover all of these cases with injected `fetch` functions:

- returns `unknown` JSON on HTTP 200;
- turns a thrown network error into `EshopError` code `NETWORK`, country `JP`, preserving `cause` identity;
- turns a 404 and 503 into `UPSTREAM_HTTP` and preserves `status`;
- turns an invalid JSON body into `INVALID_PAYLOAD`, preserving the parsing error as `cause`;
- when `signal.aborted` is true, rethrows `signal.reason` unchanged;
- when an AbortError is thrown without an aborted signal, rethrows that AbortError unchanged;
- never includes response bodies in the public error message.

Use a small helper in the test:

```ts
const jsonResponse = (value: unknown, status = 200) => new Response(
  JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json' } }
);
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- upstream-json.test.ts
```

Expected: import fails because `requestJson` does not exist.

- [ ] **Step 3: Implement the narrow helper**

Implement this public-within-package contract:

```ts
import type { CountryCode } from '@eshop-tracker/shared';
import { EshopError } from './errors.js';

export type FetchLike = typeof globalThis.fetch;

interface RequestJsonOptions {
  fetch: FetchLike;
  url: URL;
  country: CountryCode;
  signal?: AbortSignal | undefined;
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}

export async function requestJson(options: RequestJsonOptions): Promise<unknown> {
  let response: Response;

  try {
    const init = options.signal === undefined ? undefined : { signal: options.signal };
    response = await options.fetch(options.url, init);
  } catch (cause) {
    if (options.signal?.aborted === true) {
      throw options.signal.reason ?? cause;
    }
    if (isAbortError(cause)) {
      throw cause;
    }
    throw new EshopError({
      code: 'NETWORK',
      message: 'Nintendo eShop request failed',
      country: options.country,
      cause
    });
  }

  if (!response.ok) {
    throw new EshopError({
      code: 'UPSTREAM_HTTP',
      message: 'Nintendo eShop returned an error response',
      country: options.country,
      status: response.status
    });
  }

  try {
    return await response.json();
  } catch (cause) {
    throw new EshopError({
      code: 'INVALID_PAYLOAD',
      message: 'Nintendo eShop returned invalid JSON',
      country: options.country,
      cause
    });
  }
}
```

Keep it out of `src/index.ts`; this is an internal implementation primitive.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- upstream-json.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
git diff --check
git add packages/eshop/src/upstream-json.ts packages/eshop/test/upstream-json.test.ts
git commit -m "feat(eshop): add upstream json boundary"
```

## Task 3: Validate and normalize Japanese catalog items

**Files:**

- Create: `packages/eshop/src/japan/catalog-schema.ts`
- Create: `packages/eshop/src/japan/normalize-catalog-item.ts`
- Create: `packages/eshop/test/fixtures/jp-catalog-page.json`
- Create: `packages/eshop/test/fixture.ts`
- Create: `packages/eshop/test/jp-catalog-normalizer.test.ts`

- [ ] **Step 1: Add a reduced fixed fixture**

The JSON fixture must contain one page with four items and additive unknown fields:

- `HAC_DL` game with `siurl` and valid `dsdate`;
- `set` bundle with only `iurl` and `sdate` such as `2026.8.27`;
- `DLC` item;
- unrecognized `mystery_form` item.

Each item includes only fields needed by tests plus one unknown property. Use synthetic NSUIDs `70010000000001` through `70010000000004`; do not copy descriptions or artwork hashes from production.

Load fixtures without enabling TypeScript JSON imports:

```ts
import { readFile } from 'node:fs/promises';

export async function readJsonFixture(name: string): Promise<unknown> {
  const contents = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return JSON.parse(contents) as unknown;
}
```

- [ ] **Step 2: Write normalizer tests**

Assert the exact mapping from the approved design:

- constants `country: 'JP'`, `source: 'nintendo-jp-search'`;
- `sourceId` from `nsuid`, `productCode` from `icode` or `null`;
- title, publisher, description, developer `null`;
- `siurl` before `iurl` and the exact CDN URL;
- release date from `dsdate`, then guarded dotted `sdate` fallback;
- exact product types `game`, `bundle`, `dlc`, `unknown`;
- exact store URL;
- additive fields remain present in `sourcePayload`;
- the input object is not mutated.

Add rejection cases for blank/missing NSUID, blank title, invalid date, non-JSON source payload, and malformed page envelope.

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- jp-catalog-normalizer.test.ts
```

Expected: imports fail because the schema and normalizer do not exist.

- [ ] **Step 4: Implement permissive raw schemas**

Use `.loose()` so additive upstream fields survive into `sourcePayload`:

```ts
import { z } from 'zod';

const NullableTrimmedString = z.string().nullable().optional();

export const JapanCatalogItemSchema = z.object({
  nsuid: z.string().trim().min(1),
  title: z.string().trim().min(1),
  icode: NullableTrimmedString,
  maker: NullableTrimmedString,
  text: NullableTrimmedString,
  siurl: NullableTrimmedString,
  iurl: NullableTrimmedString,
  dsdate: NullableTrimmedString,
  sdate: NullableTrimmedString,
  sform: z.string().trim().min(1).nullable().optional()
}).loose();

export const JapanCatalogPageSchema = z.object({
  result: z.object({
    total: z.number().int().nonnegative(),
    items: z.array(JapanCatalogItemSchema)
  }).loose(),
  status: z.number().optional()
}).loose();

export type JapanCatalogItem = z.infer<typeof JapanCatalogItemSchema>;
export type JapanCatalogPage = z.infer<typeof JapanCatalogPageSchema>;
```

- [ ] **Step 5: Implement deterministic normalization**

Use exact helpers, not `new Date()` on ambiguous Japanese values:

```ts
function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

function normalizeReleaseDate(item: JapanCatalogItem): string | null {
  const raw = nullableText(item.dsdate) ?? nullableText(item.sdate);
  if (raw === null) return null;

  const match = /^(\d{4})[.-](\d{1,2})[.-](\d{1,2})(?: 00:00:00)?$/.exec(raw);
  if (match === null) throw new Error('Unsupported Japanese release date');

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function productType(sform: string | null | undefined): ProductType {
  if (sform === 'DLC' || sform === 'DL_DLC') return 'dlc';
  if (sform === 'set') return 'bundle';
  if (sform.startsWith('HAC_')) return 'game';
  return 'unknown';
}
```

Build the `CatalogItem`, then call `CatalogItemSchema.parse(...)` before returning. The outer client will translate Zod/normalization exceptions into `INVALID_PAYLOAD`.

- [ ] **Step 6: Run GREEN and commit**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- jp-catalog-normalizer.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
git diff --check
git add packages/eshop/src/japan packages/eshop/test/fixture.ts packages/eshop/test/fixtures/jp-catalog-page.json packages/eshop/test/jp-catalog-normalizer.test.ts
git commit -m "feat(eshop): normalize Japan catalog items"
```

## Task 4: Fetch catalog pages and enforce crawl invariants

**Files:**

- Create: `packages/eshop/src/japan/catalog-client.ts`
- Create: `packages/eshop/test/jp-catalog-client.test.ts`

- [ ] **Step 1: Test one-page request construction and validation**

With an injected fetch spy, assert the exact URL parameters:

```text
https://search.nintendo.jp/nintendo_soft/search.json
opt_hard=1_HAC
limit=400
page=<requested page>
sort=hdate desc
```

Assert that the signal identity reaches fetch and that raw schema errors become `EshopError` with code `INVALID_PAYLOAD`, country `JP`, and a cause.

- [ ] **Step 2: Test full-catalog orchestration**

Use synthetic page responses small enough for unit tests. Cover:

- two sequential pages produce normalized items in page order;
- duplicate IDs across pages are returned once, preserving first occurrence;
- every requested page uses limit 400;
- a changed total rejects;
- an identical/repeated page rejects;
- a page with zero new unique IDs rejects;
- a final page that would push unique IDs above total rejects;
- a short/incomplete sequence never returns partial data;
- input fixture objects are not mutated;
- transport, HTTP, JSON, and abort behavior remains unchanged from Task 2.

The mock must fail if requests overlap, proving sequential pagination.

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- jp-catalog-client.test.ts
```

Expected: import fails because `JapanCatalogClient` does not exist.

- [ ] **Step 4: Implement page fetching and catalog assembly**

Expose only the internal class:

```ts
interface JapanCatalogClientOptions {
  fetch: FetchLike;
}

export class JapanCatalogClient {
  constructor(private readonly options: JapanCatalogClientOptions) {}

  async fetchPage(page: number, signal?: AbortSignal): Promise<JapanCatalogPage> {
    const url = new URL('https://search.nintendo.jp/nintendo_soft/search.json');
    url.searchParams.set('opt_hard', '1_HAC');
    url.searchParams.set('limit', '400');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'hdate desc');
    const value = await requestJson({ fetch: this.options.fetch, url, country: 'JP', signal });

    try {
      return JapanCatalogPageSchema.parse(value);
    } catch (cause) {
      throw new EshopError({
        code: 'INVALID_PAYLOAD',
        message: 'Nintendo JP catalog payload is invalid',
        country: 'JP',
        cause
      });
    }
  }
}
```

Add `fetchAll(signal?)` or a focused exported internal function that:

1. stores page-1 total as `expectedTotal`;
2. normalizes each item inside an `INVALID_PAYLOAD` error boundary;
3. uses a `Map<string, CatalogItem>` for first-seen deduplication;
4. rejects total changes, repeated page signatures, no unique progress, and counts greater than total;
5. continues sequentially until `map.size === expectedTotal`;
6. calls `validateCatalogBatch([...map.values()], 'JP')` and translates any final validation failure to `INVALID_PAYLOAD`.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- jp-catalog-client.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
git diff --check
git add packages/eshop/src/japan/catalog-client.ts packages/eshop/test/jp-catalog-client.test.ts
git commit -m "feat(eshop): fetch complete Japan catalog"
```

## Task 5: Parse decimal price strings exactly

**Files:**

- Create: `packages/eshop/src/nintendo-price/decimal.ts`
- Create: `packages/eshop/test/price-decimal.test.ts`

- [ ] **Step 1: Write table-driven decimal tests**

Assert:

```ts
expect(parseMinorAmount('0', 'JPY')).toBe(0);
expect(parseMinorAmount('7980', 'JPY')).toBe(7980);
expect(parseMinorAmount('17.00', 'USD')).toBe(1700);
expect(parseMinorAmount('17.5', 'GBP')).toBe(1750);
expect(parseMinorAmount('90071992547409.90', 'USD')).toBe(9007199254740990);
```

Reject negative values, signs, whitespace, separators, localized strings, scientific notation, excess fractional precision, fractional JPY, unsupported currency, and values above `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- price-decimal.test.ts
```

Expected: import fails because `parseMinorAmount` does not exist.

- [ ] **Step 3: Implement string-only conversion**

Implement with `BigInt`; do not convert the decimal through `Number`:

```ts
import type { CurrencyCode } from '@eshop-tracker/shared';

const scaleByCurrency: Record<CurrencyCode, number> = {
  JPY: 0,
  USD: 2,
  GBP: 2
};

export function parseMinorAmount(raw: string, currency: CurrencyCode): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (match === null) throw new Error('Invalid raw price');

  const scale = scaleByCurrency[currency];
  const fraction = match[2] ?? '';
  if (fraction.length > scale) throw new Error('Excess price precision');

  const minor = BigInt(match[1]) * (10n ** BigInt(scale))
    + BigInt(fraction.padEnd(scale, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Price exceeds safe integer range');
  return Number(minor);
}
```

Although the internal function accepts the shared three-currency union for reuse, the JP response schema in Task 6 will only accept `JPY`.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- price-decimal.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
git diff --check
git add packages/eshop/src/nintendo-price/decimal.ts packages/eshop/test/price-decimal.test.ts
git commit -m "feat(eshop): parse price decimals exactly"
```

## Task 6: Validate and normalize Nintendo price responses

**Files:**

- Create: `packages/eshop/src/nintendo-price/price-schema.ts`
- Create: `packages/eshop/src/nintendo-price/normalize-price.ts`
- Create: `packages/eshop/test/fixtures/jp-price-response.json`
- Create: `packages/eshop/test/price-normalizer.test.ts`

- [ ] **Step 1: Add a reduced price fixture**

Include exactly four requested synthetic IDs:

- normal `onsale` with `regular_price.raw_value` and a deliberately non-parseable localized `amount`;
- discounted `onsale` with UTC start/end;
- `unreleased` with regular price;
- `not_found` without price fields.

Model the observed envelope:

```json
{
  "personalized": false,
  "country": "JP",
  "prices": [
    {
      "title_id": 70010000000001,
      "sales_status": "onsale",
      "regular_price": {
        "amount": "localized text that must not be parsed",
        "currency": "JPY",
        "raw_value": "7980"
      }
    }
  ]
}
```

- [ ] **Step 2: Write normalizer tests**

Assert exact output fields:

- `country: 'JP'`, `source: 'nintendo-price-api'`;
- source ID is the decimal string form of `title_id`;
- normal/unreleased amounts and `salesStatus`;
- discounted amount and exact UTC times;
- missing discount produces three `null` values;
- `not_found` produces no observation and one unavailable ID;
- `observedAt` is the single injected ISO timestamp;
- fixture remains unchanged.

Reject mismatched country, wrong currency, fractional JPY, absent regular price for statuses other than `not_found`, malformed UTC dates, incomplete discount objects, and an invalid response envelope.

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- price-normalizer.test.ts
```

Expected: the raw schema/normalizer imports fail.

- [ ] **Step 4: Implement discriminated raw schemas**

Use a numeric safe-integer `title_id`, JPY literal currency, decimal strings, and UTC-only timestamps:

```ts
const MoneySchema = z.object({
  amount: z.string(),
  currency: z.literal('JPY'),
  raw_value: z.string().min(1)
}).loose();

const DiscountMoneySchema = MoneySchema.extend({
  start_datetime: z.string().datetime({ offset: false }),
  end_datetime: z.string().datetime({ offset: false })
}).loose();

const AvailablePriceSchema = z.object({
  title_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sales_status: z.string().trim().min(1).refine((value) => value !== 'not_found'),
  regular_price: MoneySchema,
  discount_price: DiscountMoneySchema.optional()
}).loose();

const UnavailablePriceSchema = z.object({
  title_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sales_status: z.literal('not_found')
}).loose();

export const NintendoPriceResponseSchema = z.object({
  country: z.literal('JP'),
  prices: z.array(z.union([UnavailablePriceSchema, AvailablePriceSchema]))
}).loose();
```

- [ ] **Step 5: Normalize one parsed response**

Return a `PriceFetchResult`, use `parseMinorAmount`, and run `validatePriceBatch(observations, 'JP')`. Any lower-level exception remains available as the `cause` when the price client translates it to `INVALID_PAYLOAD`.

- [ ] **Step 6: Run GREEN and commit**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- price-normalizer.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
git diff --check
git add packages/eshop/src/nintendo-price packages/eshop/test/fixtures/jp-price-response.json packages/eshop/test/price-normalizer.test.ts
git commit -m "feat(eshop): normalize Nintendo price responses"
```

## Task 7: Fetch, batch, reconcile, and aggregate JP prices

**Files:**

- Create: `packages/eshop/src/nintendo-price/client.ts`
- Create: `packages/eshop/test/nintendo-price-client.test.ts`

- [ ] **Step 1: Test input validation and request construction**

Cover:

- empty input returns two empty arrays and performs zero requests;
- duplicate IDs are removed while first-seen order is preserved;
- invalid IDs (blank, non-decimal, unsafe numeric range) reject as `INVALID_PAYLOAD` before a request;
- caller-owned input is not mutated;
- URL is `https://api.ec.nintendo.com/v1/price` with `country=JP`, `lang=ja`, and one comma-separated `ids` value;
- the caller's signal identity reaches every request.

- [ ] **Step 2: Test batching and reconciliation**

Cover:

- 51 unique IDs create sequential batches of 50 and 1;
- all observations share one `observedAt` from one `now()` call;
- result arrays preserve requested first-seen order even if upstream prices are shuffled;
- explicit `not_found` goes only to `unavailableSourceIds`;
- an upstream ID not requested rejects;
- a requested ID missing from the response rejects;
- a duplicate upstream ID rejects;
- a source ID cannot appear in both result arrays;
- failure in batch 2 rejects the whole call without returning batch 1;
- HTTP, network, invalid JSON, and abort semantics match Tasks 2 and 4.

The mock must throw if batch 2 begins before batch 1 resolves, proving sequential requests.

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- nintendo-price-client.test.ts
```

Expected: import fails because `NintendoPriceClient` does not exist.

- [ ] **Step 4: Implement batching with one observation time**

Define internal options:

```ts
interface NintendoPriceClientOptions {
  fetch: FetchLike;
  now: () => Date;
}

export class NintendoPriceClient {
  constructor(private readonly options: NintendoPriceClientOptions) {}

  async fetchPrices(sourceIds: readonly string[], signal?: AbortSignal): Promise<PriceFetchResult> {
    // validate and first-seen dedupe
    // return early on empty input
    // const observedAt = this.options.now().toISOString()
    // sequentially request slices of 50
    // parse, reconcile, normalize, and aggregate
    // return arrays reordered by the deduplicated request order
  }
}
```

Use a strict source-ID parser such as `/^(0|[1-9]\d*)$/`, convert to `Number`, and require `Number.isSafeInteger`. Wrap only payload/schema/reconciliation/normalization failures as:

```ts
new EshopError({
  code: 'INVALID_PAYLOAD',
  message: 'Nintendo price payload is invalid',
  country: 'JP',
  cause
})
```

Do not catch an `EshopError` already produced by `requestJson`, and do not catch abort cancellation.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- nintendo-price-client.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
git diff --check
git add packages/eshop/src/nintendo-price/client.ts packages/eshop/test/nintendo-price-client.test.ts
git commit -m "feat(eshop): fetch Nintendo prices in batches"
```

## Task 8: Compose and export the Japan adapter

**Files:**

- Create: `packages/eshop/src/japan/adapter.ts`
- Modify: `packages/eshop/src/index.ts`
- Modify: `packages/eshop/test/types.ts`
- Create: `packages/eshop/test/japan-adapter.test.ts`

- [ ] **Step 1: Write public factory tests**

Test a factory named `createJapanEshopAdapter`:

- default construction returns an `EshopAdapter` with `country === 'JP'`;
- injected fetch handles a small two-page catalog and a small price call end-to-end;
- catalog output passes `validateCatalogBatch(..., 'JP')`;
- price observations pass `validatePriceBatch(..., 'JP')`;
- only the public factory and public result/error/validation types are exported; internal schemas and clients are not exported from `src/index.ts`.

Extend `test/types.ts`:

```ts
import { createJapanEshopAdapter } from '../src/index.js';

const japanAdapter: EshopAdapter = createJapanEshopAdapter();
const injectedAdapter: EshopAdapter = createJapanEshopAdapter({
  fetch: globalThis.fetch,
  now: () => new Date('2026-08-11T00:00:00Z')
});

void japanAdapter;
void injectedAdapter;
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- japan-adapter.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
```

Expected: the public factory import fails.

- [ ] **Step 3: Implement the composition root**

```ts
import type { EshopAdapter } from '../adapter.js';
import type { FetchLike } from '../upstream-json.js';
import { NintendoPriceClient } from '../nintendo-price/client.js';
import { JapanCatalogClient } from './catalog-client.js';

export interface JapanEshopAdapterOptions {
  fetch?: FetchLike;
  now?: () => Date;
}

export function createJapanEshopAdapter(
  options: JapanEshopAdapterOptions = {}
): EshopAdapter {
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const catalog = new JapanCatalogClient({ fetch });
  const prices = new NintendoPriceClient({ fetch, now });

  return {
    country: 'JP',
    fetchCatalog: (signal) => catalog.fetchAll(signal),
    fetchPrices: (sourceIds, signal) => prices.fetchPrices(sourceIds, signal)
  };
}
```

Export the factory and `JapanEshopAdapterOptions` from the package root. Do not export upstream raw schemas, normalizers, transport, or internal clients.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- japan-adapter.test.ts
pnpm --filter @eshop-tracker/eshop typecheck
git diff --check
git add packages/eshop/src/japan/adapter.ts packages/eshop/src/index.ts packages/eshop/test/types.ts packages/eshop/test/japan-adapter.test.ts
git commit -m "feat(eshop): expose Japan eShop adapter"
```

## Task 9: Add an opt-in live smoke test and finish documentation

**Files:**

- Create: `packages/eshop/vitest.live.config.ts`
- Create: `packages/eshop/test/live/japan-live.test.ts`
- Modify: `packages/eshop/package.json`
- Modify: `README.md`

- [ ] **Step 1: Add the live-only test before the script**

The smoke must use a 15-second `AbortSignal.timeout` and make only bounded requests:

1. instantiate the public JP adapter;
2. call the internal catalog page client for page 1 rather than crawling ~28,000 items;
3. normalize at least one item and assert JP/source/title/sourceId shape;
4. choose at most three source IDs from that page;
5. call the public adapter's `fetchPrices` for those IDs;
6. assert every requested ID is represented by either an observation or unavailable ID;
7. assert at least one observation exists, without asserting a fixed title, catalog total, amount, or discount.

Because raw clients stay non-public, the live test may import `src/japan/catalog-client.ts` directly. It must not change package exports.

- [ ] **Step 2: Configure a separate live test command**

Create:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/live/**/*.test.ts'],
    testTimeout: 20_000
  }
});
```

Change ordinary test to explicitly exclude live tests and add the opt-in command:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run --exclude 'test/live/**/*.test.ts'",
    "test:live:jp": "vitest run --config vitest.live.config.ts",
    "typecheck": "pnpm --filter @eshop-tracker/shared build && tsc -p tsconfig.json"
  }
}
```

- [ ] **Step 3: Prove standard tests remain offline**

Temporarily run the ordinary eshop test with a shell environment that has no network expectation; the direct proof is that the live test path is absent from Vitest's collected file list:

```bash
pnpm --filter @eshop-tracker/eshop test
```

Expected: all offline files pass and `test/live/japan-live.test.ts` is not listed.

- [ ] **Step 4: Update README accurately**

Change current status to say Phase 2 provides live JP catalog and price acquisition. Document:

```bash
pnpm check
pnpm --filter @eshop-tracker/eshop test:live:jp
```

State explicitly:

- `pnpm check` is offline;
- the live command is opt-in and uses Nintendo's public current endpoints;
- storage, six-hour/daily scheduling, HTTP API routes, Web/PWA, and WeChat Mini Program remain future work;
- Phase 3 will persist daily catalog snapshots and six-hour price checks in PostgreSQL.

Link both the general architecture design and the Phase 2 JP design.

- [ ] **Step 5: Run the live smoke once**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test:live:jp
```

Expected: one bounded live suite passes. If Nintendo is unavailable, report the external failure but do not weaken or skip the assertions.

- [ ] **Step 6: Run full acceptance verification**

Run:

```bash
pnpm check
pnpm install --lockfile-only --frozen-lockfile
pnpm --filter @eshop-tracker/eshop pack --pack-destination /tmp/eshop-tracker-pack
git diff --check
git status --short
```

Then verify the built package from outside the workspace:

```bash
node --input-type=module -e "import('@eshop-tracker/eshop').then((m) => { if (typeof m.createJapanEshopAdapter !== 'function') process.exit(1); })"
```

Expected:

- build, typecheck, and all offline tests pass;
- frozen lockfile validation does not change `pnpm-lock.yaml`;
- package contains only `package.json` and `dist`;
- external runtime import sees the public factory;
- generated declarations expose `PriceFetchResult` and the revised adapter signature;
- no fixture or internal raw schema is publicly exported.

- [ ] **Step 7: Commit the integration/documentation task**

Run:

```bash
git add packages/eshop/vitest.live.config.ts packages/eshop/test/live/japan-live.test.ts packages/eshop/package.json README.md
git commit -m "test(eshop): add Japan live smoke coverage"
git status --short --branch
```

## Final review checklist

- [ ] Compare every completion criterion in `docs/superpowers/specs/2026-08-11-phase-2-japan-adapter-design.md` against code and tests.
- [ ] Search for incomplete markers: `rg -n "TODO|TBD|FIXME|placeholder|not implemented" packages/eshop README.md`.
- [ ] Confirm no production code imports anything from `test/`.
- [ ] Confirm all normal test fixtures are synthetic and small.
- [ ] Confirm abort errors are never wrapped and no adapter-level retry exists.
- [ ] Confirm catalog page requests are sequential with limit 400 and price requests are sequential with batches of 50.
- [ ] Confirm all normalized prices use `raw_value` through `BigInt` conversion.
- [ ] Confirm the working tree is clean after the final commit.
- [ ] Because this phase is a substantial feature, ask the user whether to push the completed commits to the private GitHub repository; do not push without explicit confirmation.
