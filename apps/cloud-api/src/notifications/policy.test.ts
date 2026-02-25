import { describe, expect, it } from 'bun:test'
import { NotificationPolicy } from './policy'

describe('notification policy', () => {
    it('maps ready completion and debounces repeated ready notifications', () => {
        let now = 1000
        const policy = new NotificationPolicy({
            debounceMs: 10_000,
            now: () => now
        })

        const first = policy.evaluate({
            eventId: 'e1',
            sessionId: 's1',
            seq: 3,
            type: 'ready',
            data: { status: 'idle' },
            createdAt: now
        }, {
            sessionId: 's1',
            assistantPreview: 'final answer'
        })
        expect(first?.kind).toBe('completion')

        now += 2000
        const second = policy.evaluate({
            eventId: 'e2',
            sessionId: 's1',
            seq: 4,
            type: 'ready',
            data: { status: 'idle' },
            createdAt: now
        }, {
            sessionId: 's1',
            assistantPreview: 'final answer'
        })
        expect(second).toBeNull()

        now += 10_001
        const third = policy.evaluate({
            eventId: 'e3',
            sessionId: 's1',
            seq: 5,
            type: 'ready',
            data: { status: 'idle' },
            createdAt: now
        }, {
            sessionId: 's1',
            assistantPreview: 'final answer'
        })
        expect(third?.kind).toBe('completion')
    })

    it('maps tool_request and error intents', () => {
        const policy = new NotificationPolicy({ debounceMs: 0 })

        const toolIntent = policy.evaluate({
            eventId: 'tool-1',
            sessionId: 's2',
            seq: 1,
            type: 'tool_request',
            data: {
                requestId: 'r-1',
                tool: 'bash',
                arguments: { cmd: 'ls' }
            },
            createdAt: Date.now()
        }, {
            sessionId: 's2',
            assistantPreview: null
        })
        expect(toolIntent?.kind).toBe('tool_request')
        expect(toolIntent?.body).toContain('bash')

        const errorIntent = policy.evaluate({
            eventId: 'err-1',
            sessionId: 's2',
            seq: 2,
            type: 'error',
            data: {
                message: 'something wrong happened',
                code: 'E_FAIL'
            },
            createdAt: Date.now()
        }, {
            sessionId: 's2',
            assistantPreview: null
        })
        expect(errorIntent?.kind).toBe('error')
        expect(errorIntent?.body).toContain('something wrong')
    })
})
