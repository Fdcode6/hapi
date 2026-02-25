import { RealtimeServerFrameSchema, type EventEnvelope } from '@fdcode/protocol'

export type ConnectionStatus = 'healthy' | 'degraded' | 'offline'

export type RealtimeHandlers = {
    onEvent: (event: EventEnvelope) => void
    onStatusChange?: (status: ConnectionStatus) => void
}

export type WebSocketLike = {
    onopen: ((event: unknown) => void) | null
    onmessage: ((event: { data: unknown }) => void) | null
    onerror: ((event: unknown) => void) | null
    onclose: ((event: unknown) => void) | null
    close: (code?: number, reason?: string) => void
}

export type ConnectionManagerOptions = {
    realtimeWsUrl: string
    getAccessToken?: () => string | null
    refreshAccessToken: () => Promise<string | null>
    fetchEventsAfter: (sessionId: string, afterSeq: number) => Promise<EventEnvelope[]>
    createWebSocket?: (url: string) => WebSocketLike
    now?: () => number
    reconnectBaseMs?: number
    reconnectMaxMs?: number
}

export class ConnectionManager {
    private status: ConnectionStatus = 'healthy'
    private socket: WebSocketLike | null = null
    private currentSessionId: string | null = null
    private handlers: RealtimeHandlers | null = null
    private foregroundActive = false
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectAttempt = 0
    private disconnectedAt: number | null = null
    private readonly lastSeqBySession = new Map<string, number>()

    constructor(private readonly options: ConnectionManagerOptions) {}

    getStatus(): ConnectionStatus {
        return this.status
    }

    getLastSeq(sessionId: string): number {
        return this.lastSeqBySession.get(sessionId) ?? 0
    }

    async enterForeground(
        sessionId: string,
        afterSeq: number,
        handlers: RealtimeHandlers
    ): Promise<EventEnvelope[]> {
        this.currentSessionId = sessionId
        this.handlers = handlers
        this.foregroundActive = true
        this.clearReconnectTimer()

        const baselineSeq = Math.max(afterSeq, this.getLastSeq(sessionId))
        const replayed = await this.recoverSession(sessionId, baselineSeq)
        replayed.forEach((event) => {
            this.emitEvent(event)
        })

        if (!this.foregroundActive || this.currentSessionId !== sessionId) {
            return replayed
        }

        await this.connectRealtime(sessionId, this.getLastSeq(sessionId))
        return replayed
    }

    enterBackground(): void {
        this.foregroundActive = false
        this.clearReconnectTimer()
        this.closeSocket()
        if (this.status === 'healthy') {
            this.setStatus('degraded')
        }
    }

    stop(): void {
        this.foregroundActive = false
        this.clearReconnectTimer()
        this.closeSocket()
        this.currentSessionId = null
        this.handlers = null
    }

    async recoverSession(sessionId: string, afterSeq: number): Promise<EventEnvelope[]> {
        this.setStatus('degraded')
        const refreshed = await this.options.refreshAccessToken()
        const token = refreshed ?? this.options.getAccessToken?.() ?? null
        if (!token) {
            this.setStatus('offline')
            return []
        }

        const events = await this.options.fetchEventsAfter(sessionId, afterSeq)
        const deduped = dedupeAndSort(events)
        if (deduped.length === 0) {
            this.lastSeqBySession.set(sessionId, Math.max(this.getLastSeq(sessionId), afterSeq))
            this.setStatus('healthy')
            return deduped
        }

        const firstSeq = deduped[0]?.seq ?? afterSeq
        if (firstSeq > afterSeq + 1) {
            this.setStatus('degraded')
        } else {
            this.setStatus('healthy')
        }

        const lastSeq = deduped[deduped.length - 1]?.seq ?? afterSeq
        this.lastSeqBySession.set(sessionId, Math.max(this.getLastSeq(sessionId), lastSeq))
        return deduped
    }

    shouldShowConnectionHint(disconnectedMs: number): boolean {
        return disconnectedMs >= 10_000
    }

    getDisconnectedMs(): number {
        if (!this.disconnectedAt) {
            return 0
        }
        const now = this.options.now ?? (() => Date.now())
        return Math.max(0, now() - this.disconnectedAt)
    }

    private async connectRealtime(sessionId: string, afterSeq: number): Promise<void> {
        const token = this.options.getAccessToken?.() ?? await this.options.refreshAccessToken()
        if (!token) {
            this.setStatus('offline')
            this.scheduleReconnect()
            return
        }

        this.closeSocket()

        const wsUrl = new URL(this.options.realtimeWsUrl)
        wsUrl.searchParams.set('sessionId', sessionId)
        wsUrl.searchParams.set('afterSeq', String(afterSeq))
        wsUrl.searchParams.set('accessToken', token)

        const createWebSocket = this.options.createWebSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike)
        const socket = createWebSocket(wsUrl.toString())

