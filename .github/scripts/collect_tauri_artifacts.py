#!/usr/bin/env python3
import argparse
import shutil
from pathlib import Path


KNOWN_SUFFIXES = (
    ".apk",
    ".aab",
    ".msi",
    ".exe",
    ".deb",
    ".rpm",
    ".dmg",
    ".appimage",
    ".pkg",
    ".app.tar.gz",
)

IGNORED_SUBSTRINGS = (
    ".sig",
    "updater",
    "baselineprofiles",
)


def is_release_asset(path: Path) -> bool:
    lower_name = path.name.lower()
    if any(lower_name.endswith(suffix) for suffix in KNOWN_SUFFIXES):
        if any(substring in lower_name for substring in IGNORED_SUBSTRINGS):
            return False
        return True
    return False


def find_candidates(root: Path, platform_id: str) -> list[Path]:
    if platform_id == "android":
        search_root = root / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs"
        if not search_root.exists():
            raise SystemExit(f"Search root does not exist: {search_root}")

        return sorted(
            path
            for path in search_root.rglob("*")
            if path.is_file() and is_release_asset(path)
        )
    else:
        search_root = root / "src-tauri" / "target"

    if not search_root.exists():
        raise SystemExit(f"Search root does not exist: {search_root}")

    return sorted(
        path
        for path in search_root.rglob("*")
        if path.is_file() and "bundle" in path.parts and is_release_asset(path)
    )


def copy_assets(root: Path, platform_id: str, output_dir_name: str) -> list[Path]:
    output_dir = root / output_dir_name
    output_dir.mkdir(parents=True, exist_ok=True)

    copied_files: list[Path] = []
    for source_path in find_candidates(root, platform_id):
        destination_path = output_dir / f"{platform_id}__{source_path.name}"
        if destination_path.exists():
            raise SystemExit(f"Artifact name collision detected: {destination_path.name}")
        shutil.copy2(source_path, destination_path)
        copied_files.append(destination_path)

    return copied_files


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect Tauri build artifacts into a release folder.")
    parser.add_argument("--platform-id", required=True, help="Platform label used as the artifact prefix.")
    parser.add_argument(
        "--output-dir",
        default="release-assets",
        help="Directory where collected assets will be copied.",
    )
    args = parser.parse_args()

    root = Path.cwd()
    copied_files = copy_assets(root, args.platform_id, args.output_dir)
    if not copied_files:
        raise SystemExit(f"No build artifacts were found for platform: {args.platform_id}")

    for path in copied_files:
        print(path.as_posix())


if __name__ == "__main__":
    main()
