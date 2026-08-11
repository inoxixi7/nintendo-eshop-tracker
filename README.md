# Nintendo eShop Tracker

A personal-first Nintendo eShop price tracker. The long-term goal is a shared data backend that powers a Web/PWA client and, potentially, a WeChat Mini Program.

The first release is planned for the Japanese (JP), United States (US), and United Kingdom (GB) eShops, with catalog information and price history for each regional listing.

## Current status

Phase 2 provides live Japanese (JP) catalog and price acquisition, backed by offline fixtures and tests.

The JP catalog output contains price-addressable rows with Nintendo Store IDs. Search-only entries without an NSUID are skipped until the domain separates listing IDs from price IDs.

PostgreSQL persistence, a daily catalog schedule, a six-hour price schedule, HTTP API routes, Web/PWA and WeChat Mini Program clients, and deployment are future work. Phase 3 will persist the daily catalog and six-hour price checks in PostgreSQL; the API will later read from that database.

## Requirements

- Node.js 24 or later
- Corepack

## Setup

```bash
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm install
pnpm check
```

`pnpm check` is fully offline. To run the opt-in, low-volume smoke test against Nintendo's public JP endpoints and current data:

```bash
pnpm --filter @eshop-tracker/eshop test:live:jp
```

The live smoke test requires network access and may fail when Nintendo's endpoints are unavailable or their current response shape changes.

## Workspace

```text
apps/
  api/       # future public read API
  web/       # future PWA
  worker/    # future catalog and price synchronization
packages/
  eshop/     # regional adapter interface plus live JP catalog and price acquisition
  shared/    # normalized domain schemas/contracts and price derivations
```

`packages/shared` provides normalized catalog and price schemas/contracts, plus price derivations. `packages/eshop` provides the regional adapter interface, typed upstream errors, output validation, and the live JP catalog and price adapter while remaining separate from future storage, API, and client code.

## Design

See the [general design document](docs/superpowers/specs/2026-08-10-nintendo-eshop-tracker-design.md) for the intended architecture and phased roadmap, and the [Phase 2 Japan adapter design](docs/superpowers/specs/2026-08-11-phase-2-japan-adapter-design.md) for the implemented acquisition boundary.

## License and upstream reference

The implementation was written from observed Nintendo endpoint behavior and was not copied from [favna/nintendo-switch-eshop](https://github.com/favna/nintendo-switch-eshop). If Apache-2.0 upstream code is copied or adapted in the future, its applicable notices will be retained.
