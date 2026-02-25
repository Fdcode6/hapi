import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'

const TokenPayloadSchema = z.object({
    sub: z.string(),
    kind: z.enum(['access', 'refresh']),
    sid: z.string()
})

export type TokenPayload = z.infer<typeof TokenPayloadSchema>

function getJwtSecret(): Uint8Array {
    return new TextEncoder().encode(process.env.FDCODE_JWT_SECRET ?? 'fdcode-dev-secret')
}

export async function signAccessToken(args: { userId: string; sessionId: string; expiresIn: string }): Promise<string> {
    return await new SignJWT({ sub: args.userId, kind: 'access', sid: args.sessionId })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(args.expiresIn)
        .sign(getJwtSecret())
}

export async function signRefreshToken(args: { userId: string; sessionId: string; expiresIn: string }): Promise<string> {
    return await new SignJWT({ sub: args.userId, kind: 'refresh', sid: args.sessionId })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(args.expiresIn)
        .sign(getJwtSecret())
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
    try {
        const verified = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] })
        const parsed = TokenPayloadSchema.safeParse(verified.payload)
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}
