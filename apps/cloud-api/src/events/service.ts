import { EventEnvelopeSchema, type EventEnvelope } from '@fdcode/protocol'
import { EventRepository } from './repo'

type EventAppendedHandler = (event: EventEnvelope) => void | Promise<void>

export class EventService {
    private readonly listeners = new Set<EventAppendedHandler>()

    constructor(private readonly repo: EventRepository, onAppended?: EventAppendedHandler) {
        if (onAppended) {
            this.listeners.add(onAppended)
        }
    }

    subscribe(listener: EventAppendedHandler): () => void {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    append(raw: unknown): { ok: true; value: EventEnvelope } | { ok: false; error: string } {
        const parsed = EventEnvelopeSchema.safeParse(raw)
        if (!parsed.success) {
            return { ok: false, error: 'Invalid event envelope' }
        }

        const normalized = this.repo.append(parsed.data)
        for (const listener of this.listeners) {
            Promise.resolve(listener(normalized)).catch((error) => {
                console.warn('[events] appended listener failed', error)
            })
        }
        return { ok: true, value: normalized }
    }

    listAfter(sessionId: string, afterSeq: number): EventEnvelope[] {
        return this.repo.listAfter(sessionId, afterSeq)
    }
}
