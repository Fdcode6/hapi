#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

ROOT_DIR="${FDCODE_DEPLOY_ROOT:-$HOME/hapi}"
ENV_FILE="${FDCODE_DAEMON_ENV_FILE:-$HOME/.config/fdcode/daemon.env}"
SERVICE_NAME="${FDCODE_DAEMON_SERVICE:-fdcode-daemon.service}"

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

write_env_template() {
  cat > "$ENV_FILE" <<ENV
FDCODE_CLOUD_URL=https://your-domain.example.com
FDCODE_DEVICE_ID=$(hostname)
FDCODE_DEVICE_TOKEN=replace-with-device-token
FDCODE_DEFAULT_DRIVER=codex
FDCODE_ADAPTER_MODE=real
ENV
}

echo "[fdcode-deploy-daemon] root=$ROOT_DIR env=$ENV_FILE service=$SERVICE_NAME"

run mkdir -p "$(dirname "$ENV_FILE")"
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] create env template -> $ENV_FILE"
  else
    write_env_template
  fi
fi

run bun install --cwd "$ROOT_DIR"
run bun run --cwd "$ROOT_DIR/apps/fdcode-daemon" typecheck
run cp "$ROOT_DIR/deploy/systemd/fdcode-daemon.service" "/etc/systemd/system/$SERVICE_NAME"
run systemctl daemon-reload
run systemctl enable --now "$SERVICE_NAME"
run systemctl restart "$SERVICE_NAME"
run systemctl status --no-pager "$SERVICE_NAME"

echo "[fdcode-deploy-daemon] done"
