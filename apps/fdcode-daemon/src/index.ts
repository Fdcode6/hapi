import { CommandDispatcher } from './runtime/command-dispatcher'
import { EventPublisher } from './runtime/event-publisher'
import { SessionManager } from './runtime/session-manager'
import { createDriverRegistry } from './drivers/registry'
import { RuntimeSyncClient } from './cloud/runtime-sync'

const events = new EventPublisher()
const sessionManager = new SessionManager(createDriverRegistry(), events)
const dispatcher = new CommandDispatcher(sessionManager, process.cwd())
let runtimeSync: RuntimeSyncClient | null = null

events.subscribe((event) => {
    console.log('[fdcode:event]', JSON.stringify(event))
})

const cloudUrl = process.env.FDCODE_CLOUD_URL
if (cloudUrl) {
    runtimeSync = new RuntimeSyncClient({
        cloudUrl,
        deviceToken: process.env.FDCODE_DEVICE_TOKEN ?? 'fdcode-device-dev',
        deviceId: process.env.FDCODE_DEVICE_ID ?? 'local-device',
        pollIntervalMs: Number.parseInt(process.env.FDCODE_POLL_INTERVAL_MS ?? '1000', 10),
        batchSize: Number.parseInt(process.env.FDCODE_POLL_BATCH_SIZE ?? '20', 10)
    }, dispatcher, events)
    runtimeSync.start()
    console.log(`[fdcode] runtime sync enabled -> ${cloudUrl}`)
} else {
    console.log('[fdcode] runtime sync disabled (set FDCODE_CLOUD_URL to enable)')
}

console.log('[fdcode] daemon started')

process.on('SIGINT', () => {
    runtimeSync?.stop()
    console.log('[fdcode] shutting down')
    process.exit(0)
})

void dispatcher
