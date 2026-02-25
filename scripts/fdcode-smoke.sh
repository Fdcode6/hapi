#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PORT="${PORT:-4010}"
FDCODE_CLOUD_URL="${FDCODE_CLOUD_URL:-http://127.0.0.1:${PORT}}"
FDCODE_DEVICE_TOKEN="${FDCODE_DEVICE_TOKEN:-fdcode-device-dev}"
FDCODE_DEVICE_ID="${FDCODE_DEVICE_ID:-smoke-device}"
FDCODE_ACCESS_TOKEN="${FDCODE_ACCESS_TOKEN:-fdcode-local-dev}"
FDCODE_ADAPTER_MODE="${FDCODE_ADAPTER_MODE:-real}"
FDCODE_DEFAULT_DRIVER="${FDCODE_DEFAULT_DRIVER:-codex}"
FDCODE_SMOKE_TIMEOUT_SEC="${FDCODE_SMOKE_TIMEOUT_SEC:-90}"
FDCODE_SMOKE_DRIVERS="${FDCODE_SMOKE_DRIVERS:-claude codex gemini}"
FDCODE_SMOKE_BARK="${FDCODE_SMOKE_BARK:-1}"
FDCODE_BARK_GROUP="${FDCODE_BARK_GROUP:-fdcode-smoke}"
BARK_PORT="${BARK_PORT:-18080}"

CLOUD_LOG="$(mktemp -t fdcode-smoke-cloud)"
DAEMON_LOG="$(mktemp -t fdcode-smoke-daemon)"
BARK_LOG="$(mktemp -t fdcode-smoke-bark)"

cleanup() {
    if [[ -n "${DAEMON_PID:-}" ]]; then
        kill "${DAEMON_PID}" >/dev/null 2>&1 || true
    fi
    if [[ -n "${CLOUD_PID:-}" ]]; then
        kill "${CLOUD_PID}" >/dev/null 2>&1 || true
    fi
    if [[ -n "${BARK_PID:-}" ]]; then
        kill "${BARK_PID}" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT INT TERM

echo "[fdcode-smoke] root: ${ROOT_DIR}"
echo "[fdcode-smoke] cloud: ${FDCODE_CLOUD_URL}"
echo "[fdcode-smoke] drivers: ${FDCODE_SMOKE_DRIVERS}"

for driver in ${FDCODE_SMOKE_DRIVERS}; do
    if ! command -v "${driver}" >/dev/null 2>&1; then
        echo "[fdcode-smoke] missing CLI: ${driver}"
        exit 1
    fi
done

wait_for_health() {
    local timeout="$1"
    local started_at
    started_at="$(date +%s)"
    while true; do
        if curl -fsS "${FDCODE_CLOUD_URL}/health" >/dev/null 2>&1; then
            return 0
        fi
        if (( "$(date +%s)" - started_at >= timeout )); then
            echo "[fdcode-smoke] cloud health timeout"
            return 1
        fi
        sleep 1
    done
}

if [[ "${FDCODE_SMOKE_BARK}" == "1" ]]; then
    python3 - <<'PY' "${BARK_LOG}" "${BARK_PORT}" >/tmp/fdcode-smoke-bark-server.out 2>&1 &
import http.server, socketserver, sys
log_path = sys.argv[1]
port = int(sys.argv[2])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(self.path + "\n")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        return

with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
    httpd.serve_forever()
PY
    BARK_PID=$!
    export FDCODE_BARK_ENDPOINT="http://127.0.0.1:${BARK_PORT}/device-key"
fi

PORT="${PORT}" \
FDCODE_DEVICE_TOKEN="${FDCODE_DEVICE_TOKEN}" \
FDCODE_BARK_GROUP="${FDCODE_BARK_GROUP}" \
bun run --cwd "${ROOT_DIR}/apps/cloud-api" start >"${CLOUD_LOG}" 2>&1 &
CLOUD_PID=$!

wait_for_health 30

FDCODE_CLOUD_URL="${FDCODE_CLOUD_URL}" \
FDCODE_DEVICE_TOKEN="${FDCODE_DEVICE_TOKEN}" \
FDCODE_DEVICE_ID="${FDCODE_DEVICE_ID}" \
FDCODE_ADAPTER_MODE="${FDCODE_ADAPTER_MODE}" \
FDCODE_DEFAULT_DRIVER="${FDCODE_DEFAULT_DRIVER}" \
bun run --cwd "${ROOT_DIR}/apps/fdcode-daemon" start >"${DAEMON_LOG}" 2>&1 &
DAEMON_PID=$!

sleep 2

LOGIN_JSON="$(curl -fsS -X POST "${FDCODE_CLOUD_URL}/v1/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"accessToken\":\"${FDCODE_ACCESS_TOKEN}\"}")"
ACCESS_TOKEN="$(python3 - <<'PY' "${LOGIN_JSON}"
import json, sys
print(json.loads(sys.argv[1])["accessToken"])
PY
)"
AUTH_HEADER="authorization: Bearer ${ACCESS_TOKEN}"

pass_count=0
fail_count=0
bark_expected_count=0

