#!/bin/sh
set -eu

if [ "$(id -u)" != 0 ]; then
  printf '%s\n' 'G3 bootstrap must be run with sudo' >&2
  exit 1
fi

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

if [ ! -f .env ]; then
  printf '%s\n' 'G3 bootstrap: .env is missing' >&2
  exit 1
fi

printf '%s\n' 'G3 bootstrap: validating the isolated live integration stack'
sh deploy/test/integration.sh

printf '%s\n' 'G3 bootstrap: validating and starting the private production stack'
sh deploy/test/compose-config.sh .env
docker compose up -d --build --wait --wait-timeout 2700

sql_true() {
  label=$1
  query=$2
  result=$(docker compose exec -T postgres psql -X -U eshop_tracker -d nintendo_eshop -Atqc "$query")
  if [ "$result" != t ]; then
    printf '%s\n' "G3 bootstrap: assertion failed: $label" >&2
    return 1
  fi
}

running_services=$(docker compose ps --status running --services | sort)
expected_services=$(printf '%s\n' api backup postgres worker)
if [ "$running_services" != "$expected_services" ]; then
  printf '%s\n' 'G3 bootstrap: not all production services are running' >&2
  exit 1
fi

sql_true 'JP catalog is nonempty' "SELECT count(*) > 0 FROM regional_listings WHERE country = 'JP'"
sql_true 'current prices are nonempty' 'SELECT count(*) > 0 FROM current_prices'
sql_true 'price history is nonempty' 'SELECT count(*) > 0 FROM price_history'
sql_true 'latest catalog and price runs completed' "SELECT count(*) = 2 AND bool_and(status IN ('success', 'partial')) FROM (SELECT status FROM sync_runs ORDER BY id DESC LIMIT 2) recent"

if ! docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/v1/deals?pageSize=1').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
  printf '%s\n' 'G3 bootstrap: API deals endpoint is not answering' >&2
  exit 1
fi

archive=$(find ../backups -maxdepth 1 -type f -name 'nintendo_eshop_*.sql.gz' -print -quit)
if [ -z "$archive" ] || [ ! -s "$archive" ]; then
  printf '%s\n' 'G3 bootstrap: no completed backup archive was found' >&2
  exit 1
fi
gzip -t "$archive"

report=../last-deploy-report.txt
temporary_report="../.last-deploy-report.$$.tmp"
cleanup_report() {
  rm -f -- "$temporary_report"
}
trap cleanup_report EXIT
trap 'exit 130' HUP INT TERM
umask 022
{
  printf 'verified_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' 'published_ports=none'
  docker compose ps
  docker compose exec -T postgres psql -X -U eshop_tracker -d nintendo_eshop -P pager=off -c \
    "SELECT country, count(*) AS listings FROM regional_listings GROUP BY country ORDER BY country;"
  docker compose exec -T postgres psql -X -U eshop_tracker -d nintendo_eshop -P pager=off -c \
    'SELECT count(*) AS current_prices, (SELECT count(*) FROM price_history) AS price_history FROM current_prices;'
  docker compose exec -T postgres psql -X -U eshop_tracker -d nintendo_eshop -P pager=off -c \
    'SELECT job_type, status, items_read, items_written FROM sync_runs ORDER BY id DESC LIMIT 5;'
  printf 'backup_archive=%s\n' "$(basename "$archive")"
} > "$temporary_report"
chmod 644 "$temporary_report"
mv -f -- "$temporary_report" "$report"
trap - EXIT HUP INT TERM

printf '%s\n' 'G3 bootstrap: production deployment verified'
cat "$report"
