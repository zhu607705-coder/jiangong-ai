import { createHash } from 'node:crypto'
import type { ActionChunk, ExperienceEvidence, MeasureCalculation, MeasureFactor } from '../../apps/host/generated/contracts'
import { ExperienceError } from './errors'

const numberSource = '(?:\\d+(?:,\\d{3})*(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千][零〇一二两三四五六七八九十百千万]*)'
const currencySource = '(?:亿元|万元|万人民币|人民币元|元)'
const numberValue = (raw: string): string | number => /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw
const uniqueEvidence = (evidence: ExperienceEvidence[]) => [...new Map(evidence.map(value => [JSON.stringify(value), value])).values()]
const suffix = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 10)
const planning = (text: string) => /拟|计划|将|预计|估算|测算|建议|提议|假设|有望|准备|尚未|未实施|未加装|未安装|未建设|暂缓|取消/.test(text)
const estimate = (text: string) => /约|大约|预计|估算|测算|近\d|超过|不少于|至少|余|多[户人台栋幢]|范围/.test(text)

function observedTime(text: string): string | null {
  // Publication/ingestion is not a quantity's observation time. Precision is
  // retained (a year never becomes an invented January 1).
  const withoutPublication = text.replace(/(?:发布时间|发布日期|发布于|报道日期|新闻日期|发文日期)\s*[:：=]?\s*\d{4}(?:[-年/]\d{1,2})?(?:[-月/]\d{1,2}日?)?/g, '')
  const values = [...withoutPublication.matchAll(/\d{4}(?:年(?:\d{1,2}月(?:\d{1,2}日)?)?|[-/]\d{1,2}(?:[-/]\d{1,2})?)/g)].map(match => match[0])
  const years = [...withoutPublication.matchAll(/(?:截至|统计时点|统计时间|时点|年度|时间|日期)\s*[:：=]?\s*(\d{4})(?!\d)/g)].map(match => match[1])
  const all = [...new Set([...values, ...years.filter(year => !values.some(value => value.startsWith(year)))])]
  return all.length === 1 ? all[0] : null
}

function ownStage(text: string): string {
  return text.match(/(?:项目阶段|阶段)\s*[:：=]\s*([^|。；;，,\n]{1,100})/)?.[1]?.trim()
    || text.match(/尚未实施|尚未建设|未实施|未加装|未安装|尚未|暂缓|取消|不实施|拟实施|计划|拟|将|已完成|已建成|已加装|已安装|已实施|已验收|施工中|正在施工|已支付/)?.[0] || ''
}

function amountKind(text: string): MeasureFactor['amount_kind'] {
  if (/(?:工程包|项目|整体|全小区|综合整治).*(?:总额|总投资|总预算|总资金)|工程包总额|项目总投资|总投资|各项.*合计/.test(text)) return 'package_total'
  if (/未支付|尚未支付|未付款|未落实|尚未落实|待支付|应付/.test(text)) return 'unknown'
  if (/运维|维护费|维保|养护费|维护预算|用于维护/.test(text)) return 'maintenance'
  if (/已支付|实际支付|实付|已付款|付款金额|支付金额/.test(text) && !planning(text)) return 'paid'
  if (/已落实|资金到位|已筹措|出资承诺|承诺出资|落实资金/.test(text) && !/未|尚未/.test(text)) return 'committed'
  if (/合同(?:金额|价|款)?|成交(?:金额|价)?|中标(?:金额|价)?/.test(text)) return 'contract'
  if (/预算|概算|估算|拟投资|计划投资/.test(text)) return 'budget'
  return 'unknown'
}

const billingDenominators = ['平方米', '平米', 'm²', 'm2', '㎡', '单元', '台', '人', '户', '栋', '幢', '次', '项', '套', '季度', '年', '月', '周', '日', '天', '小时']
const billingTokens = billingDenominators.join('|')
const totalCurrency = new RegExp(`^${currencySource}$`)

/** Only explicit billing words are normalized. No annualization, multiplication
 * by equipment counts, or guessed rate denominator is performed. */
