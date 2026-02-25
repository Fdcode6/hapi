#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FDCODE_CLOUD_URL="${FDCODE_CLOUD_URL:-http://127.0.0.1:4010}"
export FDCODE_DEVICE_TOKEN="${FDCODE_DEVICE_TOKEN:-fdcode-device-dev}"
export FDCODE_DEVICE_ID="${FDCODE_DEVICE_ID:-local-dev-machine}"
export FDCODE_ADAPTER_MODE="${FDCODE_ADAPTER_MODE:-real}"

echo "[fdcode-dev] root: ${ROOT_DIR}"
echo "[fdcode-dev] starting cloud-api + fdcode-daemon"
echo "[fdcode-dev] cloud: ${FDCODE_CLOUD_URL} deviceId: ${FDCODE_DEVICE_ID}"

cleanup() {
    if [[ -n "${CLOUD_PID:-}" ]]; then
        kill "${CLOUD_PID}" >/dev/null 2>&1 || true
    fi
    if [[ -n "${DAEMON_PID:-}" ]]; then
        kill "${DAEMON_PID}" >/dev/null 2>&1 || true
    fi
}

trap cleanup EXIT INT TERM

bun run --cwd "${ROOT_DIR}/apps/cloud-api" dev &
CLOUD_PID=$!
bun run --cwd "${ROOT_DIR}/apps/fdcode-daemon" dev &
DAEMON_PID=$!

wait "${CLOUD_PID}" "${DAEMON_PID}"
