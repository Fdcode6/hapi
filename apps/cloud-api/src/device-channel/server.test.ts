import { describe, expect, it } from 'bun:test'
import { DeviceChannelService } from './server'

describe('device channel service', () => {
    it('tracks heartbeat and expires stale devices', () => {
        const service = new DeviceChannelService()

        service.connect('d1', 100)
        service.heartbeat('d1', 120)
        expect(service.get('d1')?.online).toBe(true)

        service.markOfflineExpired(10, 200)
        expect(service.get('d1')?.online).toBe(false)
    })
})
