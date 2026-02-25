import type { DriverAdapter, DriverName } from '@fdcode/driver-sdk'
import type { CommandEnvelope, EventEnvelope } from '@fdcode/protocol'
import { createDriverRegistry } from '../drivers/registry'
import { CommandDispatcher } from './command-dispatcher'
import { EventPublisher } from './event-publisher'
import { SessionManager } from './session-manager'

export type RuntimeGateway = {
    dispatch: (command: CommandEnvelope) => Promise<void>
    subscribe: (listener: (event: EventEnvelope) => void) => () => void
}

export function createRuntimeGateway(args?: {
    cwd?: string
    drivers?: Record<DriverName, DriverAdapter>
}): RuntimeGateway {
    const events = new EventPublisher()
    const manager = new SessionManager(args?.drivers ?? createDriverRegistry(), events)
    const dispatcher = new CommandDispatcher(manager, args?.cwd ?? process.cwd())

    return {
        dispatch: async (command: CommandEnvelope) => {
            await dispatcher.handle(command)
        },
        subscribe: (listener: (event: EventEnvelope) => void) => events.subscribe(listener)
    }
}
