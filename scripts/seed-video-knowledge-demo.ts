/** Seed only the explicitly isolated synthetic video project through the existing host APIs.
 * Run: node --import tsx scripts/seed-video-knowledge-demo.ts [--approve-skill]
 * No model, external source collection, parser replacement or existing real project writes.
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ExperienceCard, ExperienceDraft, ExperienceEvidence, FactorPolicy, DistilledSkill, ActionChunk, KnowledgeGrouping, ProjectInput } from '../apps/host/generated/contracts'
import { normalizeDraft, FIELD_KEYS, FIELD_LABELS } from '../packages/experience/domain'
import { projectInput } from '../packages/contracts/validate'

const root = resolve(import.meta.dirname, '..')
const template = JSON.parse(await readFile(resolve(root, 'data/templates/video-knowledge-demo.json'), 'utf8'))
const output = resolve(root, 'output/video/full-feature-20261014/knowledge-demo-seed.json')
const host = new URL(process.env.HZZ_VIDEO_HOST || 'http://127.0.0.1:4310')
assert(host.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(host.hostname) && !host.username && !host.password, 'Only the existing local host is allowed')
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const templateHash = hash(JSON.stringify(template))
type Project = { id: string; name: string; owner_id: string; context_version: number; input: ProjectInput }
type Document = { id: string; file_name: string; parser_result: { status: string; source_hash: string; text: string } }
type Seed = { schema_version: string; host: string; template_hash: string; project_id: string; owner_id: string; project_created: boolean; documents: Record<string, { id: string; file_name: string; sha256: string }>; cards: Record<string, string>; policy_id?: string; skill_id?: string; [key: string]: unknown }
let seed: Seed
try { seed = JSON.parse(await readFile(output, 'utf8')) }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; seed = { schema_version: 'video-knowledge-seed-v1', host: host.origin, template_hash: templateHash, project_id: `SYN-VIDEO-KNOWLEDGE-${randomUUID()}`, owner_id: '', project_created: false, documents: {}, cards: {} } }
assert(seed.schema_version === 'video-knowledge-seed-v1' && seed.template_hash === templateHash && seed.host === host.origin, 'Recorded seed/template/host identity changed; do not alter an existing namespace')
assert(/^SYN-VIDEO-KNOWLEDGE-[0-9a-f-]{36}$/.test(seed.project_id), 'Invalid synthetic namespace')
await mkdir(dirname(output), { recursive: true })
const persist = async () => writeFile(output, JSON.stringify(seed, null, 2) + '\n', 'utf8')
const sessionResponse = await fetch(new URL('/api/session', host))
assert(sessionResponse.ok, 'Host session unavailable')
const session = await sessionResponse.json() as { user: { id: string } }
const cookie = sessionResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
assert(cookie && session.user?.id, 'Owner session unavailable')
if (seed.owner_id) assert.equal(seed.owner_id, session.user.id, 'Do not reuse another owner namespace')
seed.owner_id = session.user.id
await persist()
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL('/api' + path, host), { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'X-Requested-With': 'haizhizi', ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(45000) })
  const result = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${result.code || ''} ${result.detail || ''}`)
  return result as T
}
const base = `/projects/${encodeURIComponent(seed.project_id)}`
async function assertNamespace(): Promise<Project> {
  const project = await api<Project>(base)
  assert.equal(project.id, seed.project_id); assert.equal(project.owner_id, seed.owner_id)
  assert.equal(project.name, template.project_name); assert.equal(project.input.synthetic, true)
  assert.equal(project.input.purpose, 'case_library_archive')
  assert(project.input.sources.every(source => source.synthetic && source.data_class === 'synthetic'), 'Namespace contains non-synthetic source; stop')
  return project
}
// Recover a successful create whose response was interrupted without creating another project.
const projects = await api<Project[]>('/projects')
if (projects.some(project => project.id === seed.project_id)) seed.project_created = true
if (!seed.project_created) {
  const input = projectInput({ schema_version: '2.0', project_id: seed.project_id, synthetic: true, purpose: 'case_library_archive', business_profile: 'neighborhood', mode: 'enterprise', role: 'planner', as_of: template.as_of, scope: { name: '合成楼栋知识流程，不对应真实小区', geometry: null, coordinate_encoding: 'WGS84', legal_parcel_confirmed: false }, sources: [], facts: [], context_rules: [], candidate_ids: ['retain_and_reuse', 'defer_and_investigate'], events: [] })
  const created = await api<Project>('/projects', { input, name: template.project_name })
  assert.equal(created.id, seed.project_id); assert.equal(created.input.synthetic, true)
  seed.project_created = true; await persist()
}
await assertNamespace()
async function upload(key: string, name: string, text: string): Promise<Document> {
  await assertNamespace()
  const sha = hash(text), docs = await api<Document[]>(base + '/documents')
  let document = docs.find(document => document.parser_result.source_hash === sha)
  if (seed.documents[key]) {
    assert(document && document.id === seed.documents[key].id && sha === seed.documents[key].sha256, 'Recorded original changed')
  }
  if (!document) {
    const form = new FormData(); form.append('file', new Blob([text], { type: 'text/plain;charset=utf-8' }), key + '.txt'); form.append('original_file_name', name); form.append('synthetic', 'true')
    document = await api<Document>(base + '/documents', form)
  }
  assert.equal(document.parser_result.source_hash, sha); assert.equal(document.parser_result.status, 'extracted')
  assert.equal(document.parser_result.text, text)
  seed.documents[key] = { id: document.id, file_name: document.file_name, sha256: sha }; await persist()
  return document
}
function evidence(doc: Document, lines: string[], index: number): ExperienceEvidence {
  assert(index >= 0 && lines[index].trim(), 'Original line missing')
  return { document_id: doc.id, version: doc.parser_result.source_hash, locator: `line:${index + 1}`, quote: lines[index] }
}
const caseCards: ExperienceCard[] = []
for (const item of template.cases) {
  const values: Record<string, string> = {
    decision_question: '怎样在保障用水的条件下分栋更新二次供水？',
    background: `${item.building}的合成供水设备老化记录，用于演示泵房与立管更新。`,
    key_conditions: '接口复核完成，临时供水已安排，施工范围限于本楼栋。',
    alternatives: '比较一次性停水更新与分时段更新两种安排。',
    proposal: '先核查接口，再以分时段施工方式更新泵房与立管。',
    actual_decision: `${item.building}采用分时段更新，并保留临时供水。`,
    decision_basis: '合成协商记录显示居民同意，施工接口已核查，合同范围已确认。',
    implementation: `合成实施记录：${item.building}已更新${item.pipe_m}米管线，模拟工期${item.duration_days}天。`,
    outcome: `合成复盘记录：低压反馈从${item.feedback_before}户减少至${item.feedback_after}户；只用于展示记录拆分。`,
    applicability: '仅用于已完成接口复核并有临时供水安排的楼栋演示。',
  }
  const lines = [`# 合成示例：${item.building}二次供水改造记录`, template.boundary, `模拟观察日期：${template.observation_date}`, '举措编号：pipe_network', '举措名称：二次供水改造', '项目阶段：实施', ...FIELD_KEYS.map(key => `${FIELD_LABELS[key]}：${values[key]}`), `合同记录：${item.building}合同已签订，二次供水改造合同金额${item.amount_wan}万元。`, `住户记录：${item.building}二次供水改造涉及${item.households}户。`, `工程记录：${item.building}二次供水已更新管线${item.pipe_m}米。`, '适用条件：接口复核完成 true；临时供水已安排 true。', '排除条件：权属否决 true 时不得实施。']
  const doc = await upload(item.id, `合成示例-${item.building}-二次供水.txt`, lines.join('\n') + '\n')
  const cite = (index: number) => [evidence(doc, lines, index)]
  const factor = (key: string, label: string, value: number, unit: string, index: number, amount_kind: 'contract' | 'not_applicable') => ({ key, label, value, unit, object_ref: `building:${item.building}`, stage: '实施', observed_at: template.observation_date, association: 'direct' as const, amount_kind, epistemic_status: 'fact' as const, evidence: cite(index) })
  const draft: ExperienceDraft = normalizeDraft({ title: `合成示例 · ${item.building}二次供水改造`, project_type: '合成住宅楼栋', development_mode: '合成综合整治', stage: '实施', fields: FIELD_KEYS.map((key, index) => ({ key, value: values[key], evidence: cite(index + 6) })), knowledge: { kind: 'case', origin: 'project_case', measure_key: template.measure_key, measure_name: template.measure_name, evidence_level: 'implementation_record', conditions: [{ fact_kind: 'engineering.interface_confirmed', label: '接口复核完成', operator: 'eq', value: true, unit: null, evidence: cite(19) }, { fact_kind: 'engineering.temporary_supply', label: '临时供水已安排', operator: 'eq', value: true, unit: null, evidence: cite(19) }], exclusions: [{ fact_kind: 'engineering.rights_veto', label: '权属否决', operator: 'eq', value: true, unit: null, source_value: '权属否决', evidence: cite(20) }], transfer_notes: [values.applicability], factors: [factor('amount_contract', '合同金额', item.amount_wan, '万元', 16, 'contract'), factor('benefited_households', '受益户数', item.households, '户', 17, 'not_applicable'), factor('pipe_length', '更新管线长度', item.pipe_m, '米', 18, 'not_applicable')] } })
  await assertNamespace()
  const existing = await api<{ cards: ExperienceCard[] }>(base + '/experiences')
  let card = seed.cards[item.id] ? existing.cards.find(card => card.id === seed.cards[item.id]) : existing.cards.find(card => card.title === draft.title && card.fields.some(field => field.evidence.some(ref => ref.document_id === doc.id && ref.version === doc.parser_result.source_hash)))
  if (seed.cards[item.id]) assert(card, 'Recorded seed card no longer exists; do not silently replace it')
  if (!card) card = await api<ExperienceCard>(base + '/experiences', { draft })
  assert.equal(card.project_id, seed.project_id); seed.cards[item.id] = card.id; await persist()
  if (item.approve && card.status === 'draft') {
    await assertNamespace(); card = await api<ExperienceCard>(`${base}/experiences/${encodeURIComponent(card.id)}/review`, { expected_revision: card.revision, status: 'approved', note: template.review_note })
  }
  assert(card.status !== 'rejected', 'Seed card was rejected; preserve review and stop')
  if (item.approve) assert.equal(card.status, 'approved')
  caseCards.push(card)
}
const policyLines = ['# 合成示例：二次供水因素比较参数', template.boundary, template.policy.note, ...template.policy.definitions.map((item: any) => `${item.label}：单位${item.unit}，演示权重${item.weight}，比较尺度${item.scale}${item.unit}。`), `共同覆盖门槛：${template.policy.min_coverage}；完整链接最大距离：${template.policy.max_distance}。`]
const policyDoc = await upload('factor-policy', '合成示例-因素参数说明.txt', policyLines.join('\n') + '\n')
let pipeline = await api<{ policies: FactorPolicy[]; skills: DistilledSkill[] }>(base + '/knowledge/pipeline')
let policy = seed.policy_id ? pipeline.policies.find(policy => policy.id === seed.policy_id) : pipeline.policies.find(policy => policy.note === template.policy.note)
if (seed.policy_id) assert(policy, 'Recorded policy missing; do not replace')
if (!policy) {
  await assertNamespace()
  policy = await api<FactorPolicy>(base + '/knowledge/policies', { policy: { definitions: template.policy.definitions.map((item: any, index: number) => ({ ...item, measure_keys: [template.measure_key], evidence: [evidence(policyDoc, policyLines, index + 3)] })), min_coverage: template.policy.min_coverage, max_distance: template.policy.max_distance, note: template.policy.note } })
}
assert.equal(policy.project_id, seed.project_id); seed.policy_id = policy.id; await persist()
if (policy.status === 'draft') {
  await assertNamespace(); policy = await api<FactorPolicy>(`${base}/knowledge/policies/${encodeURIComponent(policy.id)}/review`, { expected_revision: policy.revision, status: 'approved', note: `${template.review_note} ${template.policy.note}` })
}
assert.equal(policy.status, 'approved')
const groups = await api<{ grouping: KnowledgeGrouping }>(base + '/knowledge/groups', { policy_id: policy.id, policy_revision: policy.revision, query: { measure_key: template.measure_key, question: '比较合成二次供水工程因素' } })
assert(groups.grouping.groups.some(group => group.card_refs.length >= 3), 'No valid three-card group; do not manufacture a grouping result')
const approved = caseCards.filter(card => template.cases.find((item: any) => seed.cards[item.id] === card.id)?.approve)
pipeline = await api(base + '/knowledge/pipeline')
let skill = seed.skill_id ? pipeline.skills.find(skill => skill.id === seed.skill_id) : undefined
if (seed.skill_id) assert(skill, 'Recorded skill missing; do not replace')
if (!skill) {
  await assertNamespace(); skill = await api<DistilledSkill>(base + '/knowledge/skills/distill', { card_ids: approved.map(card => card.id) }); seed.skill_id = skill.id; await persist()
}
assert.equal(skill.project_id, seed.project_id)
if (process.argv.includes('--approve-skill') && skill.status === 'draft') {
  await assertNamespace(); skill = await api<DistilledSkill>(`${base}/knowledge/skills/${encodeURIComponent(skill.id)}/review`, { expected_revision: skill.revision, status: 'approved', note: template.review_note })
}
let exportState: { status: string; filename?: string; markdown_hash?: string; http_status?: number; error_code?: string }
if (skill.status === 'approved') {
  const exported = await api<{ filename: string; markdown: string }>(`${base}/knowledge/skills/${encodeURIComponent(skill.id)}/export`)
  assert(approved.every(card => exported.markdown.includes(card.id)))
  exportState = { status: 'export_verified', filename: exported.filename, markdown_hash: hash(exported.markdown) }
} else {
  const response = await fetch(new URL('/api' + `${base}/knowledge/skills/${encodeURIComponent(skill.id)}/export`, host), { headers: { Cookie: cookie, 'X-Requested-With': 'haizhizi' }, signal: AbortSignal.timeout(10000) })
  const denied = await response.json() as { code: string }
  assert.equal(response.status, 422); assert.equal(denied.code, 'SKILL_REVIEW_REQUIRED')
  exportState = { status: 'draft_requires_explicit_simulated_review_before_export', http_status: response.status, error_code: denied.code }
}
const originals = await api<Document[]>(base + '/documents')
const freshCards = await api<{ cards: ExperienceCard[] }>(base + '/experiences')
const finalProject = await assertNamespace()
const chunkReadback = await api<{ chunks: ActionChunk[] }>(base + '/knowledge/chunks', { document_id: seed.documents['case-1'].id })
assert.equal(originals.length, 5); assert.equal(finalProject.input.sources.length, 5)
assert(freshCards.cards.every(card => card.project_id === seed.project_id))
seed = { ...seed, status: 'seeded_and_read_back', checked_at: new Date().toISOString(), project: { id: finalProject.id, name: finalProject.name, synthetic: finalProject.input.synthetic, context_version: finalProject.context_version, as_of: finalProject.input.as_of }, source_ids: finalProject.input.sources.map(source => source.id), card_readback: freshCards.cards.map(card => ({ id: card.id, title: card.title, status: card.status, revision: card.revision, filled_fields: card.fields.filter(field => field.value !== null).length, factors: card.knowledge?.factors })), policy_readback: policy, grouping_readback: groups.grouping, skill_readback: skill, skill_export: exportState, chunks_readback: { document_id: seed.documents['case-1'].id, chunks: chunkReadback.chunks.length, span_versions: [...new Set(chunkReadback.chunks.map(chunk => chunk.document_version))] }, model_calls: 0, external_calls: 0, synthetic_isolation: 'Only this recorded new synthetic project namespace was mutated; no existing real projects or global Intel intake were used.' }
await persist()
process.stdout.write(JSON.stringify({ project_id: seed.project_id, status: seed.status, documents: originals.length, approved_cards: freshCards.cards.filter(card => card.status === 'approved').length, draft_cards: freshCards.cards.filter(card => card.status === 'draft').length, groups: groups.grouping.groups.map(group => ({ cards: group.card_refs.length, diameter: group.diameter, coverage: group.min_coverage })), skill_status: skill.status, output }) + '\n')
