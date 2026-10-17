import Ajv, {type ErrorObject} from 'ajv'
import addFormats from 'ajv-formats'
import schema from './schema.json'
import type { ProjectInput, DecisionPacket } from '../../apps/host/generated/contracts'

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
ajv.addSchema(schema)
export class ContractError extends Error {
  readonly code = 'INVALID_CONTRACT'
  constructor(message: string,readonly issues:readonly ErrorObject[] = []) { super(message) }
}
export function validate<T>(type: string, value: unknown): T {
  const validator = ajv.getSchema(`${schema.$id}#/definitions/${type}`)
  if (!validator) throw new Error(`Unknown contract: ${type}`)
  if (!validator(value)) throw new ContractError(ajv.errorsText(validator.errors, { separator: '; ' }),structuredClone(validator.errors||[]))
  return value as T
}
/** Field diagnostics contain schema paths only, never submitted source bodies or credentials. */
export function contractErrorMessage(error:ContractError):string {
  const labels:Record<string,string>={scope:'研究范围',name:'名称',geometry:'范围坐标',coordinates:'坐标',as_of:'资料日期',sources:'带入资料',map_anchor:'地图位置',longitude:'经度',latitude:'纬度',coordinate_encoding:'坐标系',candidate_ids:'研究路径',business_profile:'业务方向',data_class:'资料类别',public_records:'原文结构化记录'}
  const notes=error.issues.slice(0,3).map(issue=>{
    const path=issue.instancePath.split('/').filter(Boolean).map(part=>labels[part]||(/^\d+$/.test(part)?`第${Number(part)+1}项`:part)).join(' → ')||'项目资料'
    if(issue.keyword==='maxItems')return `${path}条目超过当前接口容量（${issue.params.limit}）。`
    if(issue.keyword==='maxLength')return `${path}文字过长（最多${issue.params.limit}字）。`
    if(issue.keyword==='required')return `${path}缺少${labels[issue.params.missingProperty]||issue.params.missingProperty}。`
    if(issue.keyword==='additionalProperties')return `${path}包含不支持的字段${issue.params.additionalProperty}。`
    if(issue.keyword==='minimum'||issue.keyword==='maximum')return `${path}超出有效数值范围。`
    if(issue.keyword==='minLength')return `${path}不能为空。`
    return `${path}格式不符合要求${issue.keyword==='pattern'&&issue.instancePath==='/as_of'?'，请使用YYYY-MM-DD日期':''}。`
  })
  return [...new Set(notes)].join(' ')||error.message
}
export function projectInput(value: unknown): ProjectInput {
  const project = validate<ProjectInput>('ProjectInput', value)
  const asOf = new Date(`${project.as_of}T00:00:00Z`)
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString().slice(0, 10) !== project.as_of) throw new ContractError('资料时点不是有效日期')
  const sources = new Map(project.sources.map(s => [s.id, s]))
  if (sources.size !== project.sources.length) throw new ContractError('来源 ID 重复')
  if (new Set(project.facts.map(f => f.id)).size !== project.facts.length) throw new ContractError('事实 ID 重复')
  if (new Set(project.context_rules.map(r => r.id)).size !== project.context_rules.length) throw new ContractError('规则 ID 重复')
  for (const item of [...project.facts, ...project.context_rules]) {
    if (!sources.has(item.source_id)) throw new ContractError(`来源不存在：${item.source_id}`)
  }
  for (const rule of project.context_rules) {
    if (rule.project_id && rule.project_id !== project.project_id) throw new ContractError('规则不能跨项目生效')
    if (rule.kind === 'organizational_constraint' && sources.get(rule.source_id)?.visibility !== 'internal') throw new ContractError('组织约束需要项目内部来源')
  }
  for (const source of project.sources) {
    if (source.synthetic !== (source.data_class === 'synthetic')) throw new ContractError('合成标记与来源分类不一致')
    if(source.public_records?.some(record=>!source.raw_hash||record.source_hash!==source.raw_hash))throw new ContractError('结构化记录与原始来源哈希不一致')
  }
  if (project.synthetic && project.sources.some(s => !s.synthetic)) throw new ContractError('全合成项目不能混入真实来源；请创建真实项目')
  if (!project.synthetic && project.sources.some(s => s.synthetic)) throw new ContractError('真实项目不能混入未逐字段标注的合成资料')
  return project
}
export const decisionPacket = (value: unknown) => validate<DecisionPacket>('DecisionPacket', value)

export function ownedModelValue<T>(type: string, value: unknown): T {
  // DSH structured results are borrowed and deeply frozen. Business validation
  // must work on an owned copy without changing the durable runtime artifact.
  return validate<T>(type, structuredClone(value))
}

