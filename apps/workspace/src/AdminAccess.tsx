import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ADMIN_LOGIN_REQUIRED_EVENT, ADMIN_LOGIN_REQUESTED_EVENT } from './api'
import './admin-access.css'

type Authentication = { enabled: false; role: 'admin'; collaborative_workspace?: boolean; public_read_only?: false } | { enabled: true; role: 'admin'; username: string; expires_at: string } | { enabled: true; role: 'viewer'; public_read_only: true; expires_at: null }
export type AdminSession = { authentication: Authentication }
export type WorkbenchAccess = { role: 'admin' | 'viewer'; canWrite: boolean }
// Components rendered outside the entry gate retain the existing local-workspace behavior.
export const WorkbenchAccessContext = createContext<WorkbenchAccess>({ role: 'admin', canWrite: true })
export const useWorkbenchAccess = () => useContext(WorkbenchAccessContext)
type AccessState = { phase: 'checking' } | { phase: 'locked'; message: string } | { phase: 'error'; message: string } | { phase: 'ready'; session: AdminSession }

export class AdminAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function parseSession(value: unknown): AdminSession {
  const authentication = (value as AdminSession | null)?.authentication
  if (authentication?.enabled === true && authentication.role === 'viewer' && authentication.public_read_only === true && authentication.expires_at === null) return { authentication }
  if (authentication?.role === 'admin' && authentication.enabled === false
    && (authentication.collaborative_workspace === undefined || typeof authentication.collaborative_workspace === 'boolean')
    && (authentication.public_read_only === undefined || authentication.public_read_only === false)) return { authentication }
  if (authentication?.role === 'admin' && authentication.enabled === true && typeof authentication.username === 'string' && authentication.username.trim() && typeof authentication.expires_at === 'string') {
    const expires = Date.parse(authentication.expires_at)
    if (Number.isFinite(expires) && expires > Date.now()) return { authentication }
    throw new AdminAccessError(401, 'ADMIN_LOGIN_REQUIRED', '登录已过期，请重新登录。')
  }
  throw new AdminAccessError(502, 'INVALID_SESSION_RESPONSE', '无法确认工作台会话，请刷新重试。')
}

async function authRequest(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'haizhizi' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    const message = response.status === 429 ? '尝试次数过多，请稍后再试。'
      : result?.code === 'INVALID_CREDENTIALS' ? '账号或密码不正确。'
      : response.status === 401 ? '请使用管理员账号登录。' : '连接工作台失败，请稍后重试。'
    throw new AdminAccessError(response.status, typeof result?.code === 'string' ? result.code : 'AUTH_REQUEST_FAILED', message)
  }
  return result
}

export async function fetchAdminSession(signal?: AbortSignal): Promise<AdminSession> { return parseSession(await authRequest('/session', undefined, signal)) }
export async function loginAdmin(username: string, password: string, signal?: AbortSignal): Promise<AdminSession> { return parseSession(await authRequest('/auth/login', { username, password }, signal)) }
export async function logoutAdmin(signal?: AbortSignal): Promise<void> {
  const result = await authRequest('/auth/logout', {}, signal)
  if ((result as { ok?: unknown } | null)?.ok !== true) throw new AdminAccessError(502, 'INVALID_LOGOUT_RESPONSE', '服务器未确认退出，请重试。')
}

