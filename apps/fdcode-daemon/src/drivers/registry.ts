import type { DriverAdapter, DriverName } from '@fdcode/driver-sdk'
import { ClaudeAdapter } from './claude-adapter'
import { CodexAdapter } from './codex-adapter'
import { GeminiAdapter } from './gemini-adapter'

export function createDriverRegistry(): Record<DriverName, DriverAdapter> {
    return {
        claude: new ClaudeAdapter(),
        codex: new CodexAdapter(),
        gemini: new GeminiAdapter()
    }
}
