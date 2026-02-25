import { Hono } from 'hono'
import { DeviceChannelService } from './server'

export function createDeviceRoutes(service: DeviceChannelService): Hono {
    const app = new Hono()

    app.post('/devices/:id/pair', (c) => {
        const deviceId = c.req.param('id')
        const presence = service.connect(deviceId)
        return c.json({ device: presence })
    })

    app.post('/devices/:id/heartbeat', (c) => {
        const deviceId = c.req.param('id')
        const presence = service.heartbeat(deviceId)
        return c.json({ device: presence })
    })

    return app
}
