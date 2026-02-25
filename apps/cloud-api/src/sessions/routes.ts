import { Hono } from 'hono'
import type { CloudEnv } from '../auth/middleware'
import { SessionService } from './service'

export function createSessionRoutes(service: SessionService): Hono<CloudEnv> {
    const app = new Hono<CloudEnv>()

    app.get('/sessions', (c) => {
        const userId = c.get('userId') as string
        const sessions = service.listForUser(userId)
        return c.json({ sessions })
    })

    app.get('/sessions/:id', (c) => {
        const userId = c.get('userId') as string
        const sessionId = c.req.param('id')
        const session = service.getForUser(userId, sessionId)
        if (!session) {
            return c.json({ error: 'Session not found' }, 404)
        }
        return c.json({ session })
    })

    return app
}
