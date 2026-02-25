import type { EventEnvelope } from '@fdcode/protocol'
import { PushService } from '../push/service'
import { SessionOwnershipStore } from '../sessions/ownership'

type SessionCompletionState = {
    lastAssistantFinalText: string | null
    lastAssistantFinalSeq: number
    lastNotifiedSeq: number
}

export class CompletionMonitor {
    private readonly stateBySession = new Map<string, SessionCompletionState>()

    constructor(
        private readonly owners: SessionOwnershipStore,
        private readonly pushService: PushService
    ) {}

    async onEvent(event: EventEnvelope): Promise<void> {
        const state = this.stateBySession.get(event.sessionId) ?? {
            lastAssistantFinalText: null,
            lastAssistantFinalSeq: 0,
            lastNotifiedSeq: 0
        }

        if (event.type === 'message_final' && event.data.role === 'assistant') {
            state.lastAssistantFinalText = event.data.text
            state.lastAssistantFinalSeq = event.seq
            this.stateBySession.set(event.sessionId, state)
            return
        }

        if (!this.isCompletionEvent(event)) {
            this.stateBySession.set(event.sessionId, state)
            return
        }

        if (!state.lastAssistantFinalText || state.lastAssistantFinalSeq === 0) {
            return
        }

        if (state.lastNotifiedSeq >= event.seq) {
            return
        }

        const owner = this.owners.getOwner(event.sessionId)
        if (!owner) {
            return
        }

        state.lastNotifiedSeq = event.seq
        this.stateBySession.set(event.sessionId, state)

        await this.pushService.sendCompletion({
            userId: owner,
            sessionId: event.sessionId,
            preview: state.lastAssistantFinalText
        })
    }

    private isCompletionEvent(event: EventEnvelope): boolean {
        if (event.type === 'ready') {
            return true
        }
        if (event.type !== 'session_state') {
            return false
        }
        return event.data.state === 'completed'
    }
}
