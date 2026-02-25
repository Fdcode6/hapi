export type MobileApiClientOptions = {
    getAccessToken: () => string | null
    refreshAccessToken: () => Promise<string | null>
    realtimeWsUrl?: string
}

export class MobileApiClient {
    constructor(
        private readonly baseUrl: string,
        private readonly options: MobileApiClientOptions
    ) {}

    async buildRealtimeUrl(sessionId: string, afterSeq: number): Promise<string | null> {
        const token = this.options.getAccessToken() ?? await this.options.refreshAccessToken()
        if (!token) {
            return null
        }

        const wsBase = this.options.realtimeWsUrl
            ?? this.baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
        const url = new URL('/v1/realtime', wsBase)
        url.searchParams.set('sessionId', sessionId)
        url.searchParams.set('afterSeq', String(Math.max(0, afterSeq)))
        url.searchParams.set('accessToken', token)
        return url.toString()
    }

    async request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
        const token = this.options.getAccessToken()
        const headers = new Headers(init?.headers)
        if (token) {
            headers.set('authorization', `Bearer ${token}`)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(new URL(path, this.baseUrl).toString(), {
            ...init,
            headers
        })

        if (res.status === 401 && attempt === 0) {
            const refreshed = await this.options.refreshAccessToken()
            if (refreshed) {
                return await this.request<T>(path, init, 1)
            }
        }

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`)
        }

        return await res.json() as T
    }
}
