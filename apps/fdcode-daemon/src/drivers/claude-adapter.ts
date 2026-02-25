import { BaseMemoryAdapter } from './base-memory-adapter'
import { runCliCommand } from './cli-utils'

export class ClaudeAdapter extends BaseMemoryAdapter {
    readonly name = 'claude' as const

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
            command: 'claude',
            argv: ['-p', text]
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
}
