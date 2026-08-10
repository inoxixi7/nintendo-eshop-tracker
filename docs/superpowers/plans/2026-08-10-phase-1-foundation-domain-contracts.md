# Phase 1 Repository Foundation and Domain Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a working TypeScript monorepo with validated Nintendo eShop catalog and price contracts plus a region-adapter interface that later JP, US, and GB collectors can implement.

**Architecture:** This phase establishes only the shared kernel: root tooling, runtime validation schemas, pricing derivations, and the `EshopAdapter` boundary. It intentionally excludes live Nintendo calls, PostgreSQL, HTTP routes, PWA code, and Docker services so the foundation is independently testable before external systems are introduced.

**Tech Stack:** Node.js 24+, TypeScript 5.9, pnpm 10.15, Vitest 3.2, Zod 4, native ESM

---

## Scope and phase roadmap

The approved design contains six independently testable phases, so implementation is split into separate plans:

1. **This plan:** repository foundation and domain contracts.
2. JP, US, and GB adapters with recorded fixtures and opt-in live smoke tests.
3. PostgreSQL schema, repositories, scheduled worker, sync locking, and price-history writes.
4. Fastify read API, pagination, stale-data metadata, rate limiting, and health checks.
5. Vue PWA, local favorites, deal browsing, game search, listing detail, and price chart.
6. Docker Compose, Caddy, backups, restore verification, and VPS deployment.

Do not add code from phases 2-6 while executing this plan.

## File map

Files created in this phase:

```text
.gitignore                              Repository hygiene
.node-version                           Recommended Node major
package.json                            Root workspace scripts and tool versions
pnpm-workspace.yaml                     Workspace membership
tsconfig.base.json                      Shared strict TypeScript configuration
README.md                               Developer entry point and phase status
packages/shared/package.json            Shared-contract package manifest
packages/shared/tsconfig.json           Shared package type-check configuration
packages/shared/tsconfig.build.json     Shared package build configuration
packages/shared/src/country.ts          Country and currency schemas
packages/shared/src/catalog-item.ts     Normalized catalog contract
packages/shared/src/price-observation.ts Normalized price contract
packages/shared/src/pricing.ts          Derived pricing functions
packages/shared/src/index.ts            Public shared exports
packages/shared/test/contracts.test.ts  Runtime contract tests
packages/shared/test/pricing.test.ts    Pricing derivation tests
packages/eshop/package.json             Adapter package manifest
packages/eshop/tsconfig.json            Adapter package type-check configuration
packages/eshop/tsconfig.build.json      Adapter package build configuration
packages/eshop/src/adapter.ts            Adapter interface
packages/eshop/src/errors.ts             Typed upstream error
packages/eshop/src/validate-batch.ts     Runtime batch validation
packages/eshop/src/index.ts              Public adapter exports
packages/eshop/test/errors.test.ts       Error behavior tests
packages/eshop/test/validate-batch.test.ts Adapter-boundary tests
```

## Task 1: Root workspace and repository hygiene

**Files:**

- Create: `.gitignore`
- Create: `.node-version`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create the root workspace files**

Create `.gitignore`:

```gitignore
.DS_Store
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
*.log
.pnpm-debug.log
```

Create `.node-version`:

```text
24
```

Create `package.json`:

```json
{
  "name": "nintendo-eshop-tracker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.15.1",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "pnpm -r --if-present build",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "check": "pnpm build && pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@types/node": "24.3.0",
    "typescript": "5.9.2",
    "vitest": "3.2.4"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024", "DOM"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

- [ ] **Step 2: Install the pinned workspace tools**

Run:

```bash
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm install
```

Expected: `pnpm-lock.yaml` is created and installation exits with code 0.

- [ ] **Step 3: Verify repository hygiene**

Run:

```bash
git status --short
```

Expected: `.DS_Store` files do not appear; only the five new root files and `pnpm-lock.yaml` appear.

- [ ] **Step 4: Commit the root workspace**

```bash
git add .gitignore .node-version package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json
git commit -m "build: initialize TypeScript workspace"
```

## Task 2: Country, currency, and catalog contracts

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/tsconfig.build.json`
- Create: `packages/shared/src/country.ts`
- Create: `packages/shared/src/catalog-item.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/test/contracts.test.ts`

