import React, { useState } from 'react'
import { loginWithAccessToken } from '../../src/api/endpoints'
import { mobileClient, setAuthTokens } from '../../src/app/mobile-runtime'

export default function LoginScreen() {
    const [inputToken, setInputToken] = useState('fdcode-local-dev')
    const [status, setStatus] = useState<string>('')

    async function handleLogin(): Promise<void> {
        setStatus('登录中...')
        try {
            const result = await loginWithAccessToken(mobileClient, inputToken.trim())
            setAuthTokens({
                accessToken: result.accessToken,
                refreshToken: result.refreshToken
            })
            setStatus('登录成功，可切换到 Sessions 查看会话')
        } catch (error) {
            setStatus(`登录失败: ${error instanceof Error ? error.message : 'unknown error'}`)
        }
    }

    return (
        <div style={{ padding: 16 }}>
            <h1>FDCode Login</h1>
            <p>输入云端接入令牌后登录。</p>
            <input
                value={inputToken}
                onChange={(event) => setInputToken(event.currentTarget.value)}
                placeholder="fdcode-local-dev"
                style={{ width: '100%', padding: 8, marginBottom: 12 }}
            />
            <button onClick={() => void handleLogin()}>登录</button>
            <p>{status}</p>
        </div>
    )
}
