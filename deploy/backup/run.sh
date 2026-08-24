#!/bin/sh
set -eu

umask 077

backup_dir=${BACKUP_DIR:-/backups}
interval=${BACKUP_INTERVAL_SECONDS:-86400}
max_age=${BACKUP_MAX_AGE_SECONDS:-172800}
success_marker="$backup_dir/.last-success"
temporary_archive=
temporary_sql=
temporary_marker=

log() {
  printf '%s\n' "$1" >&2
}

cleanup() {
  [ -z "$temporary_archive" ] || rm -f -- "$temporary_archive" || true
  [ -z "$temporary_sql" ] || rm -f -- "$temporary_sql" || true
  [ -z "$temporary_marker" ] || rm -f -- "$temporary_marker" || true
  temporary_archive=
  temporary_sql=
  temporary_marker=
}

trap 'cleanup; exit 1' HUP INT TERM
trap cleanup 0

validate_positive_integer() {
  case "$2" in
    ''|*[!0-9]*)
      log "backup: $1 must be a positive integer"
      return 1
      ;;
    *[1-9]*) return 0 ;;
    *)
      log "backup: $1 must be a positive integer"
      return 1
      ;;
  esac
}

if ! validate_positive_integer BACKUP_INTERVAL_SECONDS "$interval" \
  || ! validate_positive_integer BACKUP_MAX_AGE_SECONDS "$max_age"; then
  exit 2
fi

wait_for_schema() {
  while :; do
    if [ "$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '001_initial.sql') AND to_regclass('public.regional_listings') IS NOT NULL AND to_regclass('public.sync_runs') IS NOT NULL" 2>/dev/null || true)" = 't' ]; then
      return 0
    fi
    log 'backup: waiting for schema migrations'
    if ! sleep 10; then
      return 1
    fi
  done
}

prune_backups() {
  find "$backup_dir" -maxdepth 1 -type f \
    -name 'nintendo_eshop_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.sql.gz' \
    -mtime +6 -delete
}

backup_once() {
  if ! mkdir -p -- "$backup_dir"; then
    return 1
  fi
  if ! rm -f -- "$success_marker"; then
    return 1
  fi
  if ! wait_for_schema; then
    return 1
  fi
  if ! timestamp=$(date -u +%Y%m%dT%H%M%SZ); then
    return 1
  fi
  case "$timestamp" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) return 1 ;;
  esac
  filename="nintendo_eshop_${timestamp}.sql.gz"
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
  if ! rm -f -- "$temporary_sql"; then
    cleanup
    return 1
  fi
  temporary_sql=
  if ! mv -- "$temporary_archive" "$archive"; then
    cleanup
    return 1
  fi
  temporary_archive=
  if ! prune_backups; then
    return 1
  fi
  if ! marker_time=$(date -u +%s); then
    return 1
  fi
  case "$marker_time" in
    ''|*[!0-9]*) return 1 ;;
  esac
  temporary_marker="$backup_dir/.last-success.$$.tmp"
  if ! printf '%s\n' "$marker_time" > "$temporary_marker"; then
    cleanup
    return 1
  fi
  if ! mv -- "$temporary_marker" "$success_marker"; then
    cleanup
    return 1
  fi
  temporary_marker=
  log 'backup: completed'
}

health() {
  if ! validate_positive_integer BACKUP_MAX_AGE_SECONDS "$max_age"; then
    return 1
  fi
  if [ ! -f "$success_marker" ]; then
    return 1
  fi
  if ! marker_time=$(cat "$success_marker"); then
    return 1
  fi
  case "$marker_time" in
    ''|*[!0-9]*) return 1 ;;
  esac
  if ! now=$(date -u +%s); then
    return 1
  fi
  case "$now" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$now" -ge "$marker_time" ] && [ $((now - marker_time)) -le "$max_age" ]
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
  health)
    health
    ;;
  *)
    log 'backup: usage: run.sh [once|loop]'
    exit 2
    ;;
esac
