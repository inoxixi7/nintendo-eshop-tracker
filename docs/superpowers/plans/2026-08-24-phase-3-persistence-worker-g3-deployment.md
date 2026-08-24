# Phase 3 Persistence, Worker, and G3 Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Japanese eShop catalog and price observations in PostgreSQL, run catalog and price jobs on durable schedules, retain daily database backups, and deploy the stack privately on the G3 server.

**Architecture:** Add a focused `packages/database` package for migrations and persistence, plus an `apps/worker` process that owns synchronization and schedules. Docker Compose runs PostgreSQL, the worker, and a backup sidecar without publishing database or application ports; the G3 deployment remains private and can later move unchanged to a VPS.

**Tech Stack:** Node.js 24, TypeScript, pnpm workspace, PostgreSQL 17, `pg`, Croner, Vitest, Docker Compose.

---

## Scope boundaries

- Implement JP persistence and scheduling because JP is the only live adapter currently available.
- Preserve the normalized adapter boundary: database and worker code import adapter contracts but never expose upstream payloads directly to clients.
- Do not implement Web/PWA, authentication, US/GB adapters, or the full public read API in this phase.
- Do not publish PostgreSQL port 5432 or any G3 management interface.

### Task 1: Workspace compatibility and database schema

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/tsconfig.build.json`
- Create: `packages/database/migrations/001_initial.sql`
- Create: `packages/database/src/migrations.ts`
- Create: `packages/database/src/index.ts`
- Test: `packages/database/test/migrations.test.ts`

- [ ] **Step 1: Write the failing migration inventory test**

Create a test that calls `loadMigrations()` and asserts a single ordered migration named `001_initial.sql`, with SQL containing `regional_listings`, `current_prices`, `price_history`, `sync_runs`, and the `(country, source, source_id)` unique constraint.

```ts
import { describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/migrations.js';

describe('loadMigrations', () => {
  it('loads the initial schema in lexical order', async () => {
    const migrations = await loadMigrations();
    expect(migrations.map((migration) => migration.name)).toEqual(['001_initial.sql']);
    expect(migrations[0]?.sql).toContain('CREATE TABLE regional_listings');
    expect(migrations[0]?.sql).toContain('CREATE TABLE current_prices');
    expect(migrations[0]?.sql).toContain('CREATE TABLE price_history');
    expect(migrations[0]?.sql).toContain('CREATE TABLE sync_runs');
    expect(migrations[0]?.sql).toContain('UNIQUE (country, source, source_id)');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `./node_modules/.bin/vitest run packages/database/test/migrations.test.ts`

Expected: FAIL because `packages/database/src/migrations.ts` does not exist.

- [ ] **Step 3: Add the package and initial migration**

The migration must create a `schema_migrations` table and these durable tables:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE regional_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES games(id),
  country text NOT NULL CHECK (country IN ('JP', 'US', 'GB')),
  source text NOT NULL,
  source_id text NOT NULL,
  product_code text,
  title text NOT NULL,
  publisher text,
  developer text,
  description text,
  image_url text,
  release_date date,
  product_type text NOT NULL,
  source_url text,
  source_payload jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, source, source_id)
);

CREATE TABLE current_prices (
  regional_listing_id uuid PRIMARY KEY REFERENCES regional_listings(id) ON DELETE CASCADE,
  currency text NOT NULL,
  regular_amount_minor integer NOT NULL CHECK (regular_amount_minor >= 0),
  discount_amount_minor integer CHECK (discount_amount_minor >= 0),
  discount_start_at timestamptz,
  discount_end_at timestamptz,
  sales_status text NOT NULL,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  regional_listing_id uuid NOT NULL REFERENCES regional_listings(id) ON DELETE CASCADE,
  currency text NOT NULL,
  regular_amount_minor integer NOT NULL CHECK (regular_amount_minor >= 0),
  discount_amount_minor integer CHECK (discount_amount_minor >= 0),
  discount_start_at timestamptz,
  discount_end_at timestamptz,
  sales_status text NOT NULL,
  observed_at timestamptz NOT NULL
);

CREATE TABLE sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('catalog', 'prices')),
  country text NOT NULL CHECK (country IN ('JP', 'US', 'GB')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  items_read integer NOT NULL DEFAULT 0,
  items_written integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text
);

CREATE INDEX regional_listings_active_source_idx
  ON regional_listings (country, source, is_active, source_id);
CREATE INDEX price_history_listing_observed_idx
  ON price_history (regional_listing_id, observed_at);
CREATE INDEX sync_runs_country_job_started_idx
  ON sync_runs (country, job_type, started_at DESC);
```

`loadMigrations()` must resolve the package migration directory from `import.meta.url`, read only `*.sql`, and return lexical order. Configure both `onlyBuiltDependencies: [esbuild]` for pinned pnpm 10.15.1 and `allowBuilds.esbuild: true` for pnpm 11 in `pnpm-workspace.yaml`, so neither supported runtime ignores the existing test dependency's esbuild build. The database build must clean `dist` before compiling and copying migrations so removed migrations cannot remain in the shipped package.

- [ ] **Step 4: Run the focused test and full offline check**

Run: `./node_modules/.bin/vitest run packages/database/test/migrations.test.ts`

Expected: PASS.

Run: `pnpm run check`

Expected: all build, typecheck, and offline tests pass.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml packages/database
git commit -m "feat(database): add initial tracker schema"
```

### Task 2: PostgreSQL migration runner and tracker repository

**Files:**
- Create: `packages/database/src/database.ts`
- Create: `packages/database/src/tracker-repository.ts`
- Modify: `packages/database/src/index.ts`
- Test: `packages/database/test/tracker-repository.test.ts`

- [ ] **Step 1: Write failing repository contract tests**

Use a small fake `QueryClient` that records parameterized SQL calls. Cover these public operations:

```ts
export interface TrackerRepository {
  migrate(): Promise<void>;
  tryJobLock(jobType: 'catalog' | 'prices', country: CountryCode): Promise<boolean>;
  releaseJobLock(jobType: 'catalog' | 'prices', country: CountryCode): Promise<void>;
  startSyncRun(jobType: 'catalog' | 'prices', country: CountryCode, startedAt: Date): Promise<number>;
  finishSyncRun(id: number, result: SyncRunResult): Promise<void>;
  upsertCatalog(items: readonly CatalogItem[], seenAt: Date): Promise<number>;
  activeSourceIds(country: CountryCode, source: string): Promise<string[]>;
  recordPrices(observations: readonly PriceObservation[]): Promise<number>;
  close(): Promise<void>;
}
```

Assert that values are passed as SQL parameters, catalog rows are processed in one transaction, and the price statement compares all price/status/discount-time fields before inserting history.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `./node_modules/.bin/vitest run packages/database/test/tracker-repository.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement the PostgreSQL boundary**

Use `pg.Pool` behind a narrow `QueryClient` interface. `createTrackerRepository(databaseUrl)` owns its pool. `migrate()` must acquire an advisory lock, apply each unapplied migration in a transaction, record it in `schema_migrations`, and release the lock in `finally`.

`upsertCatalog()` must use `INSERT ... ON CONFLICT (country, source, source_id) DO UPDATE`, restore seen rows to `is_active=true`, and mark rows inactive only when `last_seen_at < seenAt - interval '7 days'`. It must never delete listings or history.

`recordPrices()` must lock the matching listing/current-price row, insert the first history point, insert another history point only when one of these changes, and always upsert `current_prices`:

```sql
ROW(
  previous.currency,
  previous.regular_amount_minor,
  previous.discount_amount_minor,
  previous.discount_start_at,
  previous.discount_end_at,
  previous.sales_status
) IS DISTINCT FROM ROW($4, $5, $6, $7, $8, $9)
```

Unknown `(country, source, source_id)` observations must fail the transaction instead of silently creating incomplete listings.

- [ ] **Step 4: Run repository tests and typecheck**

Run: `./node_modules/.bin/vitest run packages/database/test/tracker-repository.test.ts`

Expected: PASS.

Run: `./node_modules/.bin/tsc -p packages/database/tsconfig.json --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/database
git commit -m "feat(database): persist catalog and price history"
```

### Task 3: JP synchronization jobs with retry and run accounting

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/tsconfig.build.json`
- Create: `apps/worker/src/retry.ts`
- Create: `apps/worker/src/sync.ts`
- Test: `apps/worker/test/retry.test.ts`
- Test: `apps/worker/test/sync.test.ts`

- [ ] **Step 1: Write failing retry tests**

Test injected `sleep` and `random` functions. Verify `NETWORK`, HTTP 429, and HTTP 5xx errors retry at most three total attempts; invalid payload and ordinary 4xx errors fail immediately.

```ts
const result = await withRetry(operation, {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  sleep,
  random: () => 0.5
});
expect(operation).toHaveBeenCalledTimes(3);
expect(sleep).toHaveBeenCalledTimes(2);
```

- [ ] **Step 2: Write failing synchronization tests**

Use fake adapter and repository implementations. Verify:

- catalog fetch writes items, records success, and always releases the job lock;
- prices fetches IDs from the database, persists observations, and records unavailable IDs as `partial`;
- lock contention returns without fetching;
- failures record a bounded error code/message and release the lock;
- an empty active listing set is a successful zero-item price run.

- [ ] **Step 3: Run the focused tests and verify they fail**

Run: `./node_modules/.bin/vitest run apps/worker/test/retry.test.ts apps/worker/test/sync.test.ts`

Expected: FAIL because worker modules do not exist.

- [ ] **Step 4: Implement minimal sync jobs**

Export these functions with dependency injection:

```ts
export async function runCatalogSync(options: SyncOptions): Promise<SyncSummary>;
export async function runPriceSync(options: SyncOptions): Promise<SyncSummary>;
```

Both functions must use the adapter country/source, acquire a database advisory lock, create/finish a sync run, call the retry wrapper only around upstream requests, and release the lock in `finally`. Error messages stored in `sync_runs` must be capped at 500 characters and must not include connection strings or stacks.

- [ ] **Step 5: Run focused and full offline tests**

Run: `./node_modules/.bin/vitest run apps/worker/test/retry.test.ts apps/worker/test/sync.test.ts`

Expected: PASS.

Run: `pnpm run check`

Expected: all workspace checks pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): synchronize JP catalog and prices"
```

### Task 4: Worker CLI and durable schedules

**Files:**
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/scheduler.ts`
- Create: `apps/worker/src/main.ts`
- Test: `apps/worker/test/config.test.ts`
- Test: `apps/worker/test/scheduler.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Parse environment values into this validated configuration:

```ts
interface WorkerConfig {
  databaseUrl: string;
  catalogCron: string;
  priceCron: string;
  timeZone: string;
  runOnStartup: boolean;
}
```

Defaults must be `0 3 * * *` for daily catalog, `0 */6 * * *` for prices, `UTC`, and `true`. Reject missing/non-PostgreSQL `DATABASE_URL`, invalid cron expressions, and invalid booleans.

- [ ] **Step 2: Write failing scheduler tests**

Inject a cron factory and signals. Verify the scheduler creates exactly two non-overlapping jobs, optionally runs catalog then prices at startup, stops both jobs on shutdown, and closes the repository.

- [ ] **Step 3: Run focused tests and verify they fail**

Run: `./node_modules/.bin/vitest run apps/worker/test/config.test.ts apps/worker/test/scheduler.test.ts`

Expected: FAIL because configuration and scheduler modules do not exist.

- [ ] **Step 4: Implement CLI modes**

`main.ts` must support only:

```text
node dist/main.js migrate
node dist/main.js catalog
node dist/main.js prices
node dist/main.js all
node dist/main.js schedule
```

Every mode runs migrations first. `all` runs catalog then prices. `schedule` installs Croner jobs, runs both once when `RUN_ON_STARTUP=true`, handles `SIGINT`/`SIGTERM`, and exits nonzero on initialization failure.

- [ ] **Step 5: Run worker tests and full check**

Run: `./node_modules/.bin/vitest run apps/worker/test`

Expected: PASS.

Run: `pnpm run check`

Expected: all workspace checks pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker package.json pnpm-lock.yaml
git commit -m "feat(worker): schedule catalog and price jobs"
```

### Task 5: Portable Docker Compose deployment and backups

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `deploy/backup/run.sh`
- Create: `deploy/backup/restore.sh`
- Create: `deploy/README.md`
- Test: `deploy/test/compose-config.sh`

- [ ] **Step 1: Add a failing deployment validation script**

The script must run `docker compose --env-file .env.example config --quiet`, assert that no service publishes a host port, and assert that services `postgres`, `worker`, and `backup` exist.

```sh
#!/bin/sh
set -eu
docker compose --env-file .env.example config --quiet
services="$(docker compose --env-file .env.example config --services)"
printf '%s\n' "$services" | grep -qx postgres
printf '%s\n' "$services" | grep -qx worker
printf '%s\n' "$services" | grep -qx backup
! docker compose --env-file .env.example config | grep -q 'published:'
```

- [ ] **Step 2: Run it and verify it fails**

Run: `sh deploy/test/compose-config.sh`

Expected: FAIL because `compose.yaml` does not exist.

- [ ] **Step 3: Implement the container stack**

The multi-stage Dockerfile must use Node 24, pnpm 10.15.1, a frozen lockfile, `pnpm run build`, and `node apps/worker/dist/main.js schedule` as the final command.

Compose requirements:

- `postgres:17-alpine`, healthchecked with `pg_isready`, persistent bind mount `${DATA_DIR:-../data/postgres}`;
- worker depends on healthy PostgreSQL, restarts unless stopped, and receives only the required environment variables;
- backup uses `postgres:17-alpine`, waits for PostgreSQL, creates one gzip-compressed custom-free SQL dump per day, retains seven days, and mounts `${BACKUP_DIR:-../backups}`;
- no service publishes a host port;
- secrets come from an untracked `.env`, never baked into an image.

Use this backup filename format:

```sh
backup_file="$BACKUP_DIR/nintendo_eshop_$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump --no-owner --no-privileges "$POSTGRES_DB" | gzip -9 > "$backup_file"
find "$BACKUP_DIR" -type f -name 'nintendo_eshop_*.sql.gz' -mtime +6 -delete
```

`restore.sh` must require exactly one existing `.sql.gz` path and restore it through `gzip -dc | psql -v ON_ERROR_STOP=1`; document that restore targets an empty database.

- [ ] **Step 4: Validate Compose and build the worker image**

Run: `sh deploy/test/compose-config.sh`

Expected: PASS.

Run: `docker compose --env-file .env.example build worker`

Expected: image builds successfully.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore compose.yaml .env.example deploy README.md
git commit -m "feat(deploy): add private G3 compose stack"
```

### Task 6: Local PostgreSQL integration and live JP smoke

**Files:**
- Create: `deploy/test/integration.sh`
- Modify: `README.md`

- [ ] **Step 1: Add the integration script**

The script must create a temporary Compose project name, start PostgreSQL, run migrations, run one live JP catalog and price cycle, then assert:

```sql
SELECT count(*) > 0 FROM regional_listings WHERE country = 'JP';
SELECT count(*) > 0 FROM current_prices;
SELECT count(*) > 0 FROM price_history;
SELECT count(*) = 2 FROM sync_runs WHERE status IN ('success', 'partial');
```

It must always stop and remove only its temporary containers/volumes in a trap.

- [ ] **Step 2: Run the full integration**

Run: `sh deploy/test/integration.sh`

Expected: migrations succeed, JP data is nonempty, catalog and price sync runs are recorded, and the temporary stack is removed.

- [ ] **Step 3: Run fresh offline verification**

Run: `pnpm run check`

Expected: all builds, typechecks, and tests pass with zero failures.

- [ ] **Step 4: Commit**

```bash
git add deploy/test/integration.sh README.md
git commit -m "test(deploy): verify PostgreSQL synchronization"
```

### Task 7: Stage and start the G3 deployment

**Files:**
- Remote create: `/srv/docker/nintendo-eshop-tracker/app/`
- Remote create: `/srv/docker/nintendo-eshop-tracker/data/postgres/`
- Remote create: `/srv/docker/nintendo-eshop-tracker/backups/`
- Remote create: `/srv/docker/nintendo-eshop-tracker/app/.env`

- [ ] **Step 1: Stage release files without secrets or development state**

Use `rsync` over SSH to copy the committed worktree while excluding `.git`, `.worktrees`, `node_modules`, `dist`, `.env`, logs, coverage, and local data. Create the remote data and backup directories as `bber`.

- [ ] **Step 2: Create the remote environment file securely**

Generate a high-entropy PostgreSQL password locally, write the G3 `.env` with mode `0600`, and include:

```dotenv
POSTGRES_DB=nintendo_eshop
POSTGRES_USER=eshop_tracker
POSTGRES_PASSWORD=<generated secret>
DATA_DIR=../data/postgres
BACKUP_DIR=../backups
CATALOG_CRON=0 3 * * *
PRICE_CRON=0 */6 * * *
TZ=Asia/Tokyo
RUN_ON_STARTUP=true
```

Never print or commit the generated password.

- [ ] **Step 3: Start the stack with the user's privileged Docker access**

Run on G3:

```bash
cd /srv/docker/nintendo-eshop-tracker/app
sudo docker compose up -d --build
```

If sudo requires interactive authentication, stop and ask the user to run only this command; do not request or handle their password.

- [ ] **Step 4: Verify the real G3 deployment**

After startup, verify:

```bash
sudo docker compose ps
sudo docker compose logs --no-color --tail=200 worker
sudo docker compose exec -T postgres psql -U eshop_tracker -d nintendo_eshop -c \
  "SELECT country, count(*) FROM regional_listings GROUP BY country;"
sudo docker compose exec -T postgres psql -U eshop_tracker -d nintendo_eshop -c \
  "SELECT count(*) AS current_prices FROM current_prices;"
sudo docker compose exec -T postgres psql -U eshop_tracker -d nintendo_eshop -c \
  "SELECT job_type, status, items_read, items_written FROM sync_runs ORDER BY id DESC LIMIT 5;"
```

Expected: all three services are running/healthy, JP listings and current prices are nonempty, and catalog/price sync runs are successful or partial with no unhandled error.

- [ ] **Step 5: Record deployment handoff**

Document the deployed path, update command, log command, manual backup command, restore command, and the fact that no ports are publicly exposed. Do not commit the G3 `.env`, database, or backups.

## Final verification checklist

- [ ] `pnpm run check` passes from a clean install.
- [ ] Compose configuration validates and publishes no host ports.
- [ ] A clean PostgreSQL database migrates successfully.
- [ ] A live JP catalog/price cycle persists listings, current prices, history, and sync runs.
- [ ] G3 restarts the worker and backup services automatically.
- [ ] The G3 database and backup directories are outside the Git checkout.
- [ ] The remote `.env` is mode `0600` and absent from Git.
- [ ] PostgreSQL 5432 and G3 management pages are not exposed publicly.
