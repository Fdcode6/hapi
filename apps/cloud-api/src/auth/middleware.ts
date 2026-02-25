import type { MiddlewareHandler } from 'hono'
import { verifyToken } from './jwt'

export type CloudEnv = {
    Variables: {
        userId: string
        refreshSessionId: string
    }
}

export const requireAccessToken: MiddlewareHandler<CloudEnv> = async (c, next) => {
    if (c.req.path.startsWith('/v1/auth') || c.req.path.startsWith('/v1/device-runtime')) {
        await next()
        return
    }

    const header = c.req.header('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
    if (!token) {
        return c.json({ error: 'Missing access token' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload || payload.kind !== 'access') {
        return c.json({ error: 'Invalid access token' }, 401)
    }

    c.set('userId', payload.sub)
    c.set('refreshSessionId', payload.sid)
    await next()
    return
}
