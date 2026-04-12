#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/.dist"
CARGO_TOML="$ROOT_DIR/Cargo.toml"

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

if [[ ! -f "$BINARY_PATH" ]]; then
  echo "binary not found: $BINARY_PATH" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

PACKAGE_STEM="${BINARY_NAME}-v${VERSION}-${OS_NAME}-${ARCH_NAME}-${FLAVOR}"
PACKAGE_PATH="$DIST_DIR/${PACKAGE_STEM}.tar.gz"
TMP_DIR="$(mktemp -d)"
STAGE_DIR="$TMP_DIR/$PACKAGE_STEM"

mkdir -p "$STAGE_DIR"
cp "$BINARY_PATH" "$STAGE_DIR/${BINARY_NAME}${BINARY_EXT}"

tar -C "$TMP_DIR" -czf "$PACKAGE_PATH" "$PACKAGE_STEM"
rm -rf "$TMP_DIR"

echo "$PACKAGE_PATH"
