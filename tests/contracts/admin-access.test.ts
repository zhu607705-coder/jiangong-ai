import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { runInNewContext } from 'node:vm'
import AdminAccess, { fetchAdminSession, loginAdmin, logoutAdmin, useWorkbenchAccess } from '../../apps/workspace/src/AdminAccess'
import { ADMIN_LOGIN_REQUIRED_EVENT, ADMIN_LOGIN_REQUESTED_EVENT, api } from '../../apps/workspace/src/api'
import { renderAdminLoginPage } from '../../apps/host/admin-login-page'

const authenticated = () => ({ authentication: { enabled: true, role: 'admin', username: 'example-admin', expires_at: new Date(Date.now() + 60_000).toISOString() } })
const viewer = () => ({ authentication: { enabled: true, role: 'viewer', public_read_only: true, expires_at: null } })
const campus = () => ({ authentication: { enabled: false, role: 'admin', public_read_only: false, collaborative_workspace: true } })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('admin access protocol and entry gate', () => {
  it('keeps children unmounted until a session has been checked', () => {
    const rendered = vi.fn(() => createElement('span', null, 'private business content'))
    const html = renderToStaticMarkup(createElement(AdminAccess, { children: createElement(rendered) }))
    expect(rendered).not.toHaveBeenCalled()
    expect(html).toContain('正在确认访问权限')
    expect(html).not.toContain('private business content')
  })

  it('accepts explicit local mode without administrator credentials', async () => {
    const transport = vi.fn().mockResolvedValue(response({ authentication: { enabled: false, role: 'admin' } }))
    vi.stubGlobal('fetch', transport)
    expect(await fetchAdminSession()).toEqual({ authentication: { enabled: false, role: 'admin' } })
    expect(transport).toHaveBeenCalledWith('/api/session', expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store' }))
  })

  it('accepts a public viewer session without inventing an expiry or administrator privilege', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(viewer())))
    expect(await fetchAdminSession()).toEqual(viewer())
  })

  it('accepts the explicit campus collaboration contract without credentials or a session expiry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(campus())))
    expect(await fetchAdminSession()).toEqual(campus())
  })

  it.each([
    [viewer(), '公开浏览 · 只读', 'false'],
    [authenticated(), '管理员', 'true'],
    [{ authentication: { enabled: false, role: 'admin' } }, '', 'true'],
    [{ authentication: { enabled: false, role: 'admin', collaborative_workspace: false } }, '', 'true'],
    [campus(), '校园协作', 'true'],
  ])('mounts the workbench with the matching viewer, administrator or local context (%s)', async (session, label, canWrite) => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>')
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(session)))
    const root = createRoot(dom.document.getElementById('root')!)
    function Business() { const access = useWorkbenchAccess(); return createElement('button', { 'data-can-write': String(access.canWrite), 'data-role': access.role, disabled: !access.canWrite }, 'saved project') }
    try {
      await act(async () => root.render(createElement(AdminAccess, { children: createElement(Business) })))
      await vi.waitFor(() => expect(dom.document.querySelector('[data-can-write]')?.getAttribute('data-can-write')).toBe(canWrite))
      expect(dom.document.body.textContent).toContain('saved project')
      expect(dom.document.querySelector('[data-can-write]')?.hasAttribute('disabled')).toBe(canWrite === 'false')
      if (label) expect(dom.document.querySelector('.admin-session-bar')?.textContent).toContain(label)
      else expect(dom.document.querySelector('.admin-session-bar')).toBeNull()
      if (canWrite === 'false') expect([...dom.document.querySelectorAll('a')].find(link => link.textContent === '管理员登录')?.getAttribute('href')).toBe('/admin/login')
      if (label) expect([...dom.document.querySelectorAll('a')].find(link => link.textContent === (label === '校园协作' ? '查看决策方案' : '查看公开决策方案'))?.getAttribute('href')).toBe('/?view=published')
      if (label === '校园协作') {
        expect(dom.document.querySelector('[data-role]')?.getAttribute('data-role')).toBe('admin')
        expect(dom.document.querySelector('header')?.getAttribute('aria-label')).toBe('校园协作工作台')
        expect(dom.document.querySelector('.admin-session-report')?.getAttribute('href')).toContain('/deliverables/')
        expect(dom.document.body.textContent).not.toMatch(/管理员|只读|退出登录/)
        expect([...dom.document.querySelectorAll('a')].some(link => link.getAttribute('href')?.startsWith('/admin/') || link.getAttribute('href')?.startsWith('/api/admin/'))).toBe(false)
      }
    } finally { await act(async () => root.unmount()) }
  })

  it.each([
    [campus(), ADMIN_LOGIN_REQUIRED_EVENT],
    [campus(), ADMIN_LOGIN_REQUESTED_EVENT],
    [{ authentication: { enabled: false, role: 'admin' } }, ADMIN_LOGIN_REQUIRED_EVENT],
  ])('renews a non-login workbench session instead of requesting administrator login (%s, %s)', async (session, eventName) => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>')
    const navigation = { assign: vi.fn(), reload: vi.fn() }
    Object.defineProperty(dom.window, 'location', { configurable: true, value: navigation })
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('Event', dom.window.Event)
    const transport = vi.fn().mockImplementation(async (url: string) => url === '/api/session' ? response(session) : response({ code: 'ADMIN_LOGIN_REQUIRED' }, 401))
    vi.stubGlobal('fetch', transport)
    const root = createRoot(dom.document.getElementById('root')!)
    function Business() { return createElement('p', { 'data-can-write': String(useWorkbenchAccess().canWrite) }, 'editable project') }
    try {
      await act(async () => root.render(createElement(AdminAccess, { children: createElement(Business) })))
      await vi.waitFor(() => expect(dom.document.querySelector('[data-can-write]')?.getAttribute('data-can-write')).toBe('true'))
      await act(async () => {
        if (eventName === ADMIN_LOGIN_REQUIRED_EVENT) await expect(api('/expired-cookie-test')).rejects.toThrow('401')
        else dom.window.dispatchEvent(new dom.window.Event(eventName))
      })
      await vi.waitFor(() => expect(transport.mock.calls.filter(([url]) => url === '/api/session')).toHaveLength(2))
      await vi.waitFor(() => expect(dom.document.querySelector('[data-can-write]')?.getAttribute('data-can-write')).toBe('true'))
      expect(navigation.assign).not.toHaveBeenCalled(); expect(navigation.reload).not.toHaveBeenCalled()
      expect(dom.document.querySelector('form')).toBeNull()
      expect(transport.mock.calls.some(([url]) => String(url).startsWith('/api/auth/'))).toBe(false)
    } finally { await act(async () => root.unmount()) }
  })

  it('keeps a failed campus re-handshake on a connection error instead of an administrator lock screen', async () => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>')
    const navigation = { assign: vi.fn(), reload: vi.fn() }
    Object.defineProperty(dom.window, 'location', { configurable: true, value: navigation })
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(campus())).mockResolvedValueOnce(response({ code: 'SESSION_EXPIRED' }, 401)))
    const root = createRoot(dom.document.getElementById('root')!)
    try {
      await act(async () => root.render(createElement(AdminAccess, { children: createElement('p', null, 'workspace') })))
      await vi.waitFor(() => expect(dom.document.querySelector('.campus-session-bar')).not.toBeNull())
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event(ADMIN_LOGIN_REQUIRED_EVENT)) })
      await vi.waitFor(() => expect(dom.document.body.textContent).toContain('工作台会话已失效，请重新连接'))
      expect(dom.document.querySelector('form')).toBeNull()
      expect(dom.document.body.textContent).not.toContain('管理员')
      expect(navigation.assign).not.toHaveBeenCalled(); expect(navigation.reload).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()) }
  })

  it.each([viewer(), authenticated()])('retains administrator login navigation for a private-mode session (%s)', async session => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>')
    const navigation = { assign: vi.fn(), reload: vi.fn() }
    Object.defineProperty(dom.window, 'location', { configurable: true, value: navigation })
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(session)))
    const root = createRoot(dom.document.getElementById('root')!)
    try {
      await act(async () => root.render(createElement(AdminAccess, { children: createElement('p', null, 'workspace') })))
      await vi.waitFor(() => expect(dom.document.querySelector('.admin-session-bar')).not.toBeNull())
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event(ADMIN_LOGIN_REQUESTED_EVENT)) })
      expect(navigation.assign).toHaveBeenCalledWith('/admin/login')
    } finally { await act(async () => root.unmount()) }
  })

  it('reports an unauthenticated session as requiring login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ code: 'ADMIN_LOGIN_REQUIRED' }, 401)))
    await expect(fetchAdminSession()).rejects.toMatchObject({ status: 401, code: 'ADMIN_LOGIN_REQUIRED' })
  })

  it('submits login only to the same-origin endpoint with the CSRF request header', async () => {
    const session = authenticated(), transport = vi.fn().mockResolvedValue(response(session))
    vi.stubGlobal('fetch', transport)
    expect(await loginAdmin('example-admin', 'test-only-password')).toEqual(session)
    expect(transport).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ username: 'example-admin', password: 'test-only-password' }),
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'haizhizi' },
    }))
  })

  it.each([
    [{}, 'INVALID_SESSION_RESPONSE'],
    [{ authentication: { enabled: false, role: 'admin', collaborative_workspace: 'true' } }, 'INVALID_SESSION_RESPONSE'],
    [{ authentication: { enabled: false, role: 'admin', collaborative_workspace: true, public_read_only: true } }, 'INVALID_SESSION_RESPONSE'],
    [{ authentication: { enabled: true, role: 'admin', username: 'example-admin', expires_at: 'not-a-date' } }, 'ADMIN_LOGIN_REQUIRED'],
    [{ authentication: { enabled: true, role: 'admin', username: 'example-admin', expires_at: '2000-01-01T00:00:00Z' } }, 'ADMIN_LOGIN_REQUIRED'],
  ])('does not open the application for an invalid session (%s)', async (body, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)))
    await expect(fetchAdminSession()).rejects.toMatchObject({ code })
  })

  it.each([[401, 'INVALID_CREDENTIALS', '账号或密码不正确'], [429, 'RATE_LIMITED', '尝试次数过多']])('shows a useful login error for HTTP %s', async (status, code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ code }, status as number)))
    await expect(loginAdmin('example-admin', 'test-only-password')).rejects.toThrow(message as string)
  })

  it('requires the server to confirm logout', async () => {
    const transport = vi.fn().mockResolvedValueOnce(response({ ok: true })).mockResolvedValueOnce(response({}))
    vi.stubGlobal('fetch', transport)
    await expect(logoutAdmin()).resolves.toBeUndefined()
    expect(transport).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: expect.objectContaining({ 'X-Requested-With': 'haizhizi' }) }))
    await expect(logoutAdmin()).rejects.toMatchObject({ code: 'INVALID_LOGOUT_RESPONSE' })
  })

  it('notifies the entry gate when a business API returns 401', async () => {
    const events = new EventTarget(), locked = vi.fn()
    events.addEventListener(ADMIN_LOGIN_REQUIRED_EVENT, locked)
    vi.stubGlobal('window', events)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ code: 'ADMIN_LOGIN_REQUIRED' }, 401)))
    await expect(api('/protected-test')).rejects.toThrow('401')
    expect(locked).toHaveBeenCalledOnce()
  })

  it('requests administrator login only for ADMIN_REQUIRED, without locking on unrelated 403 responses', async () => {
    const events = new EventTarget(), loginRequested = vi.fn(), locked = vi.fn()
    events.addEventListener(ADMIN_LOGIN_REQUESTED_EVENT, loginRequested)
    events.addEventListener(ADMIN_LOGIN_REQUIRED_EVENT, locked)
    vi.stubGlobal('window', events)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ code: 'INVALID_ORIGIN' }, 403)).mockResolvedValueOnce(response({ code: 'ADMIN_REQUIRED' }, 403)).mockResolvedValueOnce(response({ code: 'ADMIN_REQUIRED' }, 403)))
    await expect(api('/denied-read-test')).rejects.toThrow('403')
    expect(loginRequested).not.toHaveBeenCalled(); expect(locked).not.toHaveBeenCalled()
    await expect(api('/administrator-read-test')).rejects.toThrow('需要管理员登录')
    expect(loginRequested).not.toHaveBeenCalled(); expect(locked).not.toHaveBeenCalled()
    await expect(api('/denied-write-test', {})).rejects.toThrow('需要管理员登录')
    expect(loginRequested).toHaveBeenCalledOnce(); expect(locked).not.toHaveBeenCalled()
  })
})

