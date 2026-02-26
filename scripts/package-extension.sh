#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/mark/Desktop/projects/autoauth"
EXT_DIR="$ROOT/chrome-extension/mock-open-link"
OUT_ZIP="$ROOT/chrome-extension/ottoauth-browser-agent.zip"

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "Extension manifest not found at: $EXT_DIR/manifest.json" >&2
  exit 1
fi

rm -f "$OUT_ZIP"

(
  cd "$EXT_DIR"
  zip -r "$OUT_ZIP" . \
    -x "*.DS_Store" \
    -x "__MACOSX/*"
)

echo "Created: $OUT_ZIP"
