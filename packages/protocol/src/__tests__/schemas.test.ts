import { describe, expect, it } from 'bun:test'
import { CommandEnvelopeSchema } from '../command'
import { EventEnvelopeSchema, RealtimeResumeRequestSchema } from '../event'

describe('protocol schemas', () => {
    it('accepts send_message command envelope', () => {
        const parsed = CommandEnvelopeSchema.safeParse({
            commandId: 'c1',
            sessionId: 's1',
            type: 'send_message',
            payload: { text: 'hello' },
            ttlMs: 30000
        })
        expect(parsed.success).toBe(true)
    })

    it('accepts final event envelope', () => {
        const parsed = EventEnvelopeSchema.safeParse({
            eventId: 'e1',
            sessionId: 's1',
            seq: 1,
            type: 'message_final',
            data: { text: 'done', role: 'assistant' },
            createdAt: Date.now()
        })
        expect(parsed.success).toBe(true)
    })

    it('accepts realtime resume request', () => {
        const parsed = RealtimeResumeRequestSchema.safeParse({
            sessionId: 's1',
            afterSeq: 10
        })
        expect(parsed.success).toBe(true)
    })
})
