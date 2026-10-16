import { randomUUID } from 'node:crypto'
import type { ExperienceCard, ExperienceDraft, ProjectInput, Source } from '../../apps/host/generated/contracts'
import type { Database } from '../../apps/host/store'
import { canonical, searchExpression, searchTokens } from '../intelligence/domain'
import { documentSlices, ExperienceError, normalizeDraft, validateEvidence, type ParsedDocument } from './domain'
import { experienceEvidenceGroups } from './pipeline-normalize'

const migration = `
CREATE TABLE IF NOT EXISTS experience_cards (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL,
  payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS experience_history (
  card_id TEXT NOT NULL REFERENCES experience_cards(id), revision INTEGER NOT NULL,
  payload JSONB NOT NULL, action TEXT NOT NULL, reviewer TEXT NOT NULL,
  search_vector TSVECTOR NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(card_id,revision)
);
CREATE INDEX IF NOT EXISTS experience_project ON experience_cards(project_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS experience_search ON experience_history USING gin(search_vector);
CREATE INDEX IF NOT EXISTS experience_knowledge_kind ON experience_cards ((payload->'knowledge'->>'kind'));
CREATE INDEX IF NOT EXISTS experience_knowledge_measure ON experience_history ((payload->'knowledge'->>'measure_key'));
`
const searchable = (draft: ExperienceDraft) => searchTokens([draft.title, draft.project_type, draft.development_mode, draft.stage, ...draft.fields.map(field => field.value || ''), draft.knowledge?.measure_key || '', draft.knowledge?.measure_name || '', ...(draft.knowledge?.transfer_notes || [])].join(' ')).join(' ')
const draftContent = ({ title, project_type, development_mode, stage, fields, knowledge }: ExperienceDraft) => canonical({ title, project_type, development_mode, stage, fields, ...(knowledge ? { knowledge } : {}) })
export type SearchFilter = { q?: string; project_type?: string; development_mode?: string; stage?: string; as_of?: string; exclude_project?: string; synthetic?: boolean; limit?: number; kind?: 'case' | 'rule' }
export type KnowledgeFilter = { include_project_rules?:boolean; as_of: string; synthetic: boolean; mode: ProjectInput['mode']; measure_key?: string; limit?: number; exclude_project?: string }
export type KnowledgeMaterial = { documents: ParsedDocument[]; sources: Source[] }

/** Source identity follows the existing ingest document identifier, never a card's claimed visibility. */
export function originalSource(document: ParsedDocument, sources: Source[]): Source | undefined {
  const importedPublic = sources.find(source => source.id === `PUBLIC-DOCUMENT-${document.id}` && source.locator === `document:${document.id}` && source.hash === document.sha256 && source.visibility === 'public' && source.data_class === 'public' && !source.synthetic)
  if (importedPublic) return importedPublic
  return sources.find(source => (source.id === document.id || source.locator === `document:${document.id}`) && source.hash === document.sha256)
}

/** Public routing exports only source-backed natural-language metadata. Classification remains reviewed annotation. */
export function publicKnowledgeCard(card: ExperienceCard, documents: ParsedDocument[]): ExperienceCard | undefined {
  if (!card.knowledge) return undefined
  const ids = new Set(experienceEvidenceGroups(card).flat().map(evidence => evidence.document_id))
  const texts = documents.filter(document => ids.has(document.id)).flatMap(document => documentSlices(document).map(slice => slice.text))
  const present = (value: string) => texts.some(text => text.includes(value))
  if (!present(card.knowledge.measure_name)) return undefined
  const result = structuredClone(card)
  if (!present(result.title)) result.title = `${result.knowledge!.kind === 'rule' ? '规则' : '案例'}：${result.knowledge!.measure_name}`
  for (const key of ['project_type', 'development_mode', 'stage'] as const) if (!present(result[key])) result[key] = ''
  for (const key of ['conditions', 'exclusions'] as const) {
    result.knowledge![key] = result.knowledge![key].map(condition => ({ ...condition, label: present(condition.label) ? condition.label : key === 'conditions' ? '原文适用条件' : '原文排除条件' }))
  }
  result.knowledge!.transfer_notes = result.knowledge!.transfer_notes.filter(present)
  result.knowledge!.factors = result.knowledge!.factors?.map(factor => ({ ...factor, label: present(factor.label) ? factor.label : factor.key,
    object_ref: factor.object_ref && present(factor.object_ref.replace(/^[^:]+:/, '')) ? factor.object_ref : null }))
  return result
}

