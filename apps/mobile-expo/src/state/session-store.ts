import type { EventEnvelope } from '@fdcode/protocol'

export type SessionViewState = {
    sessionId: string
    lastSeq: number
    events: EventEnvelope[]
    status: 'healthy' | 'degraded' | 'offline'
}

export class SessionStore {
    private readonly states = new Map<string, SessionViewState>()

    upsertEvent(event: EventEnvelope): SessionViewState {
        const existing = this.states.get(event.sessionId) ?? {
            sessionId: event.sessionId,
            lastSeq: 0,
            events: [],
            status: 'healthy' as const
        }

        const next: SessionViewState = {
            ...existing,
            lastSeq: Math.max(existing.lastSeq, event.seq),
            events: [...existing.events, event]
        }

        this.states.set(event.sessionId, next)
        return next
    }

    setStatus(sessionId: string, status: SessionViewState['status']): void {
        const existing = this.states.get(sessionId)
        if (!existing) {
            this.states.set(sessionId, {
                sessionId,
                lastSeq: 0,
                events: [],
                status
            })
            return
        }

        this.states.set(sessionId, {
            ...existing,
            status
        })
    }

    get(sessionId: string): SessionViewState | null {
        return this.states.get(sessionId) ?? null
    }
}
