#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec "$ROOT_DIR/scripts/bootstrap.sh" \
  --profile-dir "$HOME/Library/Application Support/Google Chrome" \
  --profile-name "${OTTOAUTH_PROFILE_NAME:-Default}" \
  --headful \
  "$@"