function billingUnit(base: string, before: string, after: string): { unit: string; basisUnknown: boolean } {
  const denominators = new Set<string>()
  // Suffix words must immediately qualify this price; later fee labels can
  // refer to a second amount and must not be pulled backwards onto this one.
  const cleanBefore = before.replace(/[（()）]/g, ''), cleanAfter = after.replace(/[（()）]/g, '')
  const paymentCadence = /^\s*(?:每|按)(?:年|月|季度|周|日|天)\s*(?:支付|付款|结算|拨付)/.test(cleanAfter)
  const suffix = paymentCadence ? '' : cleanAfter.match(new RegExp(`^\\s*(?:(?:[\\/／]\\s*(?:${billingTokens})(?:\\s*[\\/／·]\\s*(?:${billingTokens}))*|(?:每|按)\\s*(?:${billingTokens}))\\s*)+`, 'u'))?.[0] || ''
  const product = cleanAfter.match(new RegExp(`^\\s*(·\\s*(?:${billingTokens})(?:\\s*·\\s*(?:${billingTokens}))*)`, 'u'))?.[1]
    || cleanBefore.match(new RegExp(`${currencySource}\\s*(·\\s*(?:${billingTokens})(?:\\s*·\\s*(?:${billingTokens}))*)`, 'u'))?.[1]
  if (product) return { unit: base + product.replace(/\s/g, ''), basisUnknown: true }
  const basis = `${cleanBefore} ${suffix}`
  for (const token of billingDenominators) {
    if (new RegExp(`(?:每|按)\\s*${token}`).test(basis)) denominators.add(token)
  }
  if (/年度|年费/.test(before)) denominators.add('年')
  if (/月度|月费/.test(before)) denominators.add('月')
  if (/季度|季费/.test(before)) denominators.add('季度')
  if (/周费/.test(before)) denominators.add('周')
  if (/日费/.test(before)) denominators.add('日')
  // Symbolic denominators require an initial division sign after the currency.
  // A dot alone is multiplication and must never be read as a per-unit rate.
  const symbolic = [...cleanBefore.matchAll(new RegExp(`${currencySource}([\\/／]\\s*(?:${billingTokens})(?:\\s*[\\/／·]\\s*(?:${billingTokens}))*)`, 'gu'))].map(match => match[1])
  if (/^\s*[\/／]/.test(suffix)) symbolic.push(suffix)
  for (const expression of symbolic) for (const match of expression.matchAll(new RegExp(`[\\/／·]\\s*(${billingTokens})`, 'gu'))) denominators.add(match[1])
  const ordered = billingDenominators.filter(token => denominators.has(token))
  return { unit: [base, ...ordered].join('/'), basisUnknown: !ordered.length && (/单价|单位成本|单位费用|每/.test(before) || paymentCadence && !/总额|总价|总投资|总预算/.test(before)) }
}

function moneyBounds(cell: string, start: number, end: number, previousEnd = 0, nextStart = cell.length): { before: string; after: string; kindText: string } {
  const delimiterBefore = Math.max(cell.lastIndexOf('，', start - 1), cell.lastIndexOf(',', start - 1), cell.lastIndexOf('、', start - 1), cell.lastIndexOf(';', start - 1), cell.lastIndexOf('；', start - 1)) + 1
  const before = cell.slice(Math.max(delimiterBefore, previousEnd), start)
  const remaining = cell.slice(end), delimiterAfter = remaining.search(/[，,、；;]/)
  const stop = delimiterAfter < 0 ? cell.length : end + delimiterAfter
  const after = cell.slice(end, stop)
  // Right-side descriptions are usable only when another amount does not
  // share this clause. This keeps e.g. "每月10万元合同总额100万元" ambiguous.
  return { before, after, kindText: `${before}${nextStart < stop ? '' : after}` }
}