        this.socket = socket

        socket.onopen = () => {
            if (this.socket !== socket) {
                return
            }
            this.reconnectAttempt = 0
            this.disconnectedAt = null
            this.setStatus('healthy')
        }

        socket.onmessage = (event) => {
            void this.handleSocketMessage(event.data)
        }

        socket.onerror = () => {
            if (this.socket !== socket) {
                return
            }
            this.setStatus('degraded')
        }

        socket.onclose = () => {
            if (this.socket !== socket) {
                return
            }

            this.socket = null

            if (!this.foregroundActive) {
                return
            }

            if (!this.disconnectedAt) {
                const now = this.options.now ?? (() => Date.now())
                this.disconnectedAt = now()
            }

            this.setStatus('degraded')
            this.scheduleReconnect()
        }
    }

    private async handleSocketMessage(rawData: unknown): Promise<void> {
        const payload = typeof rawData === 'string' ? rawData : String(rawData)

        let json: unknown
        try {
            json = JSON.parse(payload)
        } catch {
            this.setStatus('degraded')
            return
        }

        const frame = RealtimeServerFrameSchema.safeParse(json)
        if (!frame.success) {
            this.setStatus('degraded')
            return
        }

        if (frame.data.type === 'ready') {
            const expected = this.getLastSeq(frame.data.sessionId)
            if (frame.data.lastSeq > expected) {
                await this.replayFromCursor(frame.data.sessionId, expected)
            }
            return
        }

        if (frame.data.type === 'error') {
            this.setStatus('degraded')
            return
        }

        if (frame.data.type === 'pong') {
            return
        }

        await this.handleIncomingEvent(frame.data.event)
    }

    private async handleIncomingEvent(event: EventEnvelope): Promise<void> {
        if (!this.currentSessionId || event.sessionId !== this.currentSessionId) {
            return
        }

        const cursor = this.getLastSeq(event.sessionId)
        if (event.seq <= cursor) {
            return
        }

        if (event.seq > cursor + 1) {
            this.setStatus('degraded')
            await this.replayFromCursor(event.sessionId, cursor)
            return
        }

        this.emitEvent(event)
        this.setStatus('healthy')
    }

    private async replayFromCursor(sessionId: string, cursor: number): Promise<void> {
        const beforeReplaySeq = this.getLastSeq(sessionId)
        const replayed = await this.recoverSession(sessionId, cursor)
        replayed.forEach((event) => {
            if (event.seq <= beforeReplaySeq) {
                return
            }
            this.emitEvent(event)
        })

        if (this.socket) {
            this.setStatus('healthy')
        }
    }

    private emitEvent(event: EventEnvelope): void {
        this.lastSeqBySession.set(event.sessionId, Math.max(this.getLastSeq(event.sessionId), event.seq))
        this.handlers?.onEvent(event)
    }

    private scheduleReconnect(): void {
        if (!this.foregroundActive || !this.currentSessionId || this.reconnectTimer) {
            return
        }

        const base = this.options.reconnectBaseMs ?? 600
        const max = this.options.reconnectMaxMs ?? 8_000
        const delay = Math.min(max, base * 2 ** this.reconnectAttempt)
        this.reconnectAttempt += 1

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            if (!this.foregroundActive || !this.currentSessionId) {
                return
            }

            const cursor = this.getLastSeq(this.currentSessionId)
            void this.replayFromCursor(this.currentSessionId, cursor)
                .then(() => this.connectRealtime(this.currentSessionId!, this.getLastSeq(this.currentSessionId!)))
                .catch(() => {
                    this.setStatus('degraded')
                    this.scheduleReconnect()
                })
        }, delay)
    }

    private clearReconnectTimer(): void {
        if (!this.reconnectTimer) {
            return
        }
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
    }

    private closeSocket(): void {
        if (!this.socket) {
            return
        }

        const socket = this.socket
        this.socket = null
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        try {
            socket.close(1000, 'background')
        } catch {
            // ignore
        }
    }

    private setStatus(next: ConnectionStatus): void {
        if (this.status === next) {
            return
        }
        this.status = next
        this.handlers?.onStatusChange?.(next)
    }
}

function dedupeAndSort(events: EventEnvelope[]): EventEnvelope[] {
    const sorted = [...events].sort((a, b) => a.seq - b.seq)
    const seenSeq = new Set<number>()
    const seenEventId = new Set<string>()

    return sorted.filter((event) => {
        if (seenSeq.has(event.seq) || seenEventId.has(event.eventId)) {
            return false
        }
        seenSeq.add(event.seq)
        seenEventId.add(event.eventId)
        return true
    })
}
