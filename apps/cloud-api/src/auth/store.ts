export type RefreshSession = {
    sessionId: string
    userId: string
    createdAt: number
    expiresAt: number
}

export class RefreshStore {
    private readonly sessions = new Map<string, RefreshSession>()

    issue(userId: string, ttlMs: number): RefreshSession {
        const now = Date.now()
        const session: RefreshSession = {
            sessionId: crypto.randomUUID(),
            userId,
            createdAt: now,
            expiresAt: now + ttlMs
        }
        this.sessions.set(session.sessionId, session)
        return session
    }

    get(sessionId: string): RefreshSession | null {
        const session = this.sessions.get(sessionId)
        if (!session) {
            return null
        }
        if (session.expiresAt <= Date.now()) {
            this.sessions.delete(sessionId)
            return null
        }
        return session
    }

    revoke(sessionId: string): void {
        this.sessions.delete(sessionId)
    }
}
