import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod'
import type { Database } from '../../apps/host/store'
import { hash } from '../corpus/corpus'
import { canonical, safeUrl } from '../intelligence/domain'
import { benchmarkCosts, costBenchmarkEligibility, type CostBenchmark, type CostEligibility } from './benchmark'

export const AMOUNT_KINDS = ['estimate', 'budget', 'tender_ceiling', 'candidate_bid', 'winning_bid', 'contract_price', 'settlement'] as const
export const WORK_TYPES = ['construction', 'epc', 'design', 'supervision', 'other'] as const
export type AmountKind = typeof AMOUNT_KINDS[number]
export type WorkType = typeof WORK_TYPES[number]
const identifier = z.string().min(1).max(160)
const nullableText = z.string().min(1).max(2000).nullable()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})
const sourceSchema = z.object({
  id: identifier, title: z.string().min(1).max(1000), url: z.string().url(), province: z.string().min(1).max(20),
  published_at: z.string().nullable(), raw_path: z.string().min(1), text_path: z.string().min(1),
  raw_sha256: z.string().regex(/^[a-f0-9]{64}$/), text_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).passthrough()
const recordSchema = z.object({
  id: identifier, source_id: identifier, project_name: z.string().min(1).max(1000),
  project_code: nullableText, lot_id: nullableText, province: z.string().min(1).max(20), city: nullableText,
  work_type: z.enum(WORK_TYPES), amount_kind: z.enum(AMOUNT_KINDS), amount_basis: z.string().max(200).optional(),
  scope_level: z.string().max(100).optional(), comparability_note: z.string().max(2000).optional(),
  scope_family: z.string().max(100).optional(), scale_basis: z.string().max(100).optional(),
  scale_source_id: identifier.optional(), scope_source_id: identifier.optional(), supporting_source_ids: z.array(identifier).max(20).optional(),
  award_date: date.nullable().optional(), price_date: date.nullable().optional(), price_date_quote: nullableText.optional(), price_date_source_id: identifier.optional(), price_date_basis: z.string().max(100).optional(),
  reported_scale_value: z.number().finite().positive().nullable().optional(), reported_scale_unit: nullableText.optional(), reported_scale_label: nullableText.optional(),
  amount_yuan: z.number().finite().positive().max(1e13), amount_original: z.string().min(1).max(1000),
  amount_quote: z.string().min(1).max(10000), scope_quote: nullableText,
  scale_value: z.number().finite().positive().nullable(), scale_unit: nullableText, scale_quote: nullableText,
  notice_date: date.nullable(), contract_date: date.nullable(),
})
const platformSchema = z.object({ name: z.string().min(1), url: z.string().url(), status: z.string(), note: z.string() })
export type CostSource = z.infer<typeof sourceSchema>
export type CostRecord = z.infer<typeof recordSchema>
export type CostPlatform = z.infer<typeof platformSchema>
export type CostManifest = { sources: CostSource[]; records: CostRecord[]; platforms: CostPlatform[] }
export type CostSourceReference = { id: string; title: string; url: string; source_hash: string; text_hash: string; published_at: string | null; version: string }
export type CostItem = CostRecord & { source: Omit<CostSourceReference, 'id' | 'version'>; version: string; evidence_sources?: CostSourceReference[]; field_issues?: CostIssue[]; benchmark?: CostEligibility }
export type CostQuery = { q?: string; province?: string; amount_kind?: AmountKind; work_type?: WorkType; scale_basis?: string; year?: number }
export type CostIssue = { id: string; code: string; detail: string }
export type CostLibraryResult = {
  items: CostItem[]; platforms: CostPlatform[]; benchmark: CostBenchmark;
  summary: { total: number; matched: number; source_count: number; provinces: string[]; by_amount_kind: Partial<Record<AmountKind, number>>; by_work_type: Partial<Record<WorkType, number>>; issues: CostIssue[]; sample_notice: string }
}
export const COST_MANIFEST_PATH = 'data/public_cases/renewal-cost-library-20261013.json'
const sourceDirectory = 'data/public_cases/renewal-cost-sources'
const officialDomains = ['ggzy.zj.gov.cn', 'gdzwfw.gov.cn', 'shggzy.com', 'zfcg.sh.gov.cn', 'ccgp-shanghai.gov.cn', 'xsjypt.fgj.sh.gov.cn', 'ywtb.gzggzy.cn', 'dzjy.lssggzy.lishui.gov.cn']
const normalize = (value: string) => value.normalize('NFKC').replace(/[\s,，]/g, '')
export class CostLibraryError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
function assert(condition: unknown, code: string, detail: string): asserts condition {
  if (!condition) throw new CostLibraryError(code, detail)
}
function inDirectory(directory: string, file: string) {
  const rel = relative(directory, file)
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
}
async function sourceBytes(root: string, path: string) {
  const directory = resolve(root, sourceDirectory), target = resolve(root, path)
  assert(inDirectory(directory, target), 'SOURCE_PATH_OUTSIDE', '原件路径必须位于公开造价来源目录内。')
  const [actualDirectory, actualTarget] = await Promise.all([realpath(directory), realpath(target)])
  assert(inDirectory(actualDirectory, actualTarget), 'SOURCE_PATH_OUTSIDE', '原件链接指向了公开造价来源目录之外。')
  return readFile(actualTarget)
}
const kindCue: Record<AmountKind, RegExp> = {
  estimate: /估算|总投资/, budget: /预算/, tender_ceiling: /最高(?:投标)?限价|控制价|招标限价/,
  candidate_bid: /预中标|候选|投标报价/, winning_bid: /中标|成交/, contract_price: /合同|签约/, settlement: /结算|审定价/,
}
/** Check the supplied excerpt, not a second crawler or general document parser. */
function amountsInQuote(quote: string): number[] {
  const cleaned = normalize(quote), values: { index: number; value: number }[] = []
  for (const match of cleaned.matchAll(/(\d+(?:\.\d+)?)\s*(亿元|万元|元)/g)) {
    values.push({ index: match.index!, value: Number(match[1]) * (match[2] === '亿元' ? 1e8 : match[2] === '万元' ? 1e4 : 1) })
  }
  for (const match of cleaned.matchAll(/(?:金额|价款|价格|造价|总价|估算|投资|预算|限价)[^\d\n]{0,16}?[（(]?(亿元|万元|元)[）)]?[:：]?([\d]+(?:\.\d+)?)/g)) {
    values.push({ index: match.index!, value: Number(match[2]) * (match[1] === '亿元' ? 1e8 : match[1] === '万元' ? 1e4 : 1) })
  }
  return values.sort((a, b) => a.index - b.index).map(item => item.value)
}
function identityValues(text: string, labels: string) {
  const pattern = new RegExp(`(?:^|\\s)(?:${labels})\\s*[:：]\\s*([^\\n]+?)` + '(?=\\n|\\s+[\\p{Script=Han}（）()、]{2,30}\\s*[:：]|$)', 'gu')
  return [...text.matchAll(pattern)].map(match => ({ value: normalize(match[1]), index: match.index! }))
}
function containsIdentifier(text: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9-])${escaped}(?=$|[^A-Za-z0-9-])`).test(text)
}
function lotInText(record: CostRecord, text: string): boolean {
  if (!record.lot_id) return false
  if (containsIdentifier(text, record.lot_id)) return true
  // Shanghai exposes project code and the local lot token in distinct fields.
  if (!record.project_code || !record.lot_id.startsWith(record.project_code + '-')) return false
  const localLot = record.lot_id.slice(record.project_code.length + 1)
  return containsIdentifier(text, record.project_code) && identityValues(text, '标段号|标段编号').some(item => item.value === normalize(localLot))
}
function assertLinkedIdentity(record: CostRecord, main: BoundSource, support: BoundSource) {
  assert(main.source.province === support.source.province && record.province === support.source.province, 'SUPPORT_IDENTITY_MISMATCH', '支撑原件与金额原件的省份不一致。')
  assert(!support.source.city || support.source.city === record.city, 'SUPPORT_IDENTITY_MISMATCH', '支撑原件与金额记录的城市不一致。')
  const fullLot = !!record.lot_id && /^(?:A\d{18,}|JG\d{4}-\d{3,})$/i.test(record.lot_id)
  const explicitCodes = (text: string) => [...text.matchAll(/(?:项目代码|报建编号|工程项目编码)\s*[:：]\s*([A-Za-z0-9-]+)/g)].map(match => match[1])
  const codeAndLot = !!record.project_code && !!record.lot_id && explicitCodes(main.text).includes(record.project_code) && explicitCodes(support.text).includes(record.project_code)
  assert((fullLot || codeAndLot) && lotInText(record, main.text) && lotInText(record, support.text), 'SUPPORT_IDENTITY_MISMATCH', '跨公告联结需要同一完整交易标段编号，或同一项目代码与标段号；名称相近不足以联结。')
  assert(normalize(main.text).includes(normalize(record.project_name)) && normalize(support.text).includes(normalize(record.project_name)), 'SUPPORT_IDENTITY_MISMATCH', '支撑原件的工程名称与金额原件不一致。')
}
function assertQuoteObject(record: CostRecord, text: string, quote: string | null | undefined) {
  if (!quote) return
  const at = text.indexOf(quote)
  if (at < 0) return // The field-specific check supplies the precise missing-quote error.
  for (const [labels, expected] of [['项目名称|工程名称|采购项目名称|招标标段名称', normalize(record.project_name)], ['项目代码|报建编号', record.project_code ? normalize(record.project_code) : null], ['标段号|标段编号|标段[（(]包[）)]编号', record.lot_id ? normalize(record.lot_id) : null]] as const) {
    const keys = identityValues(text, labels)
    if (new Set(keys.map(key => key.value)).size < 2) continue
    const preceding = keys.filter(key => key.index <= at).at(-1)
    if (!preceding) continue
    const localLot = record.project_code && record.lot_id?.startsWith(record.project_code + '-') ? record.lot_id.slice(record.project_code.length + 1) : null
    assert(expected && (preceding.value === expected || labels.startsWith('标段') && preceding.value === localLot), 'SUPPORT_QUOTE_IDENTITY_MISMATCH', '支撑引文位于另一项目或标段字段之下。')
    const next = keys.find(key => key.index > preceding.index)
    assert(!next || at + quote.length <= next.index, 'SUPPORT_QUOTE_IDENTITY_MISMATCH', '支撑引文跨越项目或标段边界。')
  }
}
function validateRecord(record: CostRecord, source: CostSource, text: string): string {
  assert(record.province === source.province, 'PROVINCE_MISMATCH', '记录省份与来源省份不一致。')
  assert(text.includes(record.amount_quote), 'AMOUNT_QUOTE_MISMATCH', '金额摘录未逐字出现在来源正文中。')
  assert(normalize(record.amount_quote).includes(normalize(record.amount_original)), 'AMOUNT_ORIGINAL_MISMATCH', '原始金额未出现在金额摘录中。')
  assert(kindCue[record.amount_kind].test(record.amount_quote), 'AMOUNT_KIND_MISMATCH', '金额摘录未说明所选价格类型。')
  assert(record.amount_kind !== 'winning_bid' || !/预中标|中标候选/.test(record.amount_quote), 'AMOUNT_KIND_MISMATCH', '候选报价应单独记录，不能登记为正式中标价。')
  const values = amountsInQuote(record.amount_quote)
  assert(values.length > 0 && Math.abs(values[0] - record.amount_yuan) < 0.011, 'AMOUNT_UNIT_MISMATCH', '价格摘录的首个明确金额及单位与人民币元数值不一致；暂列金等附属金额需单独记录。')
  // The project must bind to the article or a project-name field, never just navigation text.
  const names = identityValues(text, '项目名称|工程名称|采购项目名称')
  const name = normalize(record.project_name)
  assert(normalize(text).includes(name), 'PROJECT_MISMATCH', '项目名称未出现在归档正文中。')
  assert(normalize(source.title).includes(name) || names.some(item => item.value === name), 'PROJECT_MISMATCH', '项目名称与公告标题或项目字段不一致。')
  let scope = text
  if (new Set(names.map(item => item.value)).size > 1) {
    const amountAt = text.indexOf(record.amount_quote)
    const preceding = names.filter(item => item.index <= amountAt).at(-1)
    // Tender PDFs may introduce blank project-name forms after the substantive contract clauses.
    if (!preceding) scope = text.slice(0, names[0].index)
    else {
      assert(preceding.value === name, 'PROJECT_AMOUNT_MISMATCH', '金额摘录属于其他项目。')
      const next = names.find(item => item.index > preceding.index)
      scope = text.slice(preceding.index, next?.index)
    }
    assert(scope.includes(record.amount_quote), 'PROJECT_AMOUNT_MISMATCH', '金额摘录跨越项目边界。')
  }
  const lots = identityValues(scope, '标段编号|标段号|标段[（(]包[）)]编号|包号|包件号|分包编号')
  if (new Set(lots.map(item => item.value)).size > 1) {
    const amountAt = scope.indexOf(record.amount_quote), preceding = lots.filter(item => item.index <= amountAt).at(-1)
    assert(record.lot_id && preceding?.value === normalize(record.lot_id), 'LOT_AMOUNT_MISMATCH', '多标段公告须将金额绑定到明确标段。')
    scope = scope.slice(preceding!.index, lots.find(item => item.index > preceding!.index)?.index)
    assert(scope.includes(record.amount_quote), 'LOT_AMOUNT_MISMATCH', '金额摘录跨越标段边界。')
  }
  assert(!record.project_code || containsIdentifier(scope, record.project_code), 'IDENTITY_MISMATCH', 'project_code 未出现在对应项目或标段正文中。')
  assert(!record.lot_id || lotInText(record, scope), 'IDENTITY_MISMATCH', 'lot_id 未出现在对应项目或标段正文中。')
  if (record.work_type !== 'other' && !/EPC|工程总承包|设计.{0,10}施工/i.test(source.title)) {
    if (/监理/.test(source.title)) assert(record.work_type === 'supervision', 'WORK_TYPE_MISMATCH', '监理公告应归入监理费用。')
    else if (/设计(?:服务|项目|工程)?(?:招标|采购|合同|中标)/.test(source.title)) assert(record.work_type === 'design', 'WORK_TYPE_MISMATCH', '设计公告应归入设计费用。')
  }
  return scope
}

type BoundSource = { source: CostSource; version: string; text: string }
type StoredCostRecord = CostRecord & { evidence_sources: CostSourceReference[]; field_issues: CostIssue[] }
const sourceReference = ({ source, version }: BoundSource): CostSourceReference => ({ id: source.id, version, title: source.title, url: source.url, source_hash: source.raw_sha256, text_hash: source.text_sha256, published_at: source.published_at })
function validateScale(record: CostRecord, scope: string) {
  assert(!record.scale_quote || scope.includes(record.scale_quote), 'SCALE_QUOTE_MISMATCH', '面积原文未出现在绑定的面积来源中。')
  // An ambiguous area can retain its source excerpt while its numeric denominator stays unknown.
  if (record.scale_value === null && record.scale_unit === null) return
  assert(record.scale_value !== null && !!record.scale_unit && !!record.scale_quote, 'SCALE_UNVERIFIED', '工程规模需要同时记录数值、单位与逐字来源。')
  const canonicalUnit = (unit: string) => /^(?:sqm|m2|m²|㎡|平方米)$/.test(unit) ? 'm2' : unit === '幢' ? '栋' : unit
  const scales = [...normalize(record.scale_quote!).matchAll(/(\d+(?:\.\d+)?)(万平方米|平方米|公顷|m2|m²|㎡|户|栋|幢)/g)]
  assert(scales.some(match => canonicalUnit(['万平方米', '公顷'].includes(match[2]) ? '平方米' : match[2]) === canonicalUnit(record.scale_unit!) && Math.abs(Number(match[1]) * (['万平方米', '公顷'].includes(match[2]) ? 1e4 : 1) - record.scale_value!) < 0.001), 'SCALE_UNIT_MISMATCH', '工程规模数值或单位与来源摘录不一致。')
  const basisLabels = record.scale_basis === 'building_floor_area' ? '(?:总建筑面积|建筑总面积)' : record.scale_basis === 'renovation_site_area' ? '(?:改造范围(?:占地)?|项目范围)(?:面积)?' : null
  if (basisLabels) {
    const matches = [...normalize(record.scale_quote!).matchAll(new RegExp(basisLabels + '(?:约为|为约|为|约|[:：])?(\\d+(?:\\.\\d+)?)(万平方米|平方米|公顷|m2|m²|㎡)', 'g'))]
    assert(matches.some(match => Math.abs(Number(match[1]) * (['万平方米', '公顷'].includes(match[2]) ? 1e4 : 1) - record.scale_value!) < 0.001), 'SCALE_BASIS_MISMATCH', '所选面积数值必须紧随对应的整体范围或总建筑面积标签；同段的道路、屋面等分项面积另列。')
  }
}
function containsDate(text: string, value: string, labels?: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  return new RegExp(`${labels ? `(?:${labels})\\s*[:：]?\\s*` : ''}${year}\\s*[-/.年]\\s*0?${month}\\s*[-/.月]\\s*0?${day}(?:\\s*日|(?=$|[^0-9]))`).test(text)
}
function attachEvidence(record: CostRecord, main: BoundSource, amountScope: string, sources: Map<string, BoundSource>): StoredCostRecord {
  const output: StoredCostRecord = { ...record, evidence_sources: [], field_issues: [] }
  const attached = new Map<string, BoundSource>()
  const issue = (error: unknown) => output.field_issues.push({ id: record.id, code: error instanceof CostLibraryError ? error.code : 'FIELD_UNVERIFIED', detail: error instanceof CostLibraryError ? error.message : '该字段的原件证据未核验。' })
  const sourceFor = (id: string | undefined): BoundSource => {
    if (!id || id === main.source.id) return { ...main, text: amountScope }
    const source = sources.get(id)
    assert(source, 'SUPPORT_SOURCE_REJECTED', '面积或工程范围支撑原件未通过哈希校验。')
    assertLinkedIdentity(record, main, source)
    attached.set(id, source)
    return source
  }
  for (const id of record.supporting_source_ids || []) { try { sourceFor(id) } catch (error) { issue(error) } }
  try {
    const bound = sourceFor(record.scope_source_id)
    assertQuoteObject(record, bound.text, record.scope_quote)
    assert(!record.scope_quote || bound.text.includes(record.scope_quote), 'SCOPE_QUOTE_MISMATCH', '工程范围摘录未出现在对应的范围来源正文中。')
  } catch (error) { issue(error); output.scope_quote = null; delete output.scope_source_id }
  try { const scope = sourceFor(record.scale_source_id).text; assertQuoteObject(record, scope, record.scale_quote); validateScale(record, scope) }
  catch (error) { issue(error); output.scale_value = null; output.scale_unit = null; output.scale_quote = null; output.scale_basis = 'unknown'; delete output.scale_source_id }
  for (const [field, labels] of [['contract_date', '合同签署时间|合同签订日期|合同签订时间|签约时间|签订时间|签订日期'], ['award_date', '中标日期|中标时间|定标日期']] as const) {
    if (output[field] && !containsDate(amountScope, output[field]!, labels)) {
      issue(new CostLibraryError('PRICE_DATE_UNVERIFIED', `${field === 'contract_date' ? '合同' : '中标'}日期未在金额原件对应日期字段核得。`))
      output[field] = null
    }
  }
  if (record.price_date) {
    try {
      const bound = sourceFor(record.price_date_source_id)
      assert(record.price_date_quote && bound.text.includes(record.price_date_quote) && containsDate(record.price_date_quote, record.price_date), 'PRICE_DATE_UNVERIFIED', '价格日期需要带日期的逐字原文依据。')
      assert(!!record.price_date_basis && !/notice|publication|公告|发布/i.test(record.price_date_basis), 'PRICE_DATE_BASIS_UNVERIFIED', '价格日期须说明价格形成口径，不能直接用公告日期替代。')
    } catch (error) { issue(error); output.price_date = null; output.price_date_quote = null; delete output.price_date_source_id }
  }
  output.evidence_sources = [...attached.values()].map(sourceReference)
  output.supporting_source_ids = [...attached.keys()]
  return output
}

const migration = `
CREATE TABLE IF NOT EXISTS cost_library_sources(id TEXT NOT NULL,version TEXT NOT NULL,payload JSONB NOT NULL,source_text TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(id,version));
CREATE TABLE IF NOT EXISTS cost_library_items(id TEXT NOT NULL,version TEXT NOT NULL,source_id TEXT NOT NULL,source_version TEXT NOT NULL,payload JSONB NOT NULL,current BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(id,version),FOREIGN KEY(source_id,source_version) REFERENCES cost_library_sources(id,version));
CREATE INDEX IF NOT EXISTS cost_library_current ON cost_library_items(current);
`
export class ConstructionCostLibrary {
  private platforms: CostPlatform[] = []
  private issues: CostIssue[] = []
  constructor(readonly db: Database, readonly root = process.cwd()) {}
  async initialize(): Promise<void> {
    await this.db.exec(migration)
    try { await this.importManifest(JSON.parse(await readFile(resolve(this.root, COST_MANIFEST_PATH), 'utf8'))) }
    catch (error) {
      this.issues = [{ id: 'manifest', code: error instanceof CostLibraryError ? error.code : 'MANIFEST_UNAVAILABLE', detail: error instanceof CostLibraryError ? error.message : '公开造价清单未就绪或格式错误，请核对归档文件。' }]
    }
  }
  async importManifest(value: unknown): Promise<{ accepted: number; issues: CostIssue[] }> {
    const manifest = z.object({ sources: z.array(z.unknown()), records: z.array(z.unknown()), platforms: z.array(platformSchema) }).parse(value)
    this.platforms = manifest.platforms.map(platform => ({ ...platform, url: safeUrl(platform.url) }))
    this.issues = []
    const sources = new Map<string, BoundSource>()
    const addIssue = (id: string, error: unknown) => this.issues.push({ id, code: error instanceof CostLibraryError ? error.code : 'INVALID_SOURCE_OR_RECORD', detail: error instanceof CostLibraryError ? error.message : '来源或记录格式无效，或原始文件无法读取。' })
    const sourceIds = manifest.sources.map(value => String((value as { id?: unknown })?.id || 'unknown'))
    for (const [index, value] of manifest.sources.entries()) {
      try {
        const source = sourceSchema.parse(value)
        assert(sourceIds.filter(id => id === source.id).length === 1, 'DUPLICATE_SOURCE', '来源 ID 重复。')
        safeUrl(source.url, officialDomains)
        const [raw, textBytes] = await Promise.all([sourceBytes(this.root, source.raw_path), sourceBytes(this.root, source.text_path)])
        assert(hash(raw) === source.raw_sha256 && hash(textBytes) === source.text_sha256, 'SOURCE_HASH_MISMATCH', '原始文件或正文 SHA-256 与清单不一致。')
        const text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes)
        assert(text.trim(), 'EMPTY_SOURCE', '来源正文为空。')
        // Fetch timestamps/transport receipts do not create a new version of unchanged evidence.
        const version = hash(canonical({ id: source.id, title: source.title, url: source.url, province: source.province, published_at: source.published_at, raw_sha256: source.raw_sha256, text_sha256: source.text_sha256 }))
        sources.set(source.id, { source, text, version })
      } catch (error) { addIssue(sourceIds[index], error) }
    }
    const items: { record: StoredCostRecord; version: string; sourceVersion: string }[] = []
    const recordIds = manifest.records.map(value => String((value as { id?: unknown })?.id || 'unknown'))
    for (const [index, value] of manifest.records.entries()) {
      try {
        const record = recordSchema.parse(value), bound = sources.get(record.source_id)
        assert(recordIds.filter(id => id === record.id).length === 1, 'DUPLICATE_RECORD', '记录 ID 重复。')
        assert(bound, 'SOURCE_REJECTED', '关联来源未通过原件校验。')
        const amountScope = validateRecord(record, bound.source, bound.text)
        const verified = attachEvidence(record, bound, amountScope, sources)
        this.issues.push(...verified.field_issues)
        items.push({ record: verified, sourceVersion: bound.version, version: hash(canonical({ record: verified, source_version: bound.version })) })
      } catch (error) { addIssue(recordIds[index], error) }
    }
    await this.db.transaction(async db => {
      // Immutable versions remain as history; only this validated manifest becomes the active index.
      await db.query('UPDATE cost_library_items SET current=false WHERE current=true')
      for (const { source, version, text } of sources.values()) await db.query('INSERT INTO cost_library_sources(id,version,payload,source_text) VALUES($1,$2,$3,$4) ON CONFLICT(id,version) DO NOTHING', [source.id, version, JSON.stringify(source), text])
      for (const { record, version, sourceVersion } of items) await db.query('INSERT INTO cost_library_items(id,version,source_id,source_version,payload,current) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(id,version) DO UPDATE SET current=true', [record.id, version, record.source_id, sourceVersion, JSON.stringify(record)])
    })
    return { accepted: items.length, issues: [...this.issues] }
  }
  async search(query: CostQuery = {}): Promise<CostLibraryResult> {
    const rows = (await this.db.query<{ payload: StoredCostRecord; version: string; source: CostSource }>('SELECT i.payload,i.version,s.payload AS source FROM cost_library_items i JOIN cost_library_sources s ON s.id=i.source_id AND s.version=i.source_version WHERE i.current=true ORDER BY i.payload->>\'notice_date\' DESC NULLS LAST,i.id')).rows
    const all: CostItem[] = rows.map(({ payload, version, source }) => ({ ...payload, version, source: { title: source.title, url: source.url, source_hash: source.raw_sha256, text_hash: source.text_sha256, published_at: source.published_at } }))
    const words = query.q?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) || []
    for (const item of all) item.benchmark = costBenchmarkEligibility(item)
    const items = all.filter(item => (!query.province || item.province === query.province) && (!query.amount_kind || item.amount_kind === query.amount_kind) && (!query.work_type || item.work_type === query.work_type) && (!query.scale_basis || item.scale_basis === query.scale_basis) && (!query.year || item.benchmark?.price_year === query.year) && words.every(word => `${item.project_name} ${item.project_code || ''} ${item.lot_id || ''} ${item.city || ''} ${item.scope_quote || ''}`.toLocaleLowerCase().includes(word)))
    const by_amount_kind: CostLibraryResult['summary']['by_amount_kind'] = {}, by_work_type: CostLibraryResult['summary']['by_work_type'] = {}
    for (const item of items) { by_amount_kind[item.amount_kind] = (by_amount_kind[item.amount_kind] || 0) + 1; by_work_type[item.work_type] = (by_work_type[item.work_type] || 0) + 1 }
    return { items, platforms: this.platforms, benchmark: benchmarkCosts(items), summary: { total: all.length, matched: items.length, source_count: new Set(all.flatMap(item => [item.source_id, ...(item.evidence_sources || []).map(source => source.id)])).size, provinces: [...new Set(all.map(item => item.province))].sort(), by_amount_kind, by_work_type, issues: [...this.issues], sample_notice: '浙江、上海、广东官方平台已归档样本，按工程范围、价格阶段、面积口径与价格年份分组。金额强度是组内描述性参考；暂未作跨年折现，也未提供预测区间。' } }
  }
}

export function constructionCostsCsv(items: CostItem[]): string {
  const labels: Record<AmountKind, string> = { estimate: '估算', budget: '预算', tender_ceiling: '招标控制价', candidate_bid: '候选报价', winning_bid: '中标价', contract_price: '合同价', settlement: '结算价' }
  const work: Record<WorkType, string> = { construction: '施工', epc: 'EPC工程总承包', design: '设计', supervision: '监理', other: '其他' }
  const escape = (value: unknown) => { let text = value === null || value === undefined ? '' : String(value); if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"' }
  const rows: unknown[][] = [['记录ID', '项目名称', '项目代码', '标段编号', '省份', '城市', '工程类型', '工程类型代码', '金额类型', '金额类型代码', '金额口径', '金额_元', '原始金额', '金额原文', '工程范围原文', '范围层级', '范围类别', '可比性说明', '规模', '规模单位', '分母口径', '规模原文', '金额来源ID', '面积来源ID', '范围来源ID', '公告日期', '合同日期', '中标日期', '价格日期', '价格年份', '同口径参考可用', '金额强度_元每平方米', '未纳入原因', '来源标题', '来源URL', '原件SHA256', '正文SHA256', '支撑来源及SHA256_JSON', '记录版本'], ...items.map(item => {
    const eligible = costBenchmarkEligibility(item)
    return [item.id, item.project_name, item.project_code, item.lot_id, item.province, item.city, work[item.work_type], item.work_type, labels[item.amount_kind], item.amount_kind, item.amount_basis, item.amount_yuan, item.amount_original, item.amount_quote, item.scope_quote, item.scope_level, item.scope_family, item.comparability_note, item.scale_value, item.scale_unit, item.scale_basis, item.scale_quote, item.source_id, item.scale_source_id || item.source_id, item.scope_source_id || item.source_id, item.notice_date, item.contract_date, item.award_date, eligible.price_date, eligible.price_year, eligible.eligible ? '是' : '否', eligible.intensity_yuan_per_m2, eligible.reasons.join('；'), item.source.title, item.source.url, item.source.source_hash, item.source.text_hash, JSON.stringify(item.evidence_sources || []), item.version]
  })]
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n') + '\r\n'
}
