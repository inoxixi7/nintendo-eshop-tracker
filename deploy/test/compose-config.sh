#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

if ! grep -q '^# INSECURE PLACEHOLDER:' .env.example; then
  printf '%s\n' 'compose validation failed: .env.example must mark its password as an insecure placeholder' >&2
  exit 1
fi
printf '%s\n' 'warning: .env.example is a template only; replace POSTGRES_PASSWORD before deployment' >&2

if ! grep -q -- '--from=prod-deps /app/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/apps/worker/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/packages/database/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/packages/eshop/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/packages/shared/node_modules' Dockerfile \
  || grep -q -- '--from=build /app/.*node_modules' Dockerfile; then
  printf '%s\n' 'compose validation failed: runtime node_modules must come only from prod-deps' >&2
  exit 1
fi

docker compose --env-file .env.example config --quiet

resolved=$(mktemp "${TMPDIR:-/tmp}/nintendo-eshop-compose.XXXXXX")
trap 'rm -f "$resolved"' EXIT HUP INT TERM
docker compose --env-file .env.example config --format json > "$resolved"

node --input-type=module - "$resolved" <<'NODE'
import { readFileSync } from 'node:fs';

const [configPath] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const services = config.services ?? {};
const names = Object.keys(services).sort();
const expectedNames = ['backup', 'postgres', 'worker'];

function fail(message) {
  console.error(`compose validation failed: ${message}`);
  process.exit(1);
}

if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
  fail(`services must be exactly ${expectedNames.join(', ')}, got ${names.join(', ') || '(none)'}`);
}

for (const [name, service] of Object.entries(services)) {
  if (Array.isArray(service.ports) && service.ports.length > 0) fail(`${name} publishes ports`);
  if (service.privileged === true) fail(`${name} is privileged`);
  if (service.network_mode === 'host') fail(`${name} uses host networking`);
  if (JSON.stringify(service.volumes ?? []).includes('docker.sock')) fail(`${name} mounts docker.sock`);
  if (service.restart !== 'unless-stopped') fail(`${name} must restart unless-stopped`);
  if (service.logging?.driver !== 'json-file') fail(`${name} must use json-file logging`);
  if (service.logging?.options?.['max-size'] !== '10m' || service.logging?.options?.['max-file'] !== '3') {
    fail(`${name} needs bounded rotating logs`);
  }
}

for (const name of ['postgres', 'worker', 'backup']) {
  if (services[name].healthcheck === undefined) fail(`${name} needs a healthcheck`);
}

for (const name of ['worker', 'backup']) {
  if (services[name].depends_on?.postgres?.condition !== 'service_healthy') {
    fail(`${name} must depend on healthy postgres`);
  }
}

const postgresVolumes = JSON.stringify(services.postgres.volumes ?? []);
if (!postgresVolumes.includes('/var/lib/postgresql/data')) fail('postgres needs persistent data mount');

const backupVolumes = services.backup.volumes ?? [];
if (!JSON.stringify(backupVolumes).includes('/backups')) fail('backup needs persistent backup mount');
if (!backupVolumes.some((volume) => String(volume.target ?? volume).includes('/usr/local/bin/run-backup.sh') && volume.read_only === true)) {
  fail('backup needs read-only backup script mount');
}

const networks = config.networks ?? {};
if (Object.keys(networks).length !== 1) fail('stack must use exactly one private network');
for (const service of Object.values(services)) {
  if (Object.keys(service.networks ?? {}).length !== 1) fail('every service must join the private network only');
}
NODE

sh -n deploy/backup/run.sh
sh -n deploy/backup/restore.sh
sh deploy/test/backup-run.sh
