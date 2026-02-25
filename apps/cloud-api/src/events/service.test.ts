import { describe, expect, it } from 'bun:test'
import { EventRepository } from './repo'
import { EventService } from './service'
import { openCloudDatabase } from '../store/sqlite'

function createEvent(seq: number) {
    return {
        eventId: `e${seq}`,
        sessionId: 's1',
        seq,
        type: 'message_final' as const,
        data: { text: `m${seq}`, role: 'assistant' as const },
        createdAt: Date.now()
    }
}

describe('event service', () => {
    it('lists events after cursor', () => {
        const service = new EventService(new EventRepository(openCloudDatabase(':memory:')))

        service.append(createEvent(1))
        service.append(createEvent(2))
        service.append(createEvent(3))

        const events = service.listAfter('s1', 1)
        expect(events.map((event) => event.seq)).toEqual([2, 3])
    })
})
