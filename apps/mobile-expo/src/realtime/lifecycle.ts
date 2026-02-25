import type { EventEnvelope } from '@fdcode/protocol'
import type { ConnectionManager, RealtimeHandlers } from './connection-manager'

export type AppLifecycleState = 'active' | 'inactive' | 'background'

export class RealtimeLifecycleController {
    private sessionId: string | null = null
    private handlers: RealtimeHandlers | null = null

    constructor(
        private readonly manager: ConnectionManager,
        private readonly readCursor: (sessionId: string) => number
    ) {}

    async bindSession(sessionId: string, handlers: RealtimeHandlers): Promise<EventEnvelope[]> {
        this.sessionId = sessionId
        this.handlers = handlers
        return await this.manager.enterForeground(sessionId, this.readCursor(sessionId), handlers)
    }

    unbindSession(): void {
        this.sessionId = null
        this.handlers = null
        this.manager.stop()
    }

    async onAppStateChange(nextState: AppLifecycleState): Promise<EventEnvelope[]> {
        if (nextState === 'active') {
            if (!this.sessionId || !this.handlers) {
                return []
            }
            return await this.manager.enterForeground(this.sessionId, this.readCursor(this.sessionId), this.handlers)
        }

        this.manager.enterBackground()
        return []
    }
}
