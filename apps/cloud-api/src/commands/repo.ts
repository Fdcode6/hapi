import type { Database } from 'bun:sqlite'
import type { CommandEnvelope } from '@fdcode/protocol'

export type CommandStatus = 'queued' | 'dispatched' | 'acked' | 'timeout' | 'failed'

export type StoredCommand = {
    commandId: string
    sessionId: string
    status: CommandStatus
    command: CommandEnvelope
    createdAt: number
    updatedAt: number
}

function rowToStoredCommand(row: Record<string, unknown>): StoredCommand {
    return {
        commandId: String(row.command_id),
        sessionId: String(row.session_id),
        status: String(row.status) as CommandStatus,
        command: JSON.parse(String(row.command_json)) as CommandEnvelope,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at)
    }
}

export class CommandRepository {
    constructor(private readonly db: Database) {}

    putIfAbsent(command: CommandEnvelope): StoredCommand {
        const existing = this.get(command.sessionId, command.commandId)
        if (existing) {
            return existing
        }

        const now = Date.now()
        this.db.query(`
            INSERT INTO commands (session_id, command_id, status, command_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            command.sessionId,
            command.commandId,
            'queued',
            JSON.stringify(command),
            now,
            now
        )

        return {
            commandId: command.commandId,
            sessionId: command.sessionId,
            status: 'queued',
            command,
            createdAt: now,
            updatedAt: now
        }
    }

    updateStatus(sessionId: string, commandId: string, status: CommandStatus): StoredCommand | null {
        const now = Date.now()
        const result = this.db.query(`
            UPDATE commands
            SET status = ?, updated_at = ?
            WHERE session_id = ? AND command_id = ?
            RETURNING session_id, command_id, status, command_json, created_at, updated_at
        `).get(
            status,
            now,
            sessionId,
            commandId
        ) as Record<string, unknown> | null

        return result ? rowToStoredCommand(result) : null
    }

    get(sessionId: string, commandId: string): StoredCommand | null {
        const row = this.db.query(`
            SELECT session_id, command_id, status, command_json, created_at, updated_at
            FROM commands
            WHERE session_id = ? AND command_id = ?
        `).get(
            sessionId,
            commandId
        ) as Record<string, unknown> | null
        return row ? rowToStoredCommand(row) : null
    }

    claimQueued(limit: number): StoredCommand[] {
        const transaction = this.db.transaction((maxRows: number) => {
            const rows = this.db.query(`
                SELECT session_id, command_id, status, command_json, created_at, updated_at
                FROM commands
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT ?
            `).all(maxRows) as Record<string, unknown>[]

            const now = Date.now()
            const updateStatus = this.db.query(`
                UPDATE commands
                SET status = 'dispatched', updated_at = ?
                WHERE session_id = ? AND command_id = ?
            `)

            const claimed: StoredCommand[] = []
            for (const row of rows) {
                updateStatus.run(
                    now,
                    String(row.session_id),
                    String(row.command_id)
                )
                claimed.push({
                    ...rowToStoredCommand(row),
                    status: 'dispatched',
                    updatedAt: now
                })
            }
            return claimed
        })

        return transaction(Math.max(1, limit))
    }
}
