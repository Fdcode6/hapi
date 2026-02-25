import { createApp, createStateFromEnv } from './app'
import type { RealtimeSocketData } from './realtime/gateway'

process.env.FDCODE_DB_PATH ??= '.fdcode/cloud-api.sqlite'

const state = createStateFromEnv()
const app = createApp(state)
const port = Number.parseInt(process.env.PORT ?? '4010', 10)

console.log(`[cloud-api] listening on :${port}`)

Bun.serve<RealtimeSocketData>({
    port,
    websocket: state.realtimeGateway.websocket,
    fetch: (req, server) => {
        const url = new URL(req.url)
        if (url.pathname === '/v1/realtime') {
            return state.realtimeGateway.handleUpgrade(req, server)
        }
        return app.fetch(req)
    }
})
