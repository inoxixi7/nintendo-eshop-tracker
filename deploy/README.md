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
  ../backups/              # gzip SQL backups, owned by BACKUP_UID:BACKUP_GID
```

Create the local environment file and protect it:

```sh
cp .env.example .env
chmod 0600 .env
```

Replace `POSTGRES_PASSWORD=change-me` before starting. It must be a high-entropy URL-safe value: use letters, digits, `-`, and `_`; URL punctuation such as `@`, `:`, `/`, or `%` is not supported in this deployment's constructed `DATABASE_URL`. Keep `.env` untracked.

Set `BACKUP_UID` and `BACKUP_GID` to the deployment owner's numeric IDs (`id -u`, `id -g`), then create `BACKUP_DIR` with that exact ownership and write permission. The backup sidecar deliberately runs as this arbitrary numeric non-root UID:GID; it uses only PostgreSQL Alpine client tools (`psql`/`pg_dump`) and does not initialize a server. Task 7 must still verify the actual G3 bind mount is writable by this user.

The example defaults to Tokyo time, catalog at `03:00` daily, prices every six hours, immediate startup synchronization, a daily backup interval, and a two-day maximum successful-backup age.

## Start and observe

Validate the real, permission-protected environment file first, then build and start:

```sh
sh deploy/test/compose-config.sh .env
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs -f worker backup
```

The worker healthcheck requires PID 1 Node plus a readiness marker written only after migrations, optional initial synchronization, and Croner schedules complete. The backup healthcheck remains unhealthy until a successful dump and retention pass writes a fresh `.last-success` epoch marker. The backup sidecar waits for `001_initial.sql` plus required tables before producing its first archive.

Run manual synchronization without starting a second scheduler:

```sh
docker compose run --rm worker node apps/worker/dist/main.js migrate
docker compose run --rm worker node apps/worker/dist/main.js catalog
docker compose run --rm worker node apps/worker/dist/main.js prices
docker compose run --rm worker node apps/worker/dist/main.js all
```

## Backups and restore

The `backup` service makes one UTC-named `nintendo_eshop_YYYYMMDDTHHMMSSZ.sql.gz` plain-SQL dump per interval and retains seven days. Files are created with `umask 077`, completed atomically, and are pruned only after a new successful backup. Its fresh success marker is updated atomically only after dump and retention success; a failed attempt clears it so health cannot report stale success. Keep the backup directory owned and writable by `BACKUP_UID:BACKUP_GID`; do not grant it wider access than needed.

For a manual backup validation, use the sidecar's safe one-shot mode:

```sh
docker compose run --rm backup sh /usr/local/bin/run-backup.sh once
```

Restore is intentionally not destructive by itself: it does not drop or recreate data. An operator must first prepare a **genuinely empty target database** (no public user tables), stop both writers, confirm the selected archive, and then run:

```sh
sudo docker compose stop worker backup
deploy/backup/restore.sh ../backups/nintendo_eshop_YYYYMMDDTHHMMSSZ.sql.gz
```

The script independently refuses to run while either writer is running, refuses a nonempty target, verifies gzip integrity, and restores through a single transaction with `psql` stopping on the first SQL error. Verify the restored database and only then restart the worker.

## Update, stop, and portability

The G3 deployment directory is an rsynced release, not a Git checkout. From the reviewed development machine, synchronize the release while preserving G3 secrets and durable data:

```sh
rsync -a --delete --exclude '.git/' --exclude '.env' --exclude 'data/' --exclude 'backups/' \
  ./ g3:/srv/docker/nintendo-eshop-tracker/
```

Then on G3:

```sh
cd /srv/docker/nintendo-eshop-tracker
sh deploy/test/compose-config.sh .env
sudo docker compose up -d --build
```

Task 7 must perform this Docker build and a startup/health smoke test on G3. Local Compose and shell checks do not prove the image build or live bind-mount behavior.

To stop the private stack while preserving PostgreSQL data and backups:

```sh
docker compose down
```

Because paths are supplied through `.env` and nothing publishes a port, the same directory layout and Compose file can later move to a VPS. Keep database and backup directories outside the checkout, transfer them with suitable offline backup tooling, and explicitly choose any future ingress separately.
