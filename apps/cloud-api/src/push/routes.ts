import { Hono } from 'hono'
import { z } from 'zod'
import type { CloudEnv } from '../auth/middleware'
import { PushService } from './service'

const RegisterSchema = z.object({
    token: z.string().min(1),
    platform: z.enum(['ios', 'android'])
})

const DeleteSchema = z.object({
    token: z.string().min(1)
})

export function createPushRoutes(service: PushService): Hono<CloudEnv> {
    const app = new Hono<CloudEnv>()

    app.post('/push/register', async (c) => {
        const userId = c.get('userId') as string
        const json = await c.req.json().catch(() => null)
        const parsed = RegisterSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        service.registerToken({
            userId,
            token: parsed.data.token,
            platform: parsed.data.platform,
            createdAt: Date.now()
        })

        return c.json({ ok: true })
    })

    app.delete('/push/register', async (c) => {
        const userId = c.get('userId') as string
        const json = await c.req.json().catch(() => null)
        const parsed = DeleteSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        service.unregisterToken(userId, parsed.data.token)
        return c.json({ ok: true })
    })

    return app
}