- [ ] **Step 1: Create the shared package manifest and TypeScript config**

Create `packages/shared/package.json`:

```json
{
  "name": "@eshop-tracker/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "zod": "4.0.17"
  }
}
```

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["dist"]
}
```

Create `packages/shared/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "test"]
}
```

Run:

```bash
pnpm install
```

Expected: workspace lockfile updates successfully.

- [ ] **Step 2: Write failing catalog-contract tests**

Create `packages/shared/test/contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CatalogItemSchema,
  CountryCodeSchema,
  CurrencyCodeSchema
} from '../src/index.js';

const validCatalogItem = {
  country: 'JP',
  source: 'nintendo-jp',
  sourceId: '70010000000141',
  productCode: 'HAC-P-AAAAA',
  title: 'Sample Game',
  publisher: 'Sample Publisher',
  developer: null,
  description: null,
  imageUrl: 'https://example.com/game.jpg',
  releaseDate: '2026-08-10',
  productType: 'game',
  sourceUrl: 'https://example.com/game',
  sourcePayload: { originalTitle: 'Sample Game' }
};

describe('CountryCodeSchema', () => {
  it.each(['JP', 'US', 'GB'])('accepts %s', (country) => {
    expect(CountryCodeSchema.parse(country)).toBe(country);
  });

  it('rejects a country outside phase 1', () => {
    expect(() => CountryCodeSchema.parse('DE')).toThrow();
  });
});

describe('CurrencyCodeSchema', () => {
  it.each(['JPY', 'USD', 'GBP'])('accepts %s', (currency) => {
    expect(CurrencyCodeSchema.parse(currency)).toBe(currency);
  });
});

describe('CatalogItemSchema', () => {
  it('accepts a normalized listing', () => {
    expect(CatalogItemSchema.parse(validCatalogItem)).toEqual(validCatalogItem);
  });

  it('rejects an empty source ID', () => {
    expect(() => CatalogItemSchema.parse({ ...validCatalogItem, sourceId: '' })).toThrow();
  });

  it('rejects a relative image URL', () => {
    expect(() => CatalogItemSchema.parse({ ...validCatalogItem, imageUrl: '/game.jpg' })).toThrow();
  });
});
```

- [ ] **Step 3: Run the test and confirm the contracts do not exist**

Run:

```bash
pnpm --filter @eshop-tracker/shared test
```

Expected: FAIL because `../src/index.js` or its exported schemas do not exist.

- [ ] **Step 4: Implement country and catalog schemas**

Create `packages/shared/src/country.ts`:

```ts
import { z } from 'zod';

export const CountryCodeSchema = z.enum(['JP', 'US', 'GB']);
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const CurrencyCodeSchema = z.enum(['JPY', 'USD', 'GBP']);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
```

Create `packages/shared/src/catalog-item.ts`:

```ts
import { z } from 'zod';
import { CountryCodeSchema } from './country.js';

export const ProductTypeSchema = z.enum(['game', 'bundle', 'dlc', 'unknown']);
export type ProductType = z.infer<typeof ProductTypeSchema>;

export const CatalogItemSchema = z.object({
  country: CountryCodeSchema,
  source: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  productCode: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1),
  publisher: z.string().trim().min(1).nullable(),
  developer: z.string().trim().min(1).nullable(),
  description: z.string().trim().min(1).nullable(),
  imageUrl: z.string().url().nullable(),
  releaseDate: z.string().date().nullable(),
  productType: ProductTypeSchema,
  sourceUrl: z.string().url().nullable(),
  sourcePayload: z.record(z.string(), z.unknown())
});

export type CatalogItem = z.infer<typeof CatalogItemSchema>;
```

Create `packages/shared/src/index.ts`:

```ts
export {
  CountryCodeSchema,
  CurrencyCodeSchema,
  type CountryCode,
  type CurrencyCode
} from './country.js';
export {
  CatalogItemSchema,
  ProductTypeSchema,
  type CatalogItem,
  type ProductType
} from './catalog-item.js';
```

- [ ] **Step 5: Run tests and type checking**

Run:

```bash
pnpm --filter @eshop-tracker/shared test
pnpm --filter @eshop-tracker/shared typecheck
```

Expected: all catalog-contract tests PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit catalog contracts**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): define catalog contracts"
```

