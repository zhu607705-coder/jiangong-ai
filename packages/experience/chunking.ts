import { createHash } from 'node:crypto'
import type { ActionChunk, ExperienceDraft, ExperienceEvidence, ExperienceField } from '../../apps/host/generated/contracts'
import { documentSlices, type ParsedDocument, type DocumentSlice } from './document-slices'
import { ExperienceError } from './errors'
import { deriveMeasureFactors, extractMeasureFactors } from './measure-factors'

// Domain classification only. The existing ParserPort/documentSlices owns parsing.
const measures = [
  { key: 'elevator', pattern: /电梯|加梯/g },
  { key: 'elevator_update', pattern: /老旧电梯更新|电梯(?:更新|大修|更换|改造)|更换电梯/g },
  { key: 'accessibility_ramp', pattern: /(?:无障碍)?坡道/g },
  { key: 'accessibility_handrail', pattern: /(?:无障碍)?扶手/g },
  { key: 'pipe_network', pattern: /二次供水|二供|供水(?:改造|设施|系统|管网|管道)|雨污分流|(?:排水|给水|燃气|污水|雨水)管(?:网|道)?|地下管网|管网/g },
  { key: 'fire_safety', pattern: /消防(?:通道|设施|改造|水管|栓)?|消火栓/g },
  { key: 'maintenance', pattern: /长效维护|运维|维保|维护|维修养护|物业管理/g },
  { key: 'public_service', pattern: /公共服务|养老(?:服务|设施)?|托育|社区食堂|社区卫生|便民服务|公共活动空间|儿童活动/g },
  { key: 'road_renewal', pattern: /道路(?:整治|改造|更新)?|路面(?:改造|修复)?/g },
  { key: 'roof_repair', pattern: /屋顶|屋面|外墙/g },
  { key: 'parking', pattern: /停车(?:位|场)?|充电设施|充电桩/g },
  { key: 'accessibility', pattern: /无障碍(?:改造|设施|通行|通道)/g },
] as const
type Hit = { key: string; start: number; end: number; name: string }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const uniqueSpans = (spans: ExperienceEvidence[]) => [...new Map(spans.map(span => [JSON.stringify(span), span])).values()]

function hits(text: string): Hit[] {
  const found = measures.flatMap(measure => [...text.matchAll(new RegExp(measure.pattern))].map(match => ({ key: measure.key, start: match.index!, end: match.index! + match[0].length, name: match[0] })))
  const specificAccess = found.some(hit => hit.key === 'accessibility_ramp' || hit.key === 'accessibility_handrail')
  // "电梯维保" is one maintenance action, not two independent actions.
  return found.filter(hit => !(specificAccess && hit.key === 'accessibility')
    && !(hit.key === 'elevator' && found.some(other => other.key === 'elevator_update' && other.start <= hit.start && other.end >= hit.end))
    && !(hit.key === 'elevator' && /电梯\s*(?:维保|维护|运维)/.test(text) && !/加装|增设|安装/.test(text)))
    .sort((a, b) => a.start - b.start || b.end - a.end)
}

function objectIn(text: string): string | null {
  const explicit = text.match(/(?:对象(?:范围)?|项目名称|小区名称|楼栋|楼幢|建筑|单元)\s*[:：=]\s*([^|。；;，,\n]{1,100})/)
  if (explicit) return `object:${explicit[1].trim()}`
  const building = text.match(/(?:\d+|[一二三四五六七八九十]+)(?:号楼|号?幢)(?:\s*(?:\d+|[一二三四五六七八九十]+)(?:号)?单元)?/)
  if (building && !/(?:共|涉及|覆盖|整治)\s*$/.test(text.slice(0, building.index)) && !/^(?:住宅|居民楼|楼栋|建筑)/.test(text.slice(building.index! + building[0].length))) return `building:${building[0].replace(/\s+/g, '')}`
  const namedBuilding = text.match(/(?:^|[\s：:=，,；;。])([\p{Script=Han}A-Za-z0-9]{2,20}(?:楼|大厦))(?:由于|因|不|未|已|拟|将|的|位于|[，,。；;\s]|$)/u)
  if (namedBuilding && !/^(?:居民楼|住宅楼|居民住宅楼|宿舍楼|教学楼|办公楼|公寓楼|高层住宅楼)$/.test(namedBuilding[1])) return `building:${namedBuilding[1]}`
  const named = text.match(/(?:^|[\s：:=，,；;。])([\p{Script=Han}A-Za-z0-9]{1,30}(?:小区|片区|园区))/u)
  return named && !/^(?:老|老旧|该|本|全|各|整个)小区$/.test(named[1])
    && !/的|全面|推进|涉及|多个|各类/.test(named[1]) ? `object:${named[1]}` : null
}

