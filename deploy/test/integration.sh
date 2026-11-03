#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/nintendo-eshop-integration.XXXXXX")
project="neshop-integration-$$"
env_file="$test_root/integration.env"
data_dir="$test_root/postgres"
backup_dir="$test_root/backups"

compose() {
  env \
    -u POSTGRES_DB -u POSTGRES_USER -u POSTGRES_PASSWORD \
    -u DATA_DIR -u BACKUP_DIR -u BACKUP_UID -u BACKUP_GID \
    -u CATALOG_CRON -u PRICE_CRON -u TZ -u RUN_ON_STARTUP \
    -u BACKUP_INTERVAL_SECONDS -u BACKUP_MAX_AGE_SECONDS \
    docker compose --project-name "$project" --env-file "$env_file" --project-directory "$repo_root" "$@"
}

cleanup() {
  integration_exit_code=$?
  trap - EXIT
  compose down --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$test_root"
  exit "$integration_exit_code"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

if ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'integration: Docker daemon is unavailable; run this test with Docker access' >&2
  exit 1
fi

test_uid=$(id -u)
test_gid=$(id -g)
if [ "$test_uid" = 0 ]; then
  test_uid=${SUDO_UID:-1000}
  test_gid=${SUDO_GID:-1000}
fi
positive_integer() {
  case "$1" in
    ''|*[!0-9]*|0) return 1 ;;
    *) return 0 ;;
  esac
}
if ! positive_integer "$test_uid" || ! positive_integer "$test_gid"; then
  printf '%s\n' 'integration: backup UID and GID must be positive integers' >&2
  exit 1
fi

mkdir -p "$data_dir" "$backup_dir"
if [ "$(id -u)" = 0 ]; then
  chown "$test_uid:$test_gid" "$backup_dir"
fi

umask 077
cat > "$env_file" <<EOF
POSTGRES_DB=nintendo_eshop_integration
POSTGRES_USER=eshop_integration
POSTGRES_PASSWORD=Integration_${project}_secret
DATA_DIR=$data_dir
BACKUP_DIR=$backup_dir
BACKUP_UID=$test_uid
BACKUP_GID=$test_gid
CATALOG_CRON=0 3 * * *
PRICE_CRON=0 */6 * * *
TZ=Asia/Tokyo
RUN_ON_STARTUP=false
BACKUP_INTERVAL_SECONDS=86400
BACKUP_MAX_AGE_SECONDS=172800
EOF
chmod 600 "$env_file"

cd "$repo_root"
sh deploy/test/compose-config.sh "$env_file"
compose build worker
compose up -d --wait --wait-timeout 120 postgres
compose run --rm --no-deps worker node apps/worker/dist/main.js migrate
compose run --rm --no-deps worker node apps/worker/dist/main.js catalog
compose run --rm --no-deps worker node apps/worker/dist/main.js prices

assert_sql() {
  label=$1
  query=$2
  result=$(compose exec -T postgres psql -X -U eshop_integration -d nintendo_eshop_integration -Atqc "$query")
  if [ "$result" != t ]; then
    printf '%s\n' "integration: assertion failed: $label" >&2
    return 1
  fi
}

assert_sql 'JP catalog is nonempty' "SELECT count(*) > 0 FROM regional_listings WHERE country = 'JP'"
assert_sql 'current prices are nonempty' 'SELECT count(*) > 0 FROM current_prices'
assert_sql 'price history is nonempty' 'SELECT count(*) > 0 FROM price_history'
# One catalog and one price run for each of JP, US, GB, CA, MX, BR
assert_sql 'each region has one successful or partial catalog and price run' "SELECT count(*) = 12 AND count(DISTINCT (country, job_type)) = 12 FROM sync_runs WHERE status IN ('success', 'partial')"
assert_sql 'only the catalog and price sync runs exist' 'SELECT count(*) = 12 FROM sync_runs'

compose run --rm --no-deps backup sh /usr/local/bin/run-backup.sh once
archive=$(find "$backup_dir" -maxdepth 1 -type f -name 'nintendo_eshop_*.sql.gz' -print -quit)
if [ -z "$archive" ] || [ ! -s "$archive" ]; then
  printf '%s\n' 'integration: backup archive was not created' >&2
  exit 1
fi
gzip -t "$archive"

printf '%s\n' 'integration: PostgreSQL, JP catalog, prices, history, sync runs, and backup verified'
