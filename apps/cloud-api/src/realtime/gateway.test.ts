import { afterEach, describe, expect, it } from 'bun:test'
import { RealtimeServerFrameSchema, type EventEnvelope, type RealtimeServerFrame } from '@fdcode/protocol'
import { signAccessToken } from '../auth/jwt'
import { EventRepository } from '../events/repo'
import { EventService } from '../events/service'
import { SessionOwnershipStore } from '../sessions/ownership'
import { openCloudDatabase } from '../store/sqlite'
import { RealtimeGateway, type RealtimeSocketData } from './gateway'

const servers: Array<Bun.Server<RealtimeSocketData>> = []

afterEach(() => {
    while (servers.length > 0) {
        const server = servers.pop()
        server?.stop(true)
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

describe('realtime gateway', () => {
    it('replays afterSeq on connect and streams live events', async () => {
        const db = openCloudDatabase(':memory:')
        const owners = new SessionOwnershipStore(db)
        const events = new EventService(new EventRepository(db))
        const gateway = new RealtimeGateway(events, owners)

        owners.setOwner('s1', 'owner')
        events.append(createEvent('s1', 1))
        events.append(createEvent('s1', 2))

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

        const token = await signAccessToken({
            userId: 'owner',
            sessionId: 'sid-1',
            expiresIn: '20m'
        })

        const wsUrl = server.url.toString().replace('http://', 'ws://')
        const ws = new WebSocket(`${wsUrl}v1/realtime?sessionId=s1&afterSeq=1&accessToken=${encodeURIComponent(token)}`)

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

    it('supports ping/pong keepalive frames', async () => {
        const db = openCloudDatabase(':memory:')
        const owners = new SessionOwnershipStore(db)
        const events = new EventService(new EventRepository(db))
        const gateway = new RealtimeGateway(events, owners)

        owners.setOwner('s2', 'owner')

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

        const token = await signAccessToken({
            userId: 'owner',
            sessionId: 'sid-2',
            expiresIn: '20m'
        })

        const wsUrl = server.url.toString().replace('http://', 'ws://')
        const ws = new WebSocket(`${wsUrl}v1/realtime?sessionId=s2&afterSeq=0&accessToken=${encodeURIComponent(token)}`)

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
})
