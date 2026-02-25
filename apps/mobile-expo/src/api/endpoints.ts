import type { EventEnvelope } from '@fdcode/protocol'
import { MobileApiClient } from './client'

export type LoginResult = {
    accessToken: string
    refreshToken: string
    expiresInSeconds: number
    user: {
        id: string
        name: string
    }
}

export type SessionSummaryDto = {
    sessionId: string
    ownerId: string
    updatedAt: number
    lastSeq: number
    state: string
    lastEventType: string | null
}

export type SessionDetailDto = SessionSummaryDto & {
    recentEvents: EventEnvelope[]
}

export async function loginWithAccessToken(
    client: MobileApiClient,
    accessToken: string
): Promise<LoginResult> {
    return await client.request<LoginResult>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ accessToken })
    })
}

export async function refreshWithToken(
    client: MobileApiClient,
    refreshToken: string
): Promise<{ accessToken: string; expiresInSeconds: number }> {
    return await client.request<{ accessToken: string; expiresInSeconds: number }>('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken })
    })
}

export async function listSessions(client: MobileApiClient): Promise<SessionSummaryDto[]> {
    const result = await client.request<{ sessions: SessionSummaryDto[] }>('/v1/sessions')
    return result.sessions
}

export async function getSessionDetail(client: MobileApiClient, sessionId: string): Promise<SessionDetailDto> {
    const result = await client.request<{ session: SessionDetailDto }>(`/v1/sessions/${encodeURIComponent(sessionId)}`)
    return result.session
}

export async function fetchEventsAfter(
    client: MobileApiClient,
    sessionId: string,
    afterSeq: number
): Promise<EventEnvelope[]> {
    const result = await client.request<{ events: EventEnvelope[] }>(
        `/v1/sessions/${encodeURIComponent(sessionId)}/events?afterSeq=${Math.max(0, afterSeq)}`
    )
    return result.events
}

export async function sendSessionMessage(
    client: MobileApiClient,
    sessionId: string,
    text: string
): Promise<{ commandId: string; duplicate: boolean }> {
    const commandId = crypto.randomUUID()
    const response = await client.request<{
        command: { commandId: string }
        duplicate: boolean
    }>(`/v1/sessions/${encodeURIComponent(sessionId)}/commands`, {
        method: 'POST',
        body: JSON.stringify({
            commandId,
            sessionId,
            type: 'send_message',
            payload: { text },
            ttlMs: 30_000
        })
    })

    return {
        commandId: response.command.commandId,
        duplicate: response.duplicate
    }
}
