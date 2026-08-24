#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
script="$repo_root/deploy/backup/run.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/nintendo-eshop-backup.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"

real_rm=$(command -v rm)
real_gzip=$(command -v gzip)
real_mv=$(command -v mv)
real_find=$(command -v find)
export REAL_RM="$real_rm"
export REAL_GZIP="$real_gzip"
export REAL_MV="$real_mv"
export REAL_FIND="$real_find"

cat > "$fake_bin/psql" <<'SH'
#!/bin/sh
case "$*" in
  *001_initial.sql*regional_listings*sync_runs*) printf 't\n' ;;
  *) printf 'f\n' ;;
esac
SH
cat > "$fake_bin/pg_dump" <<'SH'
#!/bin/sh
[ "${BACKUP_TEST_FAIL:-}" = pg_dump ] && exit 1
[ "${BACKUP_TEST_FAIL:-}" = signal ] && { kill -TERM "$PPID"; exit 1; }
printf '%s\n' 'SELECT 1;'
SH
cat > "$fake_bin/date" <<'SH'
#!/bin/sh
case "$*" in
  *+%s*) printf '%s\n' '1000' ;;
  *) printf '%s\n' '20260824T123456Z' ;;
esac
SH
cat > "$fake_bin/sleep" <<'SH'
#!/bin/sh
exit 99
SH
chmod +x "$fake_bin/psql" "$fake_bin/pg_dump" "$fake_bin/date" "$fake_bin/sleep"

cat > "$fake_bin/gzip" <<'SH'
#!/bin/sh
[ "${BACKUP_TEST_FAIL:-}" = gzip ] && exit 1
exec "$REAL_GZIP" "$@"
SH
cat > "$fake_bin/mv" <<'SH'
#!/bin/sh
[ "${BACKUP_TEST_FAIL:-}" = mv ] && exit 1
exec "$REAL_MV" "$@"
SH
cat > "$fake_bin/find" <<'SH'
#!/bin/sh
[ "${BACKUP_TEST_FAIL:-}" = prune ] && exit 1
exec "$REAL_FIND" "$@"
SH
chmod +x "$fake_bin/gzip" "$fake_bin/mv" "$fake_bin/find"

if BACKUP_DIR="$test_root/missing" BACKUP_INTERVAL_SECONDS=1 BACKUP_MAX_AGE_SECONDS=1 PATH="$fake_bin:$PATH" sh "$script" health; then
  printf '%s\n' 'backup test failed: missing success marker was healthy' >&2
  exit 1
fi

backup_dir="$test_root/ready"
if ! BACKUP_DIR="$backup_dir" BACKUP_INTERVAL_SECONDS=1 PATH="$fake_bin:$PATH" sh "$script" once > "$test_root/ready.out" 2>&1; then
  printf '%s\n' 'backup test failed: complete schema must permit one backup' >&2
  exit 1
fi
test -f "$backup_dir/nintendo_eshop_20260824T123456Z.sql.gz"
test "$(cat "$backup_dir/.last-success")" = '1000'
BACKUP_DIR="$backup_dir" BACKUP_INTERVAL_SECONDS=1 BACKUP_MAX_AGE_SECONDS=1 PATH="$fake_bin:$PATH" sh "$script" health
printf '%s\n' '998' > "$backup_dir/.last-success"
if BACKUP_DIR="$backup_dir" BACKUP_INTERVAL_SECONDS=1 BACKUP_MAX_AGE_SECONDS=1 PATH="$fake_bin:$PATH" sh "$script" health; then
  printf '%s\n' 'backup test failed: stale success marker was healthy' >&2
  exit 1
fi
if find "$backup_dir" -maxdepth 1 -name '*.tmp*' -print | grep -q .; then
  printf '%s\n' 'backup test failed: successful backup left temporary files' >&2
  exit 1
fi

cat > "$fake_bin/rm" <<'SH'
#!/bin/sh
case "$*" in
  *.tmp.sql*) [ "${BACKUP_TEST_FAIL:-}" = rm ] && exit 1 ;;
  *) exec "$REAL_RM" "$@" ;;
esac
exec "$REAL_RM" "$@"
SH
chmod +x "$fake_bin/rm"

assert_failed_attempt() {
  failure=$1
  failed_dir="$test_root/$failure-failure"
  mkdir -p "$failed_dir"
  printf '%s\n' '1000' > "$failed_dir/.last-success"
  if BACKUP_DIR="$failed_dir" BACKUP_INTERVAL_SECONDS=1 BACKUP_MAX_AGE_SECONDS=1 BACKUP_TEST_FAIL="$failure" PATH="$fake_bin:$PATH" sh "$script" once > "$test_root/$failure.out" 2>&1; then
    printf '%s\n' "backup test failed: $failure failure was accepted" >&2
    exit 1
  fi
  test ! -e "$failed_dir/.last-success"
  if find "$failed_dir" -maxdepth 1 -name '*.tmp*' -print | grep -q .; then
    printf '%s\n' "backup test failed: $failure left temporary files" >&2
    exit 1
  fi
}

for failure in pg_dump gzip mv prune signal; do
  assert_failed_attempt "$failure"
done
if BACKUP_DIR="$test_root/invalid" BACKUP_INTERVAL_SECONDS=0 PATH="$fake_bin:$PATH" sh "$script" once; then
  printf '%s\n' 'backup test failed: invalid interval was accepted' >&2
  exit 1
fi

backup_dir="$test_root/rm-failure"
mkdir -p "$backup_dir"
printf '%s\n' 'last good backup' > "$backup_dir/nintendo_eshop_20260817T123456Z.sql.gz"
printf '%s\n' '1000' > "$backup_dir/.last-success"
if BACKUP_DIR="$backup_dir" BACKUP_INTERVAL_SECONDS=1 BACKUP_TEST_FAIL=rm PATH="$fake_bin:$PATH" sh "$script" loop > "$test_root/rm-failure.out" 2>&1; then
  printf '%s\n' 'backup test failed: loop must stop when mocked sleep ends' >&2
  exit 1
fi
test -f "$backup_dir/nintendo_eshop_20260817T123456Z.sql.gz"
test ! -e "$backup_dir/.last-success"
if grep -q 'backup: completed' "$test_root/rm-failure.out"; then
  printf '%s\n' 'backup test failed: rm failure was reported as a completed backup' >&2
  exit 1
fi
grep -q 'backup: failed; will retry later' "$test_root/rm-failure.out"
