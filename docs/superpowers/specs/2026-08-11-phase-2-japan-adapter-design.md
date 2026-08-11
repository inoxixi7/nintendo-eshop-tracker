# Phase 2 Japan eShop Adapter Design

## 1. Goal

Build the first live Nintendo data adapter for Japan (`JP`). It must fetch the current Japanese catalog and price responses, validate the upstream payloads, and normalize them into the Phase 1 `CatalogItem` and `PriceObservation` contracts.

This phase proves the live data boundary only. It does not add PostgreSQL, scheduled jobs, HTTP API routes, a Web UI, or deployment.

## 2. Confirmed decisions

- The first live region is Japan.
- The catalog includes base games, bundles, DLC, and unknown product types.
- The current Japanese search JSON is the only runtime catalog source.
- `https://api.ec.nintendo.com/v1/price` is the only runtime price source.
- The legacy Japanese Switch XML and `nintendo-switch-eshop` are research references, not runtime dependencies.
- Ordinary tests use fixed fixtures and never require Nintendo to be online.
- A separate manual live smoke test checks a small current sample.
- Search-only rows with an explicit null NSUID count toward catalog pagination but do not produce price-addressable `CatalogItem` output.
- Persistence remains the responsibility of the next database and Worker phase.
- For the JP adapter, this spec supersedes the earlier general design's reference to a fixed JP XML fixture; fixtures now come from the current search JSON and price JSON formats.

## 3. Source investigation

The sources were probed on 2026-08-11.

### Japanese search JSON

Endpoint:

```text
https://search.nintendo.jp/nintendo_soft/search.json
```

Confirmed behavior:

- `opt_hard=1_HAC` limits results to Nintendo Switch products.
- The response contains a numeric `result.total` and an `items` array.
- `limit=100` with `page=1` and `page=2` returns distinct pages.
- Requesting `limit=1000` is capped by the server at 400 items, so the adapter uses 400.
- The response currently contains roughly 28,000 products and includes 2026 releases.
- A 2026-08-11 live smoke found Virtual Boy search rows with a null NSUID and a root-relative image path. These are valid directory rows but are not addressable through the current NSUID price flow.
- `opt_sale_flg=1` returns current sale products and exposes useful diagnostic price fields, but those directory prices are not authoritative.

### Legacy Japanese XML

Endpoint:

```text
https://www.nintendo.co.jp/data/software/xml/switch.xml
```

It still returns HTTP 200, but contains roughly 10,000 products and did not contain 2026 release dates during the investigation. It is too stale and incomplete to use as a fallback because switching sources would create false additions and removals.

### Nintendo price API

Endpoint:

```text
https://api.ec.nintendo.com/v1/price
```

Confirmed responses include:

- regular prices with `currency` and decimal-string `raw_value`;
- discounted prices with UTC `start_datetime` and `end_datetime`;
- unreleased products that can still have a regular price;
- `sales_status: "not_found"` entries with no monetary fields.

## 4. Component design

Phase 2 extends `packages/eshop` with focused internal components:

```text
JapanCatalogClient
  -> fetch and validate one Japanese search page

NintendoPriceClient
  -> fetch and validate one price batch
  -> reusable by future US and GB adapters

Japan catalog normalizer
  -> map one validated Japanese item to CatalogItem

Nintendo price normalizer
  -> map one validated price entry to PriceObservation or unavailable ID

JapanEshopAdapter
  -> implement EshopAdapter
  -> orchestrate pagination, batching, deduplication, and final batch validation
```

Network transport and time are injected through narrow options (`fetch` and `now`) so unit tests are deterministic without adding a mocking framework. The package root exports only the adapter constructor or factory and the shared result types needed by callers; raw upstream schemas remain internal.

## 5. Catalog fetching

`fetchCatalog(signal?)` performs these steps:

1. Request page 1 with `opt_hard=1_HAC`, `limit=400`, and `sort=hdate desc`, matching the probed endpoint behavior.
2. Validate the response envelope and every directory row using internal Zod schemas that permit unknown additive fields. Every row must have a nonblank directory `id`.
3. Capture `result.total`, which counts directory rows, and continue requesting sequential page numbers.
4. Require every page in the same run to report the same total.
5. Build a collision-free page signature from its directory IDs and reject repeated pages.
6. Track unique directory IDs for pagination deduplication, progress, and completeness. Reject a page that adds no directory ID or makes the unique directory count exceed the reported total.
7. Normalize every trackable occurrence whose NSUID is non-null, retaining the first normalized item for each NSUID. An explicit `nsuid: null` row counts toward directory completeness but produces no `CatalogItem`.
8. Stop only when the unique directory ID count equals the reported total, then run `validateCatalogBatch(result, 'JP')` before returning.

