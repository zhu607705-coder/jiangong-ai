import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import type { ActionChunk } from '../../apps/host/generated/contracts'
import { evidenceFocusKey, resolveEvidenceFocus, type EvidenceFocusLocation } from '../../apps/workspace/src/imports/evidence-focus'
import { normalizeImportDocument } from '../../apps/workspace/src/imports/graph-model'
import DocumentEvidenceLineage from '../../apps/workspace/src/imports/DocumentEvidenceLineage'

const apiMock = vi.hoisted(()=>vi.fn())
vi.mock('../../apps/workspace/src/api',()=>({api:apiMock}))
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();apiMock.mockReset()})

const document = normalizeImportDocument({id:'doc',file_name:'原件.md',parser_result:{status:'extracted',source_hash:'hash-1',profile:{tables:[{rows:[{rowNumber:9,values:{Line:8,Text:'拟更新二次供水管网，同时修补屋面。'}}]}]}}})
const chunk = (id:string,locator:string,quote:string,version='hash-1'):ActionChunk => ({id,document_id:'doc',document_version:version,measure_key:'pipe_network',object_ref:null,stage:'proposed',kind:'action',classification:'local',spans:[{document_id:'doc',version,locator,quote}],text:quote,context_chunk_ids:[]})
const chunks = [chunk('first','line:1','原件标题'),chunk('supply','line:8','拟更新二次供水管网，'),chunk('roof','line:8','同时修补屋面。')]
const target:EvidenceFocusLocation = {documentId:'doc',version:'hash-1',locator:'line:8',quote:'拟更新二次供水管网，同时修补屋面。',token:1}

test('navigation resolves literal overlapping spans at the exact source version and locator',()=>{
  const frozen=JSON.stringify(chunks)
  expect(resolveEvidenceFocus(document,chunks,target)).toMatchObject({status:'matched',chunk:chunks[1],locator:'line:8',alias:false})
  expect(resolveEvidenceFocus(document,chunks,{...target,quote:'同时修补屋面。'})).toMatchObject({status:'matched',chunk:chunks[2]})
  expect(resolveEvidenceFocus(document,chunks,{...target,locator:'line:2'})).toEqual({status:'not-found'})
  expect(resolveEvidenceFocus(document,chunks,{...target,quote:'已经更换电梯'})).toEqual({status:'quote-mismatch'})
  expect(JSON.stringify(chunks)).toBe(frozen)
})

test('document and chunk version mismatches never fall back to a same-text alternative',()=>{
  expect(resolveEvidenceFocus(document,chunks,{...target,version:'old-hash'})).toEqual({status:'version-mismatch'})
  expect(resolveEvidenceFocus(document,[chunk('old','line:8',target.quote!,'old-hash')],target)).toEqual({status:'version-mismatch'})
  expect(resolveEvidenceFocus(document,chunks,{...target,documentId:'other'})).toEqual({status:'document-missing'})
  const badSpan=structuredClone(chunks[1]);badSpan.spans[0].version='old-hash'
  expect(resolveEvidenceFocus(document,[badSpan],target)).toEqual({status:'not-found'})
})

test('a full-line hit selects the earliest sentence rather than a longer later sentence; an exact quote takes priority',()=>{
  const first='四幢共252户。', excluded='其中一幢不纳入本次改造。', problems='现况主要是供水管道老化严重、雨污管线混接以及楼道堆物等问题，需要现场专项调查。'
  const location={...target,locator:'line:22',quote:first+excluded+problems}
  const rows=[chunk('problems','line:22',problems),chunk('excluded','line:22',excluded),chunk('households','line:22',first)]
  expect(resolveEvidenceFocus(document,rows,location)).toMatchObject({status:'matched',chunk:rows[2],quote:first})
  const full=chunk('full-line','line:22',location.quote)
  expect(resolveEvidenceFocus(document,[...rows,full],location)).toMatchObject({status:'matched',chunk:full,quote:location.quote})
})

