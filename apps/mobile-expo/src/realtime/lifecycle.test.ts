import { describe, expect, it } from 'bun:test'
import type { EventEnvelope } from '@fdcode/protocol'
import type { ConnectionManager } from './connection-manager'
import { RealtimeLifecycleController } from './lifecycle'

type FakeManager = {
    enterForegroundCalls: Array<{ sessionId: string; afterSeq: number }>
    backgroundCalls: number
    stopCalls: number
    enterForeground: (sessionId: string, afterSeq: number, handlers: unknown) => Promise<EventEnvelope[]>
    enterBackground: () => void
    stop: () => void
}

function createFakeManager(): FakeManager {
    return {
        enterForegroundCalls: [],
        backgroundCalls: 0,
        stopCalls: 0,
        async enterForeground(sessionId, afterSeq) {
            this.enterForegroundCalls.push({ sessionId, afterSeq })
            return []
        },
        enterBackground() {
            this.backgroundCalls += 1
        },
        stop() {
            this.stopCalls += 1
        }
    }
}

describe('realtime lifecycle controller', () => {
    it('re-enters foreground with cursor when app becomes active', async () => {
        const manager = createFakeManager()
        const lifecycle = new RealtimeLifecycleController(
            manager as unknown as ConnectionManager,
            (_sessionId) => 12
        )

        await lifecycle.bindSession('s1', { onEvent: () => {} })
        await lifecycle.onAppStateChange('background')
        await lifecycle.onAppStateChange('active')

        expect(manager.enterForegroundCalls).toEqual([
            { sessionId: 's1', afterSeq: 12 },
            { sessionId: 's1', afterSeq: 12 }
        ])
        expect(manager.backgroundCalls).toBe(1)
    })

    it('stops manager when unbound', () => {
        const manager = createFakeManager()
        const lifecycle = new RealtimeLifecycleController(
            manager as unknown as ConnectionManager,
            () => 0
        )

        lifecycle.unbindSession()
        expect(manager.stopCalls).toBe(1)
    })
})
