import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../apps/workspace/src/api'
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})
afterEach(()=>vi.unstubAllGlobals())
describe('workspace in-flight reads',()=>{
  it('shares only concurrent reads and gives each caller an independent snapshot',async()=>{
    let release!:(value:Response)=>void
    const transport=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{release=r})).mockResolvedValue(response({version:2}))
    vi.stubGlobal('fetch',transport)
    const a=api<{sources:{title:string}[]}>('/read-isolation'),b=api<{sources:{title:string}[]}>('/read-isolation')
    expect(transport).toHaveBeenCalledTimes(1)
    release(response({sources:[{title:'原文'}]}))
    const [x,y]=await Promise.all([a,b]);x.sources[0].title='修改'
    expect(y.sources[0].title).toBe('原文')
    expect(await api('/read-isolation')).toEqual({version:2})
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('invalidates pending sharing on writes without letting old cleanup remove a newer read',async()=>{
    let old!:(value:Response)=>void,fresh!:(value:Response)=>void
    const transport=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{old=r})).mockResolvedValueOnce(response({saved:true})).mockImplementationOnce(()=>new Promise<Response>(r=>{fresh=r}))
    vi.stubGlobal('fetch',transport)
    const first=api('/write-boundary')
    await api('/write-boundary',{update:true})
    const next=api('/write-boundary')
    old(response({version:1}));await first
    const same=api('/write-boundary');expect(transport).toHaveBeenCalledTimes(3)
    fresh(response({version:2}));expect(await Promise.all([next,same])).toEqual([{version:2},{version:2}])
  })
  it('keeps abort ownership separate and retries rejected reads',async()=>{
    const transport=vi.fn().mockResolvedValueOnce(response({ok:1})).mockResolvedValueOnce(response({ok:2})).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({ok:3}))
    vi.stubGlobal('fetch',transport)
    await Promise.all([api('/abort-owner',undefined,new AbortController().signal),api('/abort-owner',undefined,new AbortController().signal)])
    expect(transport).toHaveBeenCalledTimes(2)
    await expect(api('/retry-read')).rejects.toThrow('offline')
    expect(await api('/retry-read')).toEqual({ok:3})
  })
})
