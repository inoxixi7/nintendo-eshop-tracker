#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' 'usage: restore.sh /path/to/nintendo_eshop_YYYYMMDDTHHMMSSZ.sql.gz' >&2
  exit 2
fi

dump=$1
case "$dump" in
  *.sql.gz) ;;
  *)
    printf '%s\n' 'restore: backup file must end in .sql.gz' >&2
    exit 2
    ;;
esac
if [ ! -f "$dump" ]; then
  printf '%s\n' 'restore: backup file does not exist' >&2
  exit 2
fi

case "$dump" in
  /*) ;;
  *) dump="$(CDPATH= cd -- "$(dirname -- "$dump")" && pwd)/$(basename -- "$dump")" ;;
esac

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

for service in worker backup; do
  if ! running=$(docker compose ps -q --status running "$service"); then
    printf '%s\n' 'restore: could not verify service state' >&2
    exit 1
  fi
  if [ -n "$running" ]; then
    printf '%s\n' 'restore: stop worker and backup before restoring' >&2
    exit 1
  fi
done

if ! public_table_count=$(docker compose exec -T postgres sh -c 'psql -X -Atq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = '\''public'\''"'); then
  printf '%s\n' 'restore: could not inspect target database' >&2
  exit 1
fi
case "$public_table_count" in
  0) ;;
  *)
    printf '%s\n' 'restore: target database is not empty' >&2
    exit 1
    ;;
esac

gzip -t -- "$dump"
gzip -dc -- "$dump" | docker compose exec -T postgres sh -c 'psql --single-transaction -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
