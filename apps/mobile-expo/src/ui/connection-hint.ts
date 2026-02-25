import type { ConnectionStatus } from '../realtime/connection-manager'

export type ConnectionHintInput = {
    status: ConnectionStatus
    disconnectedMs: number
}

export function buildConnectionHint(input: ConnectionHintInput): string | null {
    if (input.status === 'healthy') {
        return null
    }

    if (input.disconnectedMs < 10_000) {
        return null
    }

    if (input.status === 'offline') {
        return '网络已离线，恢复后将自动补偿同步。'
    }

    return '连接不稳定，正在自动恢复同步。'
}
