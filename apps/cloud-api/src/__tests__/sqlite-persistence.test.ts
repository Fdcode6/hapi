import { afterEach, describe, expect, it } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { createCloudState } from '../state'

const tempFiles: string[] = []

afterEach(() => {
    while (tempFiles.length > 0) {
        const file = tempFiles.pop()
        if (!file) {
            continue
        }
        rmSync(file, { force: true })
    }
})

function createTempDbPath(): string {
    const path = join('/tmp', `fdcode-cloud-test-${crypto.randomUUID()}.sqlite`)
    tempFiles.push(path)
    return path
}

describe('sqlite persistence', () => {
    it('persists commands, events and ownership across state re-create', () => {
        const dbPath = createTempDbPath()

        const first = createCloudState({ dbPath })
        const enqueue = first.commandService.enqueue({
            commandId: 'persist-c1',
            sessionId: 'persist-s1',
            type: 'send_message',
            payload: { text: 'hello persistence' },
            ttlMs: 30_000
        })
        expect(enqueue.ok).toBe(true)
        first.eventService.append({
            eventId: 'persist-e1',
            sessionId: 'persist-s1',
            seq: 1,
            type: 'message_final',
            data: {
                text: 'done',
                role: 'assistant'
            },
            createdAt: Date.now()
        })
        first.ownershipStore.setOwner('persist-s1', 'owner')

        const second = createCloudState({ dbPath })
        const claimed = second.commandService.claimQueued(10)
        expect(claimed).toHaveLength(1)
        expect(claimed[0]?.commandId).toBe('persist-c1')
        expect(claimed[0]?.status).toBe('dispatched')

        const events = second.eventService.listAfter('persist-s1', 0)
        expect(events).toHaveLength(1)
        expect(events[0]?.eventId).toBe('persist-e1')

        expect(second.ownershipStore.getOwner('persist-s1')).toBe('owner')
    })
})
