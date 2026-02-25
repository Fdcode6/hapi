import { createHeartbeatTicker } from './heartbeat'

export class DeviceChannelClient {
    private socket: WebSocket | null = null
    private readonly heartbeat

    constructor(private readonly config: { url: string; deviceId: string; token: string }) {
        this.heartbeat = createHeartbeatTicker({
            intervalMs: 10000,
            onTick: async () => {
                if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                    return
                }
                this.socket.send(JSON.stringify({
                    type: 'heartbeat',
                    deviceId: this.config.deviceId,
                    time: Date.now()
                }))
            }
        })
    }

    connect(): void {
        if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
            return
        }

        this.socket = new WebSocket(this.config.url, {
            headers: {
                authorization: `Bearer ${this.config.token}`
            }
        })

        this.socket.addEventListener('open', () => {
            this.socket?.send(JSON.stringify({ type: 'pair', deviceId: this.config.deviceId }))
            this.heartbeat.start()
        })

        this.socket.addEventListener('close', () => {
            this.heartbeat.stop()
        })
    }

    disconnect(): void {
        this.heartbeat.stop()
        this.socket?.close()
        this.socket = null
    }
}
