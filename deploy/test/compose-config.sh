#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  printf '%s\n' 'usage: compose-config.sh [env-file]' >&2
  exit 2
fi

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"
env_file=${1:-.env.example}
actual_env=false
backup_uid=
backup_gid=

if [ ! -f "$env_file" ]; then
  printf '%s\n' 'compose validation failed: env file does not exist' >&2
  exit 1
fi

env_value() {
  awk -v key="$1" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2); count += 1 }
    END { if (count == 1) print value; else exit 1 }
  ' "$env_file"
}

positive_integer() {
  case "$2" in
    ''|*[!0-9]*) return 1 ;;
    *[1-9]*) return 0 ;;
    *) return 1 ;;
  esac
}

url_safe() {
  case "$1" in ''|*[!A-Za-z0-9_-]*) return 1 ;; *) return 0 ;; esac
}

if [ "$env_file" != '.env.example' ]; then
  actual_env=true
  env_mode=$(stat -c '%a' "$env_file" 2>/dev/null || stat -f '%Lp' "$env_file")
  if [ "$env_mode" != 600 ]; then
    printf '%s\n' 'compose validation failed: actual env file must have mode 0600' >&2
    exit 1
  fi
  for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD; do
    if ! value=$(env_value "$key") || ! url_safe "$value"; then
      printf '%s\n' "compose validation failed: $key must be a non-empty URL-safe value" >&2
      exit 1
    fi
  done
  password=$(env_value POSTGRES_PASSWORD)
  if [ "$password" = 'change-me' ]; then
    printf '%s\n' 'compose validation failed: POSTGRES_PASSWORD is still the placeholder' >&2
    exit 1
  fi
  backup_uid=$(env_value BACKUP_UID) || {
    printf '%s\n' 'compose validation failed: BACKUP_UID is required' >&2
    exit 1
  }
  backup_gid=$(env_value BACKUP_GID) || {
    printf '%s\n' 'compose validation failed: BACKUP_GID is required' >&2
    exit 1
  }
  interval=$(env_value BACKUP_INTERVAL_SECONDS) || exit 1
  max_age=$(env_value BACKUP_MAX_AGE_SECONDS) || exit 1
  if ! positive_integer BACKUP_UID "$backup_uid" \
    || ! positive_integer BACKUP_GID "$backup_gid" \
    || ! positive_integer BACKUP_INTERVAL_SECONDS "$interval" \
    || ! positive_integer BACKUP_MAX_AGE_SECONDS "$max_age"; then
    printf '%s\n' 'compose validation failed: backup UID, GID, interval, and max age must be positive integers' >&2
    exit 1
  fi
fi

if ! grep -q '^# INSECURE PLACEHOLDER:' .env.example; then
  printf '%s\n' 'compose validation failed: .env.example must mark its password as an insecure placeholder' >&2
  exit 1
fi
if [ "$actual_env" = false ]; then
  printf '%s\n' 'warning: .env.example is a template only; replace POSTGRES_PASSWORD before deployment' >&2
fi

if ! grep -q -- '--from=prod-deps /app/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/apps/api/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/apps/worker/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/packages/database/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/packages/eshop/node_modules' Dockerfile \
  || ! grep -q -- '--from=prod-deps /app/packages/shared/node_modules' Dockerfile \
  || grep -q -- '--from=build /app/.*node_modules' Dockerfile; then
  printf '%s\n' 'compose validation failed: runtime node_modules must come only from prod-deps' >&2
  exit 1
fi

compose_config() {
  env \
    -u POSTGRES_DB -u POSTGRES_USER -u POSTGRES_PASSWORD \
    -u DATA_DIR -u BACKUP_DIR -u BACKUP_UID -u BACKUP_GID \
    -u CATALOG_CRON -u PRICE_CRON -u TZ -u RUN_ON_STARTUP \
    -u BACKUP_INTERVAL_SECONDS -u BACKUP_MAX_AGE_SECONDS \
    docker compose --env-file "$env_file" "$@"
}

compose_config config --quiet

resolved=$(mktemp "${TMPDIR:-/tmp}/nintendo-eshop-compose.XXXXXX")
trap 'rm -f "$resolved"' EXIT HUP INT TERM
compose_config config --format json > "$resolved"

validator=${COMPOSE_CONFIG_VALIDATOR:-auto}
use_python=false
case "$validator" in
  auto)
    if ! command -v node >/dev/null 2>&1; then
      use_python=true
    fi
    ;;
  node)
    if ! command -v node >/dev/null 2>&1; then
      printf '%s\n' 'compose validation failed: requested node validator is unavailable' >&2
      exit 1
    fi
    ;;
  python3)
    use_python=true
    ;;
  *)
    printf '%s\n' 'compose validation failed: invalid config validator' >&2
    exit 1
    ;;
esac

