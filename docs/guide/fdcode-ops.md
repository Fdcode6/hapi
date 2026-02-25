# FDCode Ops Guide

## Runtime modes

- Cloud API: public control plane API + command/event store.
- FDCode daemon: local execution plane with driver adapters (`claude`, `codex`, `gemini`).
- Mobile Expo: user-facing remote control client.

## Runtime channel (implemented architecture)

- Command pull: daemon polls `GET /v1/device-runtime/commands?limit=...`
- Command ack: daemon posts `POST /v1/device-runtime/commands/:sessionId/:commandId/ack`
- Event ingest: daemon posts `POST /v1/device-runtime/sessions/:id/events`
- User replay: mobile/web reads `GET /v1/sessions/:id/events?afterSeq=...`

> Note: This is HTTP polling + ingest (not websocket), intentionally chosen for easier self-host deployment and stable reconnect behavior.

## Self-hosting topology (Aliyun VPS + local machine)

1. Aliyun VPS runs `apps/cloud-api` (public HTTPS entry).
2. Local machine runs `apps/fdcode-daemon` (has Claude/Codex/Gemini local login state).
3. Mobile App only calls Cloud API.
4. Cloud receives command -> forwards to daemon runtime -> daemon emits events -> cloud persists/replays.

## Environment variables: where to place

### VPS (cloud-api)

Recommended file: `/etc/fdcode/cloud.env`

```bash
PORT=4010
FDCODE_ACCESS_TOKEN=fdcode-local-dev
FDCODE_JWT_SECRET=replace-with-strong-secret
FDCODE_DEVICE_TOKEN=replace-with-device-token
FDCODE_DB_PATH=/var/lib/fdcode/cloud-api.sqlite

# Bark (optional)
FDCODE_BARK_ENDPOINT=https://api.day.app/<YOUR_DEVICE_KEY>
FDCODE_BARK_GROUP=fdcode
FDCODE_BARK_SOUND=bell

# Expo Push (optional, real delivery)
FDCODE_EXPO_PUSH_ENABLED=1
FDCODE_EXPO_PUSH_ENDPOINT=https://exp.host/--/api/v2/push/send
FDCODE_EXPO_ACCESS_TOKEN=
```

Systemd service loads this env file.

### Local machine (fdcode-daemon)

Recommended file: `~/.config/fdcode/daemon.env`

```bash
FDCODE_CLOUD_URL=https://your-domain.example.com
FDCODE_DEVICE_ID=your-macbook
FDCODE_DEVICE_TOKEN=replace-with-device-token # must match VPS value
FDCODE_DEFAULT_DRIVER=codex # or claude / gemini
FDCODE_ADAPTER_MODE=real
```

Daemon startup script loads this file before `bun run --cwd apps/fdcode-daemon start`.

## Startup commands

### VPS

```bash
cd /srv/fdcode/hapi
bun install
bun run --cwd apps/cloud-api start
```

### Local machine

```bash
cd ~/hapi
bun install
bun run --cwd apps/fdcode-daemon start
```

## One-command local dev bootstrap

```bash
./scripts/fdcode-dev.sh
```

Starts `cloud-api` and `fdcode-daemon` together in current terminal.

## One-command real smoke test (3 drivers + Bark)

```bash
bun run smoke:fdcode
```

Default checks:
- `claude` / `codex` / `gemini` real CLI execution
- command dispatch + event replay
- completion push to Bark mock endpoint

Optional overrides:

```bash
FDCODE_SMOKE_DRIVERS="claude codex" bun run smoke:fdcode
FDCODE_SMOKE_BARK=0 bun run smoke:fdcode
FDCODE_SMOKE_TIMEOUT_SEC=120 bun run smoke:fdcode
```

## Driver upgrade policy

1. Pin known-good CLI versions.
2. Run adapter fixture tests before upgrade.
3. Reject unknown versions unless `allowUnsafe` override is explicitly set.
4. Roll back by downgrading adapter allowlist if regression appears.

## Health checks

- Cloud: `GET /health`
- Device liveness: heartbeat every 10 seconds
- Session stream: verify monotonic `seq` and no gaps after replay

## Recovery runbook

1. If mobile appears stale, run replay from last `seq` using `/v1/sessions/:id/events?afterSeq=<n>`.
2. If device marked offline, re-pair and heartbeat.
3. If auth loops occur, refresh token or logout/login.
4. If cloud starts after daemon, daemon will keep silent retry; wait for next poll cycle.

## Push notifications

- Register Expo token at `POST /v1/push/register`.
- Use event triggers (`ready`, `tool_request`, `error`) to send push notifications.
- Completion monitor: once assistant `message_final` is followed by `ready`, cloud sends completion push.
- Bark webhook uses `FDCODE_BARK_ENDPOINT`.
- Expo real delivery uses `FDCODE_EXPO_PUSH_ENABLED=1` and `FDCODE_EXPO_PUSH_ENDPOINT`.
