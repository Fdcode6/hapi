import { describe, expect, it } from 'bun:test'
import { CodexAdapter } from './codex-adapter'

describe('codex adapter', () => {
    it('converts task_complete to ready event', () => {
        const adapter = new CodexAdapter()
        const converted = adapter.parseRawEvent({
            type: 'task_complete',
            sessionId: 's1',
            seq: 5
        })

        expect(converted).not.toBeNull()
        expect(converted?.type).toBe('ready')
    })
})
