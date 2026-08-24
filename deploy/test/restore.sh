#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
script="$repo_root/deploy/backup/restore.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/nintendo-eshop-restore.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"
dump="$test_root/nintendo_eshop_20260824T123456Z.sql.gz"
: > "$dump"

cat > "$fake_bin/gzip" <<'SH'
#!/bin/sh
case "$1" in
  -t) exit 0 ;;
  -dc) printf '%s\n' 'SELECT 1;' ;;
  *) exit 2 ;;
esac
SH
cat > "$fake_bin/docker" <<'SH'
#!/bin/sh
case "$*" in
  *'compose ps -aq '*worker*|*'compose ps -aq '*backup*)
    case "${RESTORE_SCENARIO:-}" in
      running|restarting|unknown) printf '%s\n' 'container-id' ;;
    esac
    ;;
  *'inspect --format'*)
    case "${RESTORE_SCENARIO:-}" in
      running) printf '%s\n' 'running' ;;
      restarting) printf '%s\n' 'restarting' ;;
      unknown) printf '%s\n' 'mystery' ;;
      *) exit 1 ;;
    esac
    ;;
  *'ps -q'*worker*|*'ps -q'*backup*)
    [ "${RESTORE_SCENARIO:-}" = running ] && printf '%s\n' 'container-id'
    exit 0
    ;;
  *'SELECT count(*)'*)
    [ "${RESTORE_SCENARIO:-}" = nonempty ] && printf '%s\n' '1' || printf '%s\n' '0'
    ;;
  *'psql '*)
    case "$*" in *--single-transaction*'-v ON_ERROR_STOP=1'*) : ;; *) exit 9 ;; esac
    ;;
esac
SH
chmod +x "$fake_bin/gzip" "$fake_bin/docker"

if RESTORE_SCENARIO=running PATH="$fake_bin:$PATH" sh "$script" "$dump" > "$test_root/running.out" 2>&1; then
  printf '%s\n' 'restore test failed: running worker or backup must block restore' >&2
  exit 1
fi
if RESTORE_SCENARIO=restarting PATH="$fake_bin:$PATH" sh "$script" "$dump" > "$test_root/restarting.out" 2>&1; then
  printf '%s\n' 'restore test failed: restarting service must block restore' >&2
  exit 1
fi
if RESTORE_SCENARIO=unknown PATH="$fake_bin:$PATH" sh "$script" "$dump" > "$test_root/unknown.out" 2>&1; then
  printf '%s\n' 'restore test failed: unknown service state must block restore' >&2
  exit 1
fi
if RESTORE_SCENARIO=nonempty PATH="$fake_bin:$PATH" sh "$script" "$dump" > "$test_root/nonempty.out" 2>&1; then
  printf '%s\n' 'restore test failed: nonempty database must block restore' >&2
  exit 1
fi
RESTORE_SCENARIO=empty PATH="$fake_bin:$PATH" sh "$script" "$dump"

cat > "$fake_bin/gzip" <<'SH'
#!/bin/sh
exit 1
SH
chmod +x "$fake_bin/gzip"
if RESTORE_SCENARIO=empty PATH="$fake_bin:$PATH" sh "$script" "$dump" > "$test_root/gzip.out" 2>&1; then
  printf '%s\n' 'restore test failed: gzip failure must fail restore' >&2
  exit 1
fi
