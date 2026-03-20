#!/usr/bin/env python3
from pathlib import Path


IMPORT_LINE = "import java.util.Properties"
SIGNING_SNIPPET = """\

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()

if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(keystorePropertiesFile.inputStream())
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = rootProject.file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
}
"""
RELEASE_SIGNING_LINE = '            signingConfig = signingConfigs.getByName("release")'
RELEASE_MARKERS = (
    '        getByName("release") {',
    '        named("release") {',
    "        release {",
)


def ensure_import(build_gradle: str) -> str:
    if IMPORT_LINE in build_gradle:
        return build_gradle

    return f"{IMPORT_LINE}\n{build_gradle}"


def ensure_signing_block(build_gradle: str) -> str:
    if 'keystorePropertiesFile = rootProject.file("keystore.properties")' in build_gradle:
        return build_gradle

    marker = "android {"
    index = build_gradle.find(marker)
    if index == -1:
        raise SystemExit("Unable to find android block in Android build.gradle.kts")

    return build_gradle[:index] + SIGNING_SNIPPET + "\n" + build_gradle[index:]


def ensure_release_build_type(build_gradle: str) -> str:
    if RELEASE_SIGNING_LINE in build_gradle:
        return build_gradle

    for release_marker in RELEASE_MARKERS:
        if release_marker in build_gradle:
            replacement = f'{release_marker}\n{RELEASE_SIGNING_LINE}'
            return build_gradle.replace(release_marker, replacement, 1)

    raise SystemExit("Unable to find release buildType block in Android build.gradle.kts")


def main() -> None:
    build_gradle_path = Path("src-tauri/gen/android/app/build.gradle.kts")
    if not build_gradle_path.exists():
        raise SystemExit(f"Missing Android Gradle file: {build_gradle_path}")

    build_gradle = build_gradle_path.read_text(encoding="utf-8")
    build_gradle = ensure_import(build_gradle)
    build_gradle = ensure_signing_block(build_gradle)
    build_gradle = ensure_release_build_type(build_gradle)
    build_gradle_path.write_text(build_gradle, encoding="utf-8")


if __name__ == "__main__":
    main()