The returned `CatalogItem` count can be lower than `result.total` because the directory total includes search-only rows without an NSUID. Directory identity and output identity remain separate: pagination is complete by unique directory ID, while output is deduplicated by first-seen NSUID.

The method never returns a partial catalog. If the upstream catalog changes during a crawl and the totals or unique directory count no longer agree, or a page repeats or makes no directory progress, it throws `INVALID_PAYLOAD`; a later Worker retry starts a fresh run.

The catalog requests run sequentially. There is no adapter-level retry, caching, or disk output.

## 6. Catalog normalization

| `CatalogItem` field | Japanese source |
|---|---|
| `country` | constant `JP` |
| `source` | constant `nintendo-jp-search` |
| `sourceId` | non-null `nsuid` from a trackable row |
| `productCode` | `icode`, otherwise `null` |
| `title` | `title` |
| `publisher` | `maker`, otherwise `null` |
| `developer` | `null`; the source has no reliable separate developer field |
| `description` | `text`, otherwise `null` |
| `imageUrl` | `https://img-eshop.cdn.nintendo.net/i/{hash}.jpg`, using `siurl` and then `iurl` as fallback |
| `releaseDate` | normalized `YYYY-MM-DD` from `dsdate`, with `sdate` as a guarded fallback |
| `sourceUrl` | `https://store-jp.nintendo.com/item/software/D{nsuid}` |
| `sourcePayload` | the original validated JSON item |

Product type mapping is conservative:

- explicit DLC forms such as `DLC` and `DL_DLC` become `dlc`;
- the observed `set` form becomes `bundle`;
- known Switch software forms become `game`;
- any new or ambiguous form becomes `unknown` rather than being guessed.

Unknown upstream fields do not break the adapter. An explicit `nsuid: null` is a valid search-only entry, but the current domain cannot price-address it, so it is not emitted as a `CatalogItem`. A missing NSUID, an invalid non-null NSUID, a missing or blank directory ID, or an invalid title, image hash, or release date on a trackable row rejects the page. Root-relative image paths observed on search-only rows are not interpreted as catalog image hashes. Directory price fields remain only in trackable `sourcePayload` values and never produce `PriceObservation` values.

## 7. Price result contract

The live API proves that a requested ID can validly return `not_found` without a regular price. A fake zero price would corrupt current and historical pricing, while silently omitting the ID would hide data loss.

Phase 2 therefore introduces:

```ts
export interface PriceFetchResult {
  observations: PriceObservation[];
  unavailableSourceIds: string[];
}
```

`EshopAdapter.fetchPrices()` changes from returning `Promise<PriceObservation[]>` to `Promise<PriceFetchResult>`. No Worker or API consumes the old signature yet, so this is the lowest-cost point to correct the boundary.

Result behavior:

- a normal or unreleased entry with a regular price becomes a `PriceObservation`;
- an explicit `not_found` entry goes to `unavailableSourceIds`;
- a requested ID missing entirely from the upstream response rejects the call as `INVALID_PAYLOAD`;
- each source ID appears in at most one result array.

## 8. Price fetching and normalization

`fetchPrices(sourceIds, signal?)` performs these steps:

1. Validate and deduplicate the requested NSUID strings while preserving first-seen order.
2. Return two empty arrays without a network request when the input is empty.
3. Capture one UTC `observedAt` value for the entire method call.
4. Split IDs into batches of at most 50.
5. Request batches sequentially with `country=JP` and Japanese language settings.
6. Validate each response envelope and reconcile every requested ID.
7. Normalize regular and discount values without floating-point arithmetic.
8. Validate the complete observation array for expected country `JP`.

The normalizer uses `raw_value`, never the localized `amount` display string. Decimal strings are converted exactly according to the currency minor-unit scale. JPY requires zero fractional minor digits; future USD and GBP reuse the same parser with two digits. Unsupported currencies or excess fractional precision reject the response.

`discount_price.start_datetime` and `end_datetime` map directly to the UTC discount fields. When `discount_price` is absent, the discount amount and both times are `null`. The API's `sales_status` is preserved.