const labels: Record<string, string> = {
  building_area: '建筑面积', site_area: '用地面积', renovated_area: '改造面积', floor_area: '楼面面积', common_area: '公共空间面积', area: '面积（类型未明）',
  household_count: '住户数', resident_count: '居民人数', beneficiary_count: '受益人数', elevator_count: '电梯台数', building_count: '楼幢数', unit_count: '单元数',
  building_identifier: '楼幢编号', unit_identifier: '单元编号', action_status: '举措原文状态', location_description: '区位描述', public_service_description: '服务描述',
}

function areaKey(text: string): string {
  if (/建筑面积|总建筑面积/.test(text)) return 'building_area'
  if (/用地面积|占地面积/.test(text)) return 'site_area'
  if (/改造面积|整治面积|施工面积/.test(text)) return 'renovated_area'
  if (/楼面面积|楼层面积/.test(text)) return 'floor_area'
  if (/公共空间面积|公共区域面积/.test(text)) return 'common_area'
  return 'area'
}

/** Measures and their linked contexts are scanned independently. A context
 * factor keeps its source scope and shared/unresolved association; it is never
 * silently divided between the actions that refer to it. */
export function extractMeasureFactors(chunk: ActionChunk, contextChunks: ActionChunk[] = []): MeasureFactor[] {
  const contexts = contextChunks.filter(context => context.kind === 'context' && chunk.context_chunk_ids.includes(context.id)
    && context.document_id === chunk.document_id && context.document_version === chunk.document_version
    && (!chunk.object_ref || !context.object_ref || context.object_ref === chunk.object_ref
      || chunk.object_ref.startsWith('building:') && context.object_ref.startsWith('object:') && chunk.spans.some(span => span.quote.includes(context.object_ref!.slice('object:'.length)))))
  const contextEvidence = new Set(contexts.flatMap(context => context.spans).map(span => JSON.stringify(span)))
  const sources = [{ chunk, shared: chunk.kind === 'context', spans: chunk.spans.filter(span => !contextEvidence.has(JSON.stringify(span))) },
    ...contexts.map(context => ({ chunk: context, shared: true, spans: context.spans }))]
  const factors: MeasureFactor[] = []
  for (const source of sources) {
    const allTime = observedTime(source.spans.map(span => span.quote).join('\n'))
    const timeSpan = allTime ? source.spans.find(span => span.quote.includes(allTime)) : undefined
    for (const span of source.spans) {
      const text = span.quote, stage = ownStage(text) || source.chunk.stage
      const localTime = observedTime(text), observedAt = localTime || allTime
      const evidence = uniqueEvidence([span, ...(!localTime && timeSpan ? [timeSpan] : [])])
      const contextualAmbiguity = source.shared && /电梯|坡道|扶手|消防|管网|养老|托育/.test(text)
      const association: MeasureFactor['association'] = source.shared ? contextualAmbiguity && !/总投资|工程包|整体|合计|项目总|全小区/.test(text) ? 'unresolved' : 'shared' : 'direct'
      const add = (key: string, value: MeasureFactor['value'], unit: string | null, amount: MeasureFactor['amount_kind'] = 'not_applicable', label = labels[key] || key, raw = text, associated = association) => {
        const epistemic: MeasureFactor['epistemic_status'] = value === null ? 'missing' : planning(raw) || planning(stage) ? 'scenario_assumption' : estimate(raw) ? 'estimate' : 'fact'
        factors.push({ key, label, value, unit, object_ref: source.chunk.object_ref, stage, observed_at: observedAt, association: amount === 'package_total' ? 'shared' : associated,
          amount_kind: amount, epistemic_status: epistemic, evidence })
      }
      const cells = text.includes(' | ') ? text.split(' | ') : [text]
      for (const cell of cells) {
        const beforeNumber = (index: number) => cell.slice(Math.max(0, cell.lastIndexOf('，', index) + 1, cell.lastIndexOf(',', index) + 1, cell.lastIndexOf('、', index) + 1), index)
        for (const match of cell.matchAll(new RegExp(`(${numberSource})\\s*(万平方米|万平米|平方米|平米|m²|m2|㎡|公顷)`, 'gi'))) {
          const key = areaKey(beforeNumber(match.index!))
          add(key, numberValue(match[1]), match[2], 'not_applicable', labels[key], cell)
        }
        // Table units belong to their headers. Cite the original full cell/row,
        // including the header rather than inventing a suffix beside the value.
        const areaCell = cell.match(new RegExp(`(?:([^=]{1,80}面积[^=]*)[=：:]\\s*(${numberSource}))`))
        if (areaCell && !new RegExp(`${numberSource}\\s*(万平方米|万平米|平方米|平米|m²|m2|㎡|公顷)`, 'i').test(cell)) {
          const unit = areaCell[1].match(/万平方米|万平米|平方米|平米|m²|m2|㎡|公顷/i)?.[0] || null
          const key = areaKey(areaCell[1]); add(key, numberValue(areaCell[2]), unit, 'not_applicable', labels[key], cell)
        }
        const moneyMatches = [...cell.matchAll(new RegExp(`(${numberSource})\\s*(${currencySource})`, 'gu'))]
        for (const [index, match] of moneyMatches.entries()) {
          const previous = moneyMatches[index - 1], next = moneyMatches[index + 1]
          const bounds = moneyBounds(cell, match.index!, match.index! + match[0].length, previous ? previous.index! + previous[0].length : 0, next?.index ?? cell.length)
          const billing = billingUnit(match[2], bounds.before, bounds.after), amount = amountKind(bounds.kindText)
          add(`amount_${amount}`, numberValue(match[1]), billing.unit, amount, billing.basisUnknown ? '单价（计价单位待核）' : amount === 'package_total' ? '工程包总额' : amount === 'unknown' ? '金额（费用状态待核）' : `金额（${amount}）`, cell, billing.basisUnknown ? 'unresolved' : association)
        }
        const moneyCell = cell.match(new RegExp(`([^=]{0,80}(?:预算|合同|成交|中标|投资|总额|金额|运维费|维护费|维保费|资金|费用|单价|单位成本|月费|年费|价款)[^=]*)[=：:]\\s*(${numberSource})`))
        if (moneyCell && !moneyMatches.length) {
          const amount = amountKind(moneyCell[1]), base = moneyCell[1].match(new RegExp(currencySource))?.[0] || null
          const billing = base ? billingUnit(base, moneyCell[1], '') : null
          add(`amount_${amount}`, numberValue(moneyCell[2]), billing?.unit || null, amount, billing?.basisUnknown ? '单价（计价单位待核）' : amount === 'package_total' ? '工程包总额' : `金额（${amount}）`, cell, billing?.basisUnknown ? 'unresolved' : association)
        }
        const missingAmount = cell.match(/(?:预算|合同价|实付|支付金额|维护费|运维费|已落实资金)[^，,、|]{0,20}(?:未披露|未记载|未知|缺失|未明确|待核)/)
        if (missingAmount) {
          const amount = amountKind(missingAmount[0]); add(`amount_${amount}`, null, null, amount, '金额未记载', cell)
        }
        for (const match of cell.matchAll(new RegExp(`(${numberSource})\\s*(户|人|台|栋|幢|单元)`, 'g'))) {
          const prefix = beforeNumber(match.index!), after = cell.slice(match.index! + match[0].length)
          if (match[2] === '户' && /^型/.test(after) || match[2] === '人' && /^行(?:道|通道)/.test(after)) continue
          if (match[2] === '户') add('household_count', numberValue(match[1]), '户', 'not_applicable', labels.household_count, cell)
          else if (match[2] === '人') {
            const key = /受益|惠及|服务(?:人数|对象|居民)|覆盖人数/.test(prefix) ? 'beneficiary_count' : 'resident_count'
            // A bare numbered unit must never become a person count.
            add(key, numberValue(match[1]), '人', 'not_applicable', labels[key], cell)
          } else if (match[2] === '台' && /电梯|加梯/.test(cell)) add('elevator_count', numberValue(match[1]), '台', 'not_applicable', labels.elevator_count, cell)
          else if (match[2] === '栋' || match[2] === '幢') {
            const identifier = /^\s*(?:\d+|[一二三四五六七八九十]+)(?:号)?单元/.test(after) || /(?:楼栋|楼幢|建筑|对象)\s*[:：=]\s*$/.test(prefix)
              || !/(?:共|涉及|覆盖|整治|包含|楼幢数|楼栋数|住宅楼数|数量)\s*[:：=]?\s*$/.test(prefix) && !/^(?:住宅|居民楼|楼栋|建筑)/.test(after)
            add(identifier ? 'building_identifier' : 'building_count', identifier ? match[0].replace(/\s+/g, '') : numberValue(match[1]), identifier ? null : match[2], 'not_applicable', labels[identifier ? 'building_identifier' : 'building_count'], cell)
          } else if (match[2] === '单元') {
            const identifier = /(?:幢|栋|号楼)\s*$/.test(prefix) || !/(?:共|涉及|覆盖|包含|单元数|数量)\s*[:：=]?\s*$/.test(prefix)
            add(identifier ? 'unit_identifier' : 'unit_count', identifier ? match[0].replace(/\s+/g, '') : numberValue(match[1]), identifier ? null : '单元', 'not_applicable', labels[identifier ? 'unit_identifier' : 'unit_count'], cell)
          }
        }
        const countCell = cell.match(new RegExp(`([^=]{0,80}(?:户数|住户数|居民人数|人口数|人数|电梯数量|电梯台数|楼栋数|楼幢数|单元数)[^=]*)[=：:]\\s*(${numberSource})`))
        if (countCell && !new RegExp(`${numberSource}\\s*(户|人|台|栋|幢|单元)`).test(cell)) {
          const header = countCell[1], key = /受益|惠及|服务/.test(header) ? 'beneficiary_count' : /户数|住户/.test(header) ? 'household_count' : /电梯/.test(header) ? 'elevator_count' : /楼栋|楼幢/.test(header) ? 'building_count' : /单元数/.test(header) ? 'unit_count' : 'resident_count'
          const unit = header.match(/[（(](户|人|台|栋|幢|单元)[）)]/)?.[1] || null
          add(key, numberValue(countCell[2]), unit, 'not_applicable', labels[key], cell)
        }
        const identifierCell = cell.match(/(?:楼栋|楼幢|建筑编号|单元编号|单元)\s*[:：=]\s*([^|。；;，,\n]+)/)
        if (identifierCell && !/(?:栋|幢|单元)/.test(identifierCell[1])) add(/单元/.test(identifierCell[0]) ? 'unit_identifier' : 'building_identifier', identifierCell[1].trim(), null)
      }
      if (/尚未|未实施|未加装|未安装|未建设|暂缓|取消|不实施|未支付|尚未支付|未落实/.test(text)) add('action_status', text, null)
      if (/位于|毗邻|邻近|周边|步行|距(?:离)?|区位|地铁|公交/.test(text)) add('location_description', text, null)
      if (/公共服务|养老|托育|社区食堂|社区卫生|便民服务|服务内容|服务对象|开放时间|儿童活动/.test(text)) add('public_service_description', text, null)
    }
  }
  const result = distinctFactors(factors)
  if (result.length > 100) throw new ExperienceError(422, 'MEASURE_FACTOR_LIMIT', '单项举措超过100条因素，未截断；请分批整理材料。')
  return result
}

