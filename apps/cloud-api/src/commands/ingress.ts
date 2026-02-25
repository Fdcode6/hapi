import type { CommandEnvelope, EventEnvelope } from '@fdcode/protocol'
import { SessionOwnershipStore } from '../sessions/ownership'
import { CommandService } from './service'
import type { StoredCommand } from './repo'

export type RuntimeBridge = {
    dispatch: (command: CommandEnvelope) => Promise<void>
    subscribe: (listener: (event: EventEnvelope) => void) => () => void
}

type SubmitResult =
    | { ok: true; value: StoredCommand; duplicate: boolean; dispatched: boolean }
    | { ok: false; error: string }

export class CommandIngressService {
    constructor(
        private readonly commandService: CommandService,
        private readonly owners: SessionOwnershipStore,
        private readonly runtimeBridge?: RuntimeBridge
    ) {}

    async submit(raw: unknown, userId: string): Promise<SubmitResult> {
        const commandResult = this.commandService.enqueue(raw)
        if (!commandResult.ok) {
            return commandResult
        }

        const stored = commandResult.value
        this.owners.setOwner(stored.sessionId, userId)
        if (commandResult.duplicate) {
            return { ok: true, value: stored, duplicate: true, dispatched: false }
        }

        if (!this.runtimeBridge) {
            return { ok: true, value: stored, duplicate: false, dispatched: false }
        }

        try {
            await this.runtimeBridge.dispatch(stored.command)
            const acked = this.commandService.ack(stored.sessionId, stored.commandId)
            return {
                ok: true,
                value: acked ?? stored,
                duplicate: false,
                dispatched: true
            }
        } catch {
            return {
                ok: true,
                value: stored,
                duplicate: false,
                dispatched: false
            }
        }
    }
}