function stageIn(text: string): string {
  const labelled = text.match(/(?:项目阶段|阶段)\s*[:：=]\s*([^|。；;，,\n]{1,100})/)
  if (labelled) return labelled[1].trim()
  const marker = text.match(/尚未实施|尚未建设|未实施|未加装|未安装|尚未|暂缓|取消|不实施|拟实施|计划|拟|将|已完成|已建成|已加装|已安装|已实施|已验收|施工中|正在施工|已支付/)
  return marker?.[0] || ''
}

function evidence(document: ParsedDocument, slice: DocumentSlice, quote: string): ExperienceEvidence[] {
  const spans: ExperienceEvidence[] = []
  // A source quotation has its own 3,000-character contract limit. Splitting
  // preserves every character and never changes the parsed locator.
  for (let start = 0; start < quote.length; start += 3000) spans.push({ document_id: document.id, version: document.sha256, locator: slice.locator, quote: quote.slice(start, start + 3000) })
  return spans
}

type Piece = { key: string; quote: string; start: number; qualifier?: string }
function pieces(text: string, table: boolean): Piece[] {
  const found = hits(text), keys = [...new Set(found.map(hit => hit.key))]
  if (!keys.length) return [{ key: 'context', quote: text, start: 0 }]
  if (table) {
    // Other cells cannot be allocated between actions named in the same row.
    // Keep the complete row as context and cite only each named action here.
    return [{ key: 'context', quote: text, start: 0 }, ...keys.map(key => {
      const hit = found.find(value => value.key === key)!
      return { key, quote: hit.name, start: hit.start }
    })]
  }
  const firstHit = found[0], prefixComma = Math.max(text.lastIndexOf('，', firstHit.start), text.lastIndexOf(',', firstHit.start))
  const hasBackgroundPrefix = prefixComma >= 0 && /预算|总额|投资|金额|\d+\s*(?:户|人|平方米|m²|m2|㎡)|背景|目标/.test(text.slice(0, prefixComma))
  const prefixEnd = hasBackgroundPrefix ? prefixComma + 1 : 0
  const boundaries = [prefixEnd]
  const keyAtBoundary = [found[0].key]
  for (let index = 1; index < found.length; index++) {
    const current = found[index], previous = found[index - 1]
    if (current.key === keyAtBoundary[keyAtBoundary.length - 1]) continue
    const between = text.slice(previous.end, current.start)
    const separators = [...between.matchAll(/[，,、]|和|及|与|同时|并(?:且)?/g)]
    const separator = separators.at(-1)
    let boundary = separator ? previous.end + separator.index! + separator[0].length : current.start
    // Include the action verb directly before the next measure in its span.
    const verb = text.slice(previous.end, current.start).match(/(?:增设|加装|改造|更新|安装|建设|新建|修建|更换|维修|实施|完善|提升|增添)\s*$/)
    if (verb) boundary = Math.min(boundary, previous.end + verb.index!)
    if (boundary <= boundaries.at(-1)!) continue
    boundaries.push(boundary); keyAtBoundary.push(current.key)
  }
  const qualifier = text.slice(0, found[0].start).match(/尚未|未|不|暂缓|取消|计划|拟|将|已完成|已建成|已实施/)?.[0]
  const lastHit = found.at(-1)!, tailComma = Math.max(text.lastIndexOf('，'), text.lastIndexOf(','))
  // An amount after a list of actions has no automatic allocation to the last
  // action. Preserve it as its own shared source context.
  const tailStart = keys.length > 1 && tailComma >= lastHit.end && /预算|总额|投资|金额|资金|合计|共计/.test(text.slice(tailComma + 1)) ? tailComma + 1 : text.length
  const actions = boundaries.map((start, index) => {
    const quote = text.slice(start, boundaries[index + 1] ?? tailStart)
    return { key: keyAtBoundary[index], quote, start, ...(index > 0 && qualifier && !stageIn(quote) ? { qualifier } : {}) }
  })
  return [...(prefixEnd ? [{ key: 'context', quote: text.slice(0, prefixEnd), start: 0 }] : []), ...actions,
    ...(tailStart < text.length ? [{ key: 'context', quote: text.slice(tailStart), start: tailStart }] : [])]
}

