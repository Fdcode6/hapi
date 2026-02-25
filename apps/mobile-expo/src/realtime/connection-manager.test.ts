import { describe, expect, it } from 'bun:test'
import type { EventEnvelope, RealtimeServerFrame } from '@fdcode/protocol'
import { ConnectionManager, type WebSocketLike } from './connection-manager'

class FakeWebSocket implements WebSocketLike {
    onopen: ((event: unknown) => void) | null = null
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    onclose: ((event: unknown) => void) | null = null

    closeCalls: Array<{ code?: number; reason?: string }> = []

    emitOpen(): void {
        this.onopen?.({})
    }

    emitMessage(frame: RealtimeServerFrame): void {
        this.onmessage?.({ data: JSON.stringify(frame) })
    }

    emitClose(): void {
        this.onclose?.({})
    }

    close(code?: number, reason?: string): void {
        this.closeCalls.push({ code, reason })
    }
}

function createEvent(sessionId: string, seq: number): EventEnvelope {
    return {
        eventId: `${sessionId}-e${seq}`,
        sessionId,
        seq,
        type: 'message_final',
        data: {
            text: `m${seq}`,
            role: 'assistant'
        },
        createdAt: Date.now()
    }
}

async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('connection manager', () => {
    it('refreshes token and resumes from cursor', async () => {
        const manager = new ConnectionManager({
            realtimeWsUrl: 'wss://api.example.com/v1/realtime',
            refreshAccessToken: async () => 'fresh-token',
            fetchEventsAfter: async (_sessionId: string, afterSeq: number): Promise<EventEnvelope[]> => [
                createEvent('s1', afterSeq + 1)
            ]
        })

        const events = await manager.recoverSession('s1', 5)
        expect(events).toHaveLength(1)
        expect(events[0]?.seq).toBe(6)
        expect(manager.getLastSeq('s1')).toBe(6)
        expect(manager.getStatus()).toBe('healthy')
    })

    it('keeps degraded status when replay has sequence gap', async () => {
        const manager = new ConnectionManager({
            realtimeWsUrl: 'wss://api.example.com/v1/realtime',
            refreshAccessToken: async () => 'fresh-token',
            fetchEventsAfter: async (): Promise<EventEnvelope[]> => [createEvent('s1', 9)]
        })

        const events = await manager.recoverSession('s1', 5)
        expect(events[0]?.seq).toBe(9)
        expect(manager.getStatus()).toBe('degraded')
    })

    it('uses websocket foreground flow and heals seq gaps with replay', async () => {
        const ws = new FakeWebSocket()
        const wsUrls: string[] = []
        const replayCalls: number[] = []
        const emittedSeq: number[] = []

        const manager = new ConnectionManager({
            realtimeWsUrl: 'wss://api.example.com/v1/realtime',
            refreshAccessToken: async () => 'fresh-token',
            fetchEventsAfter: async (_sessionId, afterSeq) => {
                replayCalls.push(afterSeq)
                if (afterSeq === 5) {
                    return [createEvent('s1', 6)]
                }
                return [createEvent('s1', 7), createEvent('s1', 8)]
            },
            createWebSocket: (url) => {
                wsUrls.push(url)
                return ws
            },
            reconnectBaseMs: 10,
            reconnectMaxMs: 20
        })

        await manager.enterForeground('s1', 5, {
            onEvent: (event) => {
                emittedSeq.push(event.seq)
            }
        })

        expect(replayCalls).toEqual([5])
        expect(emittedSeq).toEqual([6])
        expect(wsUrls[0]).toContain('sessionId=s1')
        expect(wsUrls[0]).toContain('afterSeq=6')

        ws.emitOpen()
        expect(manager.getStatus()).toBe('healthy')

        ws.emitMessage({ type: 'event', event: createEvent('s1', 8) })
        await flush()

        expect(replayCalls).toEqual([5, 6])
        expect(emittedSeq).toEqual([6, 7, 8])
        expect(manager.getStatus()).toBe('healthy')
    })

    it('stops realtime reconnect when app enters background', async () => {
        const ws = new FakeWebSocket()
        const wsUrls: string[] = []
        let fetchCalls = 0

        const manager = new ConnectionManager({
            realtimeWsUrl: 'wss://api.example.com/v1/realtime',
            refreshAccessToken: async () => 'fresh-token',
            fetchEventsAfter: async (_sessionId, _afterSeq) => {
                fetchCalls += 1
                return []
            },
            createWebSocket: (url) => {
                wsUrls.push(url)
                return ws
            },
            reconnectBaseMs: 10,
            reconnectMaxMs: 20
        })

        await manager.enterForeground('s1', 0, { onEvent: () => {} })
        ws.emitOpen()
        manager.enterBackground()

        expect(ws.closeCalls.length).toBe(1)

        ws.emitClose()
        await new Promise((resolve) => setTimeout(resolve, 30))

        expect(wsUrls.length).toBe(1)
        expect(fetchCalls).toBe(1)
        expect(manager.getStatus()).toBe('degraded')
    })

    it('shows reconnect hint only after 10 seconds', () => {
        const manager = new ConnectionManager({
            realtimeWsUrl: 'wss://api.example.com/v1/realtime',
            refreshAccessToken: async () => 'fresh-token',
            fetchEventsAfter: async (): Promise<EventEnvelope[]> => []
        })

        expect(manager.shouldShowConnectionHint(3_000)).toBe(false)
        expect(manager.shouldShowConnectionHint(10_000)).toBe(true)
    })
})
