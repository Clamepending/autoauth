#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_WORKER_HOME="${OTTOAUTH_WORKER_HOME:-$HOME/.ottoauth-headless-worker}"
SERVICE_ENV_PATH="${OTTOAUTH_SERVICE_ENV_PATH:-$DEFAULT_WORKER_HOME/service.env}"

if [[ -f "$SERVICE_ENV_PATH" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$SERVICE_ENV_PATH"
  set +a
fi

NODE_BIN="${OTTOAUTH_NODE_PATH:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Could not find a usable node binary. Set OTTOAUTH_NODE_PATH in $SERVICE_ENV_PATH." >&2
  exit 1
fi

cd "$ROOT_DIR"
exec "$NODE_BIN" ./src/cli.mjs run "$@"
