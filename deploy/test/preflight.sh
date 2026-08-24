#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/nintendo-eshop-preflight.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
env_file="$test_root/deploy.env"
data_dir="$test_root/data"
backup_dir="$test_root/backups"
mkdir -p "$data_dir" "$backup_dir"
test_uid=$(id -u)
test_gid=$(id -g)
if [ "$test_uid" = 0 ]; then
  test_uid=1000
  test_gid=1000
  chown "$test_uid:$test_gid" "$data_dir" "$backup_dir"
fi
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"
export REAL_DOCKER="$(command -v docker)"

cat > "$fake_bin/docker" <<'SH'
#!/bin/sh
for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATA_DIR BACKUP_DIR BACKUP_UID BACKUP_GID CATALOG_CRON PRICE_CRON TZ RUN_ON_STARTUP BACKUP_INTERVAL_SECONDS BACKUP_MAX_AGE_SECONDS; do
  eval "value=\${$key-}"
  if [ -n "$value" ]; then
    printf '%s\n' 'preflight test failed: shell environment reached docker compose' >&2
    exit 42
  fi
done
exec "$REAL_DOCKER" "$@"
SH
chmod +x "$fake_bin/docker"

cat > "$env_file" <<EOF
POSTGRES_DB=nintendo_eshop
POSTGRES_USER=eshop_tracker
POSTGRES_PASSWORD=Safe_password-123
DATA_DIR=$data_dir
BACKUP_DIR=$backup_dir
BACKUP_UID=$test_uid
BACKUP_GID=$test_gid
CATALOG_CRON=0 3 * * *
PRICE_CRON=0 */6 * * *
TZ=Asia/Tokyo
RUN_ON_STARTUP=true
BACKUP_INTERVAL_SECONDS=86400
BACKUP_MAX_AGE_SECONDS=172800
EOF
chmod 600 "$env_file"

POSTGRES_PASSWORD=change-me TZ=UTC CATALOG_CRON='* * * * *' \
  PATH="$fake_bin:$PATH" sh "$repo_root/deploy/test/compose-config.sh" "$env_file"

bad_env="$test_root/placeholder.env"
sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=change-me/' "$env_file" > "$bad_env"
chmod 600 "$bad_env"
if sh "$repo_root/deploy/test/compose-config.sh" "$bad_env" > "$test_root/placeholder.out" 2>&1; then
  printf '%s\n' 'preflight test failed: password placeholder was accepted' >&2
  exit 1
fi

chmod 644 "$env_file"
if sh "$repo_root/deploy/test/compose-config.sh" "$env_file" > "$test_root/mode.out" 2>&1; then
  printf '%s\n' 'preflight test failed: actual env file without mode 0600 was accepted' >&2
  exit 1
fi
