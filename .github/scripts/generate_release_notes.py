#!/usr/bin/env python3
import hashlib
import os
import pathlib
import subprocess
from datetime import datetime, timezone


PLATFORM_LABELS = {
    "android": "Android",
    "linux": "Linux",
    "windows": "Windows",
    "macos-x64": "macOS (Intel)",
    "macos-aarch64": "macOS (Apple Silicon)",
}

ARTIFACT_LABELS = {
    ".aab": "Android App Bundle",
    ".apk": "Android APK",
    ".app.tar.gz": "macOS App Archive",
    ".appimage": "AppImage",
    ".deb": "DEB",
    ".dmg": "DMG",
    ".exe": "NSIS Installer",
    ".msi": "MSI Installer",
    ".pkg": "PKG Installer",
    ".rpm": "RPM",
}


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def human_size(num_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    size = float(num_bytes)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.2f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{num_bytes} B"


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_git(args: list[str]) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def commit_lines(previous_tag: str, target_sha: str) -> list[str]:
    pretty = "%h%x09%an%x09%ad%x09%s"
    if previous_tag:
        previous_sha = run_git(["rev-list", "-n", "1", previous_tag])
        if previous_sha == target_sha:
            log_args = ["log", "-1", f"--pretty=format:{pretty}", "--date=short", target_sha]
        else:
            log_args = [
                "log",
                "--reverse",
                f"--pretty=format:{pretty}",
                "--date=short",
                f"{previous_tag}..{target_sha}",
            ]
    else:
        log_args = ["log", "--reverse", f"--pretty=format:{pretty}", "--date=short", target_sha]

    raw_output = run_git(log_args)
    return [line for line in raw_output.splitlines() if line.strip()]


def escape_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ").strip()


def parse_platform_and_name(file_name: str) -> tuple[str, str]:
    if "__" not in file_name:
        return "unknown", file_name
    platform_id, original_name = file_name.split("__", 1)
    return platform_id, original_name


def artifact_label(file_name: str) -> str:
    lower_name = file_name.lower()
    for suffix, label in sorted(ARTIFACT_LABELS.items(), key=lambda item: len(item[0]), reverse=True):
        if lower_name.endswith(suffix):
            return label
    return pathlib.Path(file_name).suffix.lstrip(".").upper() or "FILE"


def main() -> None:
    root = pathlib.Path.cwd()
    previous_tag = os.environ.get("PREVIOUS_TAG", "").strip()
    new_tag = require_env("NEW_TAG")
    release_type = require_env("RELEASE_TYPE")
    release_prerelease = os.environ.get("RELEASE_PRERELEASE", "false").strip().lower() == "true"
    version_name = require_env("VERSION_NAME")
    target_sha = require_env("TARGET_SHA")
    project_name = os.environ.get("PROJECT_NAME", "Skid Homework").strip() or "Skid Homework"
    web_instance_url = os.environ.get("WEB_INSTANCE_URL", "").strip()
    asset_dir = root / os.environ.get("ASSET_DIR", "release-assets")
    output_path = root / os.environ.get("RELEASE_NOTES_PATH", "release-notes.md")

    artifact_paths = sorted(path for path in asset_dir.glob("*") if path.is_file())

    artifact_rows = []
    for artifact_path in artifact_paths:
        platform_id, original_name = parse_platform_and_name(artifact_path.name)
        platform_label = PLATFORM_LABELS.get(platform_id, platform_id or "Unknown")
        artifact_rows.append(
            "| {platform} | {artifact_type} | `{name}` | {size} | `{checksum}` |".format(
                platform=platform_label,
                artifact_type=artifact_label(original_name),
                name=artifact_path.name,
                size=human_size(artifact_path.stat().st_size),
                checksum=sha256(artifact_path),
            )
        )

    if not artifact_rows:
        artifact_rows.append("| Unknown | FILE | `n/a` | n/a | `n/a` |")

    commit_rows = []
    for line in commit_lines(previous_tag, target_sha):
        commit, author, date_value, subject = line.split("\t", 3)
        commit_rows.append(
            f"| `{escape_cell(commit)}` | {escape_cell(author)} | "
            f"{escape_cell(date_value)} | {escape_cell(subject)} |"
        )

    if not commit_rows:
        commit_rows.append("| `n/a` | n/a | n/a | No commits were found for this release range. |")

    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    release_type_label = release_type.capitalize()
    previous_tag_value = f"`{previous_tag}`" if previous_tag else "None"
    prerelease_value = "Yes" if release_prerelease else "No"
    short_sha = run_git(["rev-parse", "--short", target_sha])

    overview_rows = [
        f"| Release title | `{project_name} {new_tag}` |",
        f"| Release type | `{release_type_label}` |",
        f"| Prerelease | `{prerelease_value}` |",
        f"| Tag | `{new_tag}` |",
        f"| Previous tag | {previous_tag_value} |",
        f"| Version | `{version_name}` |",
        f"| Commit | `{short_sha}` |",
        f"| Built at | `{built_at}` |",
    ]

    if web_instance_url:
        overview_rows.append(f"| Web instance | {web_instance_url} |")

    release_notes = "\n".join(
        [
            f"# {new_tag}",
            "",
            "## Overview",
            "",
            "| Field | Value |",
            "| --- | --- |",
            *overview_rows,
            "",
            "## Platform notes",
            "",
            "- **Android**: use the APK for direct sideloading; the AAB is included for store or internal distribution workflows.",
            "- **Linux**: AppImage is the most portable option; `.deb` and `.rpm` packages integrate better with distro package managers.",
            "- **Windows**: the NSIS installer is usually the easiest choice; the MSI is kept for manual deployment and managed environments.",
            "- **macOS**: choose the DMG matching your Mac model (`macOS (Intel)` for older Intel Macs, `macOS (Apple Silicon)` for M-series Macs).",
            "- **Project context**: these bundles are the Tauri builds of Skid Homework, so they ship the desktop/mobile shell while the web version remains available separately.",
            "",
            "## Artifacts",
            "",
            "| Platform | Artifact | File | Size | SHA256 |",
            "| --- | --- | --- | ---: | --- |",
            *artifact_rows,
            "",
            "## Commits",
            "",
            "| Commit | Author | Date | Message |",
            "| --- | --- | --- | --- |",
            *commit_rows,
            "",
        ]
    )

    output_path.write_text(release_notes, encoding="utf-8")


if __name__ == "__main__":
    main()