/** Additive tables in the existing project DB; uploaded documents stay read-only. */
export class ExperienceRepository {
  constructor(readonly db: Database) {}
  async initialize(): Promise<void> { await this.db.exec(migration) }
  async documents(projectId: string, db = this.db): Promise<ParsedDocument[]> {
    return (await db.query<ParsedDocument>('SELECT id,project_id,file_name,sha256,parser_result,created_at FROM documents WHERE project_id=$1 ORDER BY created_at,id', [projectId])).rows
  }
  async get(projectId: string, id: string, db = this.db): Promise<ExperienceCard | undefined> {
    return (await db.query<{ payload: ExperienceCard }>('SELECT payload FROM experience_cards WHERE id=$1 AND project_id=$2', [id, projectId])).rows[0]?.payload
  }
  async list(projectId: string, query = '', status = '', kind = ''): Promise<ExperienceCard[]> {
    const rows = await this.db.query<{ payload: ExperienceCard }>(`
      SELECT c.payload FROM experience_cards c JOIN experience_history h ON h.card_id=c.id AND h.revision=c.revision
      WHERE c.project_id=$1 AND ($2::text='' OR c.payload->>'status'=$2)
      AND ($3::text='' OR h.search_vector @@ to_tsquery('simple',$3))
      AND ($4::text='' OR c.payload->'knowledge'->>'kind'=$4)
      ORDER BY c.updated_at DESC,c.id LIMIT 200`, [projectId, status, searchExpression(query), kind])
    return rows.rows.map(row => row.payload)
  }
  async create(projectId: string, drafts: ExperienceDraft[], reviewer: string): Promise<ExperienceCard[]> {
    return this.db.transaction(async db => {
      // Serialize creation per project, including concurrent model/local extractions in PostgreSQL.
      await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId])
      const existing = await db.query<{ payload: ExperienceCard }>('SELECT payload FROM experience_cards WHERE project_id=$1 ORDER BY updated_at DESC,id', [projectId])
      const byContent = new Map<string, ExperienceCard>()
      for (const { payload } of existing.rows) {
        const content = draftContent(payload)
        if (!byContent.has(content)) byContent.set(content, payload)
      }
      const cards: ExperienceCard[] = []
      for (const draft of drafts) {
        // Compare the full current draft, including source version, object, stage and monetary basis.
        // Review state and history belong to the existing card and must never be reset by re-extraction.
        const content = draftContent(draft), previous = byContent.get(content)
        if (previous) { if (!cards.some(card => card.id === previous.id)) cards.push(previous); continue }
        const clock = new Date().toISOString()
        const card: ExperienceCard = { ...draft, id: `EXP-${randomUUID()}`, project_id: projectId, status: 'draft', revision: 1, review_note: null, created_at: clock, updated_at: clock }
        await db.query('INSERT INTO experience_cards(id,project_id,revision,payload) VALUES($1,$2,$3,$4)', [card.id, projectId, 1, JSON.stringify(card)])
        await this.history(db, card, 'create', reviewer)
        byContent.set(content, card)
        cards.push(card)
      }
      return cards
    })
  }
  async save(card: ExperienceCard, expectedRevision: number, action: string, reviewer: string, db: Database): Promise<ExperienceCard> {
    const result = await db.query('UPDATE experience_cards SET revision=$1,payload=$2,updated_at=now() WHERE id=$3 AND project_id=$4 AND revision=$5 RETURNING id', [card.revision, JSON.stringify(card), card.id, card.project_id, expectedRevision])
    if (!result.rows.length) throw new ExperienceError(409, 'EXPERIENCE_VERSION_CONFLICT', '经验卡已被更新，请重新读取再修改。')
    await this.history(db, card, action, reviewer)
    return card
  }
  private async history(db: Database, card: ExperienceCard, action: string, reviewer: string): Promise<void> {
    await db.query("INSERT INTO experience_history(card_id,revision,payload,action,reviewer,search_vector) VALUES($1,$2,$3,$4,$5,to_tsvector('simple',$6))", [card.id, card.revision, JSON.stringify(card), action, reviewer, searchable(card)])
  }
  async search(ownerId: string, filter: SearchFilter): Promise<ExperienceCard[]> {
    const cutoff = filter.as_of ? `${filter.as_of}T23:59:59.999Z` : null
    const result = await this.db.query<{ payload: ExperienceCard }>(`
      SELECT h.payload FROM experience_cards c JOIN projects p ON p.id=c.project_id
      JOIN LATERAL (
        SELECT payload,search_vector,recorded_at FROM experience_history h0
        WHERE h0.card_id=c.id AND ($1::timestamptz IS NULL OR h0.recorded_at <= $1)
        ORDER BY h0.revision DESC LIMIT 1
      ) h ON true
      WHERE p.owner_id=$2 AND (p.input->>'synthetic')::boolean=$3 AND h.payload->>'status'='approved'
      AND ($4::text='' OR h.payload->>'project_type'=$4)
      AND ($5::text='' OR h.payload->>'development_mode'=$5)
      AND ($6::text='' OR h.payload->>'stage'=$6)
      AND ($7::text='' OR c.project_id<>$7)
      AND ($8::text='' OR h.search_vector @@ to_tsquery('simple',$8))
      AND ($10::text='' OR h.payload->'knowledge'->>'kind'=$10)
      ORDER BY CASE WHEN $8::text='' THEN 0 ELSE ts_rank_cd(h.search_vector,to_tsquery('simple',$8)) END DESC,h.recorded_at DESC,c.id
      LIMIT $9`, [cutoff, ownerId, Boolean(filter.synthetic), filter.project_type || '', filter.development_mode || '', filter.stage || '', filter.exclude_project || '', searchExpression(filter.q || ''), Math.min(filter.limit || 30, 100), filter.kind || ''])
    return result.rows.map(row => row.payload)
  }
  async knowledgeMaterials(ownerId: string, cards: ExperienceCard[]): Promise<Map<string, KnowledgeMaterial>> {
    const ids = [...new Set(cards.map(card => card.project_id))]
    if (!ids.length) return new Map()
    const [projects, documents] = await Promise.all([
      this.db.query<{ id: string; sources: Source[] }>("SELECT id,input->'sources' AS sources FROM projects WHERE id=ANY($1::text[]) AND owner_id=$2", [ids, ownerId]),
      this.db.query<ParsedDocument>('SELECT d.id,d.project_id,d.file_name,d.sha256,d.parser_result,d.created_at FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.project_id=ANY($1::text[]) AND p.owner_id=$2 ORDER BY d.project_id,d.created_at,d.id', [ids, ownerId]),
    ])
    const result = new Map(projects.rows.map(project => [project.id, { sources: project.sources, documents: [] as ParsedDocument[] }]))
    for (const document of documents.rows) result.get(document.project_id)?.documents.push(document)
    return result
  }
  async searchKnowledge(ownerId: string, filter: KnowledgeFilter): Promise<ExperienceCard[]> {
    const accepted: ExperienceCard[] = [], limit = Math.max(1, Math.min(filter.limit || 2000, 2000))
    let offset = 0
    while (true) {
      const result = await this.db.query<{ payload: ExperienceCard }>(`
      SELECT h.payload FROM experience_cards c JOIN projects p ON p.id=c.project_id
      JOIN LATERAL (
        SELECT payload,recorded_at FROM experience_history h0
        WHERE h0.card_id=c.id AND h0.recorded_at <= $1::timestamptz
        ORDER BY h0.revision DESC LIMIT 1
      ) h ON true
      WHERE p.owner_id=$2 AND (p.input->>'synthetic')::boolean=$3 AND h.payload->>'status'='approved'
      AND h.payload->'knowledge'->>'kind' IN ('case','rule')
      AND ($4::text='' OR h.payload->'knowledge'->>'measure_key'=$4)
      AND ($5::text='' OR c.project_id<>$5 OR ($7::boolean AND h.payload->'knowledge'->>'kind'='rule'))
      ORDER BY h.recorded_at DESC,c.id LIMIT 100 OFFSET $6`, [`${filter.as_of}T23:59:59.999Z`, ownerId, filter.synthetic, filter.measure_key || '', filter.exclude_project || '', offset,!!filter.include_project_rules])
      const cards = result.rows.map(row => row.payload)
      if (!cards.length) break
      if (offset >= 2000) throw new ExperienceError(422, 'KNOWLEDGE_SEARCH_TOO_BROAD', '知识候选超过本轮2000项核验预算，请按举措编号缩小范围后匹配；不能将未检索部分当作未命中。')
      const materials = await this.knowledgeMaterials(ownerId, cards)
      const qualified = cards.flatMap(card => {
        const material = materials.get(card.project_id)
        if (!material) return []
        try {
          const draft = normalizeDraft({ title: card.title, project_type: card.project_type, development_mode: card.development_mode, stage: card.stage, fields: card.fields, knowledge: card.knowledge })
          validateEvidence(draft, material.documents, card.project_id)
          if (filter.mode === 'automatic') {
            const references = [...card.fields.flatMap(field => field.evidence), ...[...(card.knowledge?.conditions || []), ...(card.knowledge?.exclusions || [])].flatMap(condition => condition.evidence)]
            const byId = new Map(material.documents.map(document => [document.id, document]))
            if (!references.length || references.some(evidence => {
              const document = byId.get(evidence.document_id)
              return !document || originalSource(document, material.sources)?.visibility !== 'public'
            })) return []
            const publicCard = publicKnowledgeCard(card, material.documents)
            return publicCard ? [publicCard] : []
          }
          return [card]
        } catch { return [] } // Stale hashes, fabricated locators and invalid historical payloads cannot route decisions.
      })
      accepted.push(...qualified)
      offset += cards.length
      if (cards.length < 100) break
    }
    return accepted.slice(0, limit)
  }
}
