#!/bin/bash
# Mirror vibe-id's public-api-types.ts into autoauth so the typechecker
# catches shape drift early. Run after vibe-id changes any public response
# shape, or as part of CI before npm run build.
#
# The mirrored copy lives at src/lib/vibe-id-public-api-types.ts and is
# imported by src/lib/vibe-id-client.ts. The wire formats vibe-id-client
# constructs are checked against these types — if vibe-id renames a field,
# typecheck fails here.

set -euo pipefail

VIBE_ID_REPO_DEFAULT="$HOME/Desktop/projects/vibe-id"
VIBE_ID_REPO="${VIBE_ID_REPO:-$VIBE_ID_REPO_DEFAULT}"
SOURCE="$VIBE_ID_REPO/worker/src/public-api-types.ts"
DEST="$(dirname "$0")/../src/lib/vibe-id-public-api-types.ts"

if [ ! -f "$SOURCE" ]; then
  echo "vibe-id types file not found at $SOURCE" >&2
  echo "Set VIBE_ID_REPO=<path> to point at your local vibe-id checkout, or"
  echo "fetch the file from the vibe-id repo on github.com/Clamepending/vibe-id." >&2
  exit 1
fi

{
  echo "// AUTO-GENERATED from vibe-id/worker/src/public-api-types.ts"
  echo "// DO NOT EDIT DIRECTLY — run scripts/sync-vibe-id-types.sh to refresh."
  echo "//"
  echo "// Source: $SOURCE"
  echo "// Synced: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo ""
  cat "$SOURCE"
} > "$DEST"

echo "Wrote $DEST"
