import { test,expect } from 'vitest'
import { registerIntelligenceCases } from '../intelligence/cases'
import {searchTokens,queryScore} from '../../packages/intelligence/domain'
registerIntelligenceCases(test)

test('memoized tokens cannot be changed by a caller and leave repeated ranking stable',()=>{
 const question='求是村 电梯 预算 54万元',original=searchTokens(question)
 const first=queryScore({title:'求是村电梯',text:'预算54万元'},question)
 original.splice(0,original.length,'INJECTED-TOKEN')
 expect(searchTokens(question)).not.toContain('INJECTED-TOKEN')
 expect(searchTokens(question)).toContain('电梯')
 expect(queryScore({title:'求是村电梯',text:'预算54万元'},question)).toBe(first)
})
