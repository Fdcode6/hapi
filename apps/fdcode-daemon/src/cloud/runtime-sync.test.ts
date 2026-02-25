import { describe, expect, it } from 'bun:test'
import type { CommandEnvelope, EventEnvelope } from '@fdcode/protocol'
import { RuntimeSyncClient } from './runtime-sync'
import { CommandDispatcher } from '../runtime/command-dispatcher'
import { EventPublisher } from '../runtime/event-publisher'
import { SessionManager } from '../runtime/session-manager'
import { createDriverRegistry } from '../drivers/registry'

function createJsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
            'content-type': 'application/json'
        }
    })
}

describe('runtime sync client', () => {
    it('claims command, dispatches and acknowledges', async () => {
        const calls: Array<{ url: string; method: string; body: string | undefined }> = []
        const command: CommandEnvelope = {
            commandId: 'c1',
            sessionId: 's1',
            type: 'send_message',
            payload: { text: 'hello' },
            ttlMs: 30_000
        }

        const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
            const method = init?.method ?? 'GET'
            calls.push({
                url: String(input),
                method,
                body: typeof init?.body === 'string' ? init.body : undefined
            })
            if (String(input).includes('/v1/device-runtime/commands?')) {
                return createJsonResponse({
                    commands: [{
                        commandId: command.commandId,
                        sessionId: command.sessionId,
                        command
                    }]
                })
            }
            return createJsonResponse({ ok: true })
        }

        const events = new EventPublisher()
        const manager = new SessionManager(createDriverRegistry(), events)
        const dispatcher = new CommandDispatcher(manager, process.cwd())
        const client = new RuntimeSyncClient({
            cloudUrl: 'http://127.0.0.1:4010',
            deviceToken: 'fdcode-device-dev',
            deviceId: 'test-device',
            pollIntervalMs: 10_000,
            batchSize: 10,
            fetchImpl
        }, dispatcher, events)

        await client.syncOnce()
        client.stop()

        expect(calls.some((call) => call.url.includes('/v1/device-runtime/commands?'))).toBe(true)
        expect(calls.some((call) => call.url.includes('/commands/s1/c1/ack'))).toBe(true)
        expect(calls.some((call) => call.url.includes('/sessions/s1/events'))).toBe(true)
    })

    it('publishes runtime events immediately', async () => {
        const calls: string[] = []
        const fetchImpl = async (input: string): Promise<Response> => {
            calls.push(String(input))
            if (String(input).includes('/v1/device-runtime/commands?')) {
                return createJsonResponse({ commands: [] })
            }
            return createJsonResponse({ ok: true })
        }

        const events = new EventPublisher()
        const manager = new SessionManager(createDriverRegistry(), events)
        const dispatcher = new CommandDispatcher(manager, process.cwd())
        const client = new RuntimeSyncClient({
            cloudUrl: 'http://127.0.0.1:4010',
            deviceToken: 'fdcode-device-dev',
            deviceId: 'test-device',
            pollIntervalMs: 10_000,
            batchSize: 10,
            fetchImpl
        }, dispatcher, events)

        const event: EventEnvelope = {
            eventId: 'e1',
            sessionId: 's1',
            seq: 1,
            type: 'ready',
            data: { status: 'idle' },
            createdAt: Date.now()
        }

        events.publish(event)
        await Bun.sleep(0)
        client.stop()

        expect(calls.some((url) => url.includes('/v1/device-runtime/sessions/s1/events'))).toBe(true)
    })

    it('suppresses startup connection warnings before first successful sync', async () => {
        const warnings: string[] = []
        const infos: string[] = []
        const originalWarn = console.warn
        const originalLog = console.log
        console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
        console.log = (...args: unknown[]) => infos.push(args.map(String).join(' '))

        const fetchImpl = async (): Promise<Response> => {
            throw new Error('ConnectionRefused')
        }

        try {
            const events = new EventPublisher()
            const manager = new SessionManager(createDriverRegistry(), events)
            const dispatcher = new CommandDispatcher(manager, process.cwd())
            const client = new RuntimeSyncClient({
                cloudUrl: 'http://127.0.0.1:4010',
                deviceToken: 'fdcode-device-dev',
                deviceId: 'test-device',
                pollIntervalMs: 10_000,
                batchSize: 10,
                fetchImpl
            }, dispatcher, events)

            client.start()
            await Bun.sleep(5)
            client.stop()
        } finally {
            console.warn = originalWarn
            console.log = originalLog
        }

        expect(warnings).toHaveLength(0)
        expect(infos.some((line) => line.includes('waiting for cloud'))).toBe(true)
    })

    it('warns when event publish fails after sync is healthy', async () => {
        const warnings: string[] = []
        const originalWarn = console.warn
        console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))

        try {
            const fetchImpl = async (input: string): Promise<Response> => {
                if (input.includes('/v1/device-runtime/commands?')) {
                    return createJsonResponse({ commands: [] })
                }
                return new Response('fail', { status: 500 })
            }

            const events = new EventPublisher()
            const manager = new SessionManager(createDriverRegistry(), events)
            const dispatcher = new CommandDispatcher(manager, process.cwd())
            const client = new RuntimeSyncClient({
                cloudUrl: 'http://127.0.0.1:4010',
                deviceToken: 'fdcode-device-dev',
                deviceId: 'test-device',
                pollIntervalMs: 10_000,
                batchSize: 10,
                fetchImpl
            }, dispatcher, events)

            await client.syncOnce()
            events.publish({
                eventId: 'e2',
                sessionId: 's2',
                seq: 1,
                type: 'ready',
                data: { status: 'idle' },
                createdAt: Date.now()
            })
            await Bun.sleep(0)
            client.stop()
        } finally {
            console.warn = originalWarn
        }

        expect(warnings.some((line) => line.includes('event publish failed'))).toBe(true)
    })
})
