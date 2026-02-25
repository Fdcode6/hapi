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
            if (command.type !== 'send_message') {
                return
            }
            const emit = (event: EventEnvelope) => {
                for (const listener of listeners) {
                    listener(event)
                }
            }

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
