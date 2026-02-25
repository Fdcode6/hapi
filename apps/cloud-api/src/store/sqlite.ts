import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS commands (
    session_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    status TEXT NOT NULL,
    command_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, command_id)
);

CREATE INDEX IF NOT EXISTS idx_commands_status_created
    ON commands (status, created_at);

CREATE TABLE IF NOT EXISTS events (
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_session_seq
    ON events (session_id, seq);

CREATE TABLE IF NOT EXISTS session_owners (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_tokens (
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, token)
);
`

export function openCloudDatabase(path: string): Database {
    if (path !== ':memory:') {
        mkdirSync(dirname(path), { recursive: true })
    }

    const db = new Database(path, { create: true, strict: true })
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec('PRAGMA synchronous = NORMAL;')
    db.exec(SCHEMA_SQL)
    return db
}
