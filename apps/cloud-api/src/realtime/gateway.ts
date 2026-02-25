import {
    RealtimeClientFrameSchema,
    RealtimeServerFrameSchema,
    type EventEnvelope,
    type RealtimeServerFrame
} from '@fdcode/protocol'
import { EventService } from '../events/service'
import { SessionOwnershipStore } from '../sessions/ownership'
import { resolveRealtimeRequest } from './auth'

export type RealtimeSocketData = {
    userId: string
    sessionId: string
    lastSeq: number
    connectedAt: number
    lastSeenAt: number
}

type RealtimeSocket = Bun.ServerWebSocket<RealtimeSocketData>

type RealtimeGatewayOptions = {
    maxSocketsPerSession?: number
    maxSocketsPerUser?: number
    pingTimeoutMs?: number
    sweepIntervalMs?: number
    now?: () => number
}

const DEFAULT_MAX_SOCKETS_PER_SESSION = 3
const DEFAULT_MAX_SOCKETS_PER_USER = 8
const DEFAULT_PING_TIMEOUT_MS = 45_000
const DEFAULT_SWEEP_INTERVAL_MS = 5_000

export class RealtimeGateway {
    private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>()
    private readonly socketsByUser = new Map<string, Set<RealtimeSocket>>()
    private readonly maxSocketsPerSession: number
    private readonly maxSocketsPerUser: number
    private readonly pingTimeoutMs: number
    private readonly now: () => number
    private readonly sweepTimer: ReturnType<typeof setInterval>

    readonly websocket: Bun.WebSocketHandler<RealtimeSocketData> = {
        open: (ws) => {
            this.onOpen(ws)
        },
        close: (ws) => {
            this.onClose(ws)
        },
        message: (ws, raw) => {
            this.onMessage(ws, raw)
        }
    }

    constructor(
        private readonly events: EventService,
        private readonly owners: SessionOwnershipStore,
        options: RealtimeGatewayOptions = {}
    ) {
        this.maxSocketsPerSession = options.maxSocketsPerSession ?? DEFAULT_MAX_SOCKETS_PER_SESSION
        this.maxSocketsPerUser = options.maxSocketsPerUser ?? DEFAULT_MAX_SOCKETS_PER_USER
        this.pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS
        const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
        this.now = options.now ?? (() => Date.now())

        this.events.subscribe((event) => {
            this.broadcast(event)
        })

        this.sweepTimer = setInterval(() => {
            this.closeExpiredSockets()
        }, Math.max(250, sweepIntervalMs))
    }

    shutdown(): void {
        clearInterval(this.sweepTimer)
    }

    async handleUpgrade(
        req: Request,
        server: Bun.Server<RealtimeSocketData>
    ): Promise<Response | undefined> {
        const auth = await resolveRealtimeRequest(req, this.owners)
        if (!auth.ok) {
            return Response.json({ error: auth.error }, { status: auth.status })
        }

        const now = this.now()
        const upgraded = server.upgrade(req, {
            data: {
                userId: auth.value.userId,
                sessionId: auth.value.sessionId,
                lastSeq: auth.value.afterSeq,
                connectedAt: now,
                lastSeenAt: now
            }
        })

        if (upgraded) {
            return
        }

        return Response.json({ error: 'Upgrade required' }, { status: 426 })
    }

    private onOpen(ws: RealtimeSocket): void {
        if (!this.registerSocket(ws)) {
            this.sendFrame(ws, {
                type: 'error',
                code: 'socket_limit',
                message: 'Too many realtime connections'
            })
            try {
                ws.close(1013, 'socket limit')
            } catch {
                // ignore
            }
            return
        }

        ws.data.lastSeenAt = this.now()
        this.sendReplay(ws, ws.data.lastSeq)
        this.sendFrame(ws, {
            type: 'ready',
            sessionId: ws.data.sessionId,
            lastSeq: ws.data.lastSeq
        })
    }

    private onClose(ws: RealtimeSocket): void {
        this.removeSocket(ws)
    }

