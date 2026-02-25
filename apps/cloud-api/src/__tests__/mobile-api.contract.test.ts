import { describe, expect, it } from 'bun:test'
import { createApp } from '../app'

type LoginResponse = {
    accessToken: string
    refreshToken: string
}

describe('mobile api contract', () => {
    it('covers auth + session + device + push flows', async () => {
        const app = createApp()

        const loginRes = await app.request('/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: 'fdcode-local-dev' })
        })
        expect(loginRes.status).toBe(200)
        const login = await loginRes.json() as LoginResponse

        const refreshRes = await app.request('/v1/auth/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: login.refreshToken })
        })
        expect(refreshRes.status).toBe(200)
        const refreshed = await refreshRes.json() as { accessToken: string }

        const authHeaders = { authorization: `Bearer ${refreshed.accessToken}`, 'content-type': 'application/json' }

        const pairRes = await app.request('/v1/devices/dev-1/pair', {
            method: 'POST',
            headers: authHeaders
        })
        expect(pairRes.status).toBe(200)

        const heartbeatRes = await app.request('/v1/devices/dev-1/heartbeat', {
            method: 'POST',
            headers: authHeaders
        })
        expect(heartbeatRes.status).toBe(200)

        const commandPayload = {
            commandId: 'mobile-c1',
            sessionId: 'mobile-s1',
            type: 'send_message',
            payload: { text: 'hello from mobile' },
            ttlMs: 30000
        }

        const commandRes1 = await app.request('/v1/sessions/mobile-s1/commands', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(commandPayload)
        })
        expect(commandRes1.status).toBe(200)
        const commandBody1 = await commandRes1.json() as { duplicate: boolean }
        expect(commandBody1.duplicate).toBe(false)

        const commandRes2 = await app.request('/v1/sessions/mobile-s1/commands', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(commandPayload)
        })
        const commandBody2 = await commandRes2.json() as { duplicate: boolean }
        expect(commandBody2.duplicate).toBe(true)

        const eventPayload = {
            eventId: 'mobile-e1',
            sessionId: 'mobile-s1',
            seq: 1,
            type: 'message_final',
            data: {
                text: 'done',
                role: 'assistant'
            },
            createdAt: Date.now()
        }

        const postEvent = await app.request('/v1/sessions/mobile-s1/events', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(eventPayload)
        })
        expect(postEvent.status).toBe(200)

        const eventsRes = await app.request('/v1/sessions/mobile-s1/events?afterSeq=0', {
            method: 'GET',
            headers: authHeaders
        })
        expect(eventsRes.status).toBe(200)
        const eventsBody = await eventsRes.json() as { events: Array<{ seq: number }> }
        expect(eventsBody.events).toHaveLength(1)
        expect(eventsBody.events[0]?.seq).toBe(1)

        const pushRegister = await app.request('/v1/push/register', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ token: 'ExponentPushToken[test]', platform: 'ios' })
        })
        expect(pushRegister.status).toBe(200)

        const pushDelete = await app.request('/v1/push/register', {
            method: 'DELETE',
            headers: authHeaders,
            body: JSON.stringify({ token: 'ExponentPushToken[test]' })
        })
        expect(pushDelete.status).toBe(200)

        const logoutRes = await app.request('/v1/auth/logout', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: login.refreshToken })
        })
        expect(logoutRes.status).toBe(200)
    })
})
