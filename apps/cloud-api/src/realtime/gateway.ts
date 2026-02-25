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
}

type RealtimeSocket = Bun.ServerWebSocket<RealtimeSocketData>

export class RealtimeGateway {
    private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>()

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
        private readonly owners: SessionOwnershipStore
    ) {
        this.events.subscribe((event) => {
            this.broadcast(event)
        })
    }

    async handleUpgrade(
        req: Request,
        server: Bun.Server<RealtimeSocketData>
    ): Promise<Response | undefined> {
        const auth = await resolveRealtimeRequest(req, this.owners)
        if (!auth.ok) {
            return Response.json({ error: auth.error }, { status: auth.status })
        }

        const upgraded = server.upgrade(req, {
            data: {
                userId: auth.value.userId,
                sessionId: auth.value.sessionId,
                lastSeq: auth.value.afterSeq
            }
        })

        if (upgraded) {
            return
        }

        return Response.json({ error: 'Upgrade required' }, { status: 426 })
    }

    private onOpen(ws: RealtimeSocket): void {
        const bucket = this.socketsBySession.get(ws.data.sessionId) ?? new Set<RealtimeSocket>()
        bucket.add(ws)
        this.socketsBySession.set(ws.data.sessionId, bucket)
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

        this.sendReplay(ws, parsed.data.afterSeq)
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

    private removeSocket(ws: RealtimeSocket): void {
        const bucket = this.socketsBySession.get(ws.data.sessionId)
        if (!bucket) {
            return
        }

        bucket.delete(ws)
        if (bucket.size === 0) {
            this.socketsBySession.delete(ws.data.sessionId)
        }
    }
}
