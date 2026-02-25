import type { EventEnvelope } from '@fdcode/protocol'

export type NotificationKind = 'completion' | 'tool_request' | 'error'

export type NotificationIntent = {
    kind: NotificationKind
    title: string
    body: string
    data?: Record<string, unknown>
}

type NotificationPolicyOptions = {
    debounceMs?: number
    now?: () => number
}

type NotificationContext = {
    sessionId: string
    assistantPreview: string | null
}

const DEFAULT_DEBOUNCE_MS = 20_000

export class NotificationPolicy {
    private readonly debounceMs: number
    private readonly now: () => number
    private readonly lastSentAt = new Map<string, number>()

    constructor(options: NotificationPolicyOptions = {}) {
        this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
        this.now = options.now ?? (() => Date.now())
    }

    evaluate(event: EventEnvelope, context: NotificationContext): NotificationIntent | null {
        const intent = this.toIntent(event, context)
        if (!intent) {
            return null
        }

        const key = `${context.sessionId}:${intent.kind}`
        const now = this.now()
        const lastSent = this.lastSentAt.get(key)
        if (lastSent !== undefined && now - lastSent < this.debounceMs) {
            return null
        }

        this.lastSentAt.set(key, now)
        return intent
    }

    private toIntent(event: EventEnvelope, context: NotificationContext): NotificationIntent | null {
        if (event.type === 'ready' || (event.type === 'session_state' && event.data.state === 'completed')) {
            if (!context.assistantPreview) {
                return null
            }
            return {
                kind: 'completion',
                title: `FDCode 完成 · ${context.sessionId}`,
                body: context.assistantPreview,
                data: {
                    sessionId: context.sessionId,
                    type: 'session_completed'
                }
            }
        }

        if (event.type === 'tool_request') {
            return {
                kind: 'tool_request',
                title: `FDCode 待授权 · ${context.sessionId}`,
                body: `工具 ${event.data.tool} 正在等待你的授权`,
                data: {
                    sessionId: context.sessionId,
                    requestId: event.data.requestId,
                    type: 'tool_request'
                }
            }
        }

        if (event.type === 'error') {
            return {
                kind: 'error',
                title: `FDCode 异常 · ${context.sessionId}`,
                body: event.data.message.slice(0, 120),
                data: {
                    sessionId: context.sessionId,
                    code: event.data.code,
                    type: 'session_error'
                }
            }
        }

        return null
    }
}
