import { Hono } from 'hono'
import type { CloudEnv } from '../auth/middleware'
import { CommandIngressService } from './ingress'

export function createCommandRoutes(commandIngress: CommandIngressService): Hono<CloudEnv> {
    const app = new Hono<CloudEnv>()

    app.post('/sessions/:id/commands', async (c) => {
        const sessionId = c.req.param('id')
        const userId = c.get('userId') as string
        const json = await c.req.json().catch(() => null)
        if (!json || typeof json !== 'object') {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const commandResult = await commandIngress.submit(json, userId)
        if (!commandResult.ok) {
            return c.json({ error: commandResult.error }, 400)
        }

        if (commandResult.value.sessionId !== sessionId) {
            return c.json({ error: 'Session mismatch' }, 400)
        }

        return c.json({
            command: commandResult.value,
            duplicate: commandResult.duplicate,
            dispatched: commandResult.dispatched
        })
    })

    return app
}
