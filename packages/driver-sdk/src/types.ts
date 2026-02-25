import type { CommandEnvelope, EventEnvelope } from '@fdcode/protocol'

export type DriverName = 'claude' | 'codex' | 'gemini'

export type DriverSessionStartInput = {
    sessionId: string
    cwd: string
    model?: string
}

export type DriverSessionRef = {
    sessionRef: string
}

export type DriverEventHandler = (event: EventEnvelope) => void

export interface DriverAdapter {
    readonly name: DriverName
    startSession(input: DriverSessionStartInput): Promise<DriverSessionRef>
    sendMessage(sessionRef: string, text: string): Promise<void>
    abort(sessionRef: string): Promise<void>
    switchMode(sessionRef: string, mode: 'local' | 'remote'): Promise<void>
    onEvent(handler: DriverEventHandler): () => void
    getVersion(): Promise<string>
    handleCommand?(command: CommandEnvelope): Promise<void>
}
