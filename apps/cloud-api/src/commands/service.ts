import { CommandEnvelopeSchema, type CommandEnvelope } from '@fdcode/protocol'
import { CommandRepository, type CommandStatus, type StoredCommand } from './repo'

export class CommandService {
    constructor(private readonly repo: CommandRepository) {}

    enqueue(raw: unknown): { ok: true; value: StoredCommand; duplicate: boolean } | { ok: false; error: string } {
        const parsed = CommandEnvelopeSchema.safeParse(raw)
        if (!parsed.success) {
            return { ok: false, error: 'Invalid command envelope' }
        }

        const command = parsed.data as CommandEnvelope
        const existing = this.repo.get(command.sessionId, command.commandId)
        if (existing) {
            return { ok: true, value: existing, duplicate: true }
        }

        const stored = this.repo.putIfAbsent(command)
        return { ok: true, value: stored, duplicate: false }
    }

    ack(sessionId: string, commandId: string): StoredCommand | null {
        return this.repo.updateStatus(sessionId, commandId, 'acked')
    }

    claimQueued(limit: number): StoredCommand[] {
        const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20
        return this.repo.claimQueued(safeLimit)
    }

    updateStatus(sessionId: string, commandId: string, status: CommandStatus): StoredCommand | null {
        return this.repo.updateStatus(sessionId, commandId, status)
    }
}
