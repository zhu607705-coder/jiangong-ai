/** Reuse the local Host/Origin guard, with one explicitly configured LAN origin. */
export function requestOriginPolicy(port: number, workspacePort: number, trustedPublicOrigin = '') {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `127.0.0.1:${workspacePort}`, `localhost:${workspacePort}`])
  const allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`))
  let publicOrigin: string | null = null
  if (trustedPublicOrigin.trim()) {
    let url: URL
    try { url = new URL(trustedPublicOrigin.trim()) }
    catch { throw new Error('TRUSTED_PUBLIC_ORIGIN must be a single http(s) origin.') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash || url.hostname.includes('*')) {
      throw new Error('TRUSTED_PUBLIC_ORIGIN must contain only scheme, hostname and optional port.')
    }
    publicOrigin = url.origin
    allowedHosts.add(url.host)
    allowedOrigins.add(publicOrigin)
  }
  return { allowedHosts, allowedOrigins, publicOrigin }
}