If any batch fails, the entire method rejects. The adapter does not expose partial price results.

## 9. Error behavior

- Transport failure becomes `EshopError` with code `NETWORK`.
- A non-2xx response becomes `UPSTREAM_HTTP` and preserves the HTTP status.
- Invalid JSON, invalid response shapes, pagination invariant failures, missing requested IDs, or normalization failures become `INVALID_PAYLOAD` with country `JP` and the original cause.
- Abort cancellation propagates the original `signal.reason` or `AbortError`; it is never wrapped as a retryable network failure.
- Adapter methods do not retry. The future Worker owns exponential backoff and the distinction between retryable network/5xx failures and non-retryable payload/4xx failures.

Errors do not include a full upstream response in their public message. Fixed fixtures and diagnostic `sourcePayload` provide enough detail without leaking oversized payloads into logs.

## 10. Test strategy

### Automatic offline tests

Fixed, reduced fixtures cover:

- one base game, one bundle, one DLC, and one unknown product form;
- a live-shaped search-only row with a null NSUID and root-relative image path, which is skipped without weakening trackable-row validation;
- a normal price, discounted price, unreleased price, and `not_found` result;
- localized display strings that prove only `raw_value` is parsed;
- additive unknown fields;
- malformed identity, dates, currency, decimals, and response envelopes.

Injected fetch responses cover:

- multiple catalog pages and the server's 400-item page size;
- directory-ID completeness, deduplication, overshoot, collision-free page signatures, and null-row skip semantics;
- total changes, repeated pages, no-progress pages, trackable NSUID duplicates, and incomplete totals;
- empty price input, input deduplication, 50-item batching, and cross-batch aggregation;
- missing price IDs, HTTP failures, transport failures, and abort propagation;
- immutability of caller-owned input arrays.

The standard `pnpm check` remains fully offline.

### Manual live smoke

A separate command excluded from normal tests fetches:

- one current Japanese catalog page;
- a small set of current NSUID prices;
- at least one normalized catalog item and one valid price result.

It asserts shapes and non-empty results, not a fixed catalog count, title, or price. The smoke path uses a short timeout and does not perform a full catalog crawl.

## 11. Persistence handoff to Phase 3

Phase 2 returns data in memory. Phase 3 adds PostgreSQL and a scheduled Worker.

The daily catalog job will upsert `regional_listings` by `(country, source, source_id)`, update `last_seen_at`, and only mark products inactive after seven consecutive days without being seen. A failed or partial catalog run never marks products inactive.

The six-hour price job will:

- upsert the latest successful observation into `current_prices`;
- insert the first valid price into `price_history`;
- add another history row only when currency, regular price, discount price, discount times, or sales status changes;
- update `observed_at` without duplicating history when the price state is unchanged;
- preserve the last successful price for explicit unavailable IDs and record them in the sync run instead of writing a fake zero;
- record every run in `sync_runs` with status and item counts.

The API will later read PostgreSQL only. Nintendo downtime therefore does not directly make the user-facing API unavailable.

## 12. Security and licensing

- The JP endpoints require no secret key.
- No raw response dumps, credentials, or environment files are committed.
- Runtime code is written against observed endpoint behavior rather than copied from `favna/nintendo-switch-eshop`.
- If implementation later copies or adapts upstream code, the Apache-2.0 notice and applicable copyright statements must be retained.
- Live smoke tests are explicit and low-volume; ordinary tests never contact Nintendo.

## 13. Completion criteria

- `JapanEshopAdapter` conforms to the revised `EshopAdapter` interface.
- Catalog fixtures normalize game, bundle, DLC, and unknown products correctly.
- Live-shaped null-NSUID directory rows count toward completeness and are skipped from `CatalogItem` output.
- Price fixtures distinguish normal, discounted, unreleased, and unavailable entries.
- Catalog pagination tests cover directory-ID uniqueness, completeness, collision-free signatures, overshoot, null-row skipping, and no-progress behavior.
- Price deduplication, 50-ID batching, reconciliation, and exact decimal conversion are tested.
- All errors follow the defined `EshopError` and abort semantics.
- Package exports and generated declarations work for an external consumer.
- `pnpm check` passes without network access.
- The separate manual JP smoke command succeeds against a small current sample.
- README accurately states that live JP acquisition exists while persistence, scheduling, API routes, and UI remain future work.
