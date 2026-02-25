import type { DriverAdapter, DriverName } from '@fdcode/driver-sdk'
import type { CommandEnvelope, EventEnvelope } from '@fdcode/protocol'
import { EventPublisher } from './event-publisher'

export type RuntimeSession = {
    sessionId: string
    driver: DriverName
    sessionRef: string
}

export class SessionManager {
    private readonly sessions = new Map<string, RuntimeSession>()
    private readonly defaultDriver: DriverName

    constructor(
        private readonly drivers: Record<DriverName, DriverAdapter>,
        private readonly events: EventPublisher
    ) {
        this.defaultDriver = (process.env.FDCODE_DEFAULT_DRIVER as DriverName | undefined) ?? 'codex'
        for (const driver of Object.values(drivers)) {
            driver.onEvent((event) => {
                this.events.publish(event)
            })
        }
    }

    async ensureSession(args: { sessionId: string; driver: DriverName; cwd: string }): Promise<RuntimeSession> {
        const existing = this.sessions.get(args.sessionId)
        if (existing) {
            return existing
        }

        const adapter = this.drivers[args.driver]
        const started = await adapter.startSession({
            sessionId: args.sessionId,
            cwd: args.cwd
        })

        const session: RuntimeSession = {
            sessionId: args.sessionId,
            driver: args.driver,
            sessionRef: started.sessionRef
        }

        this.sessions.set(args.sessionId, session)
        return session
    }

    async dispatch(command: CommandEnvelope, cwd: string): Promise<void> {
        const session = await this.ensureSession({
            sessionId: command.sessionId,
            driver: command.driver ?? this.defaultDriver,
            cwd
        })

        const adapter = this.drivers[session.driver]
        if (command.type === 'send_message') {
            await adapter.sendMessage(session.sessionRef, command.payload.text)
            return
        }

        if (command.type === 'abort') {
            await adapter.abort(session.sessionRef)
            return
        }

        if (command.type === 'switch_mode') {
            await adapter.switchMode(session.sessionRef, command.payload.mode)
            return
        }

        if (command.type === 'approve_tool' && adapter.handleCommand) {
            await adapter.handleCommand(command)
            return
        }
    }

    emit(event: EventEnvelope): void {
        this.events.publish(event)
    }
}
