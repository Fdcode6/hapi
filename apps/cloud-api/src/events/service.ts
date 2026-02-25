import { EventEnvelopeSchema, type EventEnvelope } from '@fdcode/protocol'
import { EventRepository } from './repo'

type EventAppendedHandler = (event: EventEnvelope) => void | Promise<void>

export class EventService {
    constructor(
        private readonly repo: EventRepository,
        private readonly onAppended?: EventAppendedHandler
    ) {}

    append(raw: unknown): { ok: true; value: EventEnvelope } | { ok: false; error: string } {
        const parsed = EventEnvelopeSchema.safeParse(raw)
        if (!parsed.success) {
            return { ok: false, error: 'Invalid event envelope' }
        }

        const normalized = this.repo.append(parsed.data)
        if (this.onAppended) {
            void this.onAppended(normalized)
        }
        return { ok: true, value: normalized }
    }

    listAfter(sessionId: string, afterSeq: number): EventEnvelope[] {
        return this.repo.listAfter(sessionId, afterSeq)
    }
}
