import { Hono } from 'hono'
import { z } from 'zod'
import { RefreshStore } from './store'
import { signAccessToken, signRefreshToken, verifyToken } from './jwt'

const LoginSchema = z.object({
    accessToken: z.string().min(1)
})

const RefreshSchema = z.object({
    refreshToken: z.string().min(1)
})

const LogoutSchema = z.object({
    refreshToken: z.string().min(1)
})

export function createAuthRoutes(refreshStore: RefreshStore): Hono {
    const app = new Hono()

    app.post('/login', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = LoginSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const expected = process.env.FDCODE_ACCESS_TOKEN ?? 'fdcode-local-dev'
        if (parsed.data.accessToken !== expected) {
            return c.json({ error: 'Invalid access token' }, 401)
        }

        const userId = 'owner'
        const refreshSession = refreshStore.issue(userId, 30 * 24 * 60 * 60 * 1000)
        const accessToken = await signAccessToken({
            userId,
            sessionId: refreshSession.sessionId,
            expiresIn: '20m'
        })
        const refreshToken = await signRefreshToken({
            userId,
            sessionId: refreshSession.sessionId,
            expiresIn: '30d'
        })

        return c.json({
            accessToken,
            refreshToken,
            expiresInSeconds: 20 * 60,
            user: { id: userId, name: 'Owner' }
        })
    })

    app.post('/refresh', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = RefreshSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const payload = await verifyToken(parsed.data.refreshToken)
        if (!payload || payload.kind !== 'refresh') {
            return c.json({ error: 'Invalid refresh token' }, 401)
        }

        const session = refreshStore.get(payload.sid)
        if (!session) {
            return c.json({ error: 'Refresh session expired' }, 401)
        }

        const accessToken = await signAccessToken({
            userId: session.userId,
            sessionId: session.sessionId,
            expiresIn: '20m'
        })

        return c.json({
            accessToken,
            expiresInSeconds: 20 * 60
        })
    })

    app.post('/logout', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = LogoutSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const payload = await verifyToken(parsed.data.refreshToken)
        if (payload?.kind === 'refresh') {
            refreshStore.revoke(payload.sid)
        }

        return c.json({ ok: true })
    })

    return app
}
