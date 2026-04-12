#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/chrome-extension"
DIST_DIR="$ROOT_DIR/.dist"
MANIFEST_PATH="$EXT_DIR/manifest.json"
KEY_PATH="${CRX_KEY_PATH:-$DIST_DIR/nas-page-translator-extension.pem}"
BROWSER_BIN="${BROWSER_BIN:-}"

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

if [[ -z "$BROWSER_BIN" ]]; then
  for candidate in google-chrome-stable google-chrome chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      BROWSER_BIN="$(command -v "$candidate")"
      break
    fi
  done
fi

if [[ -z "$BROWSER_BIN" ]]; then
  echo "no Chrome/Chromium executable found; set BROWSER_BIN to continue" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to create a reusable CRX signing key" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

if [[ ! -f "$KEY_PATH" ]]; then
  openssl genrsa -out "$KEY_PATH" 2048 >/dev/null 2>&1
fi

PACKAGE_STEM="nas-page-translator-chrome-extension-v${VERSION}"
PACKAGE_PATH="$DIST_DIR/${PACKAGE_STEM}.crx"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

STAGE_DIR="$TMP_DIR/$PACKAGE_STEM"
cp -R "$EXT_DIR" "$STAGE_DIR"

"$BROWSER_BIN" \
  --no-message-box \
  --pack-extension="$STAGE_DIR" \
  --pack-extension-key="$KEY_PATH"

mv "$TMP_DIR/${PACKAGE_STEM}.crx" "$PACKAGE_PATH"

echo "$PACKAGE_PATH"
echo "$KEY_PATH"