    private onMessage(ws: RealtimeSocket, raw: string | Buffer): void {
        if (typeof raw !== 'string') {
            return
        }

        ws.data.lastSeenAt = this.now()

        let json: unknown
        try {
            json = JSON.parse(raw) as unknown
        } catch {
            this.sendFrame(ws, {
                type: 'error',
                code: 'invalid_json',
                message: 'Realtime frame must be JSON'
            })
            return
        }
        const parsed = RealtimeClientFrameSchema.safeParse(json)
        if (!parsed.success) {
            this.sendFrame(ws, {
                type: 'error',
                code: 'invalid_frame',
                message: 'Invalid realtime client frame'
            })
            return
        }

        if (parsed.data.type === 'ping') {
            this.sendFrame(ws, {
                type: 'pong',
                ts: parsed.data.ts
            })
            return
        }

        if (parsed.data.sessionId !== ws.data.sessionId) {
            this.sendFrame(ws, {
                type: 'error',
                code: 'session_mismatch',
                message: 'Resume session mismatch'
            })
            return
        }

        const replayCursor = Math.max(parsed.data.afterSeq, ws.data.lastSeq)
        this.sendReplay(ws, replayCursor)
        this.sendFrame(ws, {
            type: 'ready',
            sessionId: ws.data.sessionId,
            lastSeq: ws.data.lastSeq
        })
    }

    private broadcast(event: EventEnvelope): void {
        const bucket = this.socketsBySession.get(event.sessionId)
        if (!bucket || bucket.size === 0) {
            return
        }

        for (const ws of bucket) {
            if (event.seq <= ws.data.lastSeq) {
                continue
            }

            if (event.seq > ws.data.lastSeq + 1) {
                this.sendReplay(ws, ws.data.lastSeq)
                if (event.seq <= ws.data.lastSeq) {
                    continue
                }
            }

            const sent = this.sendFrame(ws, {
                type: 'event',
                event
            })
            if (!sent) {
                this.removeSocket(ws)
                try {
                    ws.close(1011, 'send failed')
                } catch {
                    // ignore
                }
                continue
            }
            ws.data.lastSeq = event.seq
            ws.data.lastSeenAt = this.now()
        }
    }

    private sendReplay(ws: RealtimeSocket, afterSeq: number): void {
        const events = this.events.listAfter(ws.data.sessionId, afterSeq)
        for (const event of events) {
            const sent = this.sendFrame(ws, {
                type: 'event',
                event
            })
            if (!sent) {
                this.removeSocket(ws)
                try {
                    ws.close(1011, 'replay failed')
                } catch {
                    // ignore
                }
                return
            }
            ws.data.lastSeq = Math.max(ws.data.lastSeq, event.seq)
            ws.data.lastSeenAt = this.now()
        }
    }

    private sendFrame(ws: RealtimeSocket, frame: RealtimeServerFrame): boolean {
        const validated = RealtimeServerFrameSchema.safeParse(frame)
        if (!validated.success) {
            return false
        }

        try {
            ws.send(JSON.stringify(validated.data))
            return true
        } catch {
            return false
        }
    }

    private registerSocket(ws: RealtimeSocket): boolean {
        const sessionBucket = this.socketsBySession.get(ws.data.sessionId) ?? new Set<RealtimeSocket>()
        if (sessionBucket.size >= this.maxSocketsPerSession) {
            return false
        }

        const userBucket = this.socketsByUser.get(ws.data.userId) ?? new Set<RealtimeSocket>()
        if (userBucket.size >= this.maxSocketsPerUser) {
            return false
        }

        sessionBucket.add(ws)
        this.socketsBySession.set(ws.data.sessionId, sessionBucket)

        userBucket.add(ws)
        this.socketsByUser.set(ws.data.userId, userBucket)

        return true
    }

    private removeSocket(ws: RealtimeSocket): void {
        const sessionBucket = this.socketsBySession.get(ws.data.sessionId)
        if (sessionBucket) {
            sessionBucket.delete(ws)
            if (sessionBucket.size === 0) {
                this.socketsBySession.delete(ws.data.sessionId)
            }
        }

        const userBucket = this.socketsByUser.get(ws.data.userId)
        if (userBucket) {
            userBucket.delete(ws)
            if (userBucket.size === 0) {
                this.socketsByUser.delete(ws.data.userId)
            }
        }
    }

    private closeExpiredSockets(): void {
        const now = this.now()
        for (const bucket of this.socketsBySession.values()) {
            for (const ws of bucket) {
                if (now - ws.data.lastSeenAt <= this.pingTimeoutMs) {
                    continue
                }

                this.sendFrame(ws, {
                    type: 'error',
                    code: 'ping_timeout',
                    message: 'Realtime ping timeout'
                })
                this.removeSocket(ws)
                try {
                    ws.close(1001, 'ping timeout')
                } catch {
                    // ignore
                }
            }
        }
    }
}
