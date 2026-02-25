import type { EventEnvelope } from '@fdcode/protocol'

export type ConnectionStatus = 'healthy' | 'degraded' | 'offline'

export type ConnectionManagerOptions = {
    refreshAccessToken: () => Promise<string | null>
    fetchEventsAfter: (sessionId: string, afterSeq: number) => Promise<EventEnvelope[]>
}

export class ConnectionManager {
    private status: ConnectionStatus = 'healthy'

    constructor(private readonly options: ConnectionManagerOptions) {}

    getStatus(): ConnectionStatus {
        return this.status
    }

    async recoverSession(sessionId: string, afterSeq: number): Promise<EventEnvelope[]> {
        this.status = 'degraded'
        const refreshed = await this.options.refreshAccessToken()
        if (!refreshed) {
            this.status = 'offline'
            return []
        }

        const events = await this.options.fetchEventsAfter(sessionId, afterSeq)
        const sorted = [...events].sort((a, b) => a.seq - b.seq)
        const deduped = sorted.filter((event, idx) => idx === 0 || sorted[idx - 1]?.seq !== event.seq)
        const firstSeq = deduped[0]?.seq

        if (deduped.length > 0 && firstSeq !== undefined && firstSeq > afterSeq + 1) {
            this.status = 'degraded'
            return deduped
        }

        this.status = 'healthy'
        return deduped
    }

    shouldShowConnectionHint(disconnectedMs: number): boolean {
        return disconnectedMs >= 10_000
    }
}
