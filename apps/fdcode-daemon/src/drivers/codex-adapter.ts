import type { EventEnvelope } from '@fdcode/protocol'
import { BaseMemoryAdapter } from './base-memory-adapter'
import { runCliCommand } from './cli-utils'

export class CodexAdapter extends BaseMemoryAdapter {
    readonly name = 'codex' as const

    async sendMessage(sessionRef: string, text: string): Promise<void> {
        const useRealCli = process.env.FDCODE_ADAPTER_MODE === 'real' || Boolean(process.env.FDCODE_CLOUD_URL)
        if (!useRealCli) {
            await super.sendMessage(sessionRef, text)
            return
        }

        const sessionId = this.sessionIdFromRef(sessionRef)
        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: this.nextSeq(sessionId),
            type: 'session_state',
            data: { state: 'running' },
            createdAt: Date.now()
        })

        const result = await runCliCommand({
            command: 'codex',
            argv: ['exec', text]
        })

        if (!result.ok) {
            this.emit({
                eventId: crypto.randomUUID(),
                sessionId,
                seq: this.nextSeq(sessionId),
                type: 'error',
                data: { message: result.error },
                createdAt: Date.now()
            })
            this.emit({
                eventId: crypto.randomUUID(),
                sessionId,
                seq: this.nextSeq(sessionId),
                type: 'session_state',
                data: { state: 'failed' },
                createdAt: Date.now()
            })
            return
        }

        const output = result.output.length > 0 ? result.output : '(empty)'
        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: this.nextSeq(sessionId),
            type: 'message_delta',
            data: {
                text: output,
                role: 'assistant'
            },
            createdAt: Date.now()
        })
        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: this.nextSeq(sessionId),
            type: 'message_final',
            data: {
                text: output,
                role: 'assistant'
            },
            createdAt: Date.now()
        })
        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: this.nextSeq(sessionId),
            type: 'ready',
            data: { status: 'idle' },
            createdAt: Date.now()
        })
    }

    parseRawEvent(raw: Record<string, unknown>): EventEnvelope | null {
        const type = typeof raw.type === 'string' ? raw.type : null
        const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : 'unknown'
        const seq = typeof raw.seq === 'number' ? raw.seq : 1

        if (type === 'task_started') {
            return {
                eventId: crypto.randomUUID(),
                sessionId,
                seq,
                type: 'session_state',
                data: { state: 'running' },
                createdAt: Date.now()
            }
        }

        if (type === 'agent_message') {
            return {
                eventId: crypto.randomUUID(),
                sessionId,
                seq,
                type: 'message_delta',
                data: {
                    text: String(raw.message ?? ''),
                    role: 'assistant'
                },
                createdAt: Date.now()
            }
        }

        if (type === 'task_complete') {
            return {
                eventId: crypto.randomUUID(),
                sessionId,
                seq,
                type: 'ready',
                data: { status: 'idle' },
                createdAt: Date.now()
            }
        }

        return null
    }
}
