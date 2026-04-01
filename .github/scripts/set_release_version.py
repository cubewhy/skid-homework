#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


def update_package_json(root: Path, version: str) -> None:
    package_json_path = root / "package.json"
    package_json = json.loads(package_json_path.read_text(encoding="utf-8"))
    package_json["version"] = version
    package_json_path.write_text(
        json.dumps(package_json, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def update_tauri_config(root: Path, version: str) -> None:
    tauri_config_path = root / "src-tauri" / "tauri.conf.json"
    tauri_config = json.loads(tauri_config_path.read_text(encoding="utf-8"))
    tauri_config["version"] = version
    tauri_config_path.write_text(
        json.dumps(tauri_config, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def update_cargo_toml(root: Path, version: str) -> None:
    cargo_toml_path = root / "src-tauri" / "Cargo.toml"
    cargo_toml = cargo_toml_path.read_text(encoding="utf-8")
    package_header = "[package]"
    package_start = cargo_toml.find(package_header)
    if package_start == -1:
        raise SystemExit("Unable to find [package] section in src-tauri/Cargo.toml")

    next_section = cargo_toml.find("\n[", package_start + len(package_header))
    if next_section == -1:
        next_section = len(cargo_toml)

    package_section = cargo_toml[package_start:next_section]
    updated_package_section, count = re.subn(
        r'(?m)^(version\s*=\s*")[^"]+(")$',
        rf'\g<1>{version}\2',
        package_section,
        count=1,
    )
    if count != 1:
        raise SystemExit("Unable to update package version in src-tauri/Cargo.toml")

    cargo_toml_path.write_text(
        cargo_toml[:package_start] + updated_package_section + cargo_toml[next_section:],
        encoding="utf-8",
    )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: set_release_version.py <version>")

    version = sys.argv[1].strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Invalid semantic version: {version}")

    root = Path.cwd()
    update_package_json(root, version)
    update_tauri_config(root, version)
    update_cargo_toml(root, version)


if __name__ == "__main__":
    main()
