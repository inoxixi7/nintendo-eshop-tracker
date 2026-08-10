# Nintendo eShop Tracker

A personal-first Nintendo eShop price tracker. The long-term goal is a shared data backend that powers a PWA and, potentially, a WeChat Mini Program.

The first release is planned for the Japanese (JP), United States (US), and United Kingdom (GB) eShops, with catalog information and price history for each regional listing.

## Current status

Phase 1 provides only verified catalog and price contracts, plus the region-adapter boundary that future collectors will implement.

Live Nintendo adapters, storage, API routes, Web UI, and deployment are all future work.

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

## Workspace

```text
apps/
  api/       # future public read API
  web/       # future PWA
  worker/    # future catalog and price synchronization
packages/
  eshop/     # regional adapter boundary and validation
  shared/    # catalog, price, and shared domain contracts
```

`packages/shared` defines normalized catalog and price data. `packages/eshop` validates adapter output and keeps the regional data-source interface separate from future storage, API, and client code.

## Design

See the [design document](docs/superpowers/specs/2026-08-10-nintendo-eshop-tracker-design.md) for the intended architecture and phased roadmap.

## License and upstream reference

Future adapter behavior will be informed by [favna/nintendo-switch-eshop](https://github.com/favna/nintendo-switch-eshop), which is licensed under Apache-2.0. When Phase 2 introduces adapter code derived from or copied from that project, its applicable upstream notices will be retained.
