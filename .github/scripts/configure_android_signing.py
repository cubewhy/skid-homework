#!/usr/bin/env python3
import argparse
import re
from pathlib import Path


PROPERTIES_MARKER = 'val releaseKeystorePropertiesFile = rootProject.file("keystore.properties")'
CONFIG_MARKER = 'keyAlias = releaseKeystoreProperties.getProperty("keyAlias")'
BINDING_MARKER = 'signingConfig = signingConfigs.getByName("release")'

PROPERTIES_BLOCK = """\
val releaseKeystorePropertiesFile = rootProject.file("keystore.properties")
val releaseKeystoreProperties = Properties().apply {
    releaseKeystorePropertiesFile.inputStream().use { load(it) }
}

"""


def configure_signing(build_gradle: str) -> str:
    managed_markers = (
        PROPERTIES_MARKER in build_gradle,
        CONFIG_MARKER in build_gradle,
        BINDING_MARKER in build_gradle,
    )
    if all(managed_markers):
        if "import java.util.Properties" in build_gradle:
            return build_gradle
        return f"import java.util.Properties\n{build_gradle}"
    if any(managed_markers):
        raise ValueError("Android build.gradle.kts contains a partial CI signing configuration.")

    android_match = re.search(r"^(?P<indent>[ \t]*)android\s*\{[ \t]*$", build_gradle, re.MULTILINE)
    if not android_match:
        raise ValueError("Unable to find the android block in Android build.gradle.kts.")

    build_types_match = re.search(
        r"^(?P<indent>[ \t]+)buildTypes\s*\{[ \t]*$",
        build_gradle[android_match.end():],
        re.MULTILINE,
    )
    if not build_types_match:
        raise ValueError("Unable to find the buildTypes block in Android build.gradle.kts.")
    build_types_start = android_match.end() + build_types_match.start()
    build_types_indent = build_types_match.group("indent")

    release_match = re.search(
        r'^(?P<indent>[ \t]+)(?:getByName\("release"\)|named\("release"\)|release)\s*\{[ \t]*$',
        build_gradle[build_types_start:],
        re.MULTILINE,
    )
    if not release_match:
        raise ValueError("Unable to find the release buildType block in Android build.gradle.kts.")
    release_line_end = build_types_start + release_match.end()
    release_indent = release_match.group("indent")
    if len(release_indent.expandtabs(4)) <= len(build_types_indent.expandtabs(4)):
        raise ValueError("The release buildType is not nested inside the buildTypes block.")

    signing_config = (
        f'{build_types_indent}signingConfigs {{\n'
        f'{build_types_indent}    create("release") {{\n'
        f'{build_types_indent}        keyAlias = releaseKeystoreProperties.getProperty("keyAlias")\n'
        f'{build_types_indent}        keyPassword = releaseKeystoreProperties.getProperty("keyPassword")\n'
        f'{build_types_indent}        storeFile = file(releaseKeystoreProperties.getProperty("storeFile"))\n'
        f'{build_types_indent}        storePassword = releaseKeystoreProperties.getProperty("storePassword")\n'
        f'{build_types_indent}    }}\n'
        f'{build_types_indent}}}\n'
    )

    configured = build_gradle
    if "import java.util.Properties" not in configured:
        configured = f"import java.util.Properties\n{configured}"
        import_length = len("import java.util.Properties\n")
        android_match_start = android_match.start() + import_length
        build_types_start += import_length
        release_line_end += import_length
    else:
        android_match_start = android_match.start()

    configured = configured[:android_match_start] + PROPERTIES_BLOCK + configured[android_match_start:]
    property_length = len(PROPERTIES_BLOCK)
    build_types_start += property_length
    release_line_end += property_length

    configured = configured[:build_types_start] + signing_config + configured[build_types_start:]
    release_line_end += len(signing_config)
    signing_line = f'\n{release_indent}    {BINDING_MARKER}'
    return configured[:release_line_end] + signing_line + configured[release_line_end:]


def configure_signing_file(build_gradle_path: Path) -> None:
    try:
        original = build_gradle_path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ValueError(f"Missing Android Gradle file: {build_gradle_path}") from error
    configured = configure_signing(original)
    if configured != original:
        build_gradle_path.write_text(configured, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Configure generated Android release signing.")
    parser.add_argument(
        "--build-gradle",
        type=Path,
        default=Path("src-tauri/gen/android/app/build.gradle.kts"),
    )
    args = parser.parse_args()

    try:
        configure_signing_file(args.build_gradle)
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