function loginShell(transport: ReturnType<typeof vi.fn>) {
  let submit: (event: { preventDefault: () => void }) => Promise<void> = async () => { throw new Error('Submit handler not attached') }
  const elements = {
    login: { addEventListener: (_event: string, handler: typeof submit) => { submit = handler } },
    username: { value: ' example-admin ' }, password: { value: 'test-only-password' },
    submit: { disabled: false, textContent: '登录工作台' }, message: { textContent: '' },
  }
  const navigate = vi.fn(), html = renderAdminLoginPage(), script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('Independent login script missing')
  runInNewContext(script, { document: { getElementById: (id: keyof typeof elements) => elements[id] }, fetch: transport, location: { assign: navigate }, AbortController, setTimeout, clearTimeout })
  return { submit: () => submit({ preventDefault: vi.fn() }), elements, navigate, html }
}

describe('independent server login page', () => {
  it('contains no business assets or default credentials and reloads after cookie login', async () => {
    const transport = vi.fn().mockResolvedValue(response(authenticated())), shell = loginShell(transport)
    expect(shell.html).not.toContain('/assets/')
    expect(shell.html).not.toContain('test-only-password')
    expect(shell.html).not.toContain('localStorage')
    expect(shell.html).not.toContain('innerHTML')
    await shell.submit()
    expect(shell.elements.password.value).toBe('')
    expect(transport).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ credentials: 'same-origin', body: JSON.stringify({ username: 'example-admin', password: 'test-only-password' }), headers: expect.objectContaining({ 'X-Requested-With': 'haizhizi' }) }))
    expect(shell.navigate).toHaveBeenCalledWith('/')
  })

  it('keeps an invalid login on the isolated shell and renders its message as text', async () => {
    const shell = loginShell(vi.fn().mockResolvedValue(response({ code: 'INVALID_CREDENTIALS' }, 401)))
    await shell.submit()
    expect(shell.navigate).not.toHaveBeenCalled()
    expect(shell.elements.message.textContent).toBe('账号或密码不正确。')
    expect(shell.elements.password.value).toBe('')
    expect(shell.elements.submit.disabled).toBe(false)
  })
})
