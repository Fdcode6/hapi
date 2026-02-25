import type { Database } from 'bun:sqlite'

export type RefreshSession = {
    sessionId: string
    userId: string
    createdAt: number
    expiresAt: number
}

export class RefreshStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    issue(userId: string, ttlMs: number): RefreshSession {
        this.cleanupExpired()

        const now = Date.now()
        const session: RefreshSession = {
            sessionId: crypto.randomUUID(),
            userId,
            createdAt: now,
            expiresAt: now + ttlMs
        }

        this.db.query(`
            INSERT INTO refresh_sessions (session_id, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(
            session.sessionId,
            session.userId,
            session.createdAt,
            session.expiresAt
        )

        return session
    }

    get(sessionId: string): RefreshSession | null {
        this.cleanupExpired()

        const row = this.db.query(`
            SELECT session_id, user_id, created_at, expires_at
            FROM refresh_sessions
            WHERE session_id = ?
            LIMIT 1
        `).get(sessionId) as {
            session_id: string
            user_id: string
            created_at: number
            expires_at: number
        } | null

        if (!row) {
            return null
        }

        return {
            sessionId: row.session_id,
            userId: row.user_id,
            createdAt: row.created_at,
            expiresAt: row.expires_at
        }
    }

    revoke(sessionId: string): void {
        this.db.query(`
            DELETE FROM refresh_sessions
            WHERE session_id = ?
        `).run(sessionId)
    }

    cleanupExpired(now = Date.now()): number {
        const result = this.db.query(`
            DELETE FROM refresh_sessions
            WHERE expires_at <= ?
        `).run(now)

        return Number(result.changes ?? 0)
    }
}
