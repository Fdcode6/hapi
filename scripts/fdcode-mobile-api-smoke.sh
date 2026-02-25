#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4010}"
FDCODE_CLOUD_URL="${FDCODE_CLOUD_URL:-http://127.0.0.1:${PORT}}"
FDCODE_ACCESS_TOKEN="${FDCODE_ACCESS_TOKEN:-fdcode-local-dev}"
FDCODE_DEVICE_TOKEN="${FDCODE_DEVICE_TOKEN:-fdcode-device-dev}"

CLOUD_LOG="$(mktemp -t fdcode-mobile-cloud)"

cleanup() {
    if [[ -n "${CLOUD_PID:-}" ]]; then
        kill "${CLOUD_PID}" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT INT TERM

wait_for_health() {
    local timeout="$1"
    local started_at
    started_at="$(date +%s)"
    while true; do
        if curl -fsS "${FDCODE_CLOUD_URL}/health" >/dev/null 2>&1; then
            return 0
        fi
        if (( "$(date +%s)" - started_at >= timeout )); then
            echo "[fdcode-mobile-smoke] cloud health timeout"
            return 1
        fi
        sleep 1
    done
}

echo "[fdcode-mobile-smoke] starting cloud-api"
PORT="${PORT}" \
FDCODE_DEVICE_TOKEN="${FDCODE_DEVICE_TOKEN}" \
FDCODE_DB_PATH=":memory:" \
bun run --cwd "${ROOT_DIR}/apps/cloud-api" start >"${CLOUD_LOG}" 2>&1 &
CLOUD_PID=$!

wait_for_health 30

LOGIN_JSON="$(curl -fsS -X POST "${FDCODE_CLOUD_URL}/v1/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"accessToken\":\"${FDCODE_ACCESS_TOKEN}\"}")"
ACCESS_TOKEN="$(python3 - <<'PY' "${LOGIN_JSON}"
import json, sys
print(json.loads(sys.argv[1])["accessToken"])
PY
)"
AUTH_HEADER="authorization: Bearer ${ACCESS_TOKEN}"

SESSION_ID="mobile-smoke-$(date +%s)-$RANDOM"
COMMAND_ID="mobile-cmd-$(date +%s)-$RANDOM"
EVENT_ID="mobile-event-$(date +%s)-$RANDOM"

curl -fsS -X POST "${FDCODE_CLOUD_URL}/v1/sessions/${SESSION_ID}/commands" \
  -H "${AUTH_HEADER}" \
  -H 'content-type: application/json' \
  -d "$(python3 - <<'PY' "${COMMAND_ID}" "${SESSION_ID}"
import json, sys
print(json.dumps({
    "commandId": sys.argv[1],
    "sessionId": sys.argv[2],
    "type": "send_message",
    "payload": {"text": "mobile smoke"},
    "ttlMs": 30000
}))
PY
)" >/dev/null

curl -fsS -X POST "${FDCODE_CLOUD_URL}/v1/sessions/${SESSION_ID}/events" \
  -H "${AUTH_HEADER}" \
  -H 'content-type: application/json' \
  -d "$(python3 - <<'PY' "${EVENT_ID}" "${SESSION_ID}"
import json, sys, time
print(json.dumps({
    "eventId": sys.argv[1],
    "sessionId": sys.argv[2],
    "seq": 1,
    "type": "message_final",
    "data": {"text": "mobile event", "role": "assistant"},
    "createdAt": int(time.time() * 1000)
}))
PY
)" >/dev/null

curl -fsS "${FDCODE_CLOUD_URL}/v1/sessions" -H "${AUTH_HEADER}" >/dev/null
curl -fsS "${FDCODE_CLOUD_URL}/v1/sessions/${SESSION_ID}" -H "${AUTH_HEADER}" >/dev/null
curl -fsS "${FDCODE_CLOUD_URL}/v1/sessions/${SESSION_ID}/events?afterSeq=0" -H "${AUTH_HEADER}" >/dev/null

WS_RESULT="$(bun -e '
const cloudUrl = process.argv[1]
const token = process.argv[2]
const sessionId = process.argv[3]
const wsUrl = cloudUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + `/v1/realtime?sessionId=${encodeURIComponent(sessionId)}&afterSeq=0&accessToken=${encodeURIComponent(token)}`

const timeout = setTimeout(() => {
  console.log("timeout")
  process.exit(0)
}, 4000)

const ws = new WebSocket(wsUrl)
let hasReady = false
let hasEvent = false

ws.onmessage = (event) => {
  const frame = JSON.parse(String(event.data))
  if (frame.type === "ready") hasReady = true
  if (frame.type === "event" && frame.event && frame.event.seq === 1) hasEvent = true
  if (hasReady && hasEvent) {
    clearTimeout(timeout)
    console.log("ok")
    ws.close()
    process.exit(0)
  }
}

ws.onerror = () => {
  clearTimeout(timeout)
  console.log("error")
  process.exit(0)
}
' "${FDCODE_CLOUD_URL}" "${ACCESS_TOKEN}" "${SESSION_ID}")"

if [[ "${WS_RESULT}" != "ok" ]]; then
  echo "[fdcode-mobile-smoke] realtime ws check failed: ${WS_RESULT}"
  echo "[fdcode-mobile-smoke] cloud log: ${CLOUD_LOG}"
  exit 1
fi

echo "[fdcode-mobile-smoke] pass"
echo "[fdcode-mobile-smoke] cloud log: ${CLOUD_LOG}"
