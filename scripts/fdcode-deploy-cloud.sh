#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

ROOT_DIR="${FDCODE_DEPLOY_ROOT:-/srv/fdcode/hapi}"
ENV_FILE="${FDCODE_CLOUD_ENV_FILE:-/etc/fdcode/cloud.env}"
SERVICE_NAME="${FDCODE_CLOUD_SERVICE:-fdcode-cloud.service}"

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
  cat > "$ENV_FILE" <<'ENV'
PORT=4010
FDCODE_ACCESS_TOKEN=fdcode-local-dev
FDCODE_JWT_SECRET=replace-with-strong-secret
FDCODE_DEVICE_TOKEN=replace-with-device-token
FDCODE_DB_PATH=/var/lib/fdcode/cloud-api.sqlite
FDCODE_EXPO_PUSH_ENABLED=1
FDCODE_EXPO_PUSH_ENDPOINT=https://exp.host/--/api/v2/push/send
FDCODE_EXPO_ACCESS_TOKEN=
FDCODE_BARK_ENDPOINT=
ENV
}

echo "[fdcode-deploy-cloud] root=$ROOT_DIR env=$ENV_FILE service=$SERVICE_NAME"

run mkdir -p "$(dirname "$ENV_FILE")"
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] create env template -> $ENV_FILE"
  else
    write_env_template
  fi
fi

run bun install --cwd "$ROOT_DIR"
run bun run --cwd "$ROOT_DIR/apps/cloud-api" typecheck
run cp "$ROOT_DIR/deploy/systemd/fdcode-cloud.service" "/etc/systemd/system/$SERVICE_NAME"
run systemctl daemon-reload
run systemctl enable --now "$SERVICE_NAME"
run systemctl restart "$SERVICE_NAME"
run systemctl status --no-pager "$SERVICE_NAME"

echo "[fdcode-deploy-cloud] done"
