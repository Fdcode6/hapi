import { describe, expect, it } from 'bun:test'
import { signAccessToken } from '../auth/jwt'
import { SessionOwnershipStore } from '../sessions/ownership'
import { openCloudDatabase } from '../store/sqlite'
import { resolveRealtimeRequest } from './auth'

describe('realtime auth', () => {
    it('authorizes query access token and defaults afterSeq', async () => {
        const owners = new SessionOwnershipStore(openCloudDatabase(':memory:'))
        owners.setOwner('s1', 'owner')

        const token = await signAccessToken({
            userId: 'owner',
            sessionId: 'auth-s1',
            expiresIn: '20m'
        })

        const req = new Request(`http://localhost/v1/realtime?sessionId=s1&accessToken=${encodeURIComponent(token)}`)
        const result = await resolveRealtimeRequest(req, owners)

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.value.sessionId).toBe('s1')
            expect(result.value.afterSeq).toBe(0)
            expect(result.value.userId).toBe('owner')
        }
    })

    it('rejects missing token', async () => {
        const owners = new SessionOwnershipStore(openCloudDatabase(':memory:'))
        const req = new Request('http://localhost/v1/realtime?sessionId=s1&afterSeq=2')
        const result = await resolveRealtimeRequest(req, owners)

        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.status).toBe(401)
        }
    })

    it('rejects owner mismatch', async () => {
        const owners = new SessionOwnershipStore(openCloudDatabase(':memory:'))
        owners.setOwner('s1', 'owner-a')

        const token = await signAccessToken({
            userId: 'owner-b',
            sessionId: 'auth-s2',
            expiresIn: '20m'
        })

        const req = new Request(`http://localhost/v1/realtime?sessionId=s1&accessToken=${encodeURIComponent(token)}`)
        const result = await resolveRealtimeRequest(req, owners)

        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.status).toBe(403)
        }
    })
})