test('only an exact text-parser Line/Text mirror maps an alias to the canonical line',()=>{
  expect(resolveEvidenceFocus(document,chunks,{...target,locator:'table:1/row:9'})).toMatchObject({status:'matched',locator:'line:8',alias:true})
  const spreadsheet={...document,format:'xlsx'}
  expect(resolveEvidenceFocus(spreadsheet,chunks,{...target,locator:'table:1/row:9'})).toEqual({status:'not-found'})
  const unrelated=structuredClone(document);unrelated.tables[0].previewRows[0].values.Text='另一行相同编号但不同文字'
  expect(resolveEvidenceFocus(unrelated,chunks,{...target,locator:'table:1/row:9'})).toEqual({status:'not-found'})
  unrelated.tables[0].previewRows[0].values.Text='拟更新二次供水管网，实际取消屋面工程。'
  expect(resolveEvidenceFocus(unrelated,chunks,{...target,locator:'table:1/row:9'})).toEqual({status:'not-found'})
  expect(evidenceFocusKey(target)).not.toBe(evidenceFocusKey({...target,token:2}))
})

test('a loaded focus request selects and focuses once, allows manual selection, and repeats only for a new token',async()=>{
  const dom=parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>setTimeout(()=>callback(0),0))
  vi.stubGlobal('cancelAnimationFrame',clearTimeout)
  const scrolled=vi.fn(), focused=vi.fn()
  Object.defineProperty(dom.window.HTMLElement.prototype,'scrollIntoView',{value:scrolled,configurable:true})
  Object.defineProperty(dom.window.HTMLElement.prototype,'focus',{value:focused,configurable:true})
  apiMock.mockImplementation((path:string)=>Promise.resolve(path.endsWith('/pipeline')?{cards:[]}:{chunks}))
  const root=createRoot(dom.document.getElementById('root')!)
  const otherDocument={...document,id:'other-document',hash:'other-hash',fileName:'另一份原件.md'}
  const render=(focusLocation=target)=>root.render(createElement(DocumentEvidenceLineage,{projectId:'P1',revision:1,documents:[otherDocument,document],sources:[],focusLocation}))
  const flush=()=>new Promise(resolve=>setTimeout(resolve,10))
  try {
    await act(async()=>{render();await flush()})
    await act(flush)
    const selected=()=>dom.document.querySelector('.document-lineage-chunks button[aria-pressed="true"]')
    expect((dom.document.querySelector('select') as unknown as HTMLSelectElement).value).toBe('doc')
    expect(apiMock.mock.calls.filter(([path])=>path.endsWith('/chunks')).every(([,body])=>body.document_id==='doc')).toBe(true)
    expect(selected()?.textContent).toContain('拟更新二次供水管网')
    expect(dom.document.querySelector('.document-lineage-filter button[aria-pressed="true"]')?.textContent).toBe('全部原文片段')
    await vi.waitFor(()=>{expect(focused).toHaveBeenCalled();expect(scrolled).toHaveBeenCalled()})
    await act(async()=>{dom.document.querySelector('.document-lineage-chunks button')!.dispatchEvent(new dom.window.Event('click',{bubbles:true}));await flush()})
    expect(selected()?.textContent).toContain('原件标题')
    const focusCalls=focused.mock.calls.length
    await act(async()=>{render({...target});await flush()})
    expect(selected()?.textContent).toContain('原件标题')
    expect(focused.mock.calls.length).toBe(focusCalls)
    await act(async()=>{render({...target,token:2});await flush()})
    await act(flush)
    expect(selected()?.textContent).toContain('拟更新二次供水管网')
    await vi.waitFor(()=>expect(focused.mock.calls.length).toBeGreaterThan(focusCalls))
    await act(async()=>{render({...target,version:'old-hash',token:3});await flush()})
    expect(dom.document.querySelector('[role="alert"]')?.textContent).toContain('版本不同')
    expect(selected()?.textContent).toContain('拟更新二次供水管网')
  } finally {await act(async()=>root.unmount())}
})
