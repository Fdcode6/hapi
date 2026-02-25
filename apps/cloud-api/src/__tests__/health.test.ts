import { describe, expect, it } from 'bun:test'
import { createApp } from '../app'

describe('health', () => {
    it('returns ok', async () => {
        const app = createApp()
        const res = await app.request('/health')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ status: 'ok' })
    })
})
