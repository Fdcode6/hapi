import type { EventEnvelope } from '@fdcode/protocol'
import { PushService } from '../push/service'
import { SessionOwnershipStore } from '../sessions/ownership'
import { NotificationPolicy } from './policy'

type SessionCompletionState = {
    lastAssistantFinalText: string | null
    lastAssistantFinalSeq: number
}

export class CompletionMonitor {
    private readonly stateBySession = new Map<string, SessionCompletionState>()

    constructor(
        private readonly owners: SessionOwnershipStore,
        private readonly pushService: PushService,
        private readonly policy: NotificationPolicy = new NotificationPolicy()
    ) {}

    async onEvent(event: EventEnvelope): Promise<void> {
        const state = this.stateBySession.get(event.sessionId) ?? {
            lastAssistantFinalText: null,
            lastAssistantFinalSeq: 0
        }

        if (event.type === 'message_final' && event.data.role === 'assistant') {
            state.lastAssistantFinalText = event.data.text
            state.lastAssistantFinalSeq = event.seq
            this.stateBySession.set(event.sessionId, state)
            return
        }

        this.stateBySession.set(event.sessionId, state)

        const owner = this.owners.getOwner(event.sessionId)
        if (!owner) {
            return
        }

        const intent = this.policy.evaluate(event, {
            sessionId: event.sessionId,
            assistantPreview: state.lastAssistantFinalText
        })
        if (!intent) {
            return
        }

        if (intent.kind === 'completion') {
            await this.pushService.sendCompletion({
                userId: owner,
                sessionId: event.sessionId,
                preview: state.lastAssistantFinalText ?? intent.body
            })
            return
        }

        if (intent.kind === 'tool_request') {
            await this.pushService.sendToolRequest({
                userId: owner,
                sessionId: event.sessionId,
                body: intent.body,
                data: intent.data
            })
            return
        }

        await this.pushService.sendError({
            userId: owner,
            sessionId: event.sessionId,
            body: intent.body,
            data: intent.data
        })
    }
}
