import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const skillText = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8')
export const BRIEF_SKILL_VERSION = 'brief-' + createHash('sha256').update(skillText).digest('hex').slice(0,12)
export const INVESTMENT_BRIEF_SKILL = skillText
const defensive = /用途.{0,14}权属.{0,14}腾退.{0,18}未核实|不可直接套用更新项目|不是线路数|不等同于客观需求|不代表|不构成|仅供参考|AI\s*生成与搜索可能存在错误/
/** Reject, never trim a negation or silently rewrite a model's meaning. */
export function assertBriefProse(value: {summary?:string;opportunities?:{text:string}[];cautions?:{text:string}[];next_steps?:string[]}) {
  const prose=[value.summary,...(value.opportunities||[]).map(x=>x.text),...(value.cautions||[]).map(x=>x.text),...(value.next_steps||[])].filter(Boolean).join('\n')
  if(defensive.test(prose)) throw new Error('BRIEF_STYLE_RETRY')
}
export type ReferenceCase = {id:string;name:string;tags:string[];published_fact:string;investment_reading:string;next_check:string;transfer_condition:string;source_url:string;source_locator:string;published_at:string}
let cases:ReferenceCase[]|undefined
export function selectReferenceCases(text:string, limit=3):ReferenceCase[] {
  cases ??= JSON.parse(readFileSync(new URL('./references/cases.json', import.meta.url),'utf8')).cases
  return cases!.map(c=>({c,score:c.tags.reduce((n,t)=>n+(text.includes(t)?1:0),0)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id)).slice(0,Math.min(3,limit)).map(x=>x.c)
}