## Task 3: Price observation contract

**Files:**

- Create: `packages/shared/src/price-observation.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/test/contracts.test.ts`

- [ ] **Step 1: Add failing price-contract tests**

Append to `packages/shared/test/contracts.test.ts`:

```ts
import { PriceObservationSchema } from '../src/index.js';

const validPriceObservation = {
  country: 'US',
  source: 'nintendo-price-api',
  sourceId: '70010000000185',
  currency: 'USD',
  regularAmountMinor: 3999,
  discountAmountMinor: 2999,
  discountStartAt: '2026-08-01T00:00:00.000Z',
  discountEndAt: '2026-08-15T23:59:59.000Z',
  salesStatus: 'onsale',
  observedAt: '2026-08-10T06:00:00.000Z'
};

describe('PriceObservationSchema', () => {
  it('accepts integer minor-unit amounts', () => {
    expect(PriceObservationSchema.parse(validPriceObservation)).toEqual(validPriceObservation);
  });

  it('rejects floating-point amounts', () => {
    expect(() => PriceObservationSchema.parse({
      ...validPriceObservation,
      regularAmountMinor: 39.99
    })).toThrow();
  });

  it('rejects a discount higher than the regular price', () => {
    expect(() => PriceObservationSchema.parse({
      ...validPriceObservation,
      discountAmountMinor: 4999
    })).toThrow('discountAmountMinor cannot exceed regularAmountMinor');
  });

  it('rejects an end time before the start time', () => {
    expect(() => PriceObservationSchema.parse({
      ...validPriceObservation,
      discountEndAt: '2026-07-01T00:00:00.000Z'
    })).toThrow('discountEndAt must be later than discountStartAt');
  });
});
```

Move the new `PriceObservationSchema` import into the existing top import block so the test file has one import from `../src/index.js`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @eshop-tracker/shared test -- contracts.test.ts
```

Expected: FAIL because `PriceObservationSchema` is not exported.

- [ ] **Step 3: Implement the price observation schema**

Create `packages/shared/src/price-observation.ts`:

```ts
import { z } from 'zod';
import { CountryCodeSchema, CurrencyCodeSchema } from './country.js';

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const PriceObservationSchema = z.object({
  country: CountryCodeSchema,
  source: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  currency: CurrencyCodeSchema,
  regularAmountMinor: z.number().int().nonnegative(),
  discountAmountMinor: z.number().int().nonnegative().nullable(),
  discountStartAt: IsoDateTimeSchema.nullable(),
  discountEndAt: IsoDateTimeSchema.nullable(),
  salesStatus: z.string().trim().min(1),
  observedAt: IsoDateTimeSchema
}).superRefine((value, context) => {
  if (
    value.discountAmountMinor !== null &&
    value.discountAmountMinor > value.regularAmountMinor
  ) {
    context.addIssue({
      code: 'custom',
      path: ['discountAmountMinor'],
      message: 'discountAmountMinor cannot exceed regularAmountMinor'
    });
  }

  if (
    value.discountStartAt !== null &&
    value.discountEndAt !== null &&
    Date.parse(value.discountEndAt) <= Date.parse(value.discountStartAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['discountEndAt'],
      message: 'discountEndAt must be later than discountStartAt'
    });
  }
});

export type PriceObservation = z.infer<typeof PriceObservationSchema>;
```

Append to `packages/shared/src/index.ts`:

```ts
export {
  PriceObservationSchema,
  type PriceObservation
} from './price-observation.js';
```

- [ ] **Step 4: Run contract tests and type checking**

Run:

```bash
pnpm --filter @eshop-tracker/shared test -- contracts.test.ts
pnpm --filter @eshop-tracker/shared typecheck
```

Expected: all contract tests PASS and TypeScript exits with code 0.

- [ ] **Step 5: Commit the price contract**

```bash
git add packages/shared/src packages/shared/test/contracts.test.ts
git commit -m "feat(shared): define price observation contract"
```

## Task 4: Derived pricing functions

**Files:**

- Create: `packages/shared/src/pricing.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/pricing.test.ts`

- [ ] **Step 1: Write failing pricing tests**

Create `packages/shared/test/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  calculateDiscountPercent,
  effectiveAmountMinor,
  isOnSale,
  type PriceObservation
} from '../src/index.js';

