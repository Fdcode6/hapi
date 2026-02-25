import { describe, expect, it } from 'bun:test'
import type { EventEnvelope } from '@fdcode/protocol'
import { ConnectionManager } from './connection-manager'

describe('connection manager', () => {
    it('refreshes token and resumes from cursor', async () => {
        const manager = new ConnectionManager({
            refreshAccessToken: async () => 'fresh-token',
            fetchEventsAfter: async (_sessionId: string, afterSeq: number): Promise<EventEnvelope[]> => [
                {
                    eventId: 'e1',
                    sessionId: 's1',
                    seq: afterSeq + 1,
                    type: 'message_final',
                    data: {
                        text: 'hello',
                        role: 'assistant'
                    },
                    createdAt: Date.now()
                }
            ]
        })

        const events = await manager.recoverSession('s1', 5)
        expect(events).toHaveLength(1)
        expect(events[0]?.seq).toBe(6)
        expect(manager.getStatus()).toBe('healthy')
    })

    it('keeps degraded status when replay has sequence gap', async () => {
        const manager = new ConnectionManager({
            refreshAccessToken: async () => 'fresh-token',
            fetchEventsAfter: async (): Promise<EventEnvelope[]> => [
                {
                    eventId: 'e-gap',
                    sessionId: 's1',
                    seq: 9,
                    type: 'message_final',
                    data: {
                        text: 'late event',
                        role: 'assistant'
                    },
                    createdAt: Date.now()
                }
            ]
        })

        const events = await manager.recoverSession('s1', 5)
        expect(events[0]?.seq).toBe(9)
        expect(manager.getStatus()).toBe('degraded')
    })

    it('shows reconnect hint only after 10 seconds', () => {
        const manager = new ConnectionManager({
            refreshAccessToken: async () => 'fresh-token',
            fetchEventsAfter: async (): Promise<EventEnvelope[]> => []
        })

        expect(manager.shouldShowConnectionHint(3_000)).toBe(false)
        expect(manager.shouldShowConnectionHint(10_000)).toBe(true)
    })
})
