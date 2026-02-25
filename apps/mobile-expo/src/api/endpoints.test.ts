import { describe, expect, it } from 'bun:test'
import type { EventEnvelope } from '@fdcode/protocol'
import {
    fetchEventsAfter,
    getSessionDetail,
    listSessions,
    sendSessionMessage,
    type SessionDetailDto,
    type SessionSummaryDto
} from './endpoints'
import type { MobileApiClient } from './client'

describe('mobile api endpoints', () => {
    it('lists sessions and fetches detail', async () => {
        const sessions: SessionSummaryDto[] = [{
            sessionId: 's1',
            ownerId: 'owner',
            updatedAt: 1,
            lastSeq: 3,
            state: 'completed',
            lastEventType: 'ready'
        }]

        const detail: SessionDetailDto = {
            ...sessions[0],
            recentEvents: [{
                eventId: 'e1',
                sessionId: 's1',
                seq: 1,
                type: 'message_final',
                data: { text: 'done', role: 'assistant' },
                createdAt: Date.now()
            }]
        }

        const calls: string[] = []
        const client = {
            request: async (path: string) => {
                calls.push(path)
                if (path === '/v1/sessions') {
                    return { sessions }
                }
                return { session: detail }
            }
        } as unknown as MobileApiClient

        const listed = await listSessions(client)
        const fetched = await getSessionDetail(client, 's1')

        expect(listed).toHaveLength(1)
        expect(fetched.sessionId).toBe('s1')
        expect(calls).toEqual(['/v1/sessions', '/v1/sessions/s1'])
    })

    it('sends command and fetches replay events', async () => {
        const events: EventEnvelope[] = [{
            eventId: 'e2',
            sessionId: 's2',
            seq: 5,
            type: 'ready',
            data: { status: 'idle' },
            createdAt: Date.now()
        }]

        const calls: Array<{ path: string; method?: string; body?: string }> = []

        const client = {
            request: async (path: string, init?: RequestInit) => {
                calls.push({
                    path,
                    method: init?.method,
                    body: typeof init?.body === 'string' ? init.body : undefined
                })
                if (path.includes('/events?afterSeq=')) {
                    return { events }
                }

                return {
                    command: { commandId: 'c123' },
                    duplicate: false
                }
            }
        } as unknown as MobileApiClient

        const sent = await sendSessionMessage(client, 's2', 'hello')
        const replay = await fetchEventsAfter(client, 's2', 4)

        expect(sent.commandId).toBe('c123')
        expect(sent.duplicate).toBe(false)
        expect(replay[0]?.seq).toBe(5)
        expect(calls[0]?.path).toContain('/v1/sessions/s2/commands')
        expect(calls[0]?.method).toBe('POST')
        expect(calls[1]?.path).toBe('/v1/sessions/s2/events?afterSeq=4')
    })
})
