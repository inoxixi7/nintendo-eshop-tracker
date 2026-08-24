#!/usr/bin/env python3
import json
import os
import re
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"compose validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key:
            fail("actual env file has an invalid assignment")
        if key in values:
            fail("actual env file has duplicate assignments")
        values[key] = value
    return values


def contains_json(value: object, needle: str) -> bool:
    return needle in json.dumps(value, separators=(",", ":"))


def main() -> None:
    if len(sys.argv) != 6:
        fail("validator received invalid arguments")
    config_path, actual_env, backup_uid, backup_gid, env_file = sys.argv[1:]
    with open(config_path, encoding="utf-8") as handle:
        config = json.load(handle)

    services = config.get("services", {})
    expected_names = ["backup", "postgres", "worker"]
    names = sorted(services)
    if names != expected_names:
        fail(f"services must be exactly {', '.join(expected_names)}, got {', '.join(names) or '(none)'}")

    for name, service in services.items():
        if service.get("ports"):
            fail(f"{name} publishes ports")
        if service.get("privileged") is True:
            fail(f"{name} is privileged")
        if service.get("network_mode") == "host":
            fail(f"{name} uses host networking")
        if contains_json(service.get("volumes", []), "docker.sock"):
            fail(f"{name} mounts docker.sock")
        if service.get("restart") != "unless-stopped":
            fail(f"{name} must restart unless-stopped")
        logging = service.get("logging", {})
        if logging.get("driver") != "json-file":
            fail(f"{name} must use json-file logging")
        options = logging.get("options", {})
        if options.get("max-size") != "10m" or options.get("max-file") != "3":
            fail(f"{name} needs bounded rotating logs")

    if re.fullmatch(r"[1-9][0-9]*:[1-9][0-9]*", str(services["backup"].get("user", ""))) is None:
        fail("backup must run as a non-root numeric UID:GID")
    if not contains_json(services["worker"].get("healthcheck", {}).get("test", []), "/tmp/nintendo-eshop-worker-ready"):
        fail("worker healthcheck needs the readiness marker")
    if not contains_json(services["backup"].get("healthcheck", {}).get("test", []), "run-backup.sh health"):
        fail("backup healthcheck must validate the successful backup marker")

    for name in expected_names:
        if "healthcheck" not in services[name]:
            fail(f"{name} needs a healthcheck")
    for name in ("worker", "backup"):
        condition = services[name].get("depends_on", {}).get("postgres", {}).get("condition")
        if condition != "service_healthy":
            fail(f"{name} must depend on healthy postgres")

    if not contains_json(services["postgres"].get("volumes", []), "/var/lib/postgresql/data"):
        fail("postgres needs persistent data mount")
    backup_volumes = services["backup"].get("volumes", [])
    if not contains_json(backup_volumes, "/backups"):
        fail("backup needs persistent backup mount")
    if not any(
        "/usr/local/bin/run-backup.sh" in str(volume.get("target", volume)) and volume.get("read_only") is True
        for volume in backup_volumes
        if isinstance(volume, dict)
    ):
        fail("backup needs read-only backup script mount")

    networks = config.get("networks", {})
    if len(networks) != 1:
        fail("stack must use exactly one private network")
    for service in services.values():
        if len(service.get("networks", {})) != 1:
            fail("every service must join the private network only")

    if actual_env != "true":
        return

    values = parse_env_file(Path(env_file))

    def required(key: str) -> str:
        if key not in values:
            fail("actual env file is missing a required value")
        return values[key]

    database = required("POSTGRES_DB")
    user = required("POSTGRES_USER")
    password = required("POSTGRES_PASSWORD")
    expected_url = f"postgresql://{user}:{password}@postgres:5432/{database}"
    postgres_env = services["postgres"].get("environment", {})
    worker_env = services["worker"].get("environment", {})
    backup_env = services["backup"].get("environment", {})
    rendered_values_match = (
        postgres_env.get("POSTGRES_DB") == database
        and postgres_env.get("POSTGRES_USER") == user
        and postgres_env.get("POSTGRES_PASSWORD") == password
        and worker_env.get("DATABASE_URL") == expected_url
        and backup_env.get("PGPASSWORD") == password
        and backup_env.get("PGDATABASE") == database
        and backup_env.get("PGUSER") == user
        and backup_env.get("BACKUP_INTERVAL_SECONDS") == required("BACKUP_INTERVAL_SECONDS")
        and backup_env.get("BACKUP_MAX_AGE_SECONDS") == required("BACKUP_MAX_AGE_SECONDS")
    )
    if not rendered_values_match:
        fail("actual env values did not render exactly")

    def bind_source(service: dict[str, object], target: str) -> str:
        for volume in service.get("volumes", []):  # type: ignore[union-attr]
            if isinstance(volume, dict) and volume.get("type") == "bind" and volume.get("target") == target:
                source = volume.get("source")
                if isinstance(source, str):
                    return source
        fail(f"{target} needs a resolved bind source")

    data_source = bind_source(services["postgres"], "/var/lib/postgresql/data")
    backup_source = bind_source(services["backup"], "/backups")
    if not os.path.isdir(data_source):
        fail(f"{data_source} must exist and be a directory")
    if not os.path.isdir(backup_source) or not os.access(backup_source, os.W_OK):
        fail(f"{backup_source} must exist and be writable")

    backup_stat = os.stat(backup_source)
    if backup_stat.st_uid != int(backup_uid) or backup_stat.st_gid != int(backup_gid):
        fail("BACKUP_DIR ownership must match BACKUP_UID:BACKUP_GID")
    if services["backup"].get("user") != f"{backup_uid}:{backup_gid}":
        fail("backup user does not match BACKUP_UID:BACKUP_GID")


if __name__ == "__main__":
    main()
