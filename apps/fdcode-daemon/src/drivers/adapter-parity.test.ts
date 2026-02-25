import { describe, expect, it } from 'bun:test'
import type { DriverAdapter } from '@fdcode/driver-sdk'
import { ClaudeAdapter } from './claude-adapter'
import { CodexAdapter } from './codex-adapter'
import { GeminiAdapter } from './gemini-adapter'

async function collectTypes(adapter: DriverAdapter): Promise<Set<string>> {
    const eventTypes = new Set<string>()
    const unsubscribe = adapter.onEvent((event) => {
        eventTypes.add(event.type)
    })

    const { sessionRef } = await adapter.startSession({
        sessionId: 's1',
        cwd: process.cwd()
    })

    await adapter.sendMessage(sessionRef, 'hello')
    unsubscribe()
    return eventTypes
}

describe('adapter parity', () => {
    it('all adapters emit core event categories', async () => {
        const adapters: DriverAdapter[] = [
            new ClaudeAdapter(),
            new CodexAdapter(),
            new GeminiAdapter()
        ]

        for (const adapter of adapters) {
            const types = await collectTypes(adapter)
            expect(types.has('message_delta')).toBe(true)
            expect(types.has('ready')).toBe(true)
        }
    })
})
