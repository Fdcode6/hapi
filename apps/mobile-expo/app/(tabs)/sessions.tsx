import React, { useEffect, useMemo, useState } from 'react'
import { listSessions, type SessionSummaryDto } from '../../src/api/endpoints'
import { hasAccessToken, mobileClient } from '../../src/app/mobile-runtime'
import { MobileSessionStore } from '../../src/state/mobile-session-store'

const store = new MobileSessionStore()

export default function SessionsScreen() {
    const [sessions, setSessions] = useState<SessionSummaryDto[]>([])
    const [status, setStatus] = useState('')
    const items = useMemo(() => sessions, [sessions])

    useEffect(() => {
        void (async () => {
            if (!hasAccessToken()) {
                setStatus('请先登录后再查看会话')
                return
            }

            setStatus('同步会话中...')
            try {
                const result = await listSessions(mobileClient)
                store.setSessions(result)
                setSessions(store.getState().sessions)
                setStatus(`已加载 ${result.length} 个会话`)
            } catch (error) {
                setStatus(`加载失败: ${error instanceof Error ? error.message : 'unknown error'}`)
            }
        })()
    }, [])

    return (
        <div style={{ padding: 16 }}>
            <h1>Sessions</h1>
            <p>{status}</p>
            <ul>
                {items.map((session) => (
                    <li key={session.sessionId}>
                        <strong>{session.sessionId}</strong>
                        {' · '}
                        {session.state}
                        {' · seq='}
                        {session.lastSeq}
                    </li>
                ))}
            </ul>
        </div>
    )
}
