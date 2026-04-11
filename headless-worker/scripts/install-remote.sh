#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

REPO_OWNER="${OTTOAUTH_REPO_OWNER:-Clamepending}"
REPO_NAME="${OTTOAUTH_REPO_NAME:-autoauth}"
REPO_REF="${OTTOAUTH_REPO_REF:-main}"
INSTALL_DIR="${OTTOAUTH_INSTALL_DIR:-$HOME/.local/share/ottoauth/autoauth}"
ARCHIVE_URL="${OTTOAUTH_ARCHIVE_URL:-https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_REF}.tar.gz}"

usage() {
  cat <<'EOF'
Usage:
  curl -fsSL https://raw.githubusercontent.com/Clamepending/autoauth/main/headless-worker/scripts/install-remote.sh \
    | ANTHROPIC_API_KEY=sk-ant-... bash -s -- \
        --server https://ottoauth.vercel.app \
        --device-id raspberry-pi-worker-1 \
        --label "Raspberry Pi Worker" \
        --claim-code XXXX-XXXX-XXXX

Extra flags for the remote installer:
  --install-dir PATH       Stable install directory for the OttoAuth repo
  --repo-ref REF           Git ref to install from (default: main)
  --help                   Show this help

All other flags are passed through to ./headless-worker/scripts/bootstrap.sh.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

resolve_source_dir() {
  local extracted_root="$1"
  if [[ -x "$extracted_root/headless-worker/scripts/bootstrap.sh" ]]; then
    printf '%s\n' "$extracted_root"
    return 0
  fi

  local nested_dir=""
  nested_dir="$(find "$extracted_root" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -n "$nested_dir" && -x "$nested_dir/headless-worker/scripts/bootstrap.sh" ]]; then
    printf '%s\n' "$nested_dir"
    return 0
  fi

  return 1
}

require_cmd bash
require_cmd curl
require_cmd tar
require_cmd find
require_cmd mktemp

if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${CLAUDE_API_KEY:-}" ]]; then
  echo "Set ANTHROPIC_API_KEY before running the remote installer." >&2
  exit 1
fi

BOOTSTRAP_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --repo-ref)
      REPO_REF="${2:-}"
      ARCHIVE_URL="${OTTOAUTH_ARCHIVE_URL:-https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_REF}.tar.gz}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      BOOTSTRAP_ARGS+=("$1")
      shift
      ;;
  esac
done

INSTALL_PARENT="$(dirname "$INSTALL_DIR")"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE_PATH="$TMP_DIR/autoauth.tar.gz"
EXTRACT_DIR="$TMP_DIR/extracted"

mkdir -p "$EXTRACT_DIR" "$INSTALL_PARENT"

echo "[remote-install] Downloading OttoAuth from $ARCHIVE_URL"
curl -fsSL "$ARCHIVE_URL" -o "$ARCHIVE_PATH"

echo "[remote-install] Extracting archive..."
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

SOURCE_DIR="$(resolve_source_dir "$EXTRACT_DIR" || true)"
if [[ -z "$SOURCE_DIR" ]]; then
  echo "Could not find headless-worker/scripts/bootstrap.sh in downloaded archive." >&2
  exit 1
fi

rm -rf "$INSTALL_DIR"
mv "$SOURCE_DIR" "$INSTALL_DIR"

echo "[remote-install] Installed repo to $INSTALL_DIR"
echo "[remote-install] Starting OttoAuth headless bootstrap..."

exec "$INSTALL_DIR/headless-worker/scripts/bootstrap.sh" "${BOOTSTRAP_ARGS[@]}"