/** All nonempty parsed source slices remain available, including unclassified
 * context. Exceeding the canonical limits fails explicitly instead of silently
 * removing the tail of a document. */
export function buildActionChunks(document: ParsedDocument): { chunks: ActionChunk[]; warnings: string[] } {
  const parsedSlices = documentSlices(document)
  const lines = new Map(parsedSlices.filter(slice => slice.locator.startsWith('line:')).map(slice => [slice.locator, slice.text]))
  // CRE's text profile also exposes each text line as a Line/Text table row.
  // Use its canonical line once for extraction; retain both locators in documentSlices
  // so existing reviewed citations continue to resolve. Distinct equal source lines stay distinct.
  const slices = parsedSlices.filter(slice => !(/\.(md|txt)$/i.test(document.file_name) && slice.values
    && Object.keys(slice.values).length === 2 && 'Line' in slice.values && 'Text' in slice.values
    && lines.get(`line:${slice.values.Line}`) === slice.values.Text))
  const warnings: string[] = [], chunks: ActionChunk[] = []
  const groups = new Map<string, number>(), chunkSections = new Map<string, number>(), sectionObjects = new Map<number, string | null>()
  let section = 0, currentObject: string | null = null, currentStage = '', headers: ExperienceEvidence[] = []
  if (document.parser_result.status !== 'extracted') warnings.push(`当前解析状态为${document.parser_result.status || '未知'}；仅保留已解析原文，扫描页或缺失资料未提取。`)
  if (!slices.length) warnings.push('没有可引用的解析原文，需补充原文或OCR。')
  for (const slice of slices) {
    const heading = /^\s*#{1,6}\s+/.test(slice.text) || /^\s*(?:标题|项目名称|对象范围|项目阶段|阶段)\s*[:：=]/.test(slice.text)
    const explicitObject = objectIn(slice.text)
    if (heading || explicitObject?.startsWith('object:') && currentObject && explicitObject !== currentObject) {
      section++; headers = []; currentStage = ''
    }
    if (explicitObject) currentObject = explicitObject
    if (explicitObject?.startsWith('object:')) sectionObjects.set(section, explicitObject)
    if (heading) {
      headers = evidence(document, slice, slice.text)
      currentStage = stageIn(slice.text)
    }
    const ranges = slice.values || heading ? [{ quote: slice.text, start: 0 }] : [...slice.text.matchAll(/[^。！？!?；;\n]+[。！？!?；;\n]?/g)].map(match => ({ quote: match[0], start: match.index! }))
    for (const range of ranges) {
      if (!range.quote.trim()) continue
      const rangeObject = objectIn(range.quote)
      if (rangeObject?.startsWith('object:') && currentObject && rangeObject !== currentObject) { section++; headers = []; currentStage = '' }
      if (rangeObject) currentObject = rangeObject
      if (rangeObject?.startsWith('object:')) sectionObjects.set(section, rangeObject)
      const divided = heading ? [{ key: 'context', quote: range.quote, start: 0 }] : pieces(range.quote, !!slice.values)
      for (const piece of divided) {
        if (!piece.quote.trim()) continue
        const key = piece.key, spanList = [
          ...(key !== 'context' ? headers : []),
          ...(piece.qualifier ? evidence(document, slice, piece.qualifier) : []),
          ...evidence(document, slice, piece.quote),
        ]
        if (spanList.length > 100) throw new ExperienceError(422, 'ACTION_CHUNK_SPAN_LIMIT', `${slice.locator}超过100条原文span；未截断，请分批导入材料。`)
        const text = spanList.map(span => span.quote).join('\n')
        if (text.length > 30000) throw new ExperienceError(422, 'ACTION_CHUNK_TEXT_LIMIT', `${slice.locator}动作原文超过30000字符；未截断，请按原文结构拆分材料。`)
        const signature = `${slice.locator}:${range.start + piece.start}:${key}`
        const duplicate = groups.get(signature) || 0; groups.set(signature, duplicate + 1)
        const id = `chunk:${document.sha256}:${digest(`${document.id}:${signature}:${duplicate}`).slice(0, 20)}:${key}`
        const chunk: ActionChunk = { id, document_id: document.id, document_version: document.sha256, measure_key: key,
          object_ref: objectIn(piece.quote) || currentObject, stage: stageIn(piece.quote) || (piece.qualifier ? stageIn(piece.qualifier) : '') || currentStage,
          kind: key === 'context' ? 'context' : 'action', classification: 'local', spans: spanList, text, context_chunk_ids: [] }
        chunks.push(chunk); chunkSections.set(id, section)
        if (chunks.length > 100) throw new ExperienceError(422, 'ACTION_CHUNK_LIMIT', '原文产生超过100个动作/背景chunk；未截断，请分批导入材料。')
      }
    }
  }
  for (const chunk of chunks.filter(value => value.kind === 'action')) {
    chunk.context_chunk_ids = chunks.filter(context => context.kind === 'context' && chunkSections.get(context.id) === chunkSections.get(chunk.id)
      && (!context.object_ref || !chunk.object_ref || context.object_ref === chunk.object_ref
        || chunk.object_ref.startsWith('building:') && context.object_ref === sectionObjects.get(chunkSections.get(chunk.id)!))).map(context => context.id)
  }
  if (chunks.length && !chunks.some(chunk => chunk.kind === 'action')) warnings.push('未识别到明确改造举措；全部原文保留为背景chunk，需进一步分类。')
  return { chunks, warnings }
}

