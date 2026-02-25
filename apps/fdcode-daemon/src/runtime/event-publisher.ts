import type { EventEnvelope } from '@fdcode/protocol'

export class EventPublisher {
    private readonly listeners = new Set<(event: EventEnvelope) => void>()

    publish(event: EventEnvelope): void {
        for (const listener of this.listeners) {
            listener(event)
        }
    }

    subscribe(listener: (event: EventEnvelope) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }
}
