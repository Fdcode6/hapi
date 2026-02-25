import { describe, expect, it } from 'bun:test'
import { buildConnectionHint } from './connection-hint'

describe('connection hint', () => {
    it('hides hint for short disconnects', () => {
        expect(buildConnectionHint({ status: 'degraded', disconnectedMs: 9_999 })).toBeNull()
    })

    it('returns lightweight hint after threshold', () => {
        expect(buildConnectionHint({ status: 'degraded', disconnectedMs: 10_000 })).toContain('恢复同步')
        expect(buildConnectionHint({ status: 'offline', disconnectedMs: 12_000 })).toContain('离线')
    })
})
