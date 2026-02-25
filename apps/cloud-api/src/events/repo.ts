import type { Database } from 'bun:sqlite'
import type { EventEnvelope } from '@fdcode/protocol'

function rowToEvent(row: Record<string, unknown>): EventEnvelope {
    return JSON.parse(String(row.event_json)) as EventEnvelope
}

export class EventRepository {
    constructor(private readonly db: Database) {}

    append(event: Omit<EventEnvelope, 'seq'> & { seq?: number }): EventEnvelope {
        const sequence = event.seq ?? this.nextSequence(event.sessionId)
        const normalized: EventEnvelope = {
            ...event,
            seq: sequence
        } as EventEnvelope

        this.db.query(`
            INSERT INTO events (session_id, seq, event_json, created_at)
            VALUES (?, ?, ?, ?)
        `).run(
            normalized.sessionId,
            normalized.seq,
            JSON.stringify(normalized),
            normalized.createdAt
        )

        return normalized
    }

    listAfter(sessionId: string, afterSeq: number): EventEnvelope[] {
        const rows = this.db.query(`
            SELECT event_json
            FROM events
            WHERE session_id = ? AND seq > ?
            ORDER BY seq ASC
        `).all(
            sessionId,
            afterSeq
        ) as Record<string, unknown>[]

        return rows.map(rowToEvent)
    }

    private nextSequence(sessionId: string): number {
        const row = this.db.query(`
            SELECT MAX(seq) AS max_seq
            FROM events
            WHERE session_id = ?
        `).get(sessionId) as Record<string, unknown> | null
        const maxSeq = row?.max_seq
        return typeof maxSeq === 'number' ? maxSeq + 1 : 1
    }
}
