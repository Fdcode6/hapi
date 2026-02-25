import { describe, expect, it } from 'bun:test'
import type { EventEnvelope } from '@fdcode/protocol'
import { SessionStore } from './session-store'

function createEvent(seq: number): EventEnvelope {
    return {
        eventId: `e-${seq}`,
        sessionId: 's1',
        seq,
        type: 'message_final',
        data: {
            text: `msg-${seq}`,
            role: 'assistant'
        },
        createdAt: Date.now()
    }
}

describe('session store', () => {
    it('deduplicates events by seq/eventId', () => {
        const store = new SessionStore()

        store.upsertEvent(createEvent(1))
        store.upsertEvent(createEvent(1))

        const state = store.get('s1')
        expect(state?.events).toHaveLength(1)
        expect(state?.lastSeq).toBe(1)
    })

    it('marks degraded when sequence gap appears', () => {
        const store = new SessionStore()

        store.upsertEvent(createEvent(1))
        store.upsertEvent(createEvent(3))

        const state = store.get('s1')
        expect(state?.status).toBe('degraded')
    })
})