if [ "$use_python" = true ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    printf '%s\n' 'compose validation failed: python3 validator is unavailable' >&2
    exit 1
  fi
  python3 "$repo_root/deploy/test/validate-compose.py" "$resolved" "$actual_env" "$backup_uid" "$backup_gid" "$env_file"
else
  node --input-type=module - "$resolved" "$actual_env" "$backup_uid" "$backup_gid" "$env_file" <<'NODE'
import { accessSync, constants, readFileSync, statSync } from 'node:fs';

const [configPath, actualEnv, backupUid, backupGid, envFile] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const services = config.services ?? {};
const names = Object.keys(services).sort();
const expectedNames = ['api', 'backup', 'postgres', 'worker'];

function fail(message) {
  console.error(`compose validation failed: ${message}`);
  process.exit(1);
}

function parseEnvFile(path) {
  const values = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) fail('actual env file has an invalid assignment');
    const key = line.slice(0, separator);
    if (values.has(key)) fail('actual env file has duplicate assignments');
    values.set(key, line.slice(separator + 1));
  }
  return values;
}

if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
  fail(`services must be exactly ${expectedNames.join(', ')}, got ${names.join(', ') || '(none)'}`);
}

for (const [name, service] of Object.entries(services)) {
  const ports = Array.isArray(service.ports) ? service.ports : [];
  if (ports.length > 0 && (name !== 'api' || ports.some((port) => port.host_ip !== '127.0.0.1'))) {
    fail(`${name} publishes ports beyond api on loopback`);
  }
  if (service.privileged === true) fail(`${name} is privileged`);
  if (service.network_mode === 'host') fail(`${name} uses host networking`);
  if (JSON.stringify(service.volumes ?? []).includes('docker.sock')) fail(`${name} mounts docker.sock`);
  if (service.restart !== 'unless-stopped') fail(`${name} must restart unless-stopped`);
  if (service.logging?.driver !== 'json-file') fail(`${name} must use json-file logging`);
  if (service.logging?.options?.['max-size'] !== '10m' || service.logging?.options?.['max-file'] !== '3') {
    fail(`${name} needs bounded rotating logs`);
  }
}

if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(String(services.backup.user ?? ''))) {
  fail('backup must run as a non-root numeric UID:GID');
}
if (!JSON.stringify(services.worker.healthcheck?.test ?? []).includes('/tmp/nintendo-eshop-worker-ready')) {
  fail('worker healthcheck needs the readiness marker');
}
if (!JSON.stringify(services.backup.healthcheck?.test ?? []).includes('run-backup.sh health')) {
  fail('backup healthcheck must validate the successful backup marker');
}

for (const name of ['api', 'postgres', 'worker', 'backup']) {
  if (services[name].healthcheck === undefined) fail(`${name} needs a healthcheck`);
}

for (const name of ['api', 'worker', 'backup']) {
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

if (actualEnv === 'true') {
  const values = parseEnvFile(envFile);
  const required = (key) => {
    const value = values.get(key);
    if (value === undefined) fail('actual env file is missing a required value');
    return value;
  };
  const database = required('POSTGRES_DB');
  const user = required('POSTGRES_USER');
  const password = required('POSTGRES_PASSWORD');
  const expectedUrl = `postgresql://${user}:${password}@postgres:5432/${database}`;
  if (
    services.postgres.environment?.POSTGRES_DB !== database
    || services.postgres.environment?.POSTGRES_USER !== user
    || services.postgres.environment?.POSTGRES_PASSWORD !== password
    || services.worker.environment?.DATABASE_URL !== expectedUrl
    || services.api.environment?.DATABASE_URL !== `${expectedUrl}?options=-c%20default_transaction_read_only%3Don`
    || services.backup.environment?.PGPASSWORD !== password
    || services.backup.environment?.PGDATABASE !== database
    || services.backup.environment?.PGUSER !== user
    || services.backup.environment?.BACKUP_INTERVAL_SECONDS !== required('BACKUP_INTERVAL_SECONDS')
    || services.backup.environment?.BACKUP_MAX_AGE_SECONDS !== required('BACKUP_MAX_AGE_SECONDS')
  ) fail('actual env values did not render exactly');
  const bindSource = (service, target) => {
    const volume = (service.volumes ?? []).find((entry) => entry.type === 'bind' && entry.target === target);
    if (volume?.source === undefined) fail(`${target} needs a resolved bind source`);
    return volume.source;
  };
  const dataSource = bindSource(services.postgres, '/var/lib/postgresql/data');
  const backupSource = bindSource(services.backup, '/backups');
  try {
    if (!statSync(dataSource).isDirectory()) fail(`${dataSource} must be a directory`);
  } catch {
    fail(`${dataSource} must exist and be a directory`);
  }
  try {
    const stat = statSync(backupSource);
    if (!stat.isDirectory()) fail(`${backupSource} must be a directory`);
    accessSync(backupSource, constants.W_OK);
  } catch {
    fail(`${backupSource} must exist and be writable`);
  }
  const backupStat = statSync(backupSource);
  if (backupStat.uid !== Number(backupUid) || backupStat.gid !== Number(backupGid)) {
    fail('BACKUP_DIR ownership must match BACKUP_UID:BACKUP_GID');
  }
  if (services.backup.user !== `${backupUid}:${backupGid}`) {
    fail('backup user does not match BACKUP_UID:BACKUP_GID');
  }
}
NODE
fi

sh -n deploy/backup/run.sh
sh -n deploy/backup/restore.sh
sh deploy/test/backup-run.sh
sh deploy/test/restore.sh
