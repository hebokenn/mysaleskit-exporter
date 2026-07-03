#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-v0.1.0}"
APP_NAME="MySalesKit导出工具"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
RELEASE_DIR="$BUILD_DIR/${APP_NAME}-${VERSION}"
ZIP_PATH="$ROOT_DIR/dist/mysaleskit-exporter-${VERSION}.zip"

cd "$ROOT_DIR"
rm -rf "$BUILD_DIR" "$APP_NAME.app"
mkdir -p "$RELEASE_DIR" "$ROOT_DIR/dist"

osacompile -o "$APP_NAME.app" scripts/mysaleskit_app_launcher.applescript
codesign --force --deep --sign - "$APP_NAME.app" >/dev/null

cp -R "$APP_NAME.app" "$RELEASE_DIR/"
cp -R scripts launchd "$RELEASE_DIR/"
cp package.json package-lock.json README.md SECURITY.md LICENSE "$RELEASE_DIR/"

rm -rf "$RELEASE_DIR/scripts/package_release.sh"
find "$RELEASE_DIR" -name ".DS_Store" -delete

rm -f "$ZIP_PATH"
(cd "$BUILD_DIR" && /usr/bin/zip -qry -X "$ZIP_PATH" "$(basename "$RELEASE_DIR")")
codesign --verify --deep --strict "$APP_NAME.app"

printf '%s\n' "$ZIP_PATH"
