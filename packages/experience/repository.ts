import { randomUUID } from 'node:crypto'
import type { ExperienceCard, ExperienceDraft } from '../../apps/host/generated/contracts'
import type { Database } from '../../apps/host/store'
import { searchExpression, searchTokens } from '../intelligence/domain'
import { ExperienceError, type ParsedDocument } from './domain'

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
`
const searchable = (draft: ExperienceDraft) => searchTokens([draft.title, draft.project_type, draft.development_mode, draft.stage, ...draft.fields.map(field => field.value || '')].join(' ')).join(' ')
export type SearchFilter = { q?: string; project_type?: string; development_mode?: string; stage?: string; as_of?: string; exclude_project?: string; synthetic?: boolean; limit?: number }

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
  async list(projectId: string, query = '', status = ''): Promise<ExperienceCard[]> {
    const rows = await this.db.query<{ payload: ExperienceCard }>(`
      SELECT c.payload FROM experience_cards c JOIN experience_history h ON h.card_id=c.id AND h.revision=c.revision
      WHERE c.project_id=$1 AND ($2::text='' OR c.payload->>'status'=$2)
      AND ($3::text='' OR h.search_vector @@ to_tsquery('simple',$3))
      ORDER BY c.updated_at DESC,c.id LIMIT 200`, [projectId, status, searchExpression(query)])
    return rows.rows.map(row => row.payload)
  }
  async create(projectId: string, drafts: ExperienceDraft[], reviewer: string): Promise<ExperienceCard[]> {
    return this.db.transaction(async db => {
      const cards: ExperienceCard[] = []
      for (const draft of drafts) {
        const clock = new Date().toISOString()
        const card: ExperienceCard = { ...draft, id: `EXP-${randomUUID()}`, project_id: projectId, status: 'draft', revision: 1, review_note: null, created_at: clock, updated_at: clock }
        await db.query('INSERT INTO experience_cards(id,project_id,revision,payload) VALUES($1,$2,$3,$4)', [card.id, projectId, 1, JSON.stringify(card)])
        await this.history(db, card, 'create', reviewer)
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
      ORDER BY CASE WHEN $8::text='' THEN 0 ELSE ts_rank_cd(h.search_vector,to_tsquery('simple',$8)) END DESC,h.recorded_at DESC,c.id
      LIMIT $9`, [cutoff, ownerId, Boolean(filter.synthetic), filter.project_type || '', filter.development_mode || '', filter.stage || '', filter.exclude_project || '', searchExpression(filter.q || ''), Math.min(filter.limit || 30, 100)])
    return result.rows.map(row => row.payload)
  }
}
