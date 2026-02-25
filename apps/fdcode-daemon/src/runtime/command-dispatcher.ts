import type { CommandEnvelope } from '@fdcode/protocol'
import { SessionManager } from './session-manager'

export class CommandDispatcher {
    constructor(private readonly manager: SessionManager, private readonly cwd: string) {}

    async handle(command: CommandEnvelope): Promise<{ acked: boolean; commandId: string }> {
        await this.manager.dispatch(command, this.cwd)
        return {
            acked: true,
            commandId: command.commandId
        }
    }
}
