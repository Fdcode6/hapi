import type { CommandEnvelope, EventEnvelope } from '@fdcode/protocol'
import type { CommandDispatcher } from '../runtime/command-dispatcher'
import type { EventPublisher } from '../runtime/event-publisher'

type DeviceCommandEnvelope = {
    commandId: string
    sessionId: string
    command: CommandEnvelope
}

type RuntimeSyncConfig = {
    cloudUrl: string
    deviceToken: string
    deviceId: string
    pollIntervalMs: number
    batchSize: number
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}

export class RuntimeSyncClient {
    private timer: NodeJS.Timeout | null = null
    private unsubEvents: (() => void) | null = null
    private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
    private running = false
    private hasSuccessfulSync = false
    private consecutiveSyncFailures = 0
    private lastSyncInfoLogAt = 0
    private lastSyncWarnLogAt = 0
    private lastPublishWarnLogAt = 0

    constructor(
        private readonly config: RuntimeSyncConfig,
        private readonly dispatcher: CommandDispatcher,
        events: EventPublisher
    ) {
        this.fetchImpl = config.fetchImpl ?? fetch
        this.unsubEvents = events.subscribe((event) => {
            void this.publishEventSafe(event)
        })
    }

    start(): void {
        if (this.timer) {
            return
        }
        this.timer = setInterval(() => {
            void this.syncOnceSafe()
        }, this.config.pollIntervalMs)
        void this.syncOnceSafe()
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
        if (this.unsubEvents) {
            this.unsubEvents()
            this.unsubEvents = null
        }
    }

    async syncOnce(): Promise<void> {
        if (this.running) {
            return
        }
        this.running = true
        try {
            const commands = await this.claimCommands()
            this.hasSuccessfulSync = true
            this.consecutiveSyncFailures = 0
            for (const item of commands) {
                try {
                    await this.dispatcher.handle(item.command)
                    await this.ack(item.sessionId, item.commandId, 'acked')
                } catch (error) {
                    await this.ack(item.sessionId, item.commandId, 'failed')
                    console.warn('[runtime-sync] command failed', error)
                }
            }
        } finally {
            this.running = false
        }
    }

    private async syncOnceSafe(): Promise<void> {
        try {
            await this.syncOnce()
        } catch (error) {
            this.consecutiveSyncFailures += 1

            if (!this.hasSuccessfulSync) {
                const now = Date.now()
                if (now - this.lastSyncInfoLogAt >= 15_000) {
                    this.lastSyncInfoLogAt = now
                    console.log('[runtime-sync] waiting for cloud (will retry silently)')
                }
                return
            }

            const now = Date.now()
            if (now - this.lastSyncWarnLogAt >= 10_000) {
                this.lastSyncWarnLogAt = now
                console.warn('[runtime-sync] sync cycle failed after connected', error)
            }
        }
    }

    private async claimCommands(): Promise<DeviceCommandEnvelope[]> {
        const url = new URL('/v1/device-runtime/commands', this.config.cloudUrl)
        url.searchParams.set('limit', String(this.config.batchSize))
        const res = await this.fetchImpl(url.toString(), {
            method: 'GET',
            headers: this.headers()
        })
        if (!res.ok) {
            throw new Error(`Claim commands failed: HTTP ${res.status}`)
        }
        const json = await res.json() as { commands?: DeviceCommandEnvelope[] }
        return json.commands ?? []
    }

    private async ack(sessionId: string, commandId: string, status: 'acked' | 'failed'): Promise<void> {
        const url = new URL(`/v1/device-runtime/commands/${sessionId}/${commandId}/ack`, this.config.cloudUrl)
        const res = await this.fetchImpl(url.toString(), {
            method: 'POST',
            headers: this.headers({
                'content-type': 'application/json'
            }),
            body: JSON.stringify({ status })
        })
        if (!res.ok) {
            throw new Error(`Ack failed: HTTP ${res.status}`)
        }
    }

    private async publishEvent(event: EventEnvelope): Promise<void> {
        const url = new URL(`/v1/device-runtime/sessions/${event.sessionId}/events`, this.config.cloudUrl)
        const res = await this.fetchImpl(url.toString(), {
            method: 'POST',
            headers: this.headers({
                'content-type': 'application/json'
            }),
            body: JSON.stringify(event)
        })
        if (!res.ok) {
            throw new Error(`Publish event failed: HTTP ${res.status}`)
        }
    }

    private async publishEventSafe(event: EventEnvelope): Promise<void> {
        try {
            await this.publishEvent(event)
        } catch (error) {
            const now = Date.now()
            if (now - this.lastPublishWarnLogAt >= 5_000) {
                this.lastPublishWarnLogAt = now
                console.warn('[runtime-sync] event publish failed', error)
            }
        }
    }

    private headers(extra?: Record<string, string>): Record<string, string> {
        return {
            'x-fdcode-device-token': this.config.deviceToken,
            'x-fdcode-device-id': this.config.deviceId,
            ...extra
        }
    }
}
