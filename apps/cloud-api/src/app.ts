import { Hono } from 'hono'
import type { CloudEnv } from './auth/middleware'
import { requireAccessToken } from './auth/middleware'
import { createAuthRoutes } from './auth/routes'
import { createCommandRoutes } from './commands/routes'
import { createDeviceRoutes } from './device-channel/routes'
import { requireDeviceRuntimeToken } from './device-runtime/middleware'
import { createDeviceRuntimeRoutes } from './device-runtime/routes'
import { createEventRoutes } from './events/routes'
import { createPushRoutes } from './push/routes'
import { createSessionRoutes } from './sessions/routes'
import { createCloudState, type CloudState } from './state'
import type { BarkNotifierConfig, ExpoPushNotifierConfig } from './push/service'

function getBarkConfigFromEnv(): BarkNotifierConfig | undefined {
    const endpoint = process.env.FDCODE_BARK_ENDPOINT?.trim()
    if (!endpoint) {
        return undefined
    }
    return {
        endpoint,
        group: process.env.FDCODE_BARK_GROUP?.trim() || 'fdcode',
        sound: process.env.FDCODE_BARK_SOUND?.trim() || undefined,
        icon: process.env.FDCODE_BARK_ICON?.trim() || undefined
    }
}

function getExpoConfigFromEnv(): ExpoPushNotifierConfig | undefined {
    const enabled = process.env.FDCODE_EXPO_PUSH_ENABLED?.trim()
    const endpoint = process.env.FDCODE_EXPO_PUSH_ENDPOINT?.trim()
    const token = process.env.FDCODE_EXPO_ACCESS_TOKEN?.trim()
    if (!endpoint && enabled !== '1') {
        return undefined
    }
    return {
        endpoint: endpoint || 'https://exp.host/--/api/v2/push/send',
        accessToken: token || undefined
    }
}

function getDbPathFromEnv(): string | undefined {
    return process.env.FDCODE_DB_PATH?.trim() || undefined
}

export function createStateFromEnv(): CloudState {
    return createCloudState({
        bark: getBarkConfigFromEnv(),
        expo: getExpoConfigFromEnv(),
        dbPath: getDbPathFromEnv()
    })
}

export function createApp(state: CloudState = createStateFromEnv()): Hono<CloudEnv> {
    const app = new Hono<CloudEnv>()

    app.get('/health', (c) => c.json({ status: 'ok' }))

    app.route('/v1/auth', createAuthRoutes(state.refreshStore))

    app.use('/v1/device-runtime/*', requireDeviceRuntimeToken)
    app.route('/v1/device-runtime', createDeviceRuntimeRoutes({
        commandService: state.commandService,
        eventService: state.eventService
    }))

    app.use('/v1/*', requireAccessToken)
    app.route('/v1', createCommandRoutes(state.commandIngressService))
    app.route('/v1', createEventRoutes(state.eventService))
    app.route('/v1', createSessionRoutes(state.sessionService))
    app.route('/v1', createDeviceRoutes(state.deviceChannelService))
    app.route('/v1', createPushRoutes(state.pushService))

    return app
}
