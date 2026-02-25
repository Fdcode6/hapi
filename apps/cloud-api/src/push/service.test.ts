import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { BarkNotifier, ExpoPushNotifier, PushService } from './service'
import { openCloudDatabase } from '../store/sqlite'

describe('push service', () => {
    const createTestDb = (): Database => openCloudDatabase(':memory:')

    it('stores token and sends ready payload', async () => {
        const service = new PushService(createTestDb())
        service.registerToken({
            userId: 'owner',
            token: 'ExponentPushToken[test]',
            platform: 'ios',
            createdAt: Date.now()
        })

        await service.send({
            userId: 'owner',
            title: 'Ready for input',
            body: 'Session is waiting'
        })

        expect(service.getSent()).toHaveLength(1)
        expect(service.getSent()[0]?.title).toBe('Ready for input')
    })

    it('builds bark url and sends bark push', async () => {
        const calls: string[] = []
        const bark = new BarkNotifier({
            endpoint: 'https://api.day.app/device-key',
            group: 'fdcode',
            fetchImpl: async (input) => {
                calls.push(String(input))
                return new Response('ok', { status: 200 })
            }
        })
        const service = new PushService(createTestDb(), bark)

        await service.send({
            userId: 'owner',
            title: '完成了',
            body: '最后一条消息完成'
        })

        expect(calls).toHaveLength(1)
        expect(calls[0]).toContain('https://api.day.app/device-key/')
        expect(calls[0]).toContain('group=fdcode')
    })


    it('sends helper payloads for tool request and error', async () => {
        const service = new PushService(createTestDb())
        service.registerToken({
            userId: 'owner',
            token: 'ExponentPushToken[helper]',
            platform: 'ios',
            createdAt: Date.now()
        })

        await service.sendToolRequest({
            userId: 'owner',
            sessionId: 's-tool',
            body: '工具 bash 等待授权'
        })
        await service.sendError({
            userId: 'owner',
            sessionId: 's-tool',
            body: '执行失败'
        })

        expect(service.getSent()).toHaveLength(2)
        expect(service.getSent()[0]?.title).toContain('待授权')
        expect(service.getSent()[1]?.title).toContain('异常')
    })

    it('sends expo push payload for registered expo tokens', async () => {
        const expoCalls: Array<{ input: string; body: string | undefined }> = []
        const expo = new ExpoPushNotifier({
            endpoint: 'https://exp.host/--/api/v2/push/send',
            fetchImpl: async (input, init) => {
                expoCalls.push({
                    input: String(input),
                    body: typeof init?.body === 'string' ? init.body : undefined
                })
                return new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 })
            }
        })
        const service = new PushService(createTestDb(), undefined, expo)
        service.registerToken({
            userId: 'owner',
            token: 'ExponentPushToken[expo-test]',
            platform: 'ios',
            createdAt: Date.now()
        })

        await service.send({
            userId: 'owner',
            title: 'Ready',
            body: 'Session finished',
            data: { sessionId: 's1' }
        })

        expect(expoCalls).toHaveLength(1)
        expect(expoCalls[0]?.input).toBe('https://exp.host/--/api/v2/push/send')
        expect(expoCalls[0]?.body).toContain('ExponentPushToken[expo-test]')
    })
})
