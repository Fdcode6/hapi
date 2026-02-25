import { z } from 'zod'
import { verifyToken } from '../auth/jwt'
import { SessionOwnershipStore } from '../sessions/ownership'

const RealtimeQuerySchema = z.object({
    sessionId: z.string().min(1),
    afterSeq: z.coerce.number().int().nonnegative().default(0),
    accessToken: z.string().optional()
})

type ResolveRealtimeRequestResult =
    | { ok: true; value: { sessionId: string; afterSeq: number; userId: string } }
    | { ok: false; status: 400 | 401 | 403; error: string }

function getTokenFromRequest(req: Request, queryToken?: string): string | null {
    if (queryToken && queryToken.trim().length > 0) {
        return queryToken
    }

    const header = req.headers.get('authorization')
    if (!header || !header.startsWith('Bearer ')) {
        return null
    }

    return header.slice('Bearer '.length)
}

export async function resolveRealtimeRequest(
    req: Request,
    owners: SessionOwnershipStore
): Promise<ResolveRealtimeRequestResult> {
    const url = new URL(req.url)
    const parsed = RealtimeQuerySchema.safeParse({
        sessionId: url.searchParams.get('sessionId'),
        afterSeq: url.searchParams.get('afterSeq') ?? 0,
        accessToken: url.searchParams.get('accessToken') ?? undefined
    })

    if (!parsed.success) {
        return { ok: false, status: 400, error: 'Invalid realtime query' }
    }

    const token = getTokenFromRequest(req, parsed.data.accessToken)
    if (!token) {
        return { ok: false, status: 401, error: 'Missing access token' }
    }

    const payload = await verifyToken(token)
    if (!payload || payload.kind !== 'access') {
        return { ok: false, status: 401, error: 'Invalid access token' }
    }

    const owner = owners.getOwner(parsed.data.sessionId)
    if (owner && owner !== payload.sub) {
        return { ok: false, status: 403, error: 'Session forbidden' }
    }

    return {
        ok: true,
        value: {
            sessionId: parsed.data.sessionId,
            afterSeq: parsed.data.afterSeq,
            userId: payload.sub
        }
    }
}
