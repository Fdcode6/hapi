import type { DriverAdapter, DriverEventHandler, DriverName, DriverSessionRef, DriverSessionStartInput } from '@fdcode/driver-sdk'
import type { CommandEnvelope, EventEnvelope } from '@fdcode/protocol'

export abstract class BaseMemoryAdapter implements DriverAdapter {
    protected readonly handlers = new Set<DriverEventHandler>()
    private readonly nextSeqBySession = new Map<string, number>()

    abstract readonly name: DriverName

    async startSession(input: DriverSessionStartInput): Promise<DriverSessionRef> {
        this.nextSeqBySession.set(input.sessionId, 1)
        return { sessionRef: `${this.name}:${input.sessionId}` }
    }

    async sendMessage(sessionRef: string, text: string): Promise<void> {
        const sessionId = this.sessionIdFromRef(sessionRef)
        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: this.nextSeq(sessionId),
            type: 'session_state',
            data: {
                state: 'running'
            },
            createdAt: Date.now()
        })

        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: this.nextSeq(sessionId),
            type: 'message_delta',
            data: {
                text,
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
                text,
                role: 'assistant'
            },
            createdAt: Date.now()
        })

        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: this.nextSeq(sessionId),
            type: 'ready',
            data: {
                status: 'idle'
            },
            createdAt: Date.now()
        })
    }

    async abort(sessionRef: string): Promise<void> {
        const sessionId = this.sessionIdFromRef(sessionRef)
        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: this.nextSeq(sessionId),
            type: 'session_state',
            data: {
                state: 'interrupted'
            },
            createdAt: Date.now()
        })
    }

    async switchMode(_sessionRef: string, _mode: 'local' | 'remote'): Promise<void> {
        return
    }

    onEvent(handler: DriverEventHandler): () => void {
        this.handlers.add(handler)
        return () => this.handlers.delete(handler)
    }

    async getVersion(): Promise<string> {
        return '0.1.0-dev'
    }

    async handleCommand(command: CommandEnvelope): Promise<void> {
        if (command.type !== 'approve_tool') {
            return
        }

        const sessionId = command.sessionId
        const nextSeq = this.nextSeq(sessionId)
        this.emit({
            eventId: crypto.randomUUID(),
            sessionId,
            seq: nextSeq,
            type: 'tool_result',
            data: {
                requestId: command.payload.requestId,
                ok: command.payload.approved,
                output: command.payload.reason ?? (command.payload.approved ? 'approved' : 'denied')
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

    protected emit(event: EventEnvelope): void {
        for (const handler of this.handlers) {
            handler(event)
        }
    }

    protected sessionIdFromRef(sessionRef: string): string {
        const [_driver, sessionId = sessionRef] = sessionRef.split(':')
        return sessionId
    }

    protected nextSeq(sessionId: string): number {
        const current = this.nextSeqBySession.get(sessionId) ?? 1
        this.nextSeqBySession.set(sessionId, current + 1)
        return current
    }
}
