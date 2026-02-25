import { MobileApiClient } from '../api/client'

type AuthState = {
    accessToken: string | null
    refreshToken: string | null
}

const state: AuthState = {
    accessToken: null,
    refreshToken: null
}

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4010'
const REALTIME_WS_URL = process.env.REALTIME_WS_URL ?? API_BASE_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')

export const mobileClient = new MobileApiClient(API_BASE_URL, {
    realtimeWsUrl: REALTIME_WS_URL,
    getAccessToken: () => state.accessToken,
    refreshAccessToken: async () => {
        if (!state.refreshToken) {
            return null
        }

        const response = await fetch(new URL('/v1/auth/refresh', API_BASE_URL).toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: state.refreshToken })
        })

        if (!response.ok) {
            state.accessToken = null
            state.refreshToken = null
            return null
        }

        const body = await response.json() as { accessToken: string }
        state.accessToken = body.accessToken
        return state.accessToken
    }
})

export function setAuthTokens(tokens: { accessToken: string; refreshToken: string }): void {
    state.accessToken = tokens.accessToken
    state.refreshToken = tokens.refreshToken
}

export function clearAuthTokens(): void {
    state.accessToken = null
    state.refreshToken = null
}

export function hasAccessToken(): boolean {
    return Boolean(state.accessToken)
}
