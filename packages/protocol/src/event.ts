import { z } from 'zod'

export const EventEnvelopeSchema = z.discriminatedUnion('type', [
    z.object({
        eventId: z.string().min(1),
        sessionId: z.string().min(1),
        seq: z.number().int().positive(),
        type: z.literal('message_delta'),
        data: z.object({
            text: z.string(),
            role: z.enum(['assistant', 'system'])
        }),
        createdAt: z.number().int()
    }),
    z.object({
        eventId: z.string().min(1),
        sessionId: z.string().min(1),
        seq: z.number().int().positive(),
        type: z.literal('message_final'),
        data: z.object({
            text: z.string(),
            role: z.enum(['assistant', 'system'])
        }),
        createdAt: z.number().int()
    }),
    z.object({
        eventId: z.string().min(1),
        sessionId: z.string().min(1),
        seq: z.number().int().positive(),
        type: z.literal('tool_request'),
        data: z.object({
            requestId: z.string(),
            tool: z.string(),
            arguments: z.unknown()
        }),
        createdAt: z.number().int()
    }),
    z.object({
        eventId: z.string().min(1),
        sessionId: z.string().min(1),
        seq: z.number().int().positive(),
        type: z.literal('tool_result'),
        data: z.object({
            requestId: z.string(),
            ok: z.boolean(),
            output: z.unknown()
        }),
        createdAt: z.number().int()
    }),
    z.object({
        eventId: z.string().min(1),
        sessionId: z.string().min(1),
        seq: z.number().int().positive(),
        type: z.literal('ready'),
        data: z.object({
            status: z.literal('idle')
        }),
        createdAt: z.number().int()
    }),
    z.object({
        eventId: z.string().min(1),
        sessionId: z.string().min(1),
        seq: z.number().int().positive(),
        type: z.literal('error'),
        data: z.object({
            message: z.string(),
            code: z.string().optional()
        }),
        createdAt: z.number().int()
    }),
    z.object({
        eventId: z.string().min(1),
        sessionId: z.string().min(1),
        seq: z.number().int().positive(),
        type: z.literal('session_state'),
        data: z.object({
            state: z.enum(['idle', 'running', 'waiting_user', 'interrupted', 'completed', 'failed'])
        }),
        createdAt: z.number().int()
    })
])

export const RealtimeResumeRequestSchema = z.object({
    sessionId: z.string().min(1),
    afterSeq: z.number().int().nonnegative()
})

export const RealtimeClientFrameSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('ping'),
        ts: z.number().int().nonnegative().optional()
    }),
    z.object({
        type: z.literal('resume'),
        sessionId: z.string().min(1),
        afterSeq: z.number().int().nonnegative()
    })
])

export const RealtimeServerFrameSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('event'),
        event: EventEnvelopeSchema
    }),
    z.object({
        type: z.literal('ready'),
        sessionId: z.string().min(1),
        lastSeq: z.number().int().nonnegative()
    }),
    z.object({
        type: z.literal('error'),
        code: z.string().min(1),
        message: z.string().min(1)
    }),
    z.object({
        type: z.literal('pong'),
        ts: z.number().int().nonnegative().optional()
    })
])

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>
export type RealtimeResumeRequest = z.infer<typeof RealtimeResumeRequestSchema>
export type RealtimeClientFrame = z.infer<typeof RealtimeClientFrameSchema>
export type RealtimeServerFrame = z.infer<typeof RealtimeServerFrameSchema>
