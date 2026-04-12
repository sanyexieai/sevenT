#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/.dist"
CARGO_TOML="$ROOT_DIR/Cargo.toml"
OS_UNAME="$(uname -s 2>/dev/null || echo unknown)"

if [[ ! -f "$CARGO_TOML" ]]; then
  echo "Cargo.toml not found: $CARGO_TOML" >&2
  exit 1
fi

VERSION="${APP_VERSION:-$(
  sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)"/\1/p' "$CARGO_TOML" \
    | head -n 1
)}"
OS_NAME="${TARGET_OS:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
ARCH_NAME="${TARGET_ARCH:-$(uname -m)}"
FLAVOR="${BUILD_FLAVOR:-cpu}"
BINARY_NAME="${BINARY_NAME:-nas-nllb-service}"
BINARY_EXT="${BINARY_EXT:-}"
BINARY_PATH="${BINARY_PATH:-$ROOT_DIR/target/release/${BINARY_NAME}${BINARY_EXT}}"
ARCHIVE_FORMAT="${ARCHIVE_FORMAT:-tar.gz}"

if [[ ! -f "$BINARY_PATH" ]]; then
  echo "binary not found: $BINARY_PATH" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

PACKAGE_STEM="${BINARY_NAME}-v${VERSION}-${OS_NAME}-${ARCH_NAME}-${FLAVOR}"
PACKAGE_PATH="$DIST_DIR/${PACKAGE_STEM}.${ARCHIVE_FORMAT}"
TMP_DIR="$(mktemp -d)"
STAGE_DIR="$TMP_DIR/$PACKAGE_STEM"

mkdir -p "$STAGE_DIR"
cp "$BINARY_PATH" "$STAGE_DIR/${BINARY_NAME}${BINARY_EXT}"

case "$ARCHIVE_FORMAT" in
  tar.gz)
    tar -C "$TMP_DIR" -czf "$PACKAGE_PATH" "$PACKAGE_STEM"
    ;;
  zip)
    if [[ "$OS_UNAME" == MINGW* || "$OS_UNAME" == MSYS* || "$OS_UNAME" == CYGWIN* ]]; then
      ARCHIVE_PARENT_DIR="$DIST_DIR"
      ARCHIVE_BASENAME="$(basename "$PACKAGE_PATH")"
      powershell -NoProfile -Command \
        "\$ErrorActionPreference = 'Stop'; \$stage = (Resolve-Path '$STAGE_DIR').Path; \$destDir = (Resolve-Path '$ARCHIVE_PARENT_DIR').Path; Compress-Archive -Path \$stage -DestinationPath (Join-Path \$destDir '$ARCHIVE_BASENAME') -Force"
    elif command -v zip >/dev/null 2>&1; then
      (
        cd "$TMP_DIR"
        zip -qr "$PACKAGE_PATH" "$PACKAGE_STEM"
      )
    elif command -v pwsh >/dev/null 2>&1; then
      pwsh -NoProfile -Command \
        "Compress-Archive -Path '$STAGE_DIR' -DestinationPath '$PACKAGE_PATH' -Force"
    elif command -v powershell >/dev/null 2>&1; then
      powershell -NoProfile -Command \
        "Compress-Archive -Path '$STAGE_DIR' -DestinationPath '$PACKAGE_PATH' -Force"
    else
      echo "zip packaging requires either 'zip', 'powershell', or 'pwsh'" >&2
      rm -rf "$TMP_DIR"
      exit 1
    fi
    ;;
  *)
    echo "unsupported archive format: $ARCHIVE_FORMAT" >&2
    rm -rf "$TMP_DIR"
    exit 1
    ;;
esac

rm -rf "$TMP_DIR"

echo "$PACKAGE_PATH"
