import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ExperienceCard, ExperienceDraft, ExperienceField, ProjectInput } from '../apps/host/generated/contracts'
import { documentSlices, type ParsedDocument } from '../packages/experience/document-slices'
import { FIELD_KEYS } from '../packages/experience/domain'
import { visibleText } from '../services/capabilities/research'
import { validate } from '../packages/contracts/validate'
import { hash } from '../packages/intelligence/domain'

const directory = resolve(process.argv[2] || 'data/local/case-library-20261008')
const base = 'http://127.0.0.1:4310/api'
const session = await fetch(base + '/session', { signal: AbortSignal.timeout(15000) })
if (!session.ok) throw new Error('请先启动本地工作台')
const cookie = (session.headers.get('set-cookie') || '').split(';')[0]
const request = async <T>(path: string, body?: unknown): Promise<T> => {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, 'X-Requested-With': 'haizhizi', ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(30000) })
  if (!response.ok) { const error = await response.json().catch(() => ({})) as { code?: string }; throw new Error(error.code || 'LOCAL_INTAKE_FAILED') }
  return response.json() as Promise<T>
}
const id = 'P-CASE-RULE-LIBRARY-20261008'
let project = (await request<{ id: string; input: ProjectInput }[]>('/projects')).find(p => p.id === id)
if (!project) {
  const input: ProjectInput = { schema_version: '2.0', project_id: id, synthetic: false, purpose: 'case_library_archive', mode: 'enterprise', role: 'investment_manager', as_of: '2026-10-08', business_profile: 'neighborhood',
    scope: { name: '公开旧改案例与论文方法资料归档', geometry: null, coordinate_encoding: 'WGS84', legal_parcel_confirmed: false, resolution_status: 'uncovered', resolution_note: '资料归档，不代表当前待建对象或可参与项目。' },
    sources: [], facts: [], context_rules: [], candidate_ids: ['retain_and_reuse', 'defer_and_investigate'], events: [] }
  project = await request('/projects', { input, name: '旧改案例与规则资料库 · 公开来源' })
}
const items = JSON.parse(await readFile(resolve(directory, 'sources.json'), 'utf8')) as { key: string; title: string; url: string; path: string; kind: string; license?: string; raw_sha256?: string }[]
const existing = await request<{ cards: ExperienceCard[] }>(`/projects/${id}/experiences`)
const counts = { documents: 0, created_cards: 0, updated_seed_drafts: 0, reused_cards: 0, model_calls: 0 }
const recorded: { card_id: string; measure_key: string; origin: string; source_url: string; document_id: string; quote_locator: string; status: string }[] = []
for (const item of items) {
  const path = resolve(item.path)
  if (!path.startsWith(directory + '/')) throw new Error('SOURCE_PATH_OUT_OF_SCOPE')
  const raw = await readFile(path, 'utf8')
  const body = path.endsWith('.html') ? visibleText(raw, item.url) : raw
  if (body.trim().length < 100) throw new Error('SOURCE_BODY_UNAVAILABLE')
  const material = path.endsWith('.html') ? `来源：${item.url}\n标题：${item.title}\n原始HTML SHA256：${item.raw_sha256}\n\n${body}` : body
  const file = `${item.key}-original.md`
  await writeFile(resolve(directory, file), material)
  const form = new FormData()
  form.set('file', new Blob([material], { type: 'text/markdown' }), file)
  form.set('original_file_name', file)
  const uploaded = await request<{ id: string; parser_result: ParsedDocument['parser_result'] }>(`/projects/${id}/documents`, form)
  const doc: ParsedDocument = { id: uploaded.id, project_id: id, file_name: file, sha256: uploaded.parser_result.source_hash!, parser_result: uploaded.parser_result, created_at: new Date().toISOString() }
  const slices = documentSlices(doc)
  counts.documents++
  const selections = item.key === 'policy'
    ? [['basic_infrastructure', '基础类'], ['resident_participation', '居民自愿'], ['long_term_maintenance', '长效管理']]
    : item.key === 'paper' ? [['resident_priority_method', 'AIPA']] : [['building_envelope', '外墙面'], ['community_roads', '道路'], ['landscape', '绿化景观']]
  for (const [measureKey, term] of selections) {
    const slice = slices.find(s => !s.text.startsWith('来源：') && !s.text.startsWith('标题：') && !s.text.startsWith('原始') && s.text.includes(term))
    if (!slice) continue
    const at = slice.text.indexOf(term), start = Math.max(0, at - 45), value = slice.text.slice(start, Math.min(slice.text.length, at + 200))
    const evidence = { document_id: doc.id, version: doc.sha256, locator: slice.locator, quote: value }
    const kind = item.key === 'case' ? 'case' as const : 'rule' as const
    const name = item.key === 'paper' ? 'AIPA' : term
    const old = existing.cards.find(card => card.knowledge?.measure_key === measureKey && card.fields.some(field => field.evidence.some(e => e.document_id === doc.id && e.version === doc.sha256)))
    if (old && (old.knowledge!.measure_name === name || old.status !== 'draft' || old.revision !== 1)) { counts.reused_cards++; recorded.push({ card_id: old.id, measure_key: measureKey, origin: old.knowledge!.origin, source_url: item.url, document_id: doc.id, quote_locator: slice.locator, status: old.status }); continue }
    const reportedCompletion = item.key === 'case' && body.includes('已通过竣工验收')
    const key: ExperienceField['key'] = item.key === 'case' ? reportedCompletion ? 'implementation' : 'background' : item.key === 'paper' ? 'decision_basis' : 'proposal'
    const draft: ExperienceDraft = { title: `${item.title.slice(0, 76)} · ${name}`, project_type: '', development_mode: '', stage: item.key === 'case' ? '公开历史报道' : '研究方法或政策摘录',
      fields: FIELD_KEYS.map(k => ({ key: k, value: k === key ? value : null, evidence: k === key ? [evidence] : [] })),
      knowledge: { kind, origin: kind === 'case' ? 'project_case' : item.key === 'paper' ? 'research_paper' : 'official_policy', measure_key: measureKey, measure_name: name, conditions: [], exclusions: [], transfer_notes: [],
        evidence_level: item.key === 'paper' ? 'observational_study' : item.key === 'policy' ? 'official_policy' : reportedCompletion ? 'implementation_record' : 'not_reported' } }
    validate('ExperienceDraft', draft)
    const card = old ? await request<ExperienceCard>(`/projects/${id}/experiences/${old.id}/update`, { draft, expected_revision: old.revision }) : await request<ExperienceCard>(`/projects/${id}/experiences`, { draft })
    if (old) { counts.updated_seed_drafts++; existing.cards.splice(existing.cards.indexOf(old),1,card) } else { counts.created_cards++; existing.cards.push(card) }
    recorded.push({ card_id: card.id, measure_key: measureKey, origin: card.knowledge!.origin, source_url: item.url, document_id: doc.id, quote_locator: slice.locator, status: card.status })
  }
}
const result = { schema_version: '1.0', project_id: id, synthetic: false, counts, records: recorded,
  review_state: 'drafts_only_no_automatic_approval', conditions: 'Structured applicability is deliberately empty until reviewed; these source excerpts cannot directly route a project.',
  upload_visibility: 'Existing upload boundary retained as internal; no automatic outbound permission or public promotion.',
  source_manifest_sha256: hash(await readFile(resolve(directory, 'sources.json'), 'utf8')) }
await mkdir(directory, { recursive: true })
await writeFile(resolve(directory, 'intake.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ project_id: id, counts, draft_cards: recorded.length, model_calls: 0 }))
