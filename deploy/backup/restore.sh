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
  if ! container_ids=$(docker compose ps -aq "$service"); then
    printf '%s\n' 'restore: could not verify service state' >&2
    exit 1
  fi
  for container_id in $container_ids; do
    if ! state=$(docker inspect --format '{{.State.Status}}' "$container_id"); then
      printf '%s\n' 'restore: could not verify service state' >&2
      exit 1
    fi
    case "$state" in
      created|exited) ;;
      *)
        printf '%s\n' 'restore: stop worker and backup before restoring' >&2
        exit 1
        ;;
    esac
  done
done

if ! public_object_count=$(docker compose exec -T postgres sh -c 'psql -X -Atq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT count(*) FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE namespace.nspname NOT IN ('\''pg_catalog'\'', '\''information_schema'\'') AND namespace.nspname NOT LIKE '\''pg_%'\'' AND class.relkind IN ('\''r'\'', '\''p'\'', '\''v'\'', '\''m'\'', '\''S'\'', '\''f'\'')) + (SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('\''pg_catalog'\'', '\''information_schema'\'', '\''public'\'') AND nspname NOT LIKE '\''pg_%'\'') + (SELECT count(*) FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace WHERE namespace.nspname NOT IN ('\''pg_catalog'\'', '\''information_schema'\'') AND namespace.nspname NOT LIKE '\''pg_%'\'') + (SELECT count(*) FROM pg_catalog.pg_extension WHERE extname <> '\''plpgsql'\'')"'); then
  printf '%s\n' 'restore: could not inspect target database' >&2
  exit 1
fi
case "$public_object_count" in
  0) ;;
  *)
    printf '%s\n' 'restore: target database is not empty' >&2
    exit 1
    ;;
esac

gzip -t -- "$dump"
gzip -dc -- "$dump" | docker compose exec -T postgres sh -c 'psql --single-transaction -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
