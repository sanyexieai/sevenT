#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/chrome-extension"
DIST_DIR="$ROOT_DIR/.dist"
MANIFEST_PATH="$EXT_DIR/manifest.json"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

VERSION="$(
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST_PATH" \
    | head -n 1
)"

if [[ -z "$VERSION" ]]; then
  echo "failed to read extension version from $MANIFEST_PATH" >&2
  exit 1
fi

PACKAGE_NAME="nas-page-translator-chrome-extension-v${VERSION}.zip"
PACKAGE_PATH="$DIST_DIR/$PACKAGE_NAME"

mkdir -p "$DIST_DIR"
rm -f "$PACKAGE_PATH"

(
  cd "$EXT_DIR"
  zip -qr "$PACKAGE_PATH" .
)

echo "$PACKAGE_PATH"
