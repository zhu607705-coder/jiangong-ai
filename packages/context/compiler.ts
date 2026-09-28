import { randomUUID } from 'node:crypto'
import type { ExperienceRule, ProjectInput, Source } from '../../apps/host/generated/contracts'

export interface ContextPatch { source: Source; rules: ExperienceRule[]; warnings: string[]; compiler: string }

/** Conservative offline compiler for explicit project statements, with traceable raw text. */
export function compileContext(project: ProjectInput, text: string, trustedAuthor: boolean): ContextPatch {
  const sourceId = `S-CTX-${randomUUID()}`
  const source: Source = { id: sourceId, title: '项目经验与组织意见', visibility: 'internal', synthetic: project.synthetic,
    data_class: project.synthetic ? 'synthetic' : 'internal', untrusted_text: text, retrieved_at: new Date().toISOString() }
  const rules: ExperienceRule[] = []
  const warnings = ['本地保守解析仅识别明确表达；未识别内容保留为待核线索。']
  const add = (kind: ExperienceRule['kind'], predicate: string, value: boolean | string | null, original: string, note: string) => {
    rules.push({ id: `RULE-${randomUUID()}`, kind, scope: 'project', project_id: project.project_id, predicate, value,
      source_id: sourceId, authority_status: trustedAuthor ? 'project_confirmed' : 'unverified', supersedes: null,
      note, original_text: original, active: true })
  }
  const sentences = text.split(/[。；;\n]/).map(v => v.trim()).filter(Boolean)
  for (const sentence of sentences) {
    if (/(忽略|绕过).*(规则|指令|权限)|system\s*:|发送.*(外部|网站)|API.?KEY|全公司|全企业/i.test(sentence)) {
      warnings.push('识别到越权或外发要求，仅保存原文，不执行。')
      add('unknown', 'untrusted_instruction', sentence, sentence, '材料中的指令不获得执行权限。')
      continue
    }
    let recognized = false
    if (/(本项目|项目).*(不|不能|禁止|别|不得)(?:进行)?整体拆|先别整体拆|不整体拆除/.test(sentence) && !/(不是|并非|取消|撤销|不再|不禁止|不反对|并不要求|如果|假如|建议|讨论|有人说|据说|是否|可能)/.test(sentence)) {
      add(trustedAuthor ? 'organizational_constraint' : 'fact_candidate', 'no_whole_site_demolition', true, sentence, '项目组织约束；不是法规，不代表局部改造已获批准。')
      recognized = true
    }
    if (/(最好|希望|优先|倾向|尽量).{0,8}分期/.test(sentence)) {
      add('preference', 'prefer_phasing', true, sentence, '分期为偏好，不是强制审批条件。'); recognized = true
    }
    if (/(做过|参与过|有).{0,12}(改造|更新).{0,6}(经验|项目)?/.test(sentence)) {
      add('capability_lead', 'renewal_experience', sentence, sentence, '能力线索，需关联实际项目和可调用资源。'); recognized = true
    }
    if (/(仍|还|正在|尚).{0,8}(出租|租赁|在租)/.test(sentence)) {
      add('fact_candidate', 'active_lease', sentence, sentence, '未定位建筑和租期；不能猜测腾退时间。'); recognized = true
    }
    if (/结构.*(不确定|不清楚|未知|未检测|还没|能不能|是否)/.test(sentence)) {
      add('unknown', 'structural_safety', null, sentence, '结构安全保持未知，需专业检测。'); recognized = true
    }
    if (!recognized) add('unknown', 'unclassified_experience', sentence, sentence, '尚未编译成可执行规则，需进一步核实语义。')
  }
  return { source, rules, warnings, compiler: 'local-conservative-v1 (no model call)' }
}

export function applyContextPatch(project: ProjectInput, patch: ContextPatch): ProjectInput {
  const next = structuredClone(project)
  next.mode = 'enterprise'
  next.sources.push(patch.source)
  for (const rule of patch.rules) {
    const previous = [...next.context_rules].reverse().find(r => r.predicate === rule.predicate && r.active !== false)
    if (previous) { previous.active = false; rule.supersedes = previous.id }
    next.context_rules.push(rule)
  }
  return next
}

/** Visibility filtering happens before tools/model serialization and before cache keys. */
export function visibleSnapshot(project: ProjectInput, visibility: 'public' | 'internal'): ProjectInput {
  const copy = structuredClone(project)
  if (visibility === 'public') {
    copy.sources = copy.sources.filter(s => s.visibility === 'public')
    const ids = new Set(copy.sources.map(s => s.id))
    copy.facts = copy.facts.filter(f => ids.has(f.source_id))
    copy.context_rules = []
    copy.events = []
  }
  return copy
}
