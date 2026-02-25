export async function registerExpoPushToken(args: {
    baseUrl: string
    accessToken: string
    expoPushToken: string
    platform: 'ios' | 'android'
}): Promise<void> {
    const res = await fetch(new URL('/v1/push/register', args.baseUrl).toString(), {
        method: 'POST',
        headers: {
            authorization: `Bearer ${args.accessToken}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            token: args.expoPushToken,
            platform: args.platform
        })
    })

    if (!res.ok) {
        throw new Error(`Failed to register push token: HTTP ${res.status}`)
    }
}
