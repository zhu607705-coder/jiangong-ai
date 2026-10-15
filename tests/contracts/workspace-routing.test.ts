import { afterEach, expect, test, vi } from 'vitest'
import { readWorkbenchLink, resolveProjectLocation, writeWorkbenchLink } from '../../apps/workspace/src/public-decisions'
afterEach(()=>vi.unstubAllGlobals())
test('legacy version and context links retain their meaning independently of scheme comparison',()=>{
  expect(resolveProjectLocation(readWorkbenchLink('?view=compare').view!)).toEqual({page:'results',section:'history'})
  expect(resolveProjectLocation('context')).toEqual({page:'evidence',section:'context'})
  expect(resolveProjectLocation('scenarios','compare')).toEqual({page:'scenarios',section:'compare'})
})
test('a scheme link freezes its explicit direction and baseline while navigation can return through browser history',()=>{
  const pushState=vi.fn(),replaceState=vi.fn()
  vi.stubGlobal('window',{location:{href:'http://example.test/?project=P1&view=compare&pane=operations'},history:{pushState,replaceState}})
  writeWorkbenchLink('P1','scenarios',{section:'detail',pane:'funding',scheme:'rebuild',baseline:14,push:true})
  expect(replaceState).not.toHaveBeenCalled()
  const url=pushState.mock.calls[0][2] as string
  expect(readWorkbenchLink(url.split('?')[1])).toMatchObject({projectId:'P1',view:'scenarios',section:'detail',pane:'funding',scheme:'rebuild',baseline:14})
})
test('invalid workspace pane and scheme values do not become an implicit working direction',()=>{
  expect(readWorkbenchLink('?view=scenarios&pane=other&scheme=auto&baseline=bad')).toMatchObject({pane:undefined,scheme:undefined,baseline:undefined})
})
