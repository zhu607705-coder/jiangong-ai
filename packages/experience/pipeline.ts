import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DistilledSkill, ExperienceCard, ExperienceDraft, FactorPolicy, KnowledgeQuery } from '../../apps/host/generated/contracts'
import type { ProjectRecord, Store } from '../../apps/host/store'
import { projectInput, validate } from '../contracts/validate'
import { config } from '../../apps/host/config'
import { parseDocument } from '../../apps/host/ingest'
import { ExperienceService } from './service'
import { ExperienceError, FIELD_KEYS, normalizeDraft, validateEvidence, validateEvidenceGroups } from './domain'
import { buildActionChunks } from './chunking'
import { groupKnowledge } from './clustering'
import { KnowledgeRepository } from './knowledge-repository'
import { compileKnowledgeSkill, skillMarkdown, skillStillApplicable } from './skill-distillation'
import { validateFactorPolicy } from './pipeline-normalize'

type PolicyInput = Pick<FactorPolicy, 'definitions' | 'min_coverage' | 'max_distance' | 'note'>
const draftOf = (card: ExperienceCard): ExperienceDraft => ({ title: card.title, project_type: card.project_type, development_mode: card.development_mode, stage: card.stage, fields: card.fields, ...(card.knowledge ? { knowledge: card.knowledge } : {}) })

