import { RefreshStore } from './auth/store'
import { CommandRepository } from './commands/repo'
import { CommandIngressService, type RuntimeBridge } from './commands/ingress'
import { CommandService } from './commands/service'
import { DeviceChannelService } from './device-channel/server'
import { EventRepository } from './events/repo'
import { EventService } from './events/service'
import { CompletionMonitor } from './notifications/completion-monitor'
import {
    BarkNotifier,
    ExpoPushNotifier,
    type BarkNotifierConfig,
    type ExpoPushNotifierConfig,
    PushService
} from './push/service'
import { SessionOwnershipStore } from './sessions/ownership'
import { openCloudDatabase } from './store/sqlite'

export type CloudState = {
    refreshStore: RefreshStore
    commandService: CommandService
    commandIngressService: CommandIngressService
    eventService: EventService
    deviceChannelService: DeviceChannelService
    pushService: PushService
    ownershipStore: SessionOwnershipStore
}

export type CloudStateOptions = {
    runtimeBridge?: RuntimeBridge
    bark?: BarkNotifierConfig
    expo?: ExpoPushNotifierConfig
    dbPath?: string
}

export function createCloudState(options?: CloudStateOptions): CloudState {
    const db = openCloudDatabase(options?.dbPath ?? ':memory:')
    const refreshStore = new RefreshStore()
    const commandRepository = new CommandRepository(db)
    const eventRepository = new EventRepository(db)
    const ownershipStore = new SessionOwnershipStore(db)
    const pushService = new PushService(
        db,
        options?.bark ? new BarkNotifier(options.bark) : undefined,
        options?.expo ? new ExpoPushNotifier(options.expo) : undefined
    )
    const completionMonitor = new CompletionMonitor(ownershipStore, pushService)
    const commandService = new CommandService(commandRepository)
    const eventService = new EventService(eventRepository, async (event) => {
        await completionMonitor.onEvent(event)
    })

    if (options?.runtimeBridge) {
        options.runtimeBridge.subscribe((event) => {
            const appended = eventService.append(event)
            if (!appended.ok) {
                console.warn('[cloud-api] dropped runtime event', appended.error)
            }
        })
    }

    return {
        refreshStore,
        commandService,
        commandIngressService: new CommandIngressService(
            commandService,
            ownershipStore,
            options?.runtimeBridge
        ),
        eventService,
        deviceChannelService: new DeviceChannelService(),
        pushService,
        ownershipStore
    }
}
