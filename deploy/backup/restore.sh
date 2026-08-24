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

gzip -t -- "$dump"
gzip -dc -- "$dump" | docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
