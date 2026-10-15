import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
import StrategyOverview from '../../apps/workspace/src/components/StrategyOverview'
import type { Project } from '../../apps/workspace/src/api'

vi.mock('../../apps/workspace/src/maps/RenewalModePanel', () => ({ default: () => null }))
vi.mock('../../apps/workspace/src/components/CompleteCommunityDemo', () => ({ default: () => null }))
vi.mock('../../apps/workspace/src/components/CommunityOperationsPanel', () => ({ default: () => null }))
const project = { id: 'strategy-status', context_version: 0, name: '测试项目', input: fixture } as unknown as Project
const failed = { project_id: project.id, context_version: 0, input_hash: 'hash', created_at: '2026-10-15T03:30:51.777Z', synthetic: false, status: 'failed', strategy: null,
  sources: [{ id: 'SOURCE', title: '已取得的来源', text: '已保留原文。', url: null, published_at: null, role: 'current', locator: 'line:1' }],
  research: { queries: ['测试项目 综合整治'] }, error: 'LIVE_STAGE_FAILED:renewal_strategy:error',
  model_calls: [{ stage: 'renewal_strategy', requested_model: 'deepseek-flash', returned_model: null, error_code: 'TRANSPORT', finish_reason: 'error', input_tokens: 0, output_tokens: 0, duration_ms: 10500 }] }
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function render(value: unknown) {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = dom.document.getElementById('root')!, root = createRoot(container)
  const transport = vi.fn(() => Promise.resolve(response(value)))
  vi.stubGlobal('fetch', transport)
  await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(StrategyOverview, { project, demoActive: false, onEvidence: vi.fn(), onInvestigate: vi.fn() }))))
  return { container, root, transport }
}

test('a saved failed strategy is Chinese, visibly failed, and retains access to acquired material', async () => {
  const { container, root, transport } = await render(failed)
  try {
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')?.textContent).toContain('无法连接模型服务'))
    expect(container.querySelector('.strategy-summary h3')?.textContent).toBe('整体更新方案生成失败')
    expect(container.textContent).not.toMatch(/LIVE_STAGE_FAILED|renewal_strategy|TRANSPORT|正在形成本项目|Agent 综合方案/)
    expect(container.textContent).toContain('查看已取得资料')
    expect(container.textContent).toContain('10.5 秒')
    expect(transport.mock.calls.every(call => (call as unknown as [string, RequestInit])[1].method === 'GET')).toBe(true)
  } finally { await act(async () => root.unmount()) }
})

test('failed packets cannot publish a stray strategy as a successful plan', async () => {
  const { container, root } = await render({ ...failed, strategy: { headline: '不应展示的成功方案', summary: '不应展示', paths: [], dimensions: [] } })
  try {
    await vi.waitFor(() => expect(container.textContent).toContain('整体更新方案生成失败'))
    expect(container.textContent).not.toContain('不应展示的成功方案')
  } finally { await act(async () => root.unmount()) }
})

test('unavailable model configuration is neither loading nor successful', async () => {
  const { container, root } = await render({ ...failed, status: 'unavailable', model_calls: [], error: '请先配置 DeepSeek 模型接口。' })
  try {
    await vi.waitFor(() => expect(container.textContent).toContain('整体更新方案暂不可生成'))
    expect(container.textContent).toContain('尚未配置模型服务')
    expect(container.textContent).not.toMatch(/正在形成|Agent 综合方案/)
  } finally { await act(async () => root.unmount()) }
})

test('arbitrary transport errors cannot expose raw provider URLs or keys in the interface', async () => {
  const { container, root } = await render(null)
  try {
    vi.mocked(fetch).mockRejectedValue(new Error('https://provider.invalid?api_key=sk-private'))
    await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(StrategyOverview, { project: { ...project, context_version: 1 }, demoActive: false, onEvidence: vi.fn(), onInvestigate: vi.fn() }))))
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')).not.toBeNull())
    expect(container.textContent).not.toMatch(/provider\.invalid|sk-private/)
    expect(container.querySelector('.strategy-summary h3')?.textContent).toBe('更新方案读取失败')
  } finally { await act(async () => root.unmount()) }
})

