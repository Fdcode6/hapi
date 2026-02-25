# FDCode Cloud-Control + Local-Execution Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a stable personal-use yet production-grade architecture with cloud control plane, local `fdcode` execution daemon, and Expo mobile app with near-invisible reconnect/auth behavior.

**Architecture:** Split system into three planes: `cloud-api` (auth/routing/event store/push), `fdcode-daemon` (local agent drivers + permission gateway), and `mobile-expo` (UX + realtime + silent recovery). Use append-only event stream with monotonic `seq`, idempotent commands, and cursor-based replay for reconnection.

**Tech Stack:** Bun workspaces, TypeScript strict, Hono/Fastify-style HTTP, WebSocket realtime channel, PostgreSQL (primary), optional Redis (ephemeral), Expo React Native, Vitest.

> **Scope update (2026-02-25):** OpenCode adapter removed. Active drivers are `claude`, `codex`, `gemini`.
>
> **Implementation update (2026-02-25):** Device control plane switched from WebSocket to authenticated HTTP runtime channel (`/v1/device-runtime/*`) with polling + event ingest. This keeps NAT/self-host deployment simpler and improved operational stability for single-user scenarios.

---

### Task 1: Monorepo scaffolding for new architecture

**Files:**
- Create: `apps/cloud-api/package.json`
- Create: `apps/fdcode-daemon/package.json`
- Create: `apps/mobile-expo/package.json`
- Create: `packages/protocol/package.json`
- Modify: `package.json`
- Test: `apps/cloud-api/src/__tests__/health.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'

describe('health', () => {
    it('returns ok', async () => {
        const res = await fetch('http://localhost:4010/health')
        expect(res.status).toBe(200)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/cloud-api/src/__tests__/health.test.ts`
Expected: FAIL because app not scaffolded.

**Step 3: Write minimal implementation**

Create minimal `cloud-api` health endpoint (`GET /health -> { status: "ok" }`) and workspace scripts.

**Step 4: Run test to verify it passes**

Run: `bun test apps/cloud-api/src/__tests__/health.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json apps/cloud-api apps/fdcode-daemon apps/mobile-expo packages/protocol
git commit -m "chore: scaffold fdcode platform workspaces"
```

---

### Task 2: Protocol package (commands/events/cursor contracts)

**Files:**
- Create: `packages/protocol/src/command.ts`
- Create: `packages/protocol/src/event.ts`
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/__tests__/schemas.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { CommandEnvelopeSchema } from '../command'

