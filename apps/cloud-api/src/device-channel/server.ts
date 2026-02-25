export type DevicePresence = {
    deviceId: string
    online: boolean
    lastSeenAt: number
}

export class DeviceChannelService {
    private readonly devices = new Map<string, DevicePresence>()

    connect(deviceId: string, now = Date.now()): DevicePresence {
        const presence: DevicePresence = {
            deviceId,
            online: true,
            lastSeenAt: now
        }
        this.devices.set(deviceId, presence)
        return presence
    }

    heartbeat(deviceId: string, now = Date.now()): DevicePresence {
        const existing = this.devices.get(deviceId)
        if (!existing) {
            return this.connect(deviceId, now)
        }

        const next: DevicePresence = {
            ...existing,
            online: true,
            lastSeenAt: now
        }
        this.devices.set(deviceId, next)
        return next
    }

    markOfflineExpired(timeoutMs: number, now = Date.now()): void {
        for (const [deviceId, presence] of this.devices.entries()) {
            if (now - presence.lastSeenAt <= timeoutMs) {
                continue
            }
            this.devices.set(deviceId, {
                ...presence,
                online: false
            })
        }
    }

    get(deviceId: string): DevicePresence | null {
        return this.devices.get(deviceId) ?? null
    }
}
