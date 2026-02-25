import { describe, expect, it } from 'bun:test'
import { CommandRepository } from './repo'
import { CommandService } from './service'
import { openCloudDatabase } from '../store/sqlite'

describe('command service', () => {
    it('deduplicates commandId per session', () => {
        const service = new CommandService(new CommandRepository(openCloudDatabase(':memory:')))

        const payload = {
            commandId: 'c1',
            sessionId: 's1',
            type: 'send_message',
            payload: { text: 'hello' },
            ttlMs: 30000
        }

        const first = service.enqueue(payload)
        const second = service.enqueue(payload)

        expect(first.ok).toBe(true)
        expect(second.ok).toBe(true)
        if (first.ok && second.ok) {
            expect(first.duplicate).toBe(false)
            expect(second.duplicate).toBe(true)
            expect(first.value.createdAt).toBe(second.value.createdAt)
        }
    })

    it('claims queued commands and marks them dispatched', () => {
        const service = new CommandService(new CommandRepository(openCloudDatabase(':memory:')))
        const firstPayload = {
            commandId: 'c1',
            sessionId: 's1',
            type: 'send_message' as const,
            payload: { text: 'hello' },
            ttlMs: 30000
        }
        const secondPayload = {
            commandId: 'c2',
            sessionId: 's1',
            type: 'send_message' as const,
            payload: { text: 'world' },
            ttlMs: 30000
        }
        service.enqueue(firstPayload)
        service.enqueue(secondPayload)

        const claimed = service.claimQueued(10)
        expect(claimed).toHaveLength(2)
        expect(claimed.every((item) => item.status === 'dispatched')).toBe(true)

        const secondClaim = service.claimQueued(10)
        expect(secondClaim).toHaveLength(0)
    })
})