run_driver() {
    local driver="$1"
    local expected="$2"
    local session_id="smoke-${driver}-$(date +%s)-$RANDOM"
    local command_id="c-$(date +%s)-$RANDOM"
    local prompt="reply exactly: ${expected}"

    local payload
    payload="$(python3 - <<'PY' "${command_id}" "${session_id}" "${driver}" "${prompt}"
import json, sys
print(json.dumps({
    "commandId": sys.argv[1],
    "sessionId": sys.argv[2],
    "driver": sys.argv[3],
    "type": "send_message",
    "payload": {"text": sys.argv[4]},
    "ttlMs": 30000
}))
PY
)"

    curl -fsS -X POST "${FDCODE_CLOUD_URL}/v1/sessions/${session_id}/commands" \
        -H "${AUTH_HEADER}" \
        -H 'content-type: application/json' \
        -d "${payload}" >/dev/null

    local started_at
    started_at="$(date +%s)"
    while true; do
        local events_json
        events_json="$(curl -fsS "${FDCODE_CLOUD_URL}/v1/sessions/${session_id}/events?afterSeq=0" -H "${AUTH_HEADER}")"
        local ready_and_text
        ready_and_text="$(python3 - <<'PY' "${events_json}"
import json, sys
events = json.loads(sys.argv[1]).get("events", [])
ready = any(e.get("type") == "ready" for e in events)
final = None
for e in events:
    if e.get("type") == "message_final":
        final = (e.get("data") or {}).get("text")
print(("1" if ready else "0") + "|" + (final or ""))
PY
)"

        local ready="${ready_and_text%%|*}"
        local final_text="${ready_and_text#*|}"
        if [[ "${ready}" == "1" ]]; then
            if [[ "${final_text}" == "${expected}" ]]; then
                echo "[fdcode-smoke] ${driver} ok -> ${final_text}"
                pass_count=$((pass_count + 1))
                bark_expected_count=$((bark_expected_count + 1))
            else
                echo "[fdcode-smoke] ${driver} mismatch: expected=${expected}, got=${final_text}"
                fail_count=$((fail_count + 1))
            fi
            return
        fi

        if (( "$(date +%s)" - started_at >= FDCODE_SMOKE_TIMEOUT_SEC )); then
            echo "[fdcode-smoke] ${driver} timeout waiting ready"
            fail_count=$((fail_count + 1))
            return
        fi
        sleep 1
    done
}

for driver in ${FDCODE_SMOKE_DRIVERS}; do
    case "${driver}" in
        claude)
            run_driver "${driver}" "CLAUDE_SMOKE_OK"
            ;;
        codex)
            run_driver "${driver}" "CODEX_SMOKE_OK"
            ;;
        gemini)
            run_driver "${driver}" "GEMINI_SMOKE_OK"
            ;;
        *)
            echo "[fdcode-smoke] unknown driver: ${driver}"
            fail_count=$((fail_count + 1))
            ;;
    esac
done

# approve_tool smoke path (tool_result replay)
approve_session_id="smoke-approve-$(date +%s)-$RANDOM"
approve_payload="$(python3 - <<'PY' "${approve_session_id}" "${FDCODE_DEFAULT_DRIVER}"
import json, sys
print(json.dumps({
    "commandId": f"approve-{sys.argv[1]}",
    "sessionId": sys.argv[1],
    "driver": sys.argv[2],
    "type": "approve_tool",
    "payload": {
        "requestId": "smoke-approve-request",
        "approved": True,
        "reason": "smoke-auto-approve"
    },
    "ttlMs": 30000
}))
PY
)"

curl -fsS -X POST "${FDCODE_CLOUD_URL}/v1/sessions/${approve_session_id}/commands" \
    -H "${AUTH_HEADER}" \
    -H 'content-type: application/json' \
    -d "${approve_payload}" >/dev/null

approve_started_at="$(date +%s)"
while true; do
    approve_events_json="$(curl -fsS "${FDCODE_CLOUD_URL}/v1/sessions/${approve_session_id}/events?afterSeq=0" -H "${AUTH_HEADER}")"
    approve_ok="$(python3 - <<'PY' "${approve_events_json}"
import json, sys
events = json.loads(sys.argv[1]).get("events", [])
print("1" if any(e.get("type") == "tool_result" for e in events) else "0")
PY
)"

    if [[ "${approve_ok}" == "1" ]]; then
        echo "[fdcode-smoke] approve flow ok"
        pass_count=$((pass_count + 1))
        break
    fi

    if (( "$(date +%s)" - approve_started_at >= FDCODE_SMOKE_TIMEOUT_SEC )); then
        echo "[fdcode-smoke] approve flow timeout"
        fail_count=$((fail_count + 1))
        break
    fi

    sleep 1
done

if [[ "${FDCODE_SMOKE_BARK}" == "1" ]]; then
    sleep 1
    bark_hits="$(wc -l <"${BARK_LOG}" | tr -d ' ')"
    echo "[fdcode-smoke] bark hits: ${bark_hits}"
    if [[ "${bark_hits}" -lt "${bark_expected_count}" ]]; then
        echo "[fdcode-smoke] bark push check failed"
        fail_count=$((fail_count + 1))
    fi
fi

echo "[fdcode-smoke] pass=${pass_count} fail=${fail_count}"
echo "[fdcode-smoke] cloud log: ${CLOUD_LOG}"
echo "[fdcode-smoke] daemon log: ${DAEMON_LOG}"
if [[ "${FDCODE_SMOKE_BARK}" == "1" ]]; then
    echo "[fdcode-smoke] bark log: ${BARK_LOG}"
fi

if [[ "${fail_count}" -ne 0 ]]; then
    exit 1
fi
