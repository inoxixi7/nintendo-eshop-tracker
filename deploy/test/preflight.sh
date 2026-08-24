#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/nintendo-eshop-preflight.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
env_file="$test_root/deploy.env"
data_dir="$test_root/data"
backup_dir="$test_root/backups"
mkdir -p "$data_dir" "$backup_dir"

cat > "$env_file" <<EOF
POSTGRES_DB=nintendo_eshop
POSTGRES_USER=eshop_tracker
POSTGRES_PASSWORD=Safe_password-123
DATA_DIR=$data_dir
BACKUP_DIR=$backup_dir
BACKUP_UID=$(id -u)
BACKUP_GID=$(id -g)
CATALOG_CRON=0 3 * * *
PRICE_CRON=0 */6 * * *
TZ=Asia/Tokyo
RUN_ON_STARTUP=true
BACKUP_INTERVAL_SECONDS=86400
BACKUP_MAX_AGE_SECONDS=172800
EOF
chmod 600 "$env_file"

sh "$repo_root/deploy/test/compose-config.sh" "$env_file"

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
