import { describe, expect, it } from 'bun:test'
import { createApp } from '../app'

describe('device runtime routes', () => {
    it('allows device to claim queued command and ack with device token', async () => {
        const app = createApp()

        const loginRes = await app.request('/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: 'fdcode-local-dev' })
        })
        const login = await loginRes.json() as { accessToken: string }
        const userHeaders = {
            authorization: `Bearer ${login.accessToken}`,
            'content-type': 'application/json'
        }

        await app.request('/v1/sessions/s1/commands', {
            method: 'POST',
            headers: userHeaders,
            body: JSON.stringify({
                commandId: 'c1',
                sessionId: 's1',
                type: 'send_message',
                payload: { text: 'run me' },
                ttlMs: 30000
            })
        })

        const deviceHeaders = {
            'x-fdcode-device-token': 'fdcode-device-dev',
            'x-fdcode-device-id': 'test-device',
            'content-type': 'application/json'
        }

        const claimRes = await app.request('/v1/device-runtime/commands?limit=10', {
            method: 'GET',
            headers: deviceHeaders
        })
        expect(claimRes.status).toBe(200)
        const claimBody = await claimRes.json() as {
            commands: Array<{ commandId: string; status: string; sessionId: string }>
        }
        expect(claimBody.commands).toHaveLength(1)
        expect(claimBody.commands[0]?.status).toBe('dispatched')

        const ackRes = await app.request('/v1/device-runtime/commands/s1/c1/ack', {
            method: 'POST',
            headers: deviceHeaders,
            body: JSON.stringify({ status: 'acked' })
        })
        expect(ackRes.status).toBe(200)
        const ackBody = await ackRes.json() as { command: { status: string } }
        expect(ackBody.command.status).toBe('acked')
    })
})