export default function AdminAccess({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>({ phase: 'checking' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [logoutError, setLogoutError] = useState('')
  const generation = useRef(0)
  const authentication = useRef<Authentication | null>(null)
  const reconnect = useCallback(() => {
    generation.current++
    setPassword(''); setBusy(false); setLogoutError('')
    setRetry(value => value + 1)
  }, [])
  const lock = useCallback((message: string) => {
    if (authentication.current?.enabled === false) { reconnect(); return }
    generation.current++
    setPassword(''); setBusy(false); setState({ phase: 'locked', message })
    // The server returns its independent login shell after a protected session ends.
    if (authentication.current) window.location.reload()
  }, [reconnect])

  useEffect(() => {
    const controller = new AbortController(), attempt = ++generation.current
    setState({ phase: 'checking' })
    void fetchAdminSession(controller.signal).then(session => {
      if (attempt !== generation.current) return
      authentication.current = session.authentication
      setState({ phase: 'ready', session })
    }).catch(error => {
      if (controller.signal.aborted || attempt !== generation.current) return
      const unauthenticated = error instanceof AdminAccessError && error.status === 401
      setState(unauthenticated && authentication.current?.enabled !== false
        ? { phase: 'locked', message: '' }
        : { phase: 'error', message: unauthenticated ? '工作台会话已失效，请重新连接。' : error instanceof Error ? error.message : '连接工作台失败，请重试。' })
    })
    return () => { controller.abort(); generation.current++ }
  }, [retry])

  useEffect(() => {
    const expired = () => lock('管理员会话已失效，请重新登录。')
    const loginRequested = () => {
      if (authentication.current?.enabled === true) window.location.assign('/admin/login')
      else reconnect()
    }
    window.addEventListener(ADMIN_LOGIN_REQUIRED_EVENT, expired)
    window.addEventListener(ADMIN_LOGIN_REQUESTED_EVENT, loginRequested)
    return () => { window.removeEventListener(ADMIN_LOGIN_REQUIRED_EVENT, expired); window.removeEventListener(ADMIN_LOGIN_REQUESTED_EVENT, loginRequested) }
  }, [lock, reconnect])

  useEffect(() => {
    if (state.phase !== 'ready' || !state.session.authentication.enabled || state.session.authentication.role !== 'admin') return
    const expires = Date.parse(state.session.authentication.expires_at)
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const remaining = expires - Date.now()
      if (remaining <= 0) lock('登录已过期，请重新登录。')
      else timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [state, lock])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const attempt = ++generation.current, submittedPassword = password
    setPassword(''); setBusy(true); setState({ phase: 'locked', message: '' })
    try {
      const session = await loginAdmin(username.trim(), submittedPassword, AbortSignal.timeout(15_000))
      if (attempt !== generation.current) return
      authentication.current = session.authentication
      setState({ phase: 'ready', session })
    } catch (error) {
      if (attempt === generation.current) setState({ phase: 'locked', message: error instanceof Error ? error.message : '登录失败，请重试。' })
    } finally { if (attempt === generation.current) setBusy(false) }
  }

  async function signOut() {
    if (busy) return
    setBusy(true); setLogoutError('')
    try {
      await logoutAdmin(AbortSignal.timeout(15_000))
      lock('已退出管理员账号。')
    } catch (error) {
      if (error instanceof AdminAccessError && error.status === 401) lock('会话已结束，请重新登录。')
      else setLogoutError('退出未完成，请检查网络后重试。')
    } finally { setBusy(false) }
  }

  if (state.phase === 'ready') {
    const auth = state.session.authentication
    const content = <WorkbenchAccessContext.Provider value={{ role: auth.role, canWrite: auth.role === 'admin' }}>{children}</WorkbenchAccessContext.Provider>
    const collaborative = !auth.enabled && auth.collaborative_workspace === true
    if (!auth.enabled && !collaborative) return content
    return <div className="admin-session-shell">
      <header className={`admin-session-bar${collaborative ? ' campus-session-bar' : ''}`} aria-label={collaborative ? '校园协作工作台' : auth.role === 'viewer' ? '公开浏览权限' : '管理员会话'}>
        <span><span className="admin-session-dot" />{collaborative ? '校园协作' : auth.role === 'viewer' ? '公开浏览 · 只读' : auth.enabled ? <>管理员 <strong>{auth.username}</strong></> : null}</span>
        <div>
          <a className="admin-public-decisions" href="/?view=published">{collaborative ? '查看决策方案' : '查看公开决策方案'}</a>
          <a className="admin-session-report" href={`/deliverables/${encodeURIComponent('求是村_旧改深度调研与行动计划.pdf')}`} target="_blank" rel="noreferrer">求是村报告</a>
          {!collaborative && (auth.role === 'viewer' ? <a href="/admin/login">管理员登录</a> : <>
            <a href="/api/admin/database-schema">数据库结构</a>
            {logoutError && <span role="alert">{logoutError}</span>}
            <button type="button" onClick={() => void signOut()} disabled={busy}>{busy ? '正在退出…' : '退出登录'}</button>
          </>)}
        </div>
      </header>
      <div className="admin-workspace">{content}</div>
    </div>
  }

  return <main className="admin-access-screen"><section className="admin-access-card" aria-labelledby="admin-access-title">
    <div className="admin-access-brand"><span aria-hidden="true">海</span><p>海之子 · 建工 AI</p></div>
    <h1 id="admin-access-title">{state.phase === 'checking' ? '正在连接工作台' : state.phase === 'error' ? '暂时无法连接' : '管理员登录'}</h1>
    <p className="admin-access-intro">老旧小区改造研判工作台</p>
    {state.phase === 'checking' ? <p className="admin-access-status" role="status">正在确认访问权限…</p> : state.phase === 'error' ? <><p className="admin-access-message" role="alert">{state.message}</p><button className="admin-access-submit" type="button" onClick={() => setRetry(value => value + 1)}>重新连接</button></> : <form onSubmit={event => void submit(event)}>
      <p className="admin-access-description">登录后查看和管理项目资料、研判结果与改造方案。</p>
      <label htmlFor="admin-username">管理员账号</label><input id="admin-username" name="username" autoComplete="username" required autoFocus maxLength={120} value={username} onChange={event => setUsername(event.target.value)} disabled={busy} />
      <label htmlFor="admin-password">密码</label><input id="admin-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
      <p className="admin-access-message" role="alert" aria-live="polite">{state.message}</p><button className="admin-access-submit" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录工作台'}</button>
    </form>}
  </section></main>
}
