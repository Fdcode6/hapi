import type { Database } from 'bun:sqlite'

export class SessionOwnershipStore {
    constructor(private readonly db: Database) {}

    setOwner(sessionId: string, userId: string): void {
        this.db.query(`
            INSERT INTO session_owners (session_id, user_id, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                user_id = excluded.user_id,
                updated_at = excluded.updated_at
        `).run(
            sessionId,
            userId,
            Date.now()
        )
    }

    getOwner(sessionId: string): string | null {
        const row = this.db.query(`
            SELECT user_id
            FROM session_owners
            WHERE session_id = ?
        `).get(sessionId) as { user_id: string } | null
        return row?.user_id ?? null
    }
}