/** Resolve our finite canonical definitions for DSH's object-root structured-output seam. */
export type ModelPresentationPolicy = {omitOptionalFields?:readonly string[];evidenceIds?:readonly string[]}
export function presentModelSchema(value: unknown, candidateIds?: readonly string[]): Record<string, unknown> {
  function present(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (Array.isArray(node.type)) return { oneOf: node.type.map(type => present({ ...node, type })) }
    const allowed = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'title', 'description'])
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) {
      if (key === 'anyOf' || key === 'oneOf') out.oneOf = (child as unknown[]).map(present)
      else if (key === 'properties') out.properties = Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, property]) => [name, present(property)]))
      else if (key === 'items' || key === 'additionalProperties') out[key] = present(child)
      else if (key === 'enum' && candidateIds && Array.isArray(child) && child.includes('defer_and_investigate')) out[key] = child.filter(id => candidateIds.includes(id))
      else if (allowed.has(key)) out[key] = child
    }
    // DSH's presentation subset omits numeric length keywords. Keep the bound
    // visible to the model as a description while AJV remains authoritative.
    const bounds:string[]=[]
    if(typeof node.maxLength==='number') bounds.push(`最多 ${node.maxLength} 个字符`)
    if(typeof node.maxItems==='number') bounds.push(`最多 ${node.maxItems} 项`)
    if(bounds.length) out.description=[node.description,...bounds].filter(Boolean).join('；')
    return out
  }
  return present(value) as Record<string, unknown>
}

export function modelSchema(name: string, candidateIds?: readonly string[], policy:ModelPresentationPolicy = {}): Record<string, unknown> {
  const defs = schema.definitions as Record<string, unknown>
  function inline(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(inline)
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (typeof node.$ref === 'string') {
      const target = defs[node.$ref.replace('#/definitions/', '')]
      if (!target) throw new Error('Unknown schema reference')
      return inline(target)
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, inline(child)]))
  }
  // DSH accepts a smaller presentation subset. Keep original constraints
  // authoritative at validation time after the structured response returns.
  const result = presentModelSchema(inline(defs[name]),candidateIds)
  for(const field of policy.omitOptionalFields || []) {
    if((result.required as string[] | undefined)?.includes(field)) throw new Error('CANNOT_OMIT_REQUIRED_MODEL_FIELD')
    delete (result.properties as Record<string,unknown>)[field]
  }
  const evidenceIds=policy.evidenceIds
  if(evidenceIds) {
    const allowedReferences=[...evidenceIds]
    function closeReferences(node:any):void {
      if(!node || typeof node!=='object') return
      for(const field of ['evidence_refs','source_ids'])if(node.properties?.[field]){node.properties[field].items=allowedReferences.length?{type:'string',enum:allowedReferences}:{type:'string'};if(!allowedReferences.length)node.properties[field].description='本轮没有可引用来源，必须返回空数组。'}
      if(node.properties?.source_id){const nullable=node.properties.source_id.oneOf?.some((part:any)=>part.type==='null');if(nullable)node.properties.source_id=allowedReferences.length?{oneOf:[{type:'string',enum:allowedReferences},{type:'null'}]}:{type:'null'};else if(allowedReferences.length)node.properties.source_id={type:'string',enum:allowedReferences}}
      for(const child of Object.values(node)) if(Array.isArray(child)) child.forEach(closeReferences); else closeReferences(child)
    }
    closeReferences(result)
    if(!allowedReferences.length&&(result.properties as any)?.rationale)(result.properties as any).rationale.description='本轮没有可引用来源，必须返回空数组。'
  }
  if (name === 'ScenarioProposal') {
    const properties = result.properties as Record<string, Record<string, unknown>>
    const base = properties.scenarios.items as Record<string, unknown>
    const actionFamilies: Record<string, string[]> = {
      retain_and_reuse: ['retain', 'retrofit', 'use_change', 'investigate', 'phase_work'],
      selective_rebuild: ['retain', 'partial_demolition', 'retrofit', 'use_change', 'investigate', 'phase_work'],
      whole_site_rebuild: ['whole_demolition', 'use_change', 'investigate', 'phase_work'],
      defer_and_investigate: ['investigate', 'retain'],
    }
    properties.scenarios.items = { oneOf: (candidateIds || Object.keys(actionFamilies)).map(id => {
      const branch = structuredClone(base)
      const fields = branch.properties as Record<string, Record<string, unknown>>
      fields.id = { type: 'string', const: id }
      if (id === 'defer_and_investigate') fields.status = { type: 'string', const: 'investigate' }
      const actions = fields.action_specs.items as { properties: Record<string, unknown> }
      actions.properties.kind = { type: 'string', enum: actionFamilies[id], description: 'phase_work 仅表示施工分期；调查分步必须使用 investigate。' }
      branch.required = [...new Set([...(branch.required as string[]), 'action_specs'])]
      return branch
    }) }
  }
  return result
}
