#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

sh deploy/test/compose-config.sh
sh deploy/test/preflight.sh
sh deploy/test/backup-run.sh
sh deploy/test/restore.sh
