import type { MiddlewareHandler } from 'hono'

export type DeviceRuntimeEnv = {
    Variables: {
        deviceId: string
    }
}

export const requireDeviceRuntimeToken: MiddlewareHandler<DeviceRuntimeEnv> = async (c, next) => {
    const expected = process.env.FDCODE_DEVICE_TOKEN ?? 'fdcode-device-dev'
    const token = c.req.header('x-fdcode-device-token')
    if (!token || token !== expected) {
        return c.json({ error: 'Invalid device token' }, 401)
    }

    const deviceId = c.req.header('x-fdcode-device-id') ?? 'unknown-device'
    c.set('deviceId', deviceId)
    await next()
    return
}