const fieldKeys = ['decision_question', 'background', 'key_conditions', 'alternatives', 'proposal', 'actual_decision', 'decision_basis', 'implementation', 'outcome', 'applicability'] as const
const prospective = (text: string) => /拟|计划|将|建议|提议|预计|有望|准备|尚未|未实施|未加装|未安装|暂缓|取消|不实施/.test(text)
function fieldFor(text: string): ExperienceField['key'] | null {
  if (/^\s*#{1,6}\s|^\s*(?:项目名称|对象范围|项目类型|开发模式|项目阶段|阶段|来源|发布日期|发布时间)\s*[:：=]/.test(text)) return null
  if (/^(?:决策问题|问题)\s*[:：=]|如何|是否.*[？?]/.test(text)) return 'decision_question'
  if (/^(?:背景(?:目标)?|背景与目标|目标)\s*[:：=]/.test(text)) return 'background'
  if (/^(?:关键条件|前置条件)\s*[:：=]/.test(text)) return 'key_conditions'
  if (/^(?:备选方案|候选方案)\s*[:：=]|方案一|方案二/.test(text)) return 'alternatives'
  if (/^(?:决策依据|选择依据|依据)\s*[:：=]/.test(text)) return 'decision_basis'
  if (/^(?:实际决策|决定)\s*[:：=]|决定(?:采用|实施|暂缓|取消)|选择(?:了|采用)/.test(text)) return 'actual_decision'
  if (/^(?:适用边界|适用条件)\s*[:：=]|仅适用于|不适用于|局限于|实施前须|实施前需/.test(text)) return 'applicability'
  if (prospective(text)) return /尚未|未实施|未加装|未安装|暂缓|取消|不实施/.test(text) ? null : 'proposal'
  if (/^(?:执行结果|实际结果|结果)\s*[:：=]|(?:实际|改造后|实施后).*(?:减少|改善|增加|下降|提高)/.test(text)) return 'outcome'
  if (/^(?:实际实施|实施情况)\s*[:：=]|已(?:完成|建成|加装|安装|实施|更新|改造|验收)|施工中|正在施工/.test(text)) return 'implementation'
  return null
}

/** Locally classified chunks create reviewable drafts, never approval or
 * decision-quality labels. Model-classified chunks use the same evidence path. */
export function draftsFromActionChunks(document: ParsedDocument, chunks: ActionChunk[]): ExperienceDraft[] {
  const groups = new Map<string, ActionChunk[]>()
  for (const chunk of chunks.filter(value => value.kind === 'action')) {
    if (chunk.document_id !== document.id || chunk.document_version !== document.sha256) throw new ExperienceError(409, 'ACTION_CHUNK_DOCUMENT_CONFLICT', '动作chunk与材料或版本不一致。')
    const key = `${chunk.measure_key}:${chunk.object_ref || chunk.id}`
    groups.set(key, [...(groups.get(key) || []), chunk])
  }
  return [...groups.values()].map(actions => {
    const contexts = chunks.filter(chunk => chunk.kind === 'context' && actions.some(action => action.context_chunk_ids.includes(chunk.id)))
    const all = [...actions, ...contexts], spans = uniqueSpans(actions.flatMap(chunk => chunk.spans))
    const candidates = new Map<ExperienceField['key'], ExperienceEvidence[]>()
    for (const span of spans) {
      const key = fieldFor(span.quote.trim())
      if (key) candidates.set(key, [...(candidates.get(key) || []), span])
    }
    const background = contexts.flatMap(chunk => chunk.spans).find(span => !/^\s*#|^\s*(?:标题|项目名称|对象范围|阶段|项目阶段)\s*[:：=]/.test(span.quote) && !fieldFor(span.quote.trim()))
    if (background && !candidates.has('background')) candidates.set('background', [background])
    const fields: ExperienceField[] = fieldKeys.map(key => {
      const citation = candidates.get(key)?.[0]
      return { key, value: citation?.quote ?? null, evidence: citation ? [citation] : [] }
    })
    const first = actions[0], names = spans.flatMap(span => hits(span.quote)).filter(hit => hit.key === first.measure_key)
    const measureName = names[0]?.name || spans.find(span => /(?:举措名称|措施)\s*[:：=]/.test(span.quote))?.quote.match(/(?:举措名称|措施)\s*[:：=]\s*([^|\n]{1,120})/)?.[1]
      || spans.find(span => span.quote.length <= 120)?.quote.trim() || document.file_name
    if (measureName.length > 120) throw new ExperienceError(422, 'MEASURE_NAME_LIMIT', '原文举措名称超过120字符，请提供明确名称；未截断。')
    const metadata = (label: string) => all.flatMap(chunk => chunk.spans).map(span => span.quote.match(new RegExp(`${label}\\s*[:：=]\\s*([^|。；;，,\\n]{1,80})`))?.[1]).find(Boolean) || ''
    const stages = [...new Set(actions.map(action => action.stage).filter(Boolean))]
    const factors = deriveMeasureFactors(actions.flatMap(action => extractMeasureFactors(action, contexts)))
    if (factors.length > 100) throw new ExperienceError(422, 'MEASURE_FACTOR_LIMIT', '单项举措超过100条因素；未截断，请分批整理原文。')
    const origins = { 官方政策: 'official_policy', 研究论文: 'research_paper', 实践经验: 'practice', 项目案例: 'project_case', official_policy: 'official_policy', research_paper: 'research_paper', practice: 'practice', project_case: 'project_case' } as const
    const rawOrigin = metadata('来源类型'), origin = origins[rawOrigin as keyof typeof origins] || 'project_case'
    const kind = metadata('知识类型') === '规则' || metadata('知识类型') === 'rule' || origin === 'official_policy' || origin === 'research_paper' ? 'rule' : 'case'
    return { title: measureName, project_type: metadata('项目类型'), development_mode: metadata('开发模式'), stage: stages.length === 1 ? stages[0] : '', fields,
      knowledge: { kind, origin, measure_key: first.measure_key, measure_name: measureName, conditions: [], exclusions: [], transfer_notes: [],
        evidence_level: origin === 'official_policy' ? 'official_policy' : fields.find(field => field.key === 'implementation')?.value ? 'implementation_record' : fields.find(field => field.key === 'proposal')?.value ? 'proposal_only' : 'not_reported',
        chunks: all, factors } }
  })
}
