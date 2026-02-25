import type { EventEnvelope } from '@fdcode/protocol'
import type { SessionDetailDto, SessionSummaryDto } from '../api/endpoints'

export type MobileSessionState = {
    sessions: SessionSummaryDto[]
    details: Record<string, SessionDetailDto>
}

export class MobileSessionStore {
    private state: MobileSessionState = {
        sessions: [],
        details: {}
    }

    getState(): MobileSessionState {
        return this.state
    }

    setSessions(sessions: SessionSummaryDto[]): MobileSessionState {
        this.state = {
            ...this.state,
            sessions: [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
        }
        return this.state
    }

    setSessionDetail(detail: SessionDetailDto): MobileSessionState {
        this.state = {
            ...this.state,
            details: {
                ...this.state.details,
                [detail.sessionId]: detail
            }
        }
        return this.state
    }

    appendOptimisticMessage(sessionId: string, text: string): MobileSessionState {
        const detail = this.state.details[sessionId]
        if (!detail) {
            return this.state
        }

        const maxSeq = detail.recentEvents.reduce((max, item) => Math.max(max, item.seq), 0)
        const optimisticEvent: EventEnvelope = {
            eventId: `optimistic-${crypto.randomUUID()}`,
            sessionId,
            seq: maxSeq + 1,
            type: 'message_delta',
            data: {
                text,
                role: 'assistant'
            },
            createdAt: Date.now()
        }

        return this.setSessionDetail({
            ...detail,
            recentEvents: [...detail.recentEvents, optimisticEvent],
            updatedAt: Date.now(),
            lastSeq: optimisticEvent.seq,
            state: 'running',
            lastEventType: optimisticEvent.type
        })
    }
}
