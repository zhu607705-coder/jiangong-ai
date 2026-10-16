/** Reuse the Host/Origin guard for explicitly named deployment addresses. */
export function requestOriginPolicy(port: number, workspacePort: number, trustedPublicOrigin = '', additionalOrigins = '') {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `127.0.0.1:${workspacePort}`, `localhost:${workspacePort}`])
  const allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`))
  let publicOrigin: string | null = null
  const entries = [trustedPublicOrigin, ...additionalOrigins.split(',')]
  if (additionalOrigins.trim() && !trustedPublicOrigin.trim()) {
    throw new Error('TRUSTED_PUBLIC_ORIGINS requires TRUSTED_PUBLIC_ORIGIN.')
  }
  for (const [index, entry] of entries.entries()) {
    if (!entry.trim()) continue
    const setting = index === 0 ? 'TRUSTED_PUBLIC_ORIGIN' : 'TRUSTED_PUBLIC_ORIGINS'
    let url: URL
    try { url = new URL(entry.trim()) }
    catch { throw new Error(`${setting} must contain explicit http(s) origins.`) }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash || url.hostname.includes('*')) {
      throw new Error(`${setting} must contain only scheme, hostname and optional port.`)
    }
    if (index === 0) publicOrigin = url.origin
    allowedHosts.add(url.host)
    allowedOrigins.add(url.origin)
  }
  return { allowedHosts, allowedOrigins, publicOrigin }
}
