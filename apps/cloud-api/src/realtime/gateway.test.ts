import { afterEach, describe, expect, it } from 'bun:test'
import { RealtimeServerFrameSchema, type EventEnvelope, type RealtimeServerFrame } from '@fdcode/protocol'
import { signAccessToken } from '../auth/jwt'
import { EventRepository } from '../events/repo'
import { EventService } from '../events/service'
import { SessionOwnershipStore } from '../sessions/ownership'
import { openCloudDatabase } from '../store/sqlite'
import { RealtimeGateway, type RealtimeSocketData } from './gateway'

const servers: Array<Bun.Server<RealtimeSocketData>> = []
const gateways: RealtimeGateway[] = []

afterEach(() => {
    while (servers.length > 0) {
        const server = servers.pop()
        server?.stop(true)
    }
    while (gateways.length > 0) {
        const gateway = gateways.pop()
        gateway?.shutdown()
    }
})

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now()
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitFor timeout')
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
}

function createEvent(sessionId: string, seq: number): EventEnvelope {
    return {
        eventId: `${sessionId}-e${seq}`,
        sessionId,
        seq,
        type: 'message_final',
        data: {
            text: `event-${seq}`,
            role: 'assistant'
        },
        createdAt: Date.now()
    }
}

function parseFrame(raw: string): RealtimeServerFrame {
    const json = JSON.parse(raw) as unknown
    const parsed = RealtimeServerFrameSchema.safeParse(json)
    if (!parsed.success) {
        throw new Error('invalid frame from realtime gateway')
    }
    return parsed.data
}

async function createServer(args?: {
    maxSocketsPerSession?: number
    maxSocketsPerUser?: number
    pingTimeoutMs?: number
    sweepIntervalMs?: number
}) {
    const db = openCloudDatabase(':memory:')
    const owners = new SessionOwnershipStore(db)
    const events = new EventService(new EventRepository(db))
    const gateway = new RealtimeGateway(events, owners, args)
    gateways.push(gateway)

    const server = Bun.serve<RealtimeSocketData>({
        port: 0,
        fetch: (req, bunServer) => {
            const url = new URL(req.url)
            if (url.pathname === '/v1/realtime') {
                return gateway.handleUpgrade(req, bunServer)
            }
            return new Response('not found', { status: 404 })
        },
        websocket: gateway.websocket
    })
    servers.push(server)

    return { server, owners, events }
}

async function connectSocket(server: Bun.Server<RealtimeSocketData>, args: {
    sessionId: string
    userId: string
    afterSeq: number
}) {
    const token = await signAccessToken({
        userId: args.userId,
        sessionId: `sid-${crypto.randomUUID()}`,
        expiresIn: '20m'
    })

    const wsUrl = server.url.toString().replace('http://', 'ws://')
    return new WebSocket(
        `${wsUrl}v1/realtime?sessionId=${args.sessionId}&afterSeq=${args.afterSeq}&accessToken=${encodeURIComponent(token)}`
    )
}

describe('realtime gateway', () => {
    it('replays afterSeq on connect and streams live events', async () => {
        const { server, owners, events } = await createServer()

        owners.setOwner('s1', 'owner')
        events.append(createEvent('s1', 1))
        events.append(createEvent('s1', 2))

        const ws = await connectSocket(server, {
            sessionId: 's1',
            userId: 'owner',
            afterSeq: 1
        })

        const frames: RealtimeServerFrame[] = []
        ws.onmessage = (event) => {
            frames.push(parseFrame(String(event.data)))
        }

        await waitFor(() => frames.some((frame) => frame.type === 'ready'))
        const replayed = frames.filter((frame) => frame.type === 'event').map((frame) => frame.event.seq)
        expect(replayed).toEqual([2])

        events.append(createEvent('s1', 3))

        await waitFor(() => frames.filter((frame) => frame.type === 'event').some((frame) => frame.event.seq === 3))
        const allEventSeq = frames.filter((frame) => frame.type === 'event').map((frame) => frame.event.seq)
        expect(allEventSeq).toEqual([2, 3])

        ws.close()
    })

    it('resume with lower cursor does not duplicate already delivered events', async () => {
        const { server, owners, events } = await createServer()
        owners.setOwner('s1', 'owner')
        events.append(createEvent('s1', 1))
        events.append(createEvent('s1', 2))

        const ws = await connectSocket(server, {
            sessionId: 's1',
            userId: 'owner',
            afterSeq: 0
        })

        const frames: RealtimeServerFrame[] = []
        ws.onmessage = (event) => {
            frames.push(parseFrame(String(event.data)))
        }

        await waitFor(() => frames.some((frame) => frame.type === 'ready'))
        const beforeResumeCount = frames.filter((frame) => frame.type === 'event').length

        ws.send(JSON.stringify({
            type: 'resume',
            sessionId: 's1',
            afterSeq: 0
        }))

        await waitFor(() => frames.filter((frame) => frame.type === 'ready').length >= 2)
        const afterResumeCount = frames.filter((frame) => frame.type === 'event').length
        expect(afterResumeCount).toBe(beforeResumeCount)

        ws.close()
    })

    it('enforces max sockets per session', async () => {
        const { server, owners } = await createServer({ maxSocketsPerSession: 1 })
        owners.setOwner('s-limit', 'owner')

        const ws1 = await connectSocket(server, {
            sessionId: 's-limit',
            userId: 'owner',
            afterSeq: 0
        })
        const ws2 = await connectSocket(server, {
            sessionId: 's-limit',
            userId: 'owner',
            afterSeq: 0
        })

        let ws2Closed = false
        ws2.onclose = () => {
            ws2Closed = true
        }

        await waitFor(() => ws2Closed)

        ws1.close()
        ws2.close()
    })

    it('supports ping/pong keepalive frames', async () => {
        const { server, owners } = await createServer()
        owners.setOwner('s2', 'owner')

        const ws = await connectSocket(server, {
            sessionId: 's2',
            userId: 'owner',
            afterSeq: 0
        })

        const frames: RealtimeServerFrame[] = []
        ws.onmessage = (event) => {
            frames.push(parseFrame(String(event.data)))
        }

        await waitFor(() => frames.some((frame) => frame.type === 'ready'))

        ws.send(JSON.stringify({ type: 'ping', ts: 123 }))

        await waitFor(() => frames.some((frame) => frame.type === 'pong'))
        const pong = frames.find((frame) => frame.type === 'pong')
        expect(pong?.ts).toBe(123)

        ws.close()
    })

    it('closes stale sockets when ping timeout exceeded', async () => {
        const { server, owners } = await createServer({
            pingTimeoutMs: 80,
            sweepIntervalMs: 20
        })
        owners.setOwner('s-timeout', 'owner')

        const ws = await connectSocket(server, {
            sessionId: 's-timeout',
            userId: 'owner',
            afterSeq: 0
        })

        let closed = false
        ws.onclose = () => {
            closed = true
        }

        await waitFor(() => closed, 1500)
        ws.close()
    })
})
