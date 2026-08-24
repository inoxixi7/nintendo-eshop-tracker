#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
script="$repo_root/deploy/backup/run.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/nintendo-eshop-backup.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"

real_rm=$(command -v rm)
export REAL_RM="$real_rm"

cat > "$fake_bin/psql" <<'SH'
#!/bin/sh
case "$*" in
  *001_initial.sql*regional_listings*sync_runs*) printf 't\n' ;;
  *) printf 'f\n' ;;
esac
SH
cat > "$fake_bin/pg_dump" <<'SH'
#!/bin/sh
printf '%s\n' 'SELECT 1;'
SH
cat > "$fake_bin/date" <<'SH'
#!/bin/sh
printf '%s\n' '20260824T123456Z'
SH
cat > "$fake_bin/sleep" <<'SH'
#!/bin/sh
exit 99
SH
chmod +x "$fake_bin/psql" "$fake_bin/pg_dump" "$fake_bin/date" "$fake_bin/sleep"

backup_dir="$test_root/ready"
if ! BACKUP_DIR="$backup_dir" BACKUP_INTERVAL_SECONDS=1 PATH="$fake_bin:$PATH" sh "$script" once > "$test_root/ready.out" 2>&1; then
  printf '%s\n' 'backup test failed: complete schema must permit one backup' >&2
  exit 1
fi
test -f "$backup_dir/nintendo_eshop_20260824T123456Z.sql.gz"
if find "$backup_dir" -maxdepth 1 -name '*.tmp*' -print | grep -q .; then
  printf '%s\n' 'backup test failed: successful backup left temporary files' >&2
  exit 1
fi

cat > "$fake_bin/rm" <<'SH'
#!/bin/sh
case "$*" in
  *.tmp.sql*) exit 1 ;;
  *) exec "$REAL_RM" "$@" ;;
esac
SH
chmod +x "$fake_bin/rm"

backup_dir="$test_root/rm-failure"
mkdir -p "$backup_dir"
printf '%s\n' 'last good backup' > "$backup_dir/nintendo_eshop_20260817T123456Z.sql.gz"
if BACKUP_DIR="$backup_dir" BACKUP_INTERVAL_SECONDS=1 PATH="$fake_bin:$PATH" sh "$script" loop > "$test_root/rm-failure.out" 2>&1; then
  printf '%s\n' 'backup test failed: loop must stop when mocked sleep ends' >&2
  exit 1
fi
test -f "$backup_dir/nintendo_eshop_20260817T123456Z.sql.gz"
if grep -q 'backup: completed' "$test_root/rm-failure.out"; then
  printf '%s\n' 'backup test failed: rm failure was reported as a completed backup' >&2
  exit 1
fi
grep -q 'backup: failed; will retry later' "$test_root/rm-failure.out"
