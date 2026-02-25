import type { Database } from 'bun:sqlite'

export type PushRecord = {
    userId: string
    token: string
    platform: 'ios' | 'android'
    createdAt: number
}

export type PushMessage = {
    userId: string
    title: string
    body: string
    data?: Record<string, unknown>
}

type PushFetch = (input: string, init?: RequestInit) => Promise<Response>

export type BarkNotifierConfig = {
    endpoint: string
    group?: string
    sound?: string
    icon?: string
    fetchImpl?: PushFetch
}

export type ExpoPushNotifierConfig = {
    endpoint?: string
    accessToken?: string
    fetchImpl?: PushFetch
}

export class BarkNotifier {
    private readonly fetchImpl: PushFetch

    constructor(private readonly config: BarkNotifierConfig) {
        this.fetchImpl = config.fetchImpl ?? fetch
    }

    buildUrl(message: PushMessage): string {
        const endpoint = this.config.endpoint.replace(/\/+$/, '')
        const title = encodeURIComponent(message.title)
        const body = encodeURIComponent(message.body)
        const url = new URL(`${endpoint}/${title}/${body}`)
        if (this.config.group) {
            url.searchParams.set('group', this.config.group)
        }
        if (this.config.sound) {
            url.searchParams.set('sound', this.config.sound)
        }
        if (this.config.icon) {
            url.searchParams.set('icon', this.config.icon)
        }
        return url.toString()
    }

    async notify(message: PushMessage): Promise<void> {
        const res = await this.fetchImpl(this.buildUrl(message), {
            method: 'GET'
        })
        if (!res.ok) {
            throw new Error(`Bark push failed: HTTP ${res.status}`)
        }
    }
}

export class ExpoPushNotifier {
    private readonly fetchImpl: PushFetch
    private readonly endpoint: string

    constructor(private readonly config: ExpoPushNotifierConfig) {
        this.fetchImpl = config.fetchImpl ?? fetch
        this.endpoint = config.endpoint ?? 'https://exp.host/--/api/v2/push/send'
    }

    async notify(tokens: PushRecord[], message: PushMessage): Promise<void> {
        const validTokens = tokens
            .map((token) => token.token)
            .filter((token) => token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))

        if (validTokens.length === 0) {
            return
        }

        const payload = validTokens.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: 'default'
        }))

        const headers: Record<string, string> = {
            'content-type': 'application/json'
        }
        if (this.config.accessToken) {
            headers.authorization = `Bearer ${this.config.accessToken}`
        }

        const res = await this.fetchImpl(this.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        })
        if (!res.ok) {
            throw new Error(`Expo push failed: HTTP ${res.status}`)
        }
    }
}

export class PushService {
    private readonly sent: PushMessage[] = []

    constructor(
        private readonly db: Database,
        private readonly barkNotifier?: BarkNotifier,
        private readonly expoNotifier?: ExpoPushNotifier
    ) {}

    registerToken(record: PushRecord): void {
        this.db.query(`
            INSERT INTO push_tokens (user_id, token, platform, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, token) DO NOTHING
        `).run(
            record.userId,
            record.token,
            record.platform,
            record.createdAt
        )
    }

    unregisterToken(userId: string, token: string): void {
        this.db.query(`
            DELETE FROM push_tokens
            WHERE user_id = ? AND token = ?
        `).run(
            userId,
            token
        )
    }

    async send(message: PushMessage): Promise<void> {
        const tokens = this.getTokens(message.userId)
        if (tokens.length === 0 && !this.barkNotifier && !this.expoNotifier) {
            return
        }

        this.sent.push(message)

        if (this.expoNotifier) {
            try {
                await this.expoNotifier.notify(tokens, message)
            } catch (error) {
                console.warn('[push] expo notify failed', error)
            }
        }

        if (this.barkNotifier) {
            try {
                await this.barkNotifier.notify(message)
            } catch (error) {
                console.warn('[push] bark notify failed', error)
            }
        }
    }

    async sendCompletion(args: {
        userId: string
        sessionId: string
        preview: string
    }): Promise<void> {
        const preview = args.preview.trim().replace(/\s+/g, ' ').slice(0, 120)
        const body = preview.length > 0 ? preview : '任务已完成，等待你的下一步指令'
        await this.send({
            userId: args.userId,
            title: `FDCode 完成 · ${args.sessionId}`,
            body,
            data: {
                sessionId: args.sessionId,
                type: 'session_completed'
            }
        })
    }

    getSent(): PushMessage[] {
        return this.sent
    }

    private getTokens(userId: string): PushRecord[] {
        const rows = this.db.query(`
            SELECT user_id, token, platform, created_at
            FROM push_tokens
            WHERE user_id = ?
            ORDER BY created_at ASC
        `).all(userId) as Array<{
            user_id: string
            token: string
            platform: string
            created_at: number
        }>

        return rows.map((row) => ({
            userId: row.user_id,
            token: row.token,
            platform: row.platform === 'android' ? 'android' : 'ios',
            createdAt: row.created_at
        }))
    }
}
