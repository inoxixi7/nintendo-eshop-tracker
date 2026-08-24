#!/bin/sh
set -eu

umask 077

backup_dir=${BACKUP_DIR:-/backups}
interval=${BACKUP_INTERVAL_SECONDS:-86400}
temporary_archive=
temporary_sql=

log() {
  printf '%s\n' "$1" >&2
}

cleanup() {
  [ -z "$temporary_archive" ] || rm -f -- "$temporary_archive"
  [ -z "$temporary_sql" ] || rm -f -- "$temporary_sql"
  temporary_archive=
  temporary_sql=
}

trap 'cleanup; exit 1' HUP INT TERM
trap cleanup 0

case "$interval" in
  ''|*[!0-9]*)
    log 'backup: BACKUP_INTERVAL_SECONDS must be a positive integer'
    exit 2
    ;;
esac
case "$interval" in
  *[1-9]*) ;;
  *)
    log 'backup: BACKUP_INTERVAL_SECONDS must be a positive integer'
    exit 2
    ;;
esac

mkdir -p -- "$backup_dir"

wait_for_schema() {
  while :; do
    if [ "$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT to_regclass('public.schema_migrations') IS NOT NULL" 2>/dev/null || true)" = 't' ]; then
      return 0
    fi
    log 'backup: waiting for schema migrations'
    sleep 10
  done
}

prune_backups() {
  find "$backup_dir" -maxdepth 1 -type f \
    -name 'nintendo_eshop_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.sql.gz' \
    -mtime +6 -delete
}

backup_once() {
  wait_for_schema
  filename="nintendo_eshop_$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  archive="$backup_dir/$filename"
  temporary_archive="$backup_dir/.${filename}.$$.tmp"
  temporary_sql="$temporary_archive.sql"

  if ! pg_dump --no-owner --no-privileges > "$temporary_sql"; then
    cleanup
    return 1
  fi
  if ! gzip -9 < "$temporary_sql" > "$temporary_archive"; then
    cleanup
    return 1
  fi
  rm -f -- "$temporary_sql"
  temporary_sql=
  if ! mv -- "$temporary_archive" "$archive"; then
    cleanup
    return 1
  fi
  temporary_archive=
  prune_backups
  log 'backup: completed'
}

case "${1:-loop}" in
  once)
    backup_once
    ;;
  loop)
    while :; do
      if ! backup_once; then
        log 'backup: failed; will retry later'
      fi
      sleep "$interval"
    done
    ;;
  *)
    log 'backup: usage: run.sh [once|loop]'
    exit 2
    ;;
esac
