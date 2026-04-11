#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="ottoauth-headless-worker.service"

usage() {
  cat <<'EOF'
Usage:
  ANTHROPIC_API_KEY=sk-ant-... ./headless-worker/scripts/bootstrap.sh \
    --server https://ottoauth.vercel.app \
    --device-id raspberry-pi-worker-1 \
    --label "Raspberry Pi Worker" \
    --claim-code XXXX-XXXX-XXXX

Flags:
  --server URL              OttoAuth base URL (required)
  --device-id ID            Stable device id (required)
  --label LABEL             Human-readable device label (optional)
  --claim-code CODE         Device claim code from OttoAuth dashboard (required)
  --browser-path PATH       Chrome/Chromium path (optional, auto-detected if omitted)
  --model MODEL             Anthropic model override for the service env file
  --login-site SITE         Site to open for manual sign-in before service start (default: snackpass)
  --login-url URL           Exact URL to open for manual sign-in
  --skip-login              Do not launch the visible sign-in browser step
  --headful                 Run the service visibly instead of headless
  --keep-tabs               Reuse old tabs between tasks
  --skip-service            Pair and install deps, but do not create/start systemd user service
  --dry-run                 Validate inputs and print actions without changing anything
  --help                    Show this help
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

detect_browser_path() {
  local candidates=(
    "${BROWSER_PATH_OVERRIDE:-}"
    "${OTTOAUTH_BROWSER_PATH:-}"
    "/usr/bin/chromium-browser"
    "/usr/bin/chromium"
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/snap/bin/chromium"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

SERVER_URL=""
DEVICE_ID=""
DEVICE_LABEL=""
CLAIM_CODE=""
BROWSER_PATH_OVERRIDE=""
MODEL_OVERRIDE=""
LOGIN_SITE="snackpass"
LOGIN_URL=""
SKIP_LOGIN=0
HEADFUL=0
KEEP_TABS=0
SKIP_SERVICE=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)
      SERVER_URL="${2:-}"; shift 2 ;;
    --device-id)
      DEVICE_ID="${2:-}"; shift 2 ;;
    --label)
      DEVICE_LABEL="${2:-}"; shift 2 ;;
    --claim-code)
      CLAIM_CODE="${2:-}"; shift 2 ;;
    --browser-path)
      BROWSER_PATH_OVERRIDE="${2:-}"; shift 2 ;;
    --model)
      MODEL_OVERRIDE="${2:-}"; shift 2 ;;
    --login-site)
      LOGIN_SITE="${2:-}"; shift 2 ;;
    --login-url)
      LOGIN_URL="${2:-}"; shift 2 ;;
    --skip-login)
      SKIP_LOGIN=1; shift ;;
    --headful)
      HEADFUL=1; shift ;;
    --keep-tabs)
      KEEP_TABS=1; shift ;;
    --skip-service)
      SKIP_SERVICE=1; shift ;;
    --dry-run)
      DRY_RUN=1; shift ;;
    --help|-h)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1 ;;
  esac
done

has_graphical_session() {
  if [[ "${OSTYPE:-}" == darwin* ]]; then
    return 0
  fi
  [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]
}

if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${CLAUDE_API_KEY:-}" ]]; then
  echo "Set ANTHROPIC_API_KEY before running bootstrap." >&2
  exit 1
fi

if [[ -z "$SERVER_URL" || -z "$DEVICE_ID" || -z "$CLAIM_CODE" ]]; then
  echo "--server, --device-id, and --claim-code are required." >&2
  usage
  exit 1
fi

if [[ -z "$DEVICE_LABEL" ]]; then
  DEVICE_LABEL="$DEVICE_ID"
fi

require_cmd npm
require_cmd node

BROWSER_PATH="$(detect_browser_path || true)"
if [[ -n "$BROWSER_PATH_OVERRIDE" ]]; then
  BROWSER_PATH="$BROWSER_PATH_OVERRIDE"
fi
if [[ -z "$BROWSER_PATH" ]]; then
  echo "Could not find Chrome/Chromium. Install it first or pass --browser-path." >&2
  exit 1
fi