export class KnowledgePipelineService {
  readonly repository: KnowledgeRepository
  constructor(readonly store: Store, readonly experience: ExperienceService) { this.repository = new KnowledgeRepository(store.db) }
  async initialize() { await this.repository.initialize() }
  async state(project: ProjectRecord) {
    const [documents, cards, policies, skills] = await Promise.all([
      this.experience.repository.documents(project.id), this.experience.repository.list(project.id), this.repository.policies(project.id), this.repository.skills(project.id),
    ])
    return { documents, cards, policies, skills, public_sources: project.input.synthetic ? [] : project.input.sources.filter(source => !source.id.startsWith('PUBLIC-DOCUMENT-') && source.visibility === 'public' && source.data_class === 'public' && !source.synthetic && !!source.untrusted_text?.trim() && source.content_status !== 'metadata_only').map(({ id, title, url, content_status }) => ({ id, title, url, content_status })) }
  }
  async importPublicDocument(project: ProjectRecord, sourceId: string) {
    const source = project.input.sources.find(source => source.id === sourceId)
    if (project.input.synthetic || !source || source.synthetic || source.visibility !== 'public' || source.data_class !== 'public' || !source.untrusted_text?.trim() || source.content_status === 'metadata_only') throw new ExperienceError(422, 'PUBLIC_ORIGINAL_REQUIRED', '请选择本项目已保存且有正文的真实公开来源。')
    const text = source.untrusted_text, bytes = Buffer.from(text, 'utf8')
    if (bytes.length > 10 * 1024 * 1024) throw new ExperienceError(413, 'PUBLIC_DOCUMENT_TOO_LARGE', '公开原文超过材料大小上限。')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const old = (await this.store.db.query<{ id: string; file_name: string; parser_result: unknown }>('SELECT id,file_name,parser_result FROM documents WHERE project_id=$1 AND sha256=$2', [project.id, hash])).rows[0]
    const id = old?.id || `DOC-${randomUUID()}`, publicId = `PUBLIC-DOCUMENT-${id}`
    const binding = project.input.sources.find(item => item.id === publicId)
    if (binding) {
      if (binding.hash !== hash || binding.locator !== `document:${id}` || binding.visibility !== 'public' || binding.data_class !== 'public' || binding.synthetic) throw new ExperienceError(409, 'PUBLIC_DOCUMENT_BINDING_STALE', '公开原件的来源绑定已变化，请先核对版本。')
      return { ...(old || {}), id, source_id: publicId, reused: true }
    }
    const directory = join(config.dataDir, 'blobs', project.id); await mkdir(directory, { recursive: true })
    const fileName = source.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 140) + '.txt', blob = `${id}.txt`, path = join(directory, blob)
    let parsed: Awaited<ReturnType<typeof parseDocument>> | undefined
    if (!old) {
      await writeFile(path, bytes, { flag: 'wx' })
      try { parsed = await parseDocument({ documentId: id, fileName, filePath: path, projectRoot: process.cwd(), allowedBasePath: directory, mime: 'text/plain', type: 'workspace_material' }) }
      catch (error) { await unlink(path).catch(() => {}); throw error }
      if (parsed.status !== 'extracted') { await unlink(path).catch(() => {}); throw new ExperienceError(422, 'PUBLIC_BODY_NOT_EXTRACTED', '公开原文未解析成功，不能保存为可用材料。') }
    }
    try {
      const next = projectInput({ ...project.input, sources: [...project.input.sources, { ...source, id: publicId, hash, locator: `document:${id}`, content_status: 'uploaded', parse_status: 'extracted', untrusted_text: text }] })
      await this.store.db.transaction(async db => {
        const update = await db.query('UPDATE projects SET input=$1,context_version=context_version+1,updated_at=now() WHERE id=$2 AND context_version=$3 RETURNING id', [JSON.stringify(next), project.id, project.context_version])
        if (!update.rows.length) throw new ExperienceError(409, 'CONTEXT_VERSION_CONFLICT', '项目资料已变更，请刷新后重新导入。')
        if (!old) await db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)', [id, project.id, fileName, blob, hash, JSON.stringify(parsed)])
      })
    } catch (error) { if (!old) await unlink(path).catch(() => {}); throw error }
    return { id, file_name: old?.file_name || fileName, parser_result: old?.parser_result || parsed, source_id: publicId, reused: !!old }
  }
  async chunks(project: ProjectRecord, documentId: string) {
    const document = (await this.experience.repository.documents(project.id)).find(document => document.id === documentId)
    if (!document) throw new ExperienceError(404, 'DOCUMENT_SCOPE', '请选择本项目已导入的材料。')
    return buildActionChunks(document)
  }
  async extract(project: ProjectRecord, ids: string[], useModel: boolean) {
    return this.experience.extract(project, ids, useModel, true)
  }
  private async checkPolicyEvidence(project: ProjectRecord, policy: FactorPolicy) {
    const documents = await this.experience.repository.documents(project.id)
    validateEvidenceGroups(policy.definitions.flatMap(definition => [definition.evidence, ...(definition.condition ? [definition.condition.evidence] : [])]), documents, project.id)
    const conditions = policy.definitions.flatMap(definition => definition.condition ? [definition.condition] : [])
    if (conditions.length) {
      const draft: ExperienceDraft = { title: '因素条件原文检查', project_type: '', development_mode: '', stage: '', fields: FIELD_KEYS.map(key => ({ key, value: null, evidence: [] })),
        knowledge: { kind: 'rule', origin: 'practice', measure_key: 'factor_policy', measure_name: '因素复核', conditions, exclusions: [], transfer_notes: [], evidence_level: 'not_reported' } }
      normalizeDraft(draft); validateEvidence(draft, documents, project.id)
    }
  }
  async savePolicy(project: ProjectRecord, input: PolicyInput, id?: string, expected?: number): Promise<FactorPolicy> {
    const previous = id ? await this.repository.policy(project.id, id) : null
    if (id && !previous) throw new ExperienceError(404, 'POLICY_NOT_FOUND', '因素政策不存在或无权访问。')
    if (id && expected === undefined) throw new ExperienceError(422, 'POLICY_VERSION_REQUIRED', '修改因素政策需要当前版本。')
    const now = new Date().toISOString()
    const value = validateFactorPolicy({ ...input, id: previous?.id || `POL-${randomUUID()}`, project_id: project.id, revision: (previous?.revision || 0) + 1,
      status: 'draft', reviewed_by: null, reviewed_at: null, created_at: previous?.created_at || now, updated_at: now })
    await this.checkPolicyEvidence(project, value)
    return this.repository.savePolicy(value, previous ? expected : undefined, previous ? 'update' : 'create', project.owner_id)
  }
  async reviewPolicy(project: ProjectRecord, id: string, expected: number, status: 'approved' | 'rejected', note: string): Promise<FactorPolicy> {
    const previous = await this.repository.policy(project.id, id)
    if (!previous) throw new ExperienceError(404, 'POLICY_NOT_FOUND', '因素政策不存在或无权访问。')
    if (!note.trim()) throw new ExperienceError(422, 'REVIEW_NOTE_REQUIRED', '请记录复核范围及依据。')
    const now = new Date().toISOString()
    const next = validateFactorPolicy({ ...previous, revision: previous.revision + 1, status, note, reviewed_by: project.owner_id, reviewed_at: now, updated_at: now }, status === 'approved')
    await this.checkPolicyEvidence(project, next)
    return this.repository.savePolicy(next, expected, 'review', project.owner_id)
  }
  async groups(project: ProjectRecord, policyId?: string, expected?: number, query?: KnowledgeQuery) {
    const policy = policyId ? await this.repository.policy(project.id, policyId) : await this.repository.approvedPolicy(project.id)
    if (policyId && !policy) throw new ExperienceError(404, 'POLICY_NOT_FOUND', '因素政策不存在或无权访问。')
    if (expected !== undefined && policy?.revision !== expected) throw new ExperienceError(409, 'KNOWLEDGE_VERSION_CONFLICT', '因素政策已变化，请刷新后预览。')
    if (policy) await this.checkPolicyEvidence(project, policy)
    const cards = (await this.experience.repository.list(project.id)).filter(card => !query?.measure_key || card.knowledge?.measure_key === query.measure_key)
    const documents = await this.experience.repository.documents(project.id)
    const current = cards.filter(card => { try { validateEvidence(card, documents, project.id); return true } catch { return false } })
    const grouping = validate('KnowledgeGrouping', groupKnowledge(current, policy))
    return { grouping, cards: current }
  }
  async distill(project: ProjectRecord, ids: string[]): Promise<DistilledSkill> {
    const selected = new Set(ids)
    const cards = (await this.experience.repository.list(project.id)).filter(card => selected.has(card.id))
    if (cards.length !== selected.size) throw new ExperienceError(422, 'SKILL_CARD_SCOPE', '技能来源必须属于当前项目。')
    const documents = await this.experience.repository.documents(project.id)
    for (const card of cards) { normalizeDraft(draftOf(card)); validateEvidence(card, documents, project.id) }
    const skill = compileKnowledgeSkill(cards, { id: `SKILL-${randomUUID()}`, projectId: project.id, now: new Date().toISOString() })
    return this.repository.saveSkill(skill, undefined, 'distill', project.owner_id)
  }
  async reviewSkill(project: ProjectRecord, id: string, expected: number, status: 'approved' | 'rejected', note: string): Promise<DistilledSkill> {
    const old = await this.repository.skill(project.id, id)
    if (!old) throw new ExperienceError(404, 'SKILL_NOT_FOUND', '技能不存在或无权访问。')
    if (!note.trim()) throw new ExperienceError(422, 'REVIEW_NOTE_REQUIRED', '请填写技能复核说明。')
    await this.checkSkillSources(project, old)
    const now = new Date().toISOString()
    const next = validate<DistilledSkill>('DistilledSkill', { ...old, revision: old.revision + 1, status, review_note: note, reviewed_by: project.owner_id, reviewed_at: now, updated_at: now })
    return this.repository.saveSkill(next, expected, 'review', project.owner_id)
  }
  private async checkSkillSources(project: ProjectRecord, skill: DistilledSkill): Promise<ExperienceCard[]> {
    const cards = await this.experience.repository.list(project.id)
    if (!skillStillApplicable({ ...skill, status: 'approved' }, cards)) throw new ExperienceError(409, 'SKILL_SOURCE_STALE', '来源经验已更改或撤回审核，请重新蒸馏和复核。')
    const selected = cards.filter(card => skill.card_refs.some(ref => ref.card_id === card.id))
    const documents = await this.experience.repository.documents(project.id)
    for (const card of selected) { normalizeDraft(draftOf(card)); validateEvidence(card, documents, project.id) }
    return selected
  }
  async exportSkill(project: ProjectRecord, id: string) {
    const skill = await this.repository.skill(project.id, id)
    if (!skill) throw new ExperienceError(404, 'SKILL_NOT_FOUND', '技能不存在或无权访问。')
    await this.checkSkillSources(project, skill)
    return { filename: `${skill.measure_key}-${skill.revision}-SKILL.md`, markdown: skillMarkdown(skill) }
  }
}
