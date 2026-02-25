import { describe, expect, it } from 'bun:test'
import { MobileSessionStore } from './mobile-session-store'

describe('mobile session store', () => {
    it('stores sessions sorted by updatedAt', () => {
        const store = new MobileSessionStore()
        store.setSessions([
            {
                sessionId: 's1',
                ownerId: 'owner',
                updatedAt: 1,
                lastSeq: 1,
                state: 'idle',
                lastEventType: null
            },
            {
                sessionId: 's2',
                ownerId: 'owner',
                updatedAt: 10,
                lastSeq: 1,
                state: 'running',
                lastEventType: 'session_state'
            }
        ])

        expect(store.getState().sessions[0]?.sessionId).toBe('s2')
    })

    it('appends optimistic message into existing detail', () => {
        const store = new MobileSessionStore()
        store.setSessionDetail({
            sessionId: 's1',
            ownerId: 'owner',
            updatedAt: 1,
            lastSeq: 1,
            state: 'idle',
            lastEventType: 'ready',
            recentEvents: []
        })

        store.appendOptimisticMessage('s1', 'optimistic')

        const detail = store.getState().details.s1
        expect(detail?.recentEvents.length).toBe(1)
        expect(detail?.state).toBe('running')
    })
})
