import { Hono } from 'hono'
import { z } from 'zod'
import { EventService } from './service'

const AfterSeqSchema = z.coerce.number().int().nonnegative().default(0)

export function createEventRoutes(eventService: EventService): Hono {
    const app = new Hono()

    app.get('/sessions/:id/events', (c) => {
        const sessionId = c.req.param('id')
        const afterSeq = AfterSeqSchema.safeParse(c.req.query('afterSeq') ?? 0)
        if (!afterSeq.success) {
            return c.json({ error: 'Invalid afterSeq' }, 400)
        }

        const events = eventService.listAfter(sessionId, afterSeq.data)
        return c.json({ events })
    })

    app.post('/sessions/:id/events', async (c) => {
        const sessionId = c.req.param('id')
        const json = await c.req.json().catch(() => null)
        const appended = eventService.append(json)
        if (!appended.ok) {
            return c.json({ error: appended.error }, 400)
        }
        if (appended.value.sessionId !== sessionId) {
            return c.json({ error: 'Session mismatch' }, 400)
        }
        return c.json({ event: appended.value })
    })

    return app
}
