import { createApp } from './app'

process.env.FDCODE_DB_PATH ??= '.fdcode/cloud-api.sqlite'

const app = createApp()
const port = Number.parseInt(process.env.PORT ?? '4010', 10)

console.log(`[cloud-api] listening on :${port}`)

Bun.serve({
    port,
    fetch: app.fetch
})
