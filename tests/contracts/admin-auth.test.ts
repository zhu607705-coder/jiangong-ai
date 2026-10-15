import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { scryptSync } from 'node:crypto'
import type { Server } from 'node:http'
import { AdminAccess, registerAdminRoutes } from '../../apps/host/admin-auth'

const password = 'fixture-only-password'
const salt = '11'.repeat(16)
const hash = `scrypt$${salt}$${scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')}`
const servers: Server[] = [], accesses: AdminAccess[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const access of accesses.splice(0)) access.close()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })))
})
function access(hashValue = hash, publicReadOnly = false, collaborativeWorkspace = false) { const value = new AdminAccess('fixture-admin', hashValue, 300, publicReadOnly, collaborativeWorkspace); accesses.push(value); return value }
async function service(hashValue = hash, publicReadOnly = false, collaborativeWorkspace = false) {
  const auth = access(hashValue, publicReadOnly, collaborativeWorkspace), app = express(); app.use(express.json())
  app.get('/health', (_request,response)=>response.json({ok:true}))
  registerAdminRoutes(app, auth, () => ({ user: { id: 'local-operator' } }), () => '<html>Independent login shell</html>')
  app.get('/api/protected', (_request,response)=>response.json({private:true}))
  app.post('/api/write', (_request,response)=>response.json({written:true}))
  app.get('/assets/history.js', (_request,response)=>response.send('PRIVATE_DATASET'))
  app.get('/deliverables/report.pdf', (_request,response)=>response.send('PRIVATE_REPORT'))
  app.get('/api/projects', (_request,response)=>response.json([{id:'existing-project'}]))
  app.post('/api/projects', (_request,response)=>response.json({written:true}))
  app.post('/api/projects/p/knowledge/retrieve', (_request,response)=>response.json({fact_writes:0}))
  app.post('/api/projects/p/renewal-strategy', (_request,response)=>response.json({model_called:true}))
  app.get('/api/events', (_request,response)=> { response.type('text/event-stream'); response.write('data: private\n\n') })
  const server=app.listen(0,'127.0.0.1');servers.push(server)
  await new Promise<void>(resolve=>server.once('listening',resolve))
  const port=(server.address() as {port:number}).port
  const request=(path:string,options:RequestInit={})=>fetch(`http://127.0.0.1:${port}${path}`,options)
  const login=(body:unknown={username:'fixture-admin',password},cookie?:string)=>request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'haizhizi',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)})
  return {auth,request,login}
}
const cookieOf=(response:Response)=>response.headers.get('set-cookie')!.split(';')[0]

