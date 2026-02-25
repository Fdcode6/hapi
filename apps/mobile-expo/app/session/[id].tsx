import React, { useEffect, useMemo, useState } from 'react'
import { getSessionDetail, sendSessionMessage, type SessionDetailDto } from '../../src/api/endpoints'
import { hasAccessToken, mobileClient } from '../../src/app/mobile-runtime'
import { MobileSessionStore } from '../../src/state/mobile-session-store'

const store = new MobileSessionStore()

function resolveSessionId(): string {
    if (typeof window === 'undefined') {
        return 'mobile-s1'
    }

    const parts = window.location.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? 'mobile-s1'
}

export default function SessionDetailScreen() {
    const [detail, setDetail] = useState<SessionDetailDto | null>(null)
    const [status, setStatus] = useState('')
    const [text, setText] = useState('')
    const sessionId = useMemo(() => resolveSessionId(), [])

    useEffect(() => {
        void (async () => {
            if (!hasAccessToken()) {
                setStatus('请先登录后再进入会话页')
                return
            }

            setStatus('同步会话详情中...')
            try {
                const result = await getSessionDetail(mobileClient, sessionId)
                store.setSessionDetail(result)
                setDetail(store.getState().details[sessionId] ?? null)
                setStatus('会话已同步')
            } catch (error) {
                setStatus(`同步失败: ${error instanceof Error ? error.message : 'unknown error'}`)
            }
        })()
    }, [sessionId])

    async function handleSend(): Promise<void> {
        if (!text.trim()) {
            return
        }

        if (!detail) {
            return
        }

        store.appendOptimisticMessage(sessionId, text)
        setDetail(store.getState().details[sessionId] ?? detail)

        const pendingText = text
        setText('')

        try {
            await sendSessionMessage(mobileClient, sessionId, pendingText)
            setStatus('消息已发送')
        } catch (error) {
            setStatus(`发送失败: ${error instanceof Error ? error.message : 'unknown error'}`)
        }
    }

    return (
        <div style={{ padding: 16 }}>
            <h1>Session: {sessionId}</h1>
            <p>{status}</p>
            <div style={{ marginBottom: 12 }}>
                <input
                    value={text}
                    onChange={(event) => setText(event.currentTarget.value)}
                    placeholder="输入消息"
                    style={{ width: '100%', padding: 8, marginBottom: 8 }}
                />
                <button onClick={() => void handleSend()}>发送</button>
            </div>
            <ul>
                {(detail?.recentEvents ?? []).map((event) => (
                    <li key={event.eventId}>
                        #{event.seq} · {event.type}
                    </li>
                ))}
            </ul>
        </div>
    )
}
