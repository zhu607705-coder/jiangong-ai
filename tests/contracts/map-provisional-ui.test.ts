import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parseHTML} from 'linkedom'
import {expect,it} from 'vitest'
import DecisionDashboard from '../../apps/workspace/src/components/DecisionDashboard'
import {initialMapDashboard,withAnalysisCompletion} from '../../packages/maps/analysis-completion'
import type {MapScreenAnalysis,MapScreenContext} from '../../apps/host/generated/contracts'

it('keeps an evidence score while displaying five clearly marked estimates without promoting evidence coverage',()=>{
 const keys=['demand','supply','adaptation','implementation','operations','resources'] as const
 const evidence={policy_version:'neighborhood-renovation-fit-v2',purpose:'本对象',model:'decision-model-preview',request_id:'UI',status:'partial',dimensions:keys.map(key=>({key,value:key==='demand'?4.2:null,confidence:key==='demand'?.9:null,basis:'本对象原文',evidence_refs:key==='demand'?['S']:[]}))}
 const provisional={...evidence,status:'completed',dimensions:keys.map((key,index)=>({key,value:1.3+index*.4,confidence:.3,basis:'情景假设：分项改善。补查重点：实际台账。',evidence_refs:[]}))}
 const analysis={context_id:'UI',profile:'neighborhood',created_at:'2026-10-16',status:'completed',model_calls:[],assessment:null,decision_support:{dashboard:evidence,provisional_dashboard:provisional}} as unknown as MapScreenAnalysis
 const initial=initialMapDashboard(analysis)!
 expect(initial.dashboard.dimensions[0].value).toBe(4.2)
 expect(initial.provisionalKeys).toEqual(keys.slice(1))
 const html=renderToStaticMarkup(createElement(DecisionDashboard,{value:initial.dashboard,onEvidence:()=>{},presentation:{title:'六维初步画像',scale:'1–5',method:'情景暂估',provisionalKeys:initial.provisionalKeys}}))
 const {document}=parseHTML(html)
 expect(document.querySelectorAll('[data-provisional=true]')).toHaveLength(5)
 expect(document.querySelectorAll('.dimension-estimate-badge')).toHaveLength(5)
 expect(document.querySelector('[data-provisional]')?.textContent).toContain('推理评分')
 expect(document.querySelector('.radar-area--provisional')).not.toBeNull()
 expect(withAnalysisCompletion(analysis,{project_revision:'v1'} as MapScreenContext).completion?.evidence).toBe('partial')
 expect(initialMapDashboard({...analysis,refresh_required:true})).toBeNull()
 const evidenceHtml=renderToStaticMarkup(createElement(DecisionDashboard,{value:analysis.decision_support!.dashboard!,onEvidence:()=>{}}))
 expect(parseHTML(evidenceHtml).document.querySelectorAll('[data-provisional]')).toHaveLength(0)
 expect(evidenceHtml).toContain('4.2');expect(evidenceHtml).toContain('—')
})
