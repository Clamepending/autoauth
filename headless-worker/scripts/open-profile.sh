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

BROWSER_BIN="${OTTOAUTH_BROWSER_PATH:-}"
PROFILE_DIR="${OTTOAUTH_PROFILE_DIR:-}"
PROFILE_NAME="${OTTOAUTH_PROFILE_NAME:-}"

if [[ -z "$BROWSER_BIN" || ! -x "$BROWSER_BIN" ]]; then
  echo "Could not find a usable Chrome/Chromium binary. Set OTTOAUTH_BROWSER_PATH in $SERVICE_ENV_PATH." >&2
  exit 1
fi

if [[ -z "$PROFILE_DIR" ]]; then
  echo "OTTOAUTH_PROFILE_DIR is not set in $SERVICE_ENV_PATH. Configure a shared browser user data dir first." >&2
  exit 1
fi

URLS=("$@")
if [[ "${#URLS[@]}" -eq 0 ]]; then
  URLS=("https://order.snackpass.co/")
fi

ARGS=(--user-data-dir="$PROFILE_DIR")
if [[ -n "$PROFILE_NAME" ]]; then
  ARGS+=(--profile-directory="$PROFILE_NAME")
fi
ARGS+=("${URLS[@]}")

if [[ "${OSTYPE:-}" == darwin* ]]; then
  APP_BUNDLE="$(cd "$(dirname "$BROWSER_BIN")/../.." && pwd)"
  open -na "$APP_BUNDLE" --args "${ARGS[@]}"
else
  (
    cd "$ROOT_DIR"
    "$BROWSER_BIN" "${ARGS[@]}" >/dev/null 2>&1 &
  )
fi
