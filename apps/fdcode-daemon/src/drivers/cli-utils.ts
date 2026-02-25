export async function runCliCommand(args: {
    command: string
    argv: string[]
    timeoutMs?: number
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
    const timeoutMs = args.timeoutMs ?? 120_000
    const proc = Bun.spawn([args.command, ...args.argv], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env
    })

    const timer = setTimeout(() => {
        try {
            proc.kill()
        } catch {
            // ignore
        }
    }, timeoutMs)

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
    ])

    clearTimeout(timer)

    if (exitCode !== 0) {
        const reason = stderr.trim() || stdout.trim() || `exit ${exitCode}`
        return { ok: false, error: reason }
    }

    return { ok: true, output: stdout.trim() }
}
