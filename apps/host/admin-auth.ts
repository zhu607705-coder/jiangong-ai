import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Express, Request, Response } from 'express'
import { isPublicReadRequest } from './public-read'

const derive = promisify(scrypt)
const HASH_PATTERN = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/
const COOKIE = 'hzz_session'
const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, path: '/' }
type Session = { username: string; expires: number; controller: AbortController; timer: ReturnType<typeof setTimeout> }
type LoginFailure = { count: number; until: number }

/** Session ownership remains the existing local operator; the login name is an authentication identity. */
export class AdminAccess {
  readonly enabled: boolean
  readonly publicReadOnly: boolean
  private readonly localToken = randomBytes(32).toString('hex')
  private readonly sessions = new Map<string, Session>()
  private failure: LoginFailure = { count: 0, until: 0 }
  constructor(readonly username: string, private readonly passwordHash: string, readonly ttlSeconds = 28800, publicReadOnly = false, readonly collaborativeWorkspace = false) {
    // An explicit campus collaboration deployment reuses the local session
    // handshake. Stored administrator credentials remain intact for rollback.
    this.enabled = !!passwordHash && !collaborativeWorkspace
    this.publicReadOnly = publicReadOnly && !collaborativeWorkspace
    if (passwordHash && !HASH_PATTERN.test(passwordHash)) throw new Error('ADMIN_PASSWORD_HASH must be a scrypt password hash.')
  }
  private cookie(header?: string): string | null {
    const matches = (header || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${COOKIE}=`))
    const value = matches.length === 1 ? matches[0].slice(COOKIE.length + 1) : ''
    return /^[a-f0-9]{64}$/.test(value) ? value : null
  }
  private key(token: string) { return createHash('sha256').update(token).digest('hex') }
  identity(header?: string): { username: string; expires_at: string | null } | null {
    const token = this.cookie(header)
    if (!token) return null
    if (!this.enabled) return timingSafeEqual(Buffer.from(token), Buffer.from(this.localToken)) ? { username: this.username, expires_at: null } : null
    const key = this.key(token), session = this.sessions.get(key)
    if (!session) return null
    if (session.expires <= Date.now()) { this.revokeKey(key); return null }
    return { username: session.username, expires_at: new Date(session.expires).toISOString() }
  }
  setLocalCookie(response: Response) { response.cookie(COOKIE, this.localToken, cookieOptions) }
  canReadPublic(method: string, path: string) { return this.enabled && this.publicReadOnly && isPublicReadRequest(method, path) }
  retryAfter(): number { return this.failure.count >= 5 ? Math.max(0, Math.ceil((this.failure.until - Date.now()) / 1000)) : 0 }
  private recordFailure() {
    if (this.failure.until <= Date.now()) this.failure = { count: 0, until: Date.now() + 15 * 60 * 1000 }
    this.failure.count++
  }
  async login(username: unknown, password: unknown): Promise<string | null> {
    if (!this.enabled || this.retryAfter()) return null
    // Reserve an attempt before asynchronous hashing, so concurrent requests cannot bypass the bucket.
    this.recordFailure()
    const validInput = typeof username === 'string' && username.length <= 64 && typeof password === 'string' && password.length <= 2048
    if (!validInput) return null
    const match = HASH_PATTERN.exec(this.passwordHash)!
    const value = await derive(password as string, Buffer.from(match[1], 'hex'), 64) as Buffer
    if (username !== this.username || !timingSafeEqual(value, Buffer.from(match[2], 'hex'))) return null
    this.failure = { count: 0, until: 0 }
    const token = randomBytes(32).toString('hex'), key = this.key(token), expires = Date.now() + this.ttlSeconds * 1000
    const timer = setTimeout(() => this.revokeKey(key), this.ttlSeconds * 1000); timer.unref()
    if (this.sessions.size >= 32) this.revokeKey(this.sessions.keys().next().value!)
    this.sessions.set(key, { username: this.username, expires, controller: new AbortController(), timer })
    return token
  }
  private revokeKey(key: string) {
    const session = this.sessions.get(key)
    if (!session) return
    this.sessions.delete(key); clearTimeout(session.timer); session.controller.abort()
  }
  logout(header?: string) { const token = this.cookie(header); if (token) this.revokeKey(this.key(token)) }
  /** Revocation closes already-open SSE/NDJSON responses, as well as denying new requests. */
  bindResponse(header: string | undefined, response: Response) {
    if (!this.enabled) return
    const token = this.cookie(header), session = token && this.sessions.get(this.key(token))
    if (!session) return
    const close = () => response.destroy()
    session.controller.signal.addEventListener('abort', close, { once: true })
    response.once('close', () => session.controller.signal.removeEventListener('abort', close))
  }
  close() { for (const key of [...this.sessions.keys()]) this.revokeKey(key) }
}

export function registerAdminRoutes(app: Express, access: AdminAccess, metadata: () => Record<string, unknown>, renderLogin: () => string) {
  const sessionBody = (header?: string) => ({ ...metadata(), authentication: { enabled: access.enabled, role: 'admin', public_read_only: access.publicReadOnly, collaborative_workspace: access.collaborativeWorkspace, ...access.identity(header) } })
  const unauthorized = (response: Response) => response.status(401).json({ code: 'ADMIN_LOGIN_REQUIRED', detail: '请使用管理员账号登录工作台。', authentication: { enabled: true } })
  const csrf = (request: Request, response: Response) => {
    if (request.headers['x-requested-with'] === 'haizhizi') return true
    response.status(403).json({ code: 'CSRF_GUARD', detail: '缺少工作台请求标识' }); return false
  }
  app.get('/api/session', (request, response) => {
    if (!access.enabled) access.setLocalCookie(response)
    else if (!access.identity(request.headers.cookie)) {
      if (access.publicReadOnly) response.json({ ...metadata(), user: { id: 'public-viewer', label: '公开访客' }, authentication: { enabled: true, role: 'viewer', public_read_only: true, expires_at: null } })
      else unauthorized(response)
      return
    }
    response.json(sessionBody(request.headers.cookie))
  })
  app.get('/admin/login', (request,response) => {
    if (!access.enabled || access.identity(request.headers.cookie)) response.redirect(303, '/')
    else response.type('html').send(renderLogin())
  })
  app.post('/api/auth/login', async (request, response, next) => {
    if (!csrf(request, response)) return
    if (!access.enabled) { response.status(403).json({ code: 'ADMIN_LOGIN_DISABLED', detail: access.collaborativeWorkspace ? '当前为校园协作模式，无需管理员登录。' : '当前为本机工作模式。' }); return }
    const retry = access.retryAfter()
    if (retry) { response.setHeader('Retry-After', retry); response.status(429).json({ code: 'LOGIN_RATE_LIMITED', detail: '登录尝试过多，请稍后再试。' }); return }
    try {
      const token = await access.login(request.body?.username, request.body?.password)
      if (!token) { response.status(401).json({ code: 'INVALID_CREDENTIALS', detail: '账号或密码不正确。' }); return }
      access.logout(request.headers.cookie)
      response.cookie(COOKIE, token, { ...cookieOptions, maxAge: access.ttlSeconds * 1000 })
      response.json(sessionBody(`${COOKIE}=${token}`))
    } catch (error) { next(error) }
  })
  app.post('/api/auth/logout', (request, response) => {
    if (!csrf(request, response)) return
    if (!access.identity(request.headers.cookie)) { unauthorized(response); return }
    access.logout(request.headers.cookie); response.clearCookie(COOKIE, cookieOptions); response.json({ ok: true })
  })
  app.use((request, response, next) => {
    if (!access.enabled) { response.locals.workbenchRole = 'admin'; next(); return }
    if (!access.identity(request.headers.cookie)) {
      if (access.canReadPublic(request.method, request.path)) { response.locals.workbenchRole = 'viewer'; next(); return }
      if (access.publicReadOnly) response.status(403).json({ code: 'ADMIN_REQUIRED', detail: '此操作需要管理员登录。', login_url: '/admin/login' })
      else if (request.method === 'GET' && ['/', '/index.html'].includes(request.path)) response.type('html').send(renderLogin())
      else unauthorized(response)
      return
    }
    response.locals.workbenchRole = 'admin'
    access.bindResponse(request.headers.cookie, response); next()
  })
}
