# FDCode Self-Use (No Telegram / No OpenCode) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a stable self-use product with Cloud API + local daemon + Expo mobile app for Claude/Codex/Gemini control, realtime updates, and push alerts.

**Architecture:** Keep three-plane model: `apps/cloud-api` (control + persistence + realtime gateway), `apps/fdcode-daemon` (local execution runtime with 3 drivers), `apps/mobile-expo` (UX + foreground websocket + replay recovery + push registration). Remove Telegram/OpenCode requirements and keep voice input out-of-scope.

**Tech Stack:** Bun workspaces, TypeScript strict, Hono, Bun WebSocket server, SQLite, Expo/React, Zod, Vitest/Bun test.

## Scope lock (must keep)

- Keep: `claude`, `codex`, `gemini`
- Remove from target: Telegram bot/MiniApp, OpenCode, voice input implementation
- Deployment target: 1 VPS (`cloud-api`) + 1 local machine (`fdcode-daemon`) + 1 mobile app (Expo)

---

### Task 1: Auth persistence hardening (refresh session durable)

**Files:**
- Modify: `apps/cloud-api/src/store/sqlite.ts`
- Modify: `apps/cloud-api/src/auth/store.ts`
- Modify: `apps/cloud-api/src/state.ts`
- Test: `apps/cloud-api/src/auth/routes.test.ts`
- Test: `apps/cloud-api/src/__tests__/sqlite-persistence.test.ts`

**Step 1: Write failing test**
- Add test: refresh token remains valid after app state recreate with same DB path.

**Step 2: Run failing test**
- Run: `bun test apps/cloud-api/src/auth/routes.test.ts apps/cloud-api/src/__tests__/sqlite-persistence.test.ts`
- Expected: FAIL (refresh store currently memory-only).

**Step 3: Implement minimal fix**
- Add `refresh_sessions` table.
- Move `RefreshStore` from in-memory Map to SQLite-backed CRUD + expiry cleanup.

**Step 4: Verify pass**
- Re-run tests above, expected PASS.

**Step 5: Commit**
- `git commit -m "feat: 持久化refresh会话提升鉴权稳定性"`

---

### Task 2: Session query API for mobile app

**Files:**
- Create: `apps/cloud-api/src/sessions/routes.ts`
- Create: `apps/cloud-api/src/sessions/service.ts`
- Modify: `apps/cloud-api/src/app.ts`
- Test: `apps/cloud-api/src/__tests__/mobile-api.contract.test.ts`

**Step 1: Write failing test**
- Add contract tests:
  - `GET /v1/sessions`
  - `GET /v1/sessions/:id`
  - return last state/last seq/updatedAt.

**Step 2: Run failing test**
- `bun test apps/cloud-api/src/__tests__/mobile-api.contract.test.ts`
- Expected: FAIL (route missing).

**Step 3: Implement minimal fix**
- Aggregate from `commands/events/session_owners` to mobile-friendly list/detail.

**Step 4: Verify pass**
- same command PASS.

**Step 5: Commit**
- `git commit -m "feat: 增加移动端会话列表与详情接口"`

---

### Task 3: Realtime gateway hardening (resume/heartbeat/limits)

**Files:**
- Modify: `apps/cloud-api/src/realtime/gateway.ts`
- Modify: `apps/cloud-api/src/realtime/auth.ts`
- Test: `apps/cloud-api/src/realtime/gateway.test.ts`

**Step 1: Write failing tests**
- Add tests for:
  - resume frame with lower/higher cursor behavior
  - max sockets per session/user
  - idle timeout + ping/pong timeout close.

**Step 2: Run failing tests**
- `bun test apps/cloud-api/src/realtime/gateway.test.ts`
- Expected: FAIL.

**Step 3: Implement minimal fix**
- Add configurable limits/timeouts and explicit close codes.
- Track socket counts + clean disconnect handling.

**Step 4: Verify pass**
- same command PASS.

**Step 5: Commit**
- `git commit -m "feat: 强化实时网关恢复与连接稳定性"`

---

### Task 4: Push policy completion (ready/tool_request/error)

**Files:**
- Modify: `apps/cloud-api/src/notifications/completion-monitor.ts`
- Create: `apps/cloud-api/src/notifications/policy.ts`
- Modify: `apps/cloud-api/src/push/service.ts`
- Test: `apps/cloud-api/src/push/service.test.ts`
- Create: `apps/cloud-api/src/notifications/policy.test.ts`

**Step 1: Write failing tests**
- ready -> completion push
- tool_request -> action-needed push
- error -> failure push
- debounce by session/time window

**Step 2: Run failing tests**
- `bun test apps/cloud-api/src/push/service.test.ts apps/cloud-api/src/notifications/policy.test.ts`
- Expected: FAIL.

**Step 3: Implement minimal fix**
- Extract notification policy with event mapping + debounce.

**Step 4: Verify pass**
- same command PASS.

**Step 5: Commit**
- `git commit -m "feat: 完成移动端推送策略与去抖"`

---

### Task 5: Tool approval end-to-end loop

**Files:**
- Modify: `apps/cloud-api/src/commands/routes.ts`
- Modify: `apps/fdcode-daemon/src/runtime/session-manager.ts`
- Modify: `apps/fdcode-daemon/src/drivers/*-adapter.ts`
- Test: `apps/cloud-api/src/__tests__/command-runtime-chain.test.ts`
- Test: `apps/fdcode-daemon/src/runtime/session-manager.test.ts`

