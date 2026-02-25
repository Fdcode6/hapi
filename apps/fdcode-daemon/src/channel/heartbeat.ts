export function createHeartbeatTicker(opts: {
    intervalMs: number
    onTick: () => Promise<void> | void
}): { start: () => void; stop: () => void } {
    let timer: NodeJS.Timeout | null = null

    const start = () => {
        if (timer) {
            return
        }
        timer = setInterval(() => {
            void opts.onTick()
        }, opts.intervalMs)
    }

    const stop = () => {
        if (!timer) {
            return
        }
        clearInterval(timer)
        timer = null
    }

    return { start, stop }
}