test('an administrator sees real streamed stages and can stop without any fake percentage or automatic call', async () => {
  const { container, root, transport } = await render(null)
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const encoder=new TextEncoder()
  transport.mockImplementation((...args: unknown[]) => Promise.resolve((args[1] as RequestInit)?.method==='POST'
    ? new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller}}),{headers:{'Content-Type':'application/x-ndjson'}})
    : response(null)))
  try {
    await act(async()=>root.render(createElement(StrategyOverview,{project,demoActive:false,onEvidence:vi.fn(),onInvestigate:vi.fn()})))
    await vi.waitFor(()=>expect(container.querySelector('.strategy-top button')?.textContent).toContain('开始研究'))
    expect(transport.mock.calls.every(call=>(call as unknown as [string,RequestInit])[1].method==='GET')).toBe(true)
    await act(async()=>container.querySelector<HTMLButtonElement>('.strategy-top button')!.click())
    await vi.waitFor(()=>expect(stream).toBeDefined())
    await act(async()=>{
      for(const event of [
        {type:'progress',stage:'sources',status:'completed',message:'已读取3份项目依据。',source_count:3},
        {type:'progress',stage:'research',status:'completed',message:'两轮检索已结束。',source_count:8,query_count:12},
        {type:'progress',stage:'model',status:'running',message:'正在研究两条更新路径。',source_count:8},
      ])stream.enqueue(encoder.encode(JSON.stringify(event)+'\n'))
    })
    await vi.waitFor(()=>expect(container.querySelector('.strategy-progress-summary')?.textContent).toContain('已整理 8 份资料'))
    expect(container.querySelectorAll('.strategy-progress li[data-state=completed]')).toHaveLength(2)
    expect(container.querySelector('.strategy-progress li[data-state=running]')?.textContent).toContain('研究两条更新路径')
    expect(container.querySelector('.strategy-progress')?.textContent).not.toMatch(/\d+%/)
    await act(async()=>container.querySelector<HTMLButtonElement>('.strategy-elapsed button')!.click())
    expect(container.querySelector('.strategy-progress h3')?.textContent).toBe('研究已停止')
    const post=transport.mock.calls.find(call=>(call as unknown as [string,RequestInit])[1].method==='POST') as unknown as [string,RequestInit]
    expect(post[1].signal?.aborted).toBe(true)
  } finally { await act(async()=>root.unmount()) }
})

test('historical rebuild output stays a comparison until the current nine-condition gate passes', async () => {
  const strategy={headline:'直接推荐整体拆建的旧标题',summary:'旧模型建议整体拆建。',preferred_mode:'rebuild',paths:[],dimensions:[],rationale:[],next_checks:[]}
  const {container,root}=await render({...failed,status:'completed',strategy,error:null})
  try{
    await vi.waitFor(()=>expect(container.querySelector('.strategy-summary h3')?.textContent).toContain('综合整治'))
    expect(container.querySelector('.strategy-direction-label')?.textContent).toBe('当前研究基线：综合整治')
    expect(container.querySelector('.strategy-summary')?.textContent).not.toContain('直接推荐整体拆建的旧标题')
    expect(container.querySelector('.strategy-search-record')?.textContent).toContain('历史模型原始方向')
  }finally{await act(async()=>root.unmount())}
})

test('a failed refresh retains the last completed strategy and labels it as the previous saved result', async()=>{
  const strategy={headline:'上次已完成的综合整治方案',summary:'保留已保存的路径与来源。',preferred_mode:'comprehensive',paths:[],dimensions:[],rationale:[],next_checks:[]}
  const saved={...failed,status:'completed',strategy,error:null}
  const {container,root,transport}=await render(saved)
  try{
    transport.mockImplementation((...args:unknown[])=>Promise.resolve(response((args[1] as RequestInit)?.method==='POST'?failed:saved)))
    await act(async()=>root.render(createElement(StrategyOverview,{project,demoActive:false,onEvidence:vi.fn(),onInvestigate:vi.fn()})))
    await vi.waitFor(()=>expect(container.querySelector('.strategy-summary h3')?.textContent).toBe(strategy.headline))
    await act(async()=>container.querySelector<HTMLButtonElement>('.strategy-top button')!.click())
    await vi.waitFor(()=>expect(container.querySelector('[role=alert]')?.textContent).toContain('本轮更新失败，展示上次已保存方案'))
    expect(container.querySelector('.strategy-summary h3')?.textContent).toBe(strategy.headline)
    expect(container.querySelector('.strategy-model-label')?.textContent).toBe('上次已保存的整体更新方案')
    expect(container.textContent).not.toMatch(/LIVE_STAGE_FAILED|TRANSPORT/)
  }finally{await act(async()=>root.unmount())}
})
