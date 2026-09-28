import type { Express } from 'express'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ensureHarnessNetwork } from '../../runtime/dsh/public-web'
import type { MapConfiguration } from '../../packages/maps/types'

const key = z.string().trim().regex(/^[a-zA-Z0-9_-]{16,128}$/).refine(v => !v.startsWith('sk-'))
const credentialsSchema = z.object({ js_key: key, security_code: key }).strict()
type Credentials = z.infer<typeof credentialsSchema>
const endpoints = new Set([
  '/v3/place/text', '/v3/place/around', '/v3/place/detail', '/v3/place/polygon', '/v5/place/text', '/v5/place/around', '/v5/place/detail',
  '/v3/assistant/inputtips', '/v3/assistant/coordinate/convert', '/v3/geocode/geo', '/v3/geocode/regeo', '/v4/map/styles',
  '/v3/log/init',
])

export class AmapSettings {
  private credentials: Credentials | null = null
  constructor(private directory: string) {}
  async load(env: NodeJS.ProcessEnv = process.env) {
    const parsed = credentialsSchema.safeParse({ js_key: env.AMAP_JS_KEY || '', security_code: env.AMAP_SECURITY_CODE || '' })
    this.credentials = parsed.success ? parsed.data : null
    try { this.credentials = credentialsSchema.parse(JSON.parse(await readFile(join(this.directory, 'amap-credentials.json'), 'utf8'))) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('本机高德配置文件无效，请检查配置格式。') }
  }
  getCredentials() { return this.credentials }
  publicConfiguration(): MapConfiguration {
    return { provider: 'amap', configured: !!this.credentials, js_key: this.credentials?.js_key || null,
      revision: this.credentials ? createHash('sha256').update(JSON.stringify(this.credentials)).digest('hex').slice(0, 16) : 'unconfigured',
      service_path: '/_AMapService', sdk_version: '2.0' }
  }
  async save(value: unknown) {
    const parsed = credentialsSchema.safeParse(value)
    if (!parsed.success) throw new Error('请填写高德 Web 端（JS API）的 Key 和配套安全密钥。')
    await mkdir(this.directory, { recursive: true })
    const target = join(this.directory, 'amap-credentials.json'), temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(parsed.data) + '\n', { mode: 0o600 })
    await rename(temp, target)
    this.credentials = parsed.data
    return this.publicConfiguration()
  }
}

/** Provider-specific allowlist; the browser never chooses the upstream host or security key. */
export function amapUpstream(requestUrl: string, credentials: Credentials): URL {
  const incoming = new URL(requestUrl, 'http://local.invalid')
  const pathname = incoming.pathname.replace(/^\/_AMapService/, '')
  if (!incoming.pathname.startsWith('/_AMapService/') || !endpoints.has(pathname)) throw new Error('不支持的地图服务路径')
  const callback = incoming.searchParams.get('callback')
  if (callback && !/^[A-Za-z_$][\w.$]{0,99}$/.test(callback)) throw new Error('无效的地图回调')
  const upstream = new URL(pathname, pathname === '/v4/map/styles' ? 'https://webapi.amap.com' : 'https://restapi.amap.com')
  upstream.search = incoming.search
  upstream.searchParams.set('key', credentials.js_key)
  upstream.searchParams.set('jscode', credentials.security_code)
  return upstream
}

export function registerAmap(app: Express, settings: AmapSettings) {
  app.get('/api/maps/config', (_req, res) => res.json(settings.publicConfiguration()))
  app.post('/api/maps/config', async (req, res) => {
    try { res.json(await settings.save(req.body)) }
    catch { res.status(422).json({ code: 'MAP_CONFIG_INVALID', detail: '请填写高德 Web 端（JS API）的 Key 和配套安全密钥。' }) }
  })
  app.get(/^\/_AMapService\/.+/, async (req, res) => {
    const credentials = settings.getCredentials()
    if (!credentials) return res.status(424).json({ code: 'MAP_NOT_CONFIGURED', detail: '尚未连接高德地图。' })
    let upstream: URL
    try { upstream = amapUpstream(req.originalUrl, credentials) }
    catch { return res.status(400).json({ code: 'MAP_PATH_REJECTED', detail: '不支持的地图服务请求。' }) }
    try {
      await ensureHarnessNetwork()
      const response = await fetch(upstream, { redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: '*/*', ...(req.headers.referer ? { Referer: req.headers.referer } : {}) } })
      if (!response.ok || !response.body) throw new Error('upstream unavailable')
      const reader = response.body.getReader(), parts: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) {
          const result = await reader.read()
          if (result.done) break
          bytes += result.value.byteLength
          if (bytes > 4_000_000) throw new Error('upstream size limit')
          parts.push(result.value)
        }
      } finally { await reader.cancel().catch(() => undefined) }
      const type = response.headers.get('content-type') || 'application/json'
      const body = Buffer.concat(parts)
      const jsonp = upstream.searchParams.has('callback')
      res.setHeader('Cache-Control', 'no-store')
      // AMap's JS callbacks can arrive as octet-stream. Preserve nosniff and
      // explicitly type the callback that was already validated above.
      res.type(jsonp ? 'application/javascript' : type)
      // Error envelopes must not reflect the server-held secret into the browser.
      res.send(jsonp || /json|javascript|text/.test(type) ? body.toString('utf8').split(credentials.security_code).join('[redacted]') : body)
    } catch { res.status(502).json({ code: 'MAP_UPSTREAM_UNAVAILABLE', detail: '高德地图服务暂未返回，请检查地图配置或稍后重试。' }) }
  })
}