it('accepts send_message command envelope', () => {
  const parsed = CommandEnvelopeSchema.safeParse({
    commandId: 'c1',
    sessionId: 's1',
    type: 'send_message',
    payload: { text: 'hello' },
    ttlMs: 30000
  })
  expect(parsed.success).toBe(true)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/protocol/src/__tests__/schemas.test.ts`
Expected: FAIL because schemas do not exist.

**Step 3: Write minimal implementation**

Implement strict zod schemas for:
- `CommandEnvelope`
- `EventEnvelope`
- `RealtimeResumeRequest { sessionId, afterSeq }`

**Step 4: Run test to verify it passes**

Run: `bun test packages/protocol/src/__tests__/schemas.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat: add protocol schemas for commands and events"
```

---

### Task 3: Cloud auth with access+refresh token

**Files:**
- Create: `apps/cloud-api/src/auth/routes.ts`
- Create: `apps/cloud-api/src/auth/jwt.ts`
- Create: `apps/cloud-api/src/auth/store.ts`
- Test: `apps/cloud-api/src/auth/routes.test.ts`

**Step 1: Write the failing test**

Test login -> refresh -> protected endpoint chain.

**Step 2: Run test to verify it fails**

Run: `bun test apps/cloud-api/src/auth/routes.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add endpoints:
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`

Use short access token + longer refresh token rotation.

**Step 4: Run test to verify it passes**

Run: `bun test apps/cloud-api/src/auth/routes.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/cloud-api/src/auth
git commit -m "feat: implement access refresh auth flow"
```

---

### Task 4: Device channel (fdcode <-> cloud websocket)

**Files:**
- Create: `apps/cloud-api/src/device-channel/server.ts`
- Create: `apps/fdcode-daemon/src/channel/client.ts`
- Create: `apps/fdcode-daemon/src/channel/heartbeat.ts`
- Test: `apps/cloud-api/src/device-channel/server.test.ts`

**Step 1: Write the failing test**

Test that authenticated device connects and sends heartbeat accepted by server.

**Step 2: Run test to verify it fails**

Run: `bun test apps/cloud-api/src/device-channel/server.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement:
- `WS /v1/device-channel`
- device auth by signed device token
- heartbeat every 10s, timeout mark offline

**Step 4: Run test to verify it passes**

Run: `bun test apps/cloud-api/src/device-channel/server.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/cloud-api/src/device-channel apps/fdcode-daemon/src/channel
git commit -m "feat: add device websocket channel with heartbeat"
```

---

### Task 5: Command queue with idempotency

**Files:**
- Create: `apps/cloud-api/src/commands/routes.ts`
- Create: `apps/cloud-api/src/commands/service.ts`
- Create: `apps/cloud-api/src/commands/repo.ts`
- Test: `apps/cloud-api/src/commands/service.test.ts`

**Step 1: Write the failing test**

Send same `commandId` twice; expect single execution record.

**Step 2: Run test to verify it fails**

Run: `bun test apps/cloud-api/src/commands/service.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement:
- `POST /v1/sessions/:id/commands`
- unique `(session_id, command_id)`
- status: `queued | acked | timeout | failed`

**Step 4: Run test to verify it passes**

Run: `bun test apps/cloud-api/src/commands/service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/cloud-api/src/commands
git commit -m "feat: add idempotent command routing"
```

---

### Task 6: Event store and cursor replay

**Files:**
- Create: `apps/cloud-api/src/events/routes.ts`
- Create: `apps/cloud-api/src/events/service.ts`
- Create: `apps/cloud-api/src/events/repo.ts`
- Test: `apps/cloud-api/src/events/service.test.ts`

**Step 1: Write the failing test**

Append events seq=1..3, query `afterSeq=1`, expect seq=2..3.

**Step 2: Run test to verify it fails**

Run: `bun test apps/cloud-api/src/events/service.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement append-only event table and endpoint:
- `GET /v1/sessions/:id/events?afterSeq=`

**Step 4: Run test to verify it passes**

Run: `bun test apps/cloud-api/src/events/service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/cloud-api/src/events
git commit -m "feat: add session event log and cursor replay"
```

---

### Task 7: fdcode daemon core runtime

**Files:**
- Create: `apps/fdcode-daemon/src/runtime/session-manager.ts`
- Create: `apps/fdcode-daemon/src/runtime/command-dispatcher.ts`
- Create: `apps/fdcode-daemon/src/runtime/event-publisher.ts`
- Test: `apps/fdcode-daemon/src/runtime/session-manager.test.ts`

**Step 1: Write the failing test**

Dispatch `send_message` command and assert command ack + event emission.

**Step 2: Run test to verify it fails**

Run: `bun test apps/fdcode-daemon/src/runtime/session-manager.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add in-memory session map + dispatcher with normalized event output.

**Step 4: Run test to verify it passes**

Run: `bun test apps/fdcode-daemon/src/runtime/session-manager.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/fdcode-daemon/src/runtime
git commit -m "feat: implement fdcode runtime session manager"
```

---

### Task 8: Driver adapter SDK + Codex first adapter

**Files:**
- Create: `packages/driver-sdk/src/types.ts`
- Create: `apps/fdcode-daemon/src/drivers/codex-adapter.ts`
- Create: `apps/fdcode-daemon/src/drivers/registry.ts`
- Test: `apps/fdcode-daemon/src/drivers/codex-adapter.test.ts`

**Step 1: Write the failing test**

Assert raw Codex events convert into normalized `message_delta`/`message_final`/`ready`.

**Step 2: Run test to verify it fails**

Run: `bun test apps/fdcode-daemon/src/drivers/codex-adapter.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement `DriverAdapter` interface and first Codex adapter.

**Step 4: Run test to verify it passes**

Run: `bun test apps/fdcode-daemon/src/drivers/codex-adapter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/driver-sdk apps/fdcode-daemon/src/drivers
git commit -m "feat: add driver sdk and codex adapter"
```

---

### Task 9: Claude/Gemini/OpenCode adapters

**Files:**
- Create: `apps/fdcode-daemon/src/drivers/claude-adapter.ts`
- Create: `apps/fdcode-daemon/src/drivers/gemini-adapter.ts`
- Create: `apps/fdcode-daemon/src/drivers/opencode-adapter.ts`
- Test: `apps/fdcode-daemon/src/drivers/adapter-parity.test.ts`

**Step 1: Write the failing test**

Parameterize adapter parity: all adapters must emit same normalized event categories.

**Step 2: Run test to verify it fails**

Run: `bun test apps/fdcode-daemon/src/drivers/adapter-parity.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement three adapters with local CLI/ACP/MCP bridging as needed.

**Step 4: Run test to verify it passes**

Run: `bun test apps/fdcode-daemon/src/drivers/adapter-parity.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/fdcode-daemon/src/drivers
git commit -m "feat: add claude gemini opencode adapters"
```

---

### Task 10: Mobile app base flows (Expo)

**Files:**
- Create: `apps/mobile-expo/app/(auth)/login.tsx`
- Create: `apps/mobile-expo/app/(tabs)/sessions.tsx`
- Create: `apps/mobile-expo/app/session/[id].tsx`
- Create: `apps/mobile-expo/src/api/client.ts`
- Test: `apps/mobile-expo/src/api/client.test.ts`

**Step 1: Write the failing test**

Test API client attaches bearer token and retries once after refresh.

**Step 2: Run test to verify it fails**

Run: `bun test apps/mobile-expo/src/api/client.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement login/session list/chat send scaffolding.

**Step 4: Run test to verify it passes**

Run: `bun test apps/mobile-expo/src/api/client.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/mobile-expo
git commit -m "feat: scaffold expo app with auth and sessions"
```

---

### Task 11: Invisible reconnect and cursor recovery UX

**Files:**
- Create: `apps/mobile-expo/src/realtime/connection-manager.ts`
- Create: `apps/mobile-expo/src/state/session-store.ts`
- Modify: `apps/mobile-expo/app/session/[id].tsx`
- Test: `apps/mobile-expo/src/realtime/connection-manager.test.ts`

**Step 1: Write the failing test**

Simulate disconnect + token refresh + resume from `afterSeq`; expect no message gap and state back to healthy.

**Step 2: Run test to verify it fails**

Run: `bun test apps/mobile-expo/src/realtime/connection-manager.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement:
- silent token refresh on reconnect path
- cursor resume fetch
- status buckets: `healthy | degraded | offline`
- delayed UX hints (>10s only)

**Step 4: Run test to verify it passes**

Run: `bun test apps/mobile-expo/src/realtime/connection-manager.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/mobile-expo/src/realtime apps/mobile-expo/src/state apps/mobile-expo/app/session/[id].tsx
git commit -m "feat: add silent reconnect and cursor replay UX"
```

---

### Task 12: Push notifications via Expo tokens

**Files:**
- Create: `apps/cloud-api/src/push/routes.ts`
- Create: `apps/cloud-api/src/push/service.ts`
- Create: `apps/mobile-expo/src/push/register.ts`
- Test: `apps/cloud-api/src/push/service.test.ts`

**Step 1: Write the failing test**

Register token + trigger `ready` event should enqueue push message.

**Step 2: Run test to verify it fails**

Run: `bun test apps/cloud-api/src/push/service.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add push token register/delete and event-triggered push send.

**Step 4: Run test to verify it passes**

Run: `bun test apps/cloud-api/src/push/service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/cloud-api/src/push apps/mobile-expo/src/push
git commit -m "feat: add expo push registration and delivery"
```

---

### Task 13: Operations and compatibility guardrails

**Files:**
- Create: `apps/fdcode-daemon/src/drivers/version-policy.ts`
- Create: `apps/fdcode-daemon/src/drivers/fixtures/*.json`
- Create: `docs/guide/fdcode-ops.md`
- Test: `apps/fdcode-daemon/src/drivers/version-policy.test.ts`

**Step 1: Write the failing test**

Driver starts only when CLI version is in allowlist unless override flag is set.

**Step 2: Run test to verify it fails**

Run: `bun test apps/fdcode-daemon/src/drivers/version-policy.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement version pinning and compatibility fixtures.

**Step 4: Run test to verify it passes**

Run: `bun test apps/fdcode-daemon/src/drivers/version-policy.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/fdcode-daemon/src/drivers docs/guide/fdcode-ops.md
git commit -m "chore: add driver version policy and ops guide"
```

---

## Global Verification Checklist

Run from repo root:

```bash
bun install
bun typecheck
bun test
```

Expected:
- Typecheck passes
- All protocol/cloud/daemon/mobile tests pass
- No adapter parity failures

---

## Non-Goals (YAGNI for first release)

- Multi-tenant billing and quota enforcement
- Full file tree editor in mobile
- Multi-device real-time collaborative editing
- Complex analytics warehouse

---

## Success Criteria

1. Background resume within 2 seconds in normal network.
2. No persistent “authenticating/syncing/reconnecting” blocking UI states.
3. Command idempotency verified by tests.
4. Cursor replay guarantees zero message gap after reconnect.
5. Driver isolation: one broken adapter does not break others.
