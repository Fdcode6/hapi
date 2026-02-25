import { describe, expect, it } from 'bun:test'
import type { CommandEnvelope, EventEnvelope } from '@fdcode/protocol'
import { createApp } from '../app'
import { createCloudState } from '../state'

type LoginResponse = {
    accessToken: string
}

async function login(app: ReturnType<typeof createApp>): Promise<string> {
    const loginRes = await app.request('/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken: 'fdcode-local-dev' })
    })
    expect(loginRes.status).toBe(200)
    const login = await loginRes.json() as LoginResponse
    return login.accessToken
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) {
            return
        }
        await Bun.sleep(20)
    }
    throw new Error('Timed out waiting for condition')
}

function createFakeRuntimeBridge() {
    const listeners = new Set<(event: EventEnvelope) => void>()
    const nextSeq = new Map<string, number>()

    const getNextSeq = (sessionId: string): number => {
        const current = nextSeq.get(sessionId) ?? 1
        nextSeq.set(sessionId, current + 1)
        return current
    }

    return {
        subscribe: (listener: (event: EventEnvelope) => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        dispatch: async (command: CommandEnvelope) => {
            const emit = (event: EventEnvelope) => {
                for (const listener of listeners) {
                    listener(event)
                }
            }

            if (command.type === 'send_message') {
                emit({
                    eventId: crypto.randomUUID(),
                    sessionId: command.sessionId,
                    seq: getNextSeq(command.sessionId),
                    type: 'message_delta',
                    data: {
                        text: command.payload.text,
                        role: 'assistant'
                    },
                    createdAt: Date.now()
                })
                emit({
                    eventId: crypto.randomUUID(),
                    sessionId: command.sessionId,
                    seq: getNextSeq(command.sessionId),
                    type: 'message_final',
                    data: {
                        text: command.payload.text,
                        role: 'assistant'
                    },
                    createdAt: Date.now()
                })
                emit({
                    eventId: crypto.randomUUID(),
                    sessionId: command.sessionId,
                    seq: getNextSeq(command.sessionId),
                    type: 'ready',
                    data: {
                        status: 'idle'
                    },
                    createdAt: Date.now()
                })
                return
            }

            if (command.type === 'approve_tool') {
                emit({
                    eventId: crypto.randomUUID(),
                    sessionId: command.sessionId,
                    seq: getNextSeq(command.sessionId),
                    type: 'tool_result',
                    data: {
                        requestId: command.payload.requestId,
                        ok: command.payload.approved,
                        output: command.payload.reason ?? (command.payload.approved ? 'approved' : 'denied')
                    },
                    createdAt: Date.now()
                })
                emit({
                    eventId: crypto.randomUUID(),
                    sessionId: command.sessionId,
                    seq: getNextSeq(command.sessionId),
                    type: 'ready',
                    data: { status: 'idle' },
                    createdAt: Date.now()
                })
            }
        }
    }
}

describe('cloud <-> runtime chain', () => {
    it('dispatches queued command to runtime and replays emitted events', async () => {
        const runtime = createFakeRuntimeBridge()
        const state = createCloudState({
            runtimeBridge: runtime
        })
        const app = createApp(state)
        const accessToken = await login(app)
        const authHeaders = {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json'
        }

        const commandRes = await app.request('/v1/sessions/s-chain/commands', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                commandId: 'c-chain-1',
                sessionId: 's-chain',
                type: 'send_message',
                payload: { text: 'hello chain' },
                ttlMs: 30_000
            })
        })
        expect(commandRes.status).toBe(200)
        const commandBody = await commandRes.json() as {
            command: { status: string }
            dispatched: boolean
            duplicate: boolean
        }
        expect(commandBody.duplicate).toBe(false)
        expect(commandBody.dispatched).toBe(true)
        expect(commandBody.command.status).toBe('acked')

        await waitUntil(() => state.eventService.listAfter('s-chain', 0).length >= 3)

        const eventsRes = await app.request('/v1/sessions/s-chain/events?afterSeq=0', {
            method: 'GET',
            headers: { authorization: `Bearer ${accessToken}` }
        })
        expect(eventsRes.status).toBe(200)

        const eventsBody = await eventsRes.json() as {
            events: Array<{ seq: number; type: string }>
        }
        expect(eventsBody.events.length).toBeGreaterThanOrEqual(3)
        expect(eventsBody.events.some((event) => event.type === 'message_final')).toBe(true)
        expect(eventsBody.events.some((event) => event.type === 'ready')).toBe(true)
    })



    it('handles approve_tool command and replays tool_result', async () => {
        const runtime = createFakeRuntimeBridge()
        const state = createCloudState({ runtimeBridge: runtime })
        const app = createApp(state)
        const accessToken = await login(app)

        await app.request('/v1/sessions/s-approve/commands', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${accessToken}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                commandId: 'c-approve-seed',
                sessionId: 's-approve',
                type: 'send_message',
                payload: { text: 'need approval' },
                ttlMs: 30_000
            })
        })

        const approveRes = await app.request('/v1/sessions/s-approve/commands', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${accessToken}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                commandId: 'c-approve-1',
                sessionId: 's-approve',
                type: 'approve_tool',
                payload: { requestId: 'r-approve-1', approved: true },
                ttlMs: 30_000
            })
        })

        expect(approveRes.status).toBe(200)
        await waitUntil(() => state.eventService.listAfter('s-approve', 0).some((event) => event.type === 'tool_result'))

        const events = state.eventService.listAfter('s-approve', 0)
        expect(events.some((event) => event.type === 'tool_result')).toBe(true)
    })

    it('triggers tool_request and error notifications with debounce', async () => {
        const runtime = createFakeRuntimeBridge()
        const state = createCloudState({
            runtimeBridge: runtime
        })
        const app = createApp(state)
        const accessToken = await login(app)

        state.pushService.registerToken({
            userId: 'owner',
            token: 'ExponentPushToken[alert]',
            platform: 'ios',
            createdAt: Date.now()
        })

        await app.request('/v1/sessions/s-alert/commands', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${accessToken}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                commandId: 'c-alert-1',
                sessionId: 's-alert',
                type: 'send_message',
                payload: { text: 'need action' },
                ttlMs: 30_000
            })
        })

        state.eventService.append({
            eventId: 'tool-alert-1',
            sessionId: 's-alert',
            seq: 99,
            type: 'tool_request',
            data: {
                requestId: 'req-1',
                tool: 'bash',
                arguments: { cmd: 'ls' }
            },
            createdAt: Date.now()
        })

        state.eventService.append({
            eventId: 'tool-alert-2',
            sessionId: 's-alert',
            seq: 100,
            type: 'tool_request',
            data: {
                requestId: 'req-2',
                tool: 'bash',
                arguments: { cmd: 'pwd' }
            },
            createdAt: Date.now()
        })

        state.eventService.append({
            eventId: 'err-alert-1',
            sessionId: 's-alert',
            seq: 101,
            type: 'error',
            data: {
                message: 'fatal boom',
                code: 'E_FATAL'
            },
            createdAt: Date.now()
        })

        await waitUntil(() => state.pushService.getSent().length >= 3)

        const titles = state.pushService.getSent().map((item) => item.title)
        expect(titles.some((title) => title.includes('待授权'))).toBe(true)
        expect(titles.some((title) => title.includes('异常'))).toBe(true)

        const toolPushCount = titles.filter((title) => title.includes('待授权')).length
        expect(toolPushCount).toBe(1)
    })

    it('triggers completion notification and bark webhook on final completion', async () => {
        const barkCalls: string[] = []
        const runtime = createFakeRuntimeBridge()
        const state = createCloudState({
            runtimeBridge: runtime,
            bark: {
                endpoint: 'https://api.day.app/fake-device-key',
                group: 'fdcode',
                fetchImpl: async (input) => {
                    barkCalls.push(String(input))
                    return new Response('ok', { status: 200 })
                }
            }
        })
        const app = createApp(state)
        const accessToken = await login(app)

        const commandRes = await app.request('/v1/sessions/s-notify/commands', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${accessToken}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                commandId: 'c-notify-1',
                sessionId: 's-notify',
                type: 'send_message',
                payload: { text: 'finish this task' },
                ttlMs: 30_000
            })
        })
        expect(commandRes.status).toBe(200)

        await waitUntil(() => state.pushService.getSent().length >= 1)
        expect(state.pushService.getSent()[0]?.title).toContain('FDCode 完成')
        expect(barkCalls).toHaveLength(1)
        expect(barkCalls[0]).toContain('https://api.day.app/fake-device-key/')
    })
})
