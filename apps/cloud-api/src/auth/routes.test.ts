import { describe, expect, it } from 'bun:test'
import { createApp } from '../app'

describe('auth routes', () => {
    it('supports login refresh and protected access', async () => {
        const app = createApp()

        const loginRes = await app.request('/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: 'fdcode-local-dev' })
        })
        expect(loginRes.status).toBe(200)
        const loginBody = await loginRes.json() as { accessToken: string; refreshToken: string }
        expect(typeof loginBody.accessToken).toBe('string')
        expect(typeof loginBody.refreshToken).toBe('string')

        const refreshRes = await app.request('/v1/auth/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: loginBody.refreshToken })
        })
        expect(refreshRes.status).toBe(200)
        const refreshBody = await refreshRes.json() as { accessToken: string }
        expect(typeof refreshBody.accessToken).toBe('string')

        const protectedRes = await app.request('/v1/sessions/s1/events?afterSeq=0', {
            headers: { authorization: `Bearer ${refreshBody.accessToken}` }
        })
        expect(protectedRes.status).toBe(200)
    })
})
