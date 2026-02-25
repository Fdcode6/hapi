const DEFAULT_ALLOWED_PREFIXES = ['0.1.', '0.2.']

export function isDriverVersionAllowed(version: string, allowedPrefixes: string[] = DEFAULT_ALLOWED_PREFIXES): boolean {
    return allowedPrefixes.some((prefix) => version.startsWith(prefix))
}

export function ensureAllowedVersion(version: string, opts?: { allowUnsafe?: boolean; allowedPrefixes?: string[] }): void {
    if (opts?.allowUnsafe) {
        return
    }

    if (!isDriverVersionAllowed(version, opts?.allowedPrefixes)) {
        throw new Error(`Driver version ${version} is not in allowlist`)
    }
}