**Step 1: Write failing tests**
- tool request event received -> mobile sends `approve_tool` -> runtime processes -> emits result/ready.

**Step 2: Run failing tests**
- `bun test apps/cloud-api/src/__tests__/command-runtime-chain.test.ts apps/fdcode-daemon/src/runtime/session-manager.test.ts`
- Expected: FAIL or partial.

**Step 3: Implement minimal fix**
- normalize `approve_tool` handling across 3 adapters (fallback in-memory when CLI lacks direct API).

**Step 4: Verify pass**
- same command PASS.

**Step 5: Commit**
- `git commit -m "feat: 打通工具审批端到端闭环"`

---

### Task 6: Expo app MVP screens (real data)

**Files:**
- Modify: `apps/mobile-expo/app/(auth)/login.tsx`
- Modify: `apps/mobile-expo/app/(tabs)/sessions.tsx`
- Modify: `apps/mobile-expo/app/session/[id].tsx`
- Create: `apps/mobile-expo/src/api/endpoints.ts`
- Create: `apps/mobile-expo/src/state/mobile-session-store.ts`
- Test: `apps/mobile-expo/src/api/client.test.ts`

**Step 1: Write failing tests**
- API endpoint wrappers and parsing tests.

**Step 2: Run failing tests**
- `bun test apps/mobile-expo/src/api`
- Expected: FAIL.

**Step 3: Implement minimal fix**
- Login page: token login + refresh persist.
- Sessions page: list sessions + status badges.
- Session page: event timeline + send message + optimistic item.

**Step 4: Verify pass**
- `bun test apps/mobile-expo/src/api apps/mobile-expo/src/state`
- expected PASS.

**Step 5: Commit**
- `git commit -m "feat: 完成Expo核心页面与真实数据接入"`

---

### Task 7: Lifecycle UX polish (no blocking reconnect text)

**Files:**
- Modify: `apps/mobile-expo/src/realtime/connection-manager.ts`
- Modify: `apps/mobile-expo/src/realtime/lifecycle.ts`
- Create: `apps/mobile-expo/src/ui/connection-hint.ts`
- Test: `apps/mobile-expo/src/realtime/connection-manager.test.ts`

**Step 1: Write failing tests**
- <10s no hint, >=10s lightweight hint, foreground recovery <2s (mocked).

**Step 2: Run failing tests**
- `bun test apps/mobile-expo/src/realtime`
- Expected: FAIL.

**Step 3: Implement minimal fix**
- status transitions: healthy/degraded/offline
- no full-screen blocking states
- reconnect backoff + replay-first recovery

**Step 4: Verify pass**
- same command PASS.

**Step 5: Commit**
- `git commit -m "perf: 优化移动端重连体验与状态展示"`

---

### Task 8: Deploy/runbook automation for self-host

**Files:**
- Create: `scripts/fdcode-deploy-cloud.sh`
- Create: `scripts/fdcode-deploy-daemon.sh`
- Create: `deploy/systemd/fdcode-cloud.service`
- Create: `deploy/systemd/fdcode-daemon.service`
- Modify: `docs/guide/fdcode-ops.md`
- Modify: `README.md`

**Step 1: Write failing check**
- manual checklist in docs for missing service/env templates.

**Step 2: Run check**
- execute scripts with `--dry-run`, expect missing outputs before implementation.

**Step 3: Implement minimal fix**
- provide env template + systemd unit + boot/start/upgrade flow.

**Step 4: Verify**
- `bash scripts/fdcode-deploy-cloud.sh --dry-run`
- `bash scripts/fdcode-deploy-daemon.sh --dry-run`
- expected PASS.

**Step 5: Commit**
- `git commit -m "docs: 完善自建部署脚本与运维手册"`

---

### Task 9: Final integration verification gate

**Files:**
- Modify: `scripts/fdcode-smoke.sh`
- Create: `scripts/fdcode-mobile-api-smoke.sh`
- Modify: `package.json`

**Step 1: Add failing smoke cases**
- include realtime ws + replay + push + approve flow.

**Step 2: Run to fail first**
- `bun run smoke:fdcode`
- `bash scripts/fdcode-mobile-api-smoke.sh`

**Step 3: Implement fixes for failing gaps**
- only minimal fixes needed by smoke.

**Step 4: Final verify**
- `bun run test:fdcode`
- `bun run typecheck:fdcode`
- `bun run smoke:fdcode`
- `bun run --cwd docs docs:build`

**Step 5: Commit**
- `git commit -m "test: 增加端到端联合验证脚本"`

---

## Acceptance criteria (this plan done means)

1. iOS foreground realtime via WS stable; background return recovers by replay.
2. No blocking “认证中/同步中/重连中” full-screen UX.
3. Claude/Codex/Gemini command loop stable; tool approval works end-to-end.
4. Push for ready/tool_request/error works with debounce.
5. Self-host deploy on VPS + local daemon can be completed using scripts/docs only.

## Out of scope

- Telegram bot / Telegram Mini App
- OpenCode driver
- Voice input implementation (you will integrate later)