function distinctFactors(factors: MeasureFactor[]): MeasureFactor[] {
  const unique = new Map<string, MeasureFactor>()
  for (const factor of factors) {
    const identity = JSON.stringify({ ...factor, evidence: [], derivation: factor.derivation })
    const previous = unique.get(identity)
    if (previous) {
      previous.evidence = uniqueEvidence([...previous.evidence, ...factor.evidence])
      if (previous.evidence.length > 30) throw new ExperienceError(422, 'MEASURE_FACTOR_EVIDENCE_LIMIT', '因素引用超过30条，未截断；请分批整理材料。')
    } else unique.set(identity, structuredClone(factor))
  }
  const result = [...unique.values()], keys = new Set<string>()
  for (const factor of result) {
    if (keys.has(factor.key)) factor.key = `${factor.key}.${suffix([factor.value, factor.unit, factor.object_ref, factor.stage, factor.observed_at, factor.amount_kind, factor.association, factor.evidence])}`
    keys.add(factor.key)
  }
  return result
}

const numeric = (factor: MeasureFactor) => typeof factor.value === 'number' && Number.isFinite(factor.value)
const baseKey = (key: string) => key.split('.')[0]

/** Conservative arithmetic over source factors. Shared/project totals and
 * unknown scopes/times/states cannot be promoted into a measure's unit cost. */
