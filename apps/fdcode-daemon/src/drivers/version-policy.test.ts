import { describe, expect, it } from 'bun:test'
import { ensureAllowedVersion, isDriverVersionAllowed } from './version-policy'

describe('version policy', () => {
    it('allows matching versions and blocks unknown versions', () => {
        expect(isDriverVersionAllowed('0.1.5')).toBe(true)
        expect(isDriverVersionAllowed('1.0.0')).toBe(false)
    })

    it('throws for non-allowlisted versions', () => {
        expect(() => ensureAllowedVersion('1.2.3')).toThrow()
    })

    it('allows override flag', () => {
        expect(() => ensureAllowedVersion('1.2.3', { allowUnsafe: true })).not.toThrow()
    })
})
