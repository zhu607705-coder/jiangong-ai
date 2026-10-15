import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runInNewContext } from 'node:vm'
import AdminAccess, { fetchAdminSession, loginAdmin, logoutAdmin } from '../../apps/workspace/src/AdminAccess'
import { ADMIN_LOGIN_REQUIRED_EVENT, api } from '../../apps/workspace/src/api'
import { renderAdminLoginPage } from '../../apps/host/admin-login-page'

const authenticated = () => ({ authentication: { enabled: true, role: 'admin', username: 'example-admin', expires_at: new Date(Date.now() + 60_000).toISOString() } })
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
})

function loginShell(transport: ReturnType<typeof vi.fn>) {
  let submit: (event: { preventDefault: () => void }) => Promise<void> = async () => { throw new Error('Submit handler not attached') }
  const elements = {
    login: { addEventListener: (_event: string, handler: typeof submit) => { submit = handler } },
    username: { value: ' example-admin ' }, password: { value: 'test-only-password' },
    submit: { disabled: false, textContent: '登录工作台' }, message: { textContent: '' },
  }
  const reload = vi.fn(), html = renderAdminLoginPage(), script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('Independent login script missing')
  runInNewContext(script, { document: { getElementById: (id: keyof typeof elements) => elements[id] }, fetch: transport, location: { reload }, AbortController, setTimeout, clearTimeout })
  return { submit: () => submit({ preventDefault: vi.fn() }), elements, reload, html }
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
    expect(shell.reload).toHaveBeenCalledOnce()
  })

  it('keeps an invalid login on the isolated shell and renders its message as text', async () => {
    const shell = loginShell(vi.fn().mockResolvedValue(response({ code: 'INVALID_CREDENTIALS' }, 401)))
    await shell.submit()
    expect(shell.reload).not.toHaveBeenCalled()
    expect(shell.elements.message.textContent).toBe('账号或密码不正确。')
    expect(shell.elements.password.value).toBe('')
    expect(shell.elements.submit.disabled).toBe(false)
  })
})