WORKER_HOME="${OTTOAUTH_WORKER_HOME:-$HOME/.ottoauth-headless-worker}"
SERVICE_ENV_PATH="$WORKER_HOME/service.env"
USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$USER_SYSTEMD_DIR/$SERVICE_NAME"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] Would install npm dependencies in $ROOT_DIR"
  echo "[dry-run] Would pair device $DEVICE_ID ($DEVICE_LABEL) to $SERVER_URL"
  if [[ "$SKIP_LOGIN" -eq 0 ]]; then
    if [[ -n "$LOGIN_URL" ]]; then
      echo "[dry-run] Would launch a visible sign-in browser at $LOGIN_URL"
    else
      echo "[dry-run] Would launch a visible sign-in browser for site '$LOGIN_SITE'"
    fi
  fi
  echo "[dry-run] Would write service env to $SERVICE_ENV_PATH"
  if [[ "$SKIP_SERVICE" -eq 0 ]]; then
    echo "[dry-run] Would install/start user systemd service at $SERVICE_PATH"
  fi
  exit 0
fi

mkdir -p "$WORKER_HOME" "$USER_SYSTEMD_DIR"

echo "[bootstrap] Installing headless-worker dependencies..."
(cd "$ROOT_DIR" && PATH=/opt/homebrew/bin:$PATH npm install)

echo "[bootstrap] Pairing device with OttoAuth..."
PAIR_ARGS=(./src/cli.mjs pair --server "$SERVER_URL" --device-id "$DEVICE_ID" --label "$DEVICE_LABEL" --claim-code "$CLAIM_CODE")
if [[ -n "$BROWSER_PATH" ]]; then
  PAIR_ARGS+=(--browser-path "$BROWSER_PATH")
fi
(cd "$ROOT_DIR" && PATH=/opt/homebrew/bin:$PATH node "${PAIR_ARGS[@]}")

if [[ "$SKIP_LOGIN" -eq 0 ]]; then
  if has_graphical_session; then
    echo "[bootstrap] Opening the dedicated worker browser profile so you can sign in..."
    LOGIN_ARGS=(./src/cli.mjs login --site "$LOGIN_SITE")
    if [[ -n "$LOGIN_URL" ]]; then
      LOGIN_ARGS=(./src/cli.mjs login --url "$LOGIN_URL")
    fi
    if [[ -n "$BROWSER_PATH" ]]; then
      LOGIN_ARGS+=(--browser-path "$BROWSER_PATH")
    fi
    (cd "$ROOT_DIR" && PATH=/opt/homebrew/bin:$PATH node "${LOGIN_ARGS[@]}")
  else
    echo "[bootstrap] No graphical desktop session detected, so the Snackpass sign-in window was skipped." >&2
    echo "Run this later on the device when a desktop session is available:" >&2
    if [[ -n "$LOGIN_URL" ]]; then
      echo "  cd $ROOT_DIR && PATH=/opt/homebrew/bin:\$PATH node ./src/cli.mjs login --url \"$LOGIN_URL\"" >&2
    else
      echo "  cd $ROOT_DIR && PATH=/opt/homebrew/bin:\$PATH node ./src/cli.mjs login --site \"$LOGIN_SITE\"" >&2
    fi
  fi
fi

{
  echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-${CLAUDE_API_KEY:-}}"
  echo "OTTOAUTH_BROWSER_PATH=$BROWSER_PATH"
  if [[ -n "$MODEL_OVERRIDE" ]]; then
    echo "OTTOAUTH_MODEL=$MODEL_OVERRIDE"
  fi
} > "$SERVICE_ENV_PATH"

if [[ "$SKIP_SERVICE" -eq 1 ]]; then
  echo "[bootstrap] Pairing complete. Service setup skipped."
  echo "Run manually with:"
  echo "  cd $ROOT_DIR && PATH=/opt/homebrew/bin:\$PATH npm run run"
  exit 0
fi

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=OttoAuth Headless Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
EnvironmentFile=$SERVICE_ENV_PATH
ExecStart=/bin/zsh -lc 'PATH=/opt/homebrew/bin:\$PATH npm run run'
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  echo "[bootstrap] Reloading and starting user service..."
  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME"
  systemctl --user status "$SERVICE_NAME" --no-pager || true
else
  echo "[bootstrap] systemctl not found. The worker is paired, but the service was not started automatically." >&2
  echo "Run manually with:"
  echo "  cd $ROOT_DIR && PATH=/opt/homebrew/bin:\$PATH npm run run"
  exit 0
fi

if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
fi

echo
echo "[bootstrap] Done."
echo "Config: $WORKER_HOME/config.json"
echo "Service env: $SERVICE_ENV_PATH"
echo "Logs: journalctl --user -u $SERVICE_NAME -f"
