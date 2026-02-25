import { describe, expect, it } from 'bun:test'
import type { EventEnvelope } from '@fdcode/protocol'
import { createDriverRegistry } from '../drivers/registry'
import { CommandDispatcher } from './command-dispatcher'
import { EventPublisher } from './event-publisher'
import { SessionManager } from './session-manager'

describe('session manager', () => {
    it('dispatches send_message and emits events', async () => {
        const events = new EventPublisher()
        const manager = new SessionManager(createDriverRegistry(), events)
        const dispatcher = new CommandDispatcher(manager, process.cwd())
        const received: EventEnvelope[] = []

        events.subscribe((event) => received.push(event))

        const ack = await dispatcher.handle({
            commandId: 'c1',
            sessionId: 's1',
            type: 'send_message',
            payload: { text: 'hello' },
            ttlMs: 30000
        })

        expect(ack.acked).toBe(true)
        expect(received.length).toBeGreaterThan(0)
        expect(received.some((event) => event.type === 'ready')).toBe(true)
    })

    it('handles approve_tool and emits tool_result', async () => {
        const events = new EventPublisher()
        const manager = new SessionManager(createDriverRegistry(), events)
        const dispatcher = new CommandDispatcher(manager, process.cwd())
        const received: EventEnvelope[] = []

        events.subscribe((event) => received.push(event))

        await dispatcher.handle({
            commandId: 'c-seed',
            sessionId: 's-tool',
            type: 'send_message',
            payload: { text: 'request tool' },
            ttlMs: 30000
        })

        const ack = await dispatcher.handle({
            commandId: 'c-approve',
            sessionId: 's-tool',
            type: 'approve_tool',
            payload: {
                requestId: 'r-1',
                approved: true
            },
            ttlMs: 30000
        })

        expect(ack.acked).toBe(true)
        expect(received.some((event) => event.type === 'tool_result')).toBe(true)
    })
})
