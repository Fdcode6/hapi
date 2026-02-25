import { z } from 'zod'

const SendMessagePayloadSchema = z.object({
    text: z.string().min(1),
    attachments: z.array(z.string()).optional()
})

const AbortPayloadSchema = z.object({
    reason: z.string().optional()
})

const SwitchModePayloadSchema = z.object({
    mode: z.enum(['local', 'remote'])
})

const ApproveToolPayloadSchema = z.object({
    requestId: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().optional()
})

const DriverSchema = z.enum(['claude', 'codex', 'gemini'])

export const CommandEnvelopeSchema = z.discriminatedUnion('type', [
    z.object({
        commandId: z.string().min(1),
        sessionId: z.string().min(1),
        driver: DriverSchema.optional(),
        type: z.literal('send_message'),
        payload: SendMessagePayloadSchema,
        ttlMs: z.number().int().positive(),
        issuedAt: z.number().int().optional()
    }),
    z.object({
        commandId: z.string().min(1),
        sessionId: z.string().min(1),
        driver: DriverSchema.optional(),
        type: z.literal('abort'),
        payload: AbortPayloadSchema,
        ttlMs: z.number().int().positive(),
        issuedAt: z.number().int().optional()
    }),
    z.object({
        commandId: z.string().min(1),
        sessionId: z.string().min(1),
        driver: DriverSchema.optional(),
        type: z.literal('switch_mode'),
        payload: SwitchModePayloadSchema,
        ttlMs: z.number().int().positive(),
        issuedAt: z.number().int().optional()
    }),
    z.object({
        commandId: z.string().min(1),
        sessionId: z.string().min(1),
        driver: DriverSchema.optional(),
        type: z.literal('approve_tool'),
        payload: ApproveToolPayloadSchema,
        ttlMs: z.number().int().positive(),
        issuedAt: z.number().int().optional()
    })
])

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>