export function deriveMeasureFactors(factors: MeasureFactor[]): MeasureFactor[] {
  const result = distinctFactors(factors), existing = new Set(result.filter(factor => factor.derivation).map(factor => JSON.stringify(factor.derivation)))
  const amounts = result.filter(factor => numeric(factor) && factor.association === 'direct' && baseKey(factor.key).startsWith('amount_')
    && ['budget', 'contract', 'paid', 'committed', 'maintenance'].includes(factor.amount_kind) && factor.epistemic_status === 'fact'
    && !!factor.object_ref && !!factor.stage && !!factor.observed_at && !!factor.unit && totalCurrency.test(factor.unit) && Number(factor.value) >= 0)
  const denominators = result.filter(factor => numeric(factor) && Number(factor.value) > 0 && factor.association === 'direct'
    && factor.amount_kind === 'not_applicable' && factor.epistemic_status === 'fact' && !!factor.unit)
  for (const numerator of amounts) for (const denominator of denominators) {
    if (numerator.object_ref !== denominator.object_ref || numerator.stage !== denominator.stage || numerator.observed_at !== denominator.observed_at) continue
    // Scope/time strings alone do not prove two independently reported rows
    // share a measure or fee status. Require a common original source span.
    const common = numerator.evidence.some(left => denominator.evidence.some(right => left.document_id === right.document_id && left.version === right.version && left.locator === right.locator && left.quote === right.quote
      && left.quote.includes(String(numerator.value)) && left.quote.includes(String(denominator.value)) && left.quote.includes(numerator.unit!) && left.quote.includes(denominator.unit!)))
    if (!common) continue
    const key = baseKey(denominator.key)
    const formula = ['elevator_count', 'household_count', 'building_count', 'unit_count'].includes(key) ? 'cost_per_unit' : ['building_area', 'site_area', 'renovated_area', 'floor_area', 'common_area'].includes(key) ? 'cost_per_area'
      : ['resident_count', 'beneficiary_count'].includes(key) ? 'cost_per_person' : null
    if (!formula) continue
    const derivation: MeasureCalculation = { formula, numerator_key: numerator.key, denominator_key: denominator.key }, identity = JSON.stringify(derivation)
    if (existing.has(identity)) continue
    const evidence = uniqueEvidence([...numerator.evidence, ...denominator.evidence])
    if (evidence.length > 30) throw new ExperienceError(422, 'MEASURE_FACTOR_EVIDENCE_LIMIT', '派生因素引用超过30条，未截断。')
    const ratio = Number(numerator.value) / Number(denominator.value)
    if (!Number.isFinite(ratio)) continue
    result.push({ key: `${formula}_${numerator.amount_kind}.${suffix(derivation)}`, label: formula === 'cost_per_unit' ? '单位台数费用' : formula === 'cost_per_area' ? '单位面积费用' : '单位人数费用',
      value: ratio, unit: `${numerator.unit}/${denominator.unit}`, object_ref: numerator.object_ref, stage: numerator.stage, observed_at: numerator.observed_at,
      association: 'derived', amount_kind: numerator.amount_kind, epistemic_status: 'fact', evidence, derivation })
    existing.add(identity)
  }
  if (result.length > 100) throw new ExperienceError(422, 'MEASURE_FACTOR_LIMIT', '因素及派生结果超过100条，未截断；请分批整理材料。')
  return result
}
