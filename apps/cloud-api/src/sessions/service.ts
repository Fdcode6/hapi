import type { Database } from 'bun:sqlite'
import type { EventEnvelope } from '@fdcode/protocol'

export type SessionSummary = {
    sessionId: string
    ownerId: string
    updatedAt: number
    lastSeq: number
    state: 'idle' | 'running' | 'waiting_user' | 'interrupted' | 'completed' | 'failed'
    lastEventType: EventEnvelope['type'] | null
}

export type SessionDetail = SessionSummary & {
    recentEvents: EventEnvelope[]
}

const DEFAULT_STATE: SessionSummary['state'] = 'idle'

export class SessionService {
    constructor(private readonly db: Database) {}

    listForUser(userId: string): SessionSummary[] {
        const rows = this.db.query(`
            SELECT session_id, user_id, updated_at
            FROM session_owners
            WHERE user_id = ?
            ORDER BY updated_at DESC
        `).all(userId) as Array<{
            session_id: string
            user_id: string
            updated_at: number
        }>

        return rows.map((row) => this.buildSummary(row.session_id, row.user_id, row.updated_at))
            .sort((a, b) => b.updatedAt - a.updatedAt)
    }

    getForUser(userId: string, sessionId: string): SessionDetail | null {
        const owner = this.db.query(`
            SELECT session_id, user_id, updated_at
            FROM session_owners
            WHERE user_id = ? AND session_id = ?
            LIMIT 1
        `).get(userId, sessionId) as {
            session_id: string
            user_id: string
            updated_at: number
        } | null

        if (!owner) {
            return null
        }

        const summary = this.buildSummary(owner.session_id, owner.user_id, owner.updated_at)
        const events = this.db.query(`
            SELECT event_json
            FROM events
            WHERE session_id = ?
            ORDER BY seq DESC
            LIMIT 100
        `).all(sessionId) as Array<{ event_json: string }>

        return {
            ...summary,
            recentEvents: events
                .map((row) => JSON.parse(row.event_json) as EventEnvelope)
                .sort((a, b) => a.seq - b.seq)
        }
    }

    private buildSummary(sessionId: string, userId: string, ownerUpdatedAt: number): SessionSummary {
        const lastEventRow = this.db.query(`
            SELECT event_json, created_at
            FROM events
            WHERE session_id = ?
            ORDER BY seq DESC
            LIMIT 1
        `).get(sessionId) as { event_json: string; created_at: number } | null

        const lastStateRow = this.db.query(`
            SELECT event_json
            FROM events
            WHERE session_id = ?
            ORDER BY seq DESC
            LIMIT 50
        `).all(sessionId) as Array<{ event_json: string }>

        const lastEvent = lastEventRow ? JSON.parse(lastEventRow.event_json) as EventEnvelope : null
        const state = this.pickSessionState(lastStateRow)
        const lastSeq = lastEvent?.seq ?? 0
        const updatedAt = Math.max(ownerUpdatedAt, lastEventRow?.created_at ?? ownerUpdatedAt)

        return {
            sessionId,
            ownerId: userId,
            updatedAt,
            lastSeq,
            state,
            lastEventType: lastEvent?.type ?? null
        }
    }

    private pickSessionState(rows: Array<{ event_json: string }>): SessionSummary['state'] {
        for (const row of rows) {
            const parsed = JSON.parse(row.event_json) as EventEnvelope
            if (parsed.type === 'session_state') {
                return parsed.data.state
            }
            if (parsed.type === 'ready') {
                return 'completed'
            }
            if (parsed.type === 'tool_request') {
                return 'waiting_user'
            }
        }

        return DEFAULT_STATE
    }
}
