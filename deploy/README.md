# Private Docker Compose deployment

This stack is deliberately private: it exposes no host ports. PostgreSQL, the scheduler, and its backup sidecar communicate only over the Compose network. The worker reaches Nintendo's public endpoints outbound; no management page or database is published.

## Layout and secrets

Place the checkout beside the durable data directories:

```text
nintendo-eshop-tracker/
  .env                    # chmod 0600; untracked
  compose.yaml
  deploy/
  ../data/postgres/       # PostgreSQL bind mount
  ../backups/              # gzip SQL backups, owned by the deploying user
```

Create the local environment file and protect it:

```sh
cp .env.example .env
chmod 0600 .env
```

Replace `POSTGRES_PASSWORD=change-me` before starting. It must be a high-entropy URL-safe value: use letters, digits, `-`, and `_`; URL punctuation such as `@`, `:`, `/`, or `%` is not supported in this deployment's constructed `DATABASE_URL`. Keep `.env` untracked.

The example defaults to Tokyo time, catalog at `03:00` daily, prices every six hours, immediate startup synchronization, and a daily backup interval.

## Start and observe

Validate the configuration first, then build and start:

```sh
deploy/test/compose-config.sh
docker compose up -d --build
docker compose ps
docker compose logs -f worker backup
```

The worker runs migrations before every scheduler or manual synchronization command. It is therefore safe to start after an image update: migrations finish before a sync job starts. The backup sidecar waits for `schema_migrations` before producing its first archive.

Run manual synchronization without starting a second scheduler:

```sh
docker compose run --rm worker node apps/worker/dist/main.js migrate
docker compose run --rm worker node apps/worker/dist/main.js catalog
docker compose run --rm worker node apps/worker/dist/main.js prices
docker compose run --rm worker node apps/worker/dist/main.js all
```

## Backups and restore

The `backup` service makes one UTC-named `nintendo_eshop_YYYYMMDDTHHMMSSZ.sql.gz` plain-SQL dump per interval and retains seven days. Files are created with `umask 077`, completed atomically, and are pruned only after a new successful backup. Make the backup directory owned and writable by the user that runs Docker Compose; do not grant it wider access than needed.

For a manual backup validation, use the sidecar's safe one-shot mode:

```sh
docker compose run --rm backup sh /usr/local/bin/run-backup.sh once
```

Restore is intentionally not destructive by itself: it does not drop data. An operator must first prepare an **empty target database**, stop the scheduler to avoid concurrent writes, confirm the selected archive, and then run:

```sh
deploy/backup/restore.sh ../backups/nintendo_eshop_YYYYMMDDTHHMMSSZ.sql.gz
```

`psql` stops on the first SQL error. Verify the restored database and only then restart the worker.

## Update, stop, and portability

To update a checkout, review the changes, validate Compose, then rebuild:

```sh
git pull --ff-only
deploy/test/compose-config.sh
docker compose up -d --build
```

To stop the private stack while preserving PostgreSQL data and backups:

```sh
docker compose down
```

Because paths are supplied through `.env` and nothing publishes a port, the same directory layout and Compose file can later move to a VPS. Keep database and backup directories outside the checkout, transfer them with suitable offline backup tooling, and explicitly choose any future ingress separately.