const price: PriceObservation = {
  country: 'GB',
  source: 'nintendo-price-api',
  sourceId: '70010000000185',
  currency: 'GBP',
  regularAmountMinor: 5000,
  discountAmountMinor: 3500,
  discountStartAt: '2026-08-01T00:00:00.000Z',
  discountEndAt: '2026-08-15T23:59:59.000Z',
  salesStatus: 'onsale',
  observedAt: '2026-08-10T06:00:00.000Z'
};

describe('isOnSale', () => {
  it('returns true only for a lower non-null discount price', () => {
    expect(isOnSale(price)).toBe(true);
    expect(isOnSale({ ...price, discountAmountMinor: null })).toBe(false);
    expect(isOnSale({ ...price, discountAmountMinor: 5000 })).toBe(false);
  });
});

describe('effectiveAmountMinor', () => {
  it('uses the discount price while on sale', () => {
    expect(effectiveAmountMinor(price)).toBe(3500);
  });

  it('uses the regular price when there is no valid discount', () => {
    expect(effectiveAmountMinor({ ...price, discountAmountMinor: null })).toBe(5000);
  });
});

describe('calculateDiscountPercent', () => {
  it('rounds the discount to the nearest integer percent', () => {
    expect(calculateDiscountPercent(price)).toBe(30);
  });

  it('returns null for free games and non-sale prices', () => {
    expect(calculateDiscountPercent({
      ...price,
      regularAmountMinor: 0,
      discountAmountMinor: null
    })).toBeNull();
    expect(calculateDiscountPercent({ ...price, discountAmountMinor: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @eshop-tracker/shared test -- pricing.test.ts
```

Expected: FAIL because the three pricing functions are not exported.

- [ ] **Step 3: Implement the pricing functions**

Create `packages/shared/src/pricing.ts`:

```ts
import type { PriceObservation } from './price-observation.js';

export function isOnSale(price: PriceObservation): boolean {
  return (
    price.discountAmountMinor !== null &&
    price.discountAmountMinor < price.regularAmountMinor
  );
}

export function effectiveAmountMinor(price: PriceObservation): number {
  return isOnSale(price)
    ? (price.discountAmountMinor as number)
    : price.regularAmountMinor;
}

export function calculateDiscountPercent(price: PriceObservation): number | null {
  if (!isOnSale(price) || price.regularAmountMinor === 0) {
    return null;
  }

  const discountAmountMinor = price.discountAmountMinor as number;
  return Math.round((1 - discountAmountMinor / price.regularAmountMinor) * 100);
}
```

Append to `packages/shared/src/index.ts`:

```ts
export {
  calculateDiscountPercent,
  effectiveAmountMinor,
  isOnSale
} from './pricing.js';
```

- [ ] **Step 4: Run pricing tests and the full shared package checks**

Run:

```bash
pnpm --filter @eshop-tracker/shared test
pnpm --filter @eshop-tracker/shared typecheck
pnpm --filter @eshop-tracker/shared build
```

Expected: all tests PASS, type checking exits 0, and `packages/shared/dist/index.js` plus declarations are created.

- [ ] **Step 5: Commit pricing derivations**

```bash
git add packages/shared/src packages/shared/test/pricing.test.ts
git commit -m "feat(shared): add pricing derivations"
```

## Task 5: Adapter package and typed upstream errors

**Files:**

- Create: `packages/eshop/package.json`
- Create: `packages/eshop/tsconfig.json`
- Create: `packages/eshop/tsconfig.build.json`
- Create: `packages/eshop/src/adapter.ts`
- Create: `packages/eshop/src/errors.ts`
- Create: `packages/eshop/src/index.ts`
- Create: `packages/eshop/test/errors.test.ts`

- [ ] **Step 1: Create the adapter package manifest and TypeScript config**

Create `packages/eshop/package.json`:

```json
{
  "name": "@eshop-tracker/eshop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@eshop-tracker/shared": "workspace:*",
    "zod": "4.0.17"
  }
}
```

Create `packages/eshop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["dist"]
}
```

Create `packages/eshop/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "test"]
}
```

Run:

```bash
pnpm install
```

Expected: `@eshop-tracker/shared` resolves as a workspace dependency.

- [ ] **Step 2: Write failing typed-error tests**

Create `packages/eshop/test/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EshopError } from '../src/index.js';

describe('EshopError', () => {
  it('retains a stable code, country, and cause', () => {
    const cause = new Error('socket closed');
    const error = new EshopError({
      code: 'NETWORK',
      message: 'Nintendo request failed',
      country: 'JP',
      cause
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EshopError');
    expect(error.code).toBe('NETWORK');
    expect(error.country).toBe('JP');
    expect(error.cause).toBe(cause);
  });
});
```

- [ ] **Step 3: Run the error test and confirm failure**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- errors.test.ts
```

Expected: FAIL because `EshopError` is not exported.

- [ ] **Step 4: Implement the adapter interface and error class**

Create `packages/eshop/src/adapter.ts`:

```ts
import type {
  CatalogItem,
  CountryCode,
  PriceObservation
} from '@eshop-tracker/shared';

export interface EshopAdapter {
  readonly country: CountryCode;
  fetchCatalog(signal?: AbortSignal): Promise<CatalogItem[]>;
  fetchPrices(sourceIds: readonly string[], signal?: AbortSignal): Promise<PriceObservation[]>;
}
```

Create `packages/eshop/src/errors.ts`:

```ts
import type { CountryCode } from '@eshop-tracker/shared';

export type EshopErrorCode =
  | 'NETWORK'
  | 'UPSTREAM_HTTP'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_COUNTRY';

interface EshopErrorOptions {
  code: EshopErrorCode;
  message: string;
  country: CountryCode;
  cause?: unknown;
}

export class EshopError extends Error {
  readonly code: EshopErrorCode;
  readonly country: CountryCode;

  constructor(options: EshopErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'EshopError';
    this.code = options.code;
    this.country = options.country;
  }
}
```

Create `packages/eshop/src/index.ts`:

```ts
export type { EshopAdapter } from './adapter.js';
export {
  EshopError,
  type EshopErrorCode
} from './errors.js';
```

- [ ] **Step 5: Run package tests and type checking**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test
pnpm --filter @eshop-tracker/eshop typecheck
```

Expected: error test PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit the adapter boundary**

```bash
git add packages/eshop pnpm-lock.yaml
git commit -m "feat(eshop): define adapter boundary"
```

## Task 6: Adapter-boundary batch validation

**Files:**

- Create: `packages/eshop/src/validate-batch.ts`
- Modify: `packages/eshop/src/index.ts`
- Create: `packages/eshop/test/validate-batch.test.ts`

- [ ] **Step 1: Write failing batch-validation tests**

Create `packages/eshop/test/validate-batch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  validateCatalogBatch,
  validatePriceBatch
} from '../src/index.js';

const catalogItem = {
  country: 'JP',
  source: 'nintendo-jp',
  sourceId: '70010000000141',
  productCode: null,
  title: 'Sample Game',
  publisher: null,
  developer: null,
  description: null,
  imageUrl: null,
  releaseDate: null,
  productType: 'game',
  sourceUrl: null,
  sourcePayload: {}
};

const priceObservation = {
  country: 'JP',
  source: 'nintendo-price-api',
  sourceId: '70010000000141',
  currency: 'JPY',
  regularAmountMinor: 6500,
  discountAmountMinor: null,
  discountStartAt: null,
  discountEndAt: null,
  salesStatus: 'onsale',
  observedAt: '2026-08-10T06:00:00.000Z'
};

describe('validateCatalogBatch', () => {
  it('returns normalized catalog items', () => {
    expect(validateCatalogBatch([catalogItem])).toEqual([catalogItem]);
  });

  it('rejects the whole batch when one item is invalid', () => {
    expect(() => validateCatalogBatch([
      catalogItem,
      { ...catalogItem, sourceId: '' }
    ])).toThrow();
  });
});

describe('validatePriceBatch', () => {
  it('returns normalized price observations', () => {
    expect(validatePriceBatch([priceObservation])).toEqual([priceObservation]);
  });

  it('rejects non-array upstream output', () => {
    expect(() => validatePriceBatch({ prices: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test -- validate-batch.test.ts
```

Expected: FAIL because the validation functions are not exported.

- [ ] **Step 3: Implement batch validation**

Create `packages/eshop/src/validate-batch.ts`:

```ts
import {
  CatalogItemSchema,
  PriceObservationSchema,
  type CatalogItem,
  type PriceObservation
} from '@eshop-tracker/shared';
import { z } from 'zod';

const CatalogBatchSchema = z.array(CatalogItemSchema);
const PriceBatchSchema = z.array(PriceObservationSchema);

export function validateCatalogBatch(value: unknown): CatalogItem[] {
  return CatalogBatchSchema.parse(value);
}

export function validatePriceBatch(value: unknown): PriceObservation[] {
  return PriceBatchSchema.parse(value);
}
```

Append to `packages/eshop/src/index.ts`:

```ts
export {
  validateCatalogBatch,
  validatePriceBatch
} from './validate-batch.js';
```

- [ ] **Step 4: Run adapter tests, type checking, and builds**

Run:

```bash
pnpm --filter @eshop-tracker/eshop test
pnpm --filter @eshop-tracker/eshop typecheck
pnpm --filter @eshop-tracker/shared build
pnpm --filter @eshop-tracker/eshop build
```

Expected: all adapter tests PASS and both packages build to `dist/`.

- [ ] **Step 5: Commit boundary validation**

```bash
git add packages/eshop/src packages/eshop/test/validate-batch.test.ts
git commit -m "feat(eshop): validate adapter output batches"
```

## Task 7: Developer documentation and full phase verification

**Files:**

- Create: `README.md`

- [ ] **Step 1: Write the project README**

Create `README.md`:

```markdown
# Nintendo eShop Tracker

Personal-first Nintendo eShop catalog and price-history service. The approved first release targets JP, US, and GB and will later expose the same backend to a PWA and possible WeChat Mini Program.

## Current status

Phase 1 defines validated catalog and price contracts plus the region-adapter boundary. Live Nintendo adapters, storage, API routes, Web UI, and deployment are intentionally implemented in later phases.

## Requirements

- Node.js 24 or newer
- Corepack

## Setup

```bash
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm install
pnpm check
```

## Workspace

- `packages/shared`: normalized domain schemas and price derivations.
- `packages/eshop`: adapter interface, upstream errors, and output validation.
- `apps/api`: added in the API phase.
- `apps/worker`: added in the persistence and sync phase.
- `apps/web`: added in the PWA phase.

## Design

See `docs/superpowers/specs/2026-08-10-nintendo-eshop-tracker-design.md`.

## License

This project derives adapter behavior from `favna/nintendo-switch-eshop`, licensed under Apache-2.0. Preserve upstream notices when adapter code is introduced in phase 2.
```

- [ ] **Step 2: Run all workspace checks**

Run:

```bash
pnpm check
```

Expected:

- shared contract and pricing tests PASS;
- adapter error and batch-validation tests PASS;
- both packages typecheck;
- both packages build;
- command exits with code 0.

- [ ] **Step 3: Inspect the final diff and status**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing. Only `README.md` is uncommitted; generated `dist/`, `coverage/`, and `.DS_Store` are ignored.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: document workspace foundation"
```

- [ ] **Step 5: Verify phase acceptance criteria**

Run:

```bash
pnpm check
git status --short --branch
git log --oneline -7
```

Expected:

- `pnpm check` exits with code 0;
- Git status shows a clean `main` branch;
- history contains focused commits for workspace, catalog contracts, price contracts, pricing derivations, adapter boundary, batch validation, and documentation.

## Phase 1 completion criteria

- The repository installs reproducibly from `pnpm-lock.yaml`.
- `CatalogItem` and `PriceObservation` are runtime-validated and exported as TypeScript types.
- Money is represented only as non-negative integer minor units.
- Invalid discount values and time ranges are rejected.
- Discount status, effective price, and percentage have unit tests.
- Future region adapters must conform to one `EshopAdapter` interface.
- Invalid adapter batches are rejected before persistence is introduced.
- `pnpm check` passes from the repository root.
- The Git working tree is clean.
