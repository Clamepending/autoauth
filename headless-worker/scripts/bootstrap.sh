#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="ottoauth-headless-worker.service"
LAUNCH_AGENT_LABEL="com.ottoauth.headless-worker"
SERVICE_RUNNER="$ROOT_DIR/scripts/run-service.sh"

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
  --profile-dir PATH        Chrome/Chromium user data dir to reuse for the worker
  --profile-name NAME       Chrome profile directory name inside the user data dir (for example: Default)
  --model MODEL             Anthropic model override for the service env file
  --login-site SITE[,SITE]  Site alias list to open for manual sign-in before service start (default: snackpass)
  --login-url URL           Exact URL to open for manual sign-in
  --skip-login              Do not launch the visible sign-in browser step
  --headful                 Run the service visibly instead of headless
  --keep-tabs               Reuse old tabs between tasks
  --skip-service            Pair and install deps, but do not create/start the background service
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

detect_shell_path() {
  local candidates=(
    "${SHELL:-}"
    "/bin/zsh"
    "/usr/bin/zsh"
    "/bin/bash"
    "/usr/bin/bash"
    "/bin/sh"
    "/usr/bin/sh"
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

detect_browser_path() {
  local candidates=(
    "${BROWSER_PATH_OVERRIDE:-}"
    "${OTTOAUTH_BROWSER_PATH:-}"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/usr/bin/chromium-browser"
    "/usr/bin/chromium"
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/snap/bin/chromium"
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

is_macos() {
  [[ "${OSTYPE:-}" == darwin* ]]
}

has_graphical_session() {
  if is_macos; then
    return 0
  fi
  [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]
}

shell_escape() {
  printf '%q' "$1"
}

write_env_line() {
  local key="$1"
  local value="$2"
  printf '%s=' "$key"
  printf '%q\n' "$value"
}

run_in_worker_env() {
  local env_args=(
    "PATH=/opt/homebrew/bin:/usr/local/bin:$PATH"
    "OTTOAUTH_WORKER_HOME=$WORKER_HOME"
  )
  if [[ -n "$PROFILE_DIR_OVERRIDE" ]]; then
    env_args+=("OTTOAUTH_PROFILE_DIR=$PROFILE_DIR_OVERRIDE")
  fi
  if [[ -n "$PROFILE_NAME_OVERRIDE" ]]; then
    env_args+=("OTTOAUTH_PROFILE_NAME=$PROFILE_NAME_OVERRIDE")
  fi
  (
    cd "$ROOT_DIR"
    env "${env_args[@]}" "$@"
  )
}

print_manual_run_command() {
  echo "  OTTOAUTH_SERVICE_ENV_PATH=$(shell_escape "$SERVICE_ENV_PATH") $(shell_escape "$SERVICE_RUNNER")"
}

print_manual_login_command() {
  local command="cd $(shell_escape "$ROOT_DIR") && OTTOAUTH_WORKER_HOME=$(shell_escape "$WORKER_HOME")"
  if [[ -n "$PROFILE_DIR_OVERRIDE" ]]; then
    command="$command OTTOAUTH_PROFILE_DIR=$(shell_escape "$PROFILE_DIR_OVERRIDE")"
  fi
  if [[ -n "$PROFILE_NAME_OVERRIDE" ]]; then
    command="$command OTTOAUTH_PROFILE_NAME=$(shell_escape "$PROFILE_NAME_OVERRIDE")"
  fi
  command="$command PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH node ./src/cli.mjs login"
  if [[ -n "$LOGIN_URL" ]]; then
    command="$command --url $(shell_escape "$LOGIN_URL")"
  else
    command="$command --site $(shell_escape "$LOGIN_SITE")"
  fi
  echo "  $command" >&2
}

SERVER_URL=""
DEVICE_ID=""
DEVICE_LABEL=""
CLAIM_CODE=""
BROWSER_PATH_OVERRIDE=""
PROFILE_DIR_OVERRIDE="${OTTOAUTH_PROFILE_DIR:-}"
PROFILE_NAME_OVERRIDE="${OTTOAUTH_PROFILE_NAME:-}"
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
    --profile-dir)
      PROFILE_DIR_OVERRIDE="${2:-}"; shift 2 ;;
    --profile-name)
      PROFILE_NAME_OVERRIDE="${2:-}"; shift 2 ;;
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

if is_macos && [[ -n "$PROFILE_DIR_OVERRIDE" && -z "$PROFILE_NAME_OVERRIDE" ]]; then
  PROFILE_NAME_OVERRIDE="Default"
fi

require_cmd npm
require_cmd node
if [[ "$SKIP_SERVICE" -eq 0 && is_macos ]]; then
  require_cmd launchctl
fi

NODE_BIN="$(command -v node)"
BROWSER_PATH="$(detect_browser_path || true)"
WORKER_SHELL="$(detect_shell_path || true)"
if [[ -n "$BROWSER_PATH_OVERRIDE" ]]; then
  BROWSER_PATH="$BROWSER_PATH_OVERRIDE"
fi
if [[ -z "$BROWSER_PATH" ]]; then
  echo "Could not find Chrome/Chromium. Install it first or pass --browser-path." >&2
  exit 1
fi
if [[ -z "$WORKER_SHELL" ]]; then
  echo "Could not find a usable shell for the OttoAuth worker service." >&2
  exit 1
fi

WORKER_HOME="${OTTOAUTH_WORKER_HOME:-$HOME/.ottoauth-headless-worker}"
SERVICE_ENV_PATH="$WORKER_HOME/service.env"
USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$USER_SYSTEMD_DIR/$SERVICE_NAME"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_PATH="$LAUNCH_AGENTS_DIR/$LAUNCH_AGENT_LABEL.plist"
LAUNCH_AGENT_LOG_DIR="$HOME/Library/Logs/ottoauth-headless-worker"
LAUNCH_AGENT_STDOUT_PATH="$LAUNCH_AGENT_LOG_DIR/stdout.log"
LAUNCH_AGENT_STDERR_PATH="$LAUNCH_AGENT_LOG_DIR/stderr.log"
LAUNCH_AGENT_DOMAIN="gui/$(id -u)"

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
    if is_macos; then
      echo "[dry-run] Would install/start macOS LaunchAgent at $LAUNCH_AGENT_PATH"
    else
      echo "[dry-run] Would install/start user systemd service at $SERVICE_PATH"
    fi
  fi
  exit 0
fi

mkdir -p "$WORKER_HOME"
if is_macos; then
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LAUNCH_AGENT_LOG_DIR"
else
  mkdir -p "$USER_SYSTEMD_DIR"
fi

echo "[bootstrap] Installing headless-worker dependencies..."
run_in_worker_env npm install

echo "[bootstrap] Pairing device with OttoAuth..."
PAIR_ARGS=(./src/cli.mjs pair --server "$SERVER_URL" --device-id "$DEVICE_ID" --label "$DEVICE_LABEL" --claim-code "$CLAIM_CODE")
if [[ -n "$BROWSER_PATH" ]]; then
  PAIR_ARGS+=(--browser-path "$BROWSER_PATH")
fi
run_in_worker_env node "${PAIR_ARGS[@]}"

if [[ "$SKIP_LOGIN" -eq 0 ]]; then
  if has_graphical_session; then
    echo "[bootstrap] Opening the worker browser profile so you can sign in..."
    LOGIN_ARGS=(./src/cli.mjs login --site "$LOGIN_SITE")
    if [[ -n "$LOGIN_URL" ]]; then
      LOGIN_ARGS=(./src/cli.mjs login --url "$LOGIN_URL")
    fi
    if [[ -n "$BROWSER_PATH" ]]; then
      LOGIN_ARGS+=(--browser-path "$BROWSER_PATH")
    fi
    run_in_worker_env node "${LOGIN_ARGS[@]}"
  else
    echo "[bootstrap] No graphical desktop session detected, so the sign-in window was skipped." >&2
    echo "Run this later on the device when a desktop session is available:" >&2
    print_manual_login_command
  fi
fi

{
  write_env_line ANTHROPIC_API_KEY "${ANTHROPIC_API_KEY:-${CLAUDE_API_KEY:-}}"
  write_env_line OTTOAUTH_WORKER_HOME "$WORKER_HOME"
  write_env_line OTTOAUTH_NODE_PATH "$NODE_BIN"
  write_env_line OTTOAUTH_BROWSER_PATH "$BROWSER_PATH"
  if [[ -n "$PROFILE_DIR_OVERRIDE" ]]; then
    write_env_line OTTOAUTH_PROFILE_DIR "$PROFILE_DIR_OVERRIDE"
  fi
  if [[ -n "$PROFILE_NAME_OVERRIDE" ]]; then
    write_env_line OTTOAUTH_PROFILE_NAME "$PROFILE_NAME_OVERRIDE"
  fi
  if is_macos && [[ -n "$PROFILE_DIR_OVERRIDE" ]]; then
    write_env_line OTTOAUTH_USE_MOCK_KEYCHAIN "0"
  fi
  if [[ "$HEADFUL" -eq 1 ]]; then
    write_env_line OTTOAUTH_HEADFUL "1"
    if ! is_macos; then
      DISPLAY_VALUE="${DISPLAY:-}"
      if [[ -z "$DISPLAY_VALUE" && -S "/tmp/.X11-unix/X0" ]]; then
        DISPLAY_VALUE=":0"
      fi
      if [[ -n "$DISPLAY_VALUE" ]]; then
        write_env_line DISPLAY "$DISPLAY_VALUE"
      fi

      XAUTHORITY_VALUE="${XAUTHORITY:-}"
      if [[ -z "$XAUTHORITY_VALUE" && -f "$HOME/.Xauthority" ]]; then
        XAUTHORITY_VALUE="$HOME/.Xauthority"
      fi
      if [[ -n "$XAUTHORITY_VALUE" ]]; then
        write_env_line XAUTHORITY "$XAUTHORITY_VALUE"
      fi
    fi
  fi
  if [[ "$KEEP_TABS" -eq 1 ]]; then
    write_env_line OTTOAUTH_KEEP_TABS "1"
  fi
  if [[ -n "$MODEL_OVERRIDE" ]]; then
    write_env_line OTTOAUTH_MODEL "$MODEL_OVERRIDE"
  fi
} > "$SERVICE_ENV_PATH"

if [[ "$SKIP_SERVICE" -eq 1 ]]; then
  echo "[bootstrap] Pairing complete. Service setup skipped."
  echo "Run manually with:"
  print_manual_run_command
  exit 0
fi

if is_macos; then
  cat > "$LAUNCH_AGENT_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCH_AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$SERVICE_RUNNER</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OTTOAUTH_SERVICE_ENV_PATH</key>
    <string>$SERVICE_ENV_PATH</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LAUNCH_AGENT_STDOUT_PATH</string>
  <key>StandardErrorPath</key>
  <string>$LAUNCH_AGENT_STDERR_PATH</string>
</dict>
</plist>
EOF

  echo "[bootstrap] Reloading and starting macOS LaunchAgent..."
  launchctl bootout "$LAUNCH_AGENT_DOMAIN" "$LAUNCH_AGENT_PATH" >/dev/null 2>&1 || true
  launchctl bootstrap "$LAUNCH_AGENT_DOMAIN" "$LAUNCH_AGENT_PATH"
  launchctl kickstart -k "$LAUNCH_AGENT_DOMAIN/$LAUNCH_AGENT_LABEL"
else
  SYSTEMD_SERVICE_RUNNER="$(shell_escape "$SERVICE_RUNNER")"
  SYSTEMD_SERVICE_ENV_PATH="$(shell_escape "$SERVICE_ENV_PATH")"

  cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=OttoAuth Headless Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
ExecStart=$WORKER_SHELL -lc 'OTTOAUTH_SERVICE_ENV_PATH=$SYSTEMD_SERVICE_ENV_PATH $SYSTEMD_SERVICE_RUNNER'
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
    print_manual_run_command
    exit 0
  fi
fi

if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
fi

echo
echo "[bootstrap] Done."
echo "Config: $WORKER_HOME/config.json"
echo "Service env: $SERVICE_ENV_PATH"
if is_macos; then
  echo "LaunchAgent: $LAUNCH_AGENT_PATH"
  echo "Logs: tail -f $LAUNCH_AGENT_STDOUT_PATH"
else
  echo "Logs: journalctl --user -u $SERVICE_NAME -f"
fi
