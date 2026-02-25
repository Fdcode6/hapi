import { describe, expect, it } from 'bun:test'
import { MobileApiClient } from './client'

describe('mobile api client', () => {
    it('retries once after refresh on 401', async () => {
        let token: string | null = 'expired-token'
        let callCount = 0

        const client = new MobileApiClient('https://api.example.com', {
            getAccessToken: () => token,
            refreshAccessToken: async () => {
                token = 'fresh-token'
                return token
            }
        })

        const fetchMock = async (_url: string, init?: RequestInit): Promise<Response> => {
            callCount += 1
            const auth = new Headers(init?.headers).get('authorization')
            if (auth === 'Bearer expired-token') {
                return new Response('unauthorized', { status: 401 })
            }
            return Response.json({ ok: true })
        }

        const originalFetch = globalThis.fetch
        // @ts-expect-error test override
        globalThis.fetch = fetchMock

        const result = await client.request<{ ok: boolean }>('/v1/test')

        globalThis.fetch = originalFetch

        expect(result.ok).toBe(true)
        expect(callCount).toBe(2)
    })
})