describe('single administrator server boundary', () => {
  it('does not issue anonymous sessions or expose business assets and API aliases', async () => {
    const {request}=await service()
    const root=await request('/');expect(await root.text()).toContain('Independent login shell')
    const session=await request('/api/session');expect(session.status).toBe(401);expect(session.headers.get('set-cookie')).toBeNull()
    for(const path of ['/api/protected','/API/protected','/assets/history.js','/deliverables/report.pdf','/_AMapService/v3/place'])expect((await request(path)).status).toBe(401)
    expect((await request('/api/write',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(401)
  })
  it('allows a valid administrator and revokes the previous session on relogin and logout', async () => {
    const {request,login}=await service()
    expect((await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(403)
    expect((await login({username:'fixture-admin',password:'wrong'})).status).toBe(401)
    const result=await login();expect(result.status).toBe(200)
    expect(result.headers.get('set-cookie')).toMatch(/HttpOnly/i);expect(result.headers.get('set-cookie')).toMatch(/SameSite=Strict/i)
    const cookie=cookieOf(result), metadata=await result.json()
    expect(metadata.authentication).toMatchObject({enabled:true,role:'admin',username:'fixture-admin'})
    expect((await request('/api/protected',{headers:{Cookie:cookie}})).status).toBe(200)
    expect((await request('/assets/history.js',{headers:{Cookie:cookie}})).status).toBe(200)
    const replacement=cookieOf(await login(undefined,cookie))
    expect((await request('/api/protected',{headers:{Cookie:cookie}})).status).toBe(401)
    expect((await request('/api/auth/logout',{method:'POST',headers:{Cookie:replacement,'X-Requested-With':'haizhizi'}})).status).toBe(200)
    expect((await request('/api/protected',{headers:{Cookie:replacement}})).status).toBe(401)
  })
  it('closes an existing stream when its administrator logs out', async () => {
    const {request,login}=await service(),cookie=cookieOf(await login())
    const stream=await request('/api/events',{headers:{Cookie:cookie}}),reader=stream.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: private')
    const closed=reader.read().then(value=>value.done).catch(()=>true)
    await request('/api/auth/logout',{method:'POST',headers:{Cookie:cookie,'X-Requested-With':'haizhizi'}})
    expect(await closed).toBe(true)
  })
  it('limits concurrent password attempts before spending hashing work', async () => {
    const auth=access()
    await Promise.all(Array.from({length:8},()=>auth.login('fixture-admin','wrong')))
    expect(auth.retryAfter()).toBeGreaterThan(0)
    expect(await auth.login('fixture-admin',password)).toBeNull()
    const {request,login}=await service()
    for(let index=0;index<5;index++)expect((await login({username:'fixture-admin',password:'wrong'})).status).toBe(401)
    const blocked=await login();expect(blocked.status).toBe(429);expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await request('/api/session')).status).toBe(401)
  })
  it('expires server-side sessions and rejects forged and duplicate cookies', async () => {
    const auth=access(),token=await auth.login('fixture-admin',password)
    expect(auth.identity(`hzz_session=${token}`)).not.toBeNull()
    expect(auth.identity(`hzz_session=${'a'.repeat(64)}`)).toBeNull()
    expect(auth.identity(`hzz_session=${token}; hzz_session=${token}`)).toBeNull()
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+301000)
    expect(auth.identity(`hzz_session=${token}`)).toBeNull()
    vi.restoreAllMocks()
  })
  it('preserves the local-mode session handshake', async () => {
    const {request}=await service(''),session=await request('/api/session')
    expect(session.status).toBe(200);expect((await session.json()).authentication.enabled).toBe(false)
    expect((await request('/api/protected',{headers:{Cookie:cookieOf(session)}})).status).toBe(200)
  })
  it('enables campus collaboration without login even when old administrator credentials are retained', async () => {
    const {auth,request,login}=await service(hash,true,true)
    expect(auth.enabled).toBe(false);expect(auth.publicReadOnly).toBe(false)
    const session=await request('/api/session')
    expect(session.status).toBe(200)
    const metadata=await session.json(),cookie=cookieOf(session)
    expect(metadata.authentication).toMatchObject({enabled:false,role:'admin',public_read_only:false,collaborative_workspace:true})
    expect(auth.identity(cookie)).not.toBeNull()
    expect(JSON.stringify(metadata)).not.toContain(hash)
    for(const path of ['/api/write','/api/projects','/api/projects/p/renewal-strategy']) {
      expect((await request(path,{method:'POST',headers:{Cookie:cookie,'X-Requested-With':'haizhizi'}})).status).toBe(200)
    }
    expect((await request('/assets/history.js')).status).toBe(200)
    const oldEntry=await request('/admin/login',{redirect:'manual'})
    expect(oldEntry.status).toBe(303);expect(oldEntry.headers.get('location')).toBe('/')
    expect((await login()).status).toBe(403)
  })
  it('keeps the previous private administrator mode available when collaboration is disabled again', async () => {
    const collaborative=access(hash,true,true)
    expect(await collaborative.login('fixture-admin',password)).toBeNull()
    const restored=access(hash,false,false)
    expect(restored.enabled).toBe(true)
    expect(await restored.login('fixture-admin',password)).toMatch(/^[a-f0-9]{64}$/)
  })
  it('allows published reads as a viewer without issuing an administrator cookie', async () => {
    const {request,login}=await service(hash,true)
    const session=await request('/api/session')
    expect(session.status).toBe(200);expect(session.headers.get('set-cookie')).toBeNull()
    expect((await session.json()).authentication).toMatchObject({enabled:true,role:'viewer',expires_at:null})
    expect((await request('/api/projects')).status).toBe(200)
    expect((await request('/assets/history.js')).status).toBe(200)
    expect((await request('/api/projects/p/knowledge/retrieve',{method:'POST'})).status).toBe(403)
    expect((await request('/api/projects',{method:'POST'})).status).toBe(403)
    expect((await request('/api/projects/p/renewal-strategy',{method:'POST'})).status).toBe(403)
    expect(await (await request('/admin/login')).text()).toContain('Independent login shell')
    const cookie=cookieOf(await login())
    expect((await request('/api/projects',{method:'POST',headers:{Cookie:cookie}})).status).toBe(200)
  })
})
