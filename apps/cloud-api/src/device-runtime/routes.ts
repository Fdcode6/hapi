import { Hono } from 'hono'
import { z } from 'zod'
import { CommandService } from '../commands/service'
import type { DeviceRuntimeEnv } from './middleware'
import { EventService } from '../events/service'

const LimitSchema = z.coerce.number().int().positive().max(100).default(20)
const AckSchema = z.object({
    status: z.enum(['acked', 'failed']).default('acked')
})

export function createDeviceRuntimeRoutes(args: {
    commandService: CommandService
    eventService: EventService
}): Hono<DeviceRuntimeEnv> {
    const app = new Hono<DeviceRuntimeEnv>()

    app.get('/commands', (c) => {
        const parsedLimit = LimitSchema.safeParse(c.req.query('limit') ?? 20)
        if (!parsedLimit.success) {
            return c.json({ error: 'Invalid limit' }, 400)
        }

        const commands = args.commandService.claimQueued(parsedLimit.data)
        return c.json({
            commands
        })
    })

    app.post('/commands/:sessionId/:commandId/ack', async (c) => {
        const sessionId = c.req.param('sessionId')
        const commandId = c.req.param('commandId')
        const json = await c.req.json().catch(() => ({}))
        const parsed = AckSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const next = args.commandService.updateStatus(
            sessionId,
            commandId,
            parsed.data.status === 'acked' ? 'acked' : 'failed'
        )
        if (!next) {
            return c.json({ error: 'Command not found' }, 404)
        }

        return c.json({ command: next })
    })

    app.post('/sessions/:id/events', async (c) => {
        const sessionId = c.req.param('id')
        const json = await c.req.json().catch(() => null)
        const appended = args.eventService.append(json)
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
