import type { DistilledSkill, FactorPolicy } from '../../apps/host/generated/contracts'
import type { Database } from '../../apps/host/store'
import { ExperienceError } from './errors'

const migration = `
CREATE TABLE IF NOT EXISTS knowledge_policies (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL,
  payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge_policy_history (
  id TEXT NOT NULL REFERENCES knowledge_policies(id), revision INTEGER NOT NULL, payload JSONB NOT NULL,
  action TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(id,revision)
);
CREATE TABLE IF NOT EXISTS knowledge_skills (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL,
  payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge_skill_history (
  id TEXT NOT NULL REFERENCES knowledge_skills(id), revision INTEGER NOT NULL, payload JSONB NOT NULL,
  action TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(id,revision)
);
CREATE TABLE IF NOT EXISTS knowledge_learning_windows (
  project_id TEXT NOT NULL REFERENCES projects(id), owner_id TEXT NOT NULL, document_id TEXT NOT NULL,
  document_hash TEXT NOT NULL, window_hash TEXT NOT NULL, card_ids JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(project_id,document_id,document_hash,window_hash)
);
CREATE INDEX IF NOT EXISTS knowledge_policies_project ON knowledge_policies(project_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_skills_project ON knowledge_skills(project_id,updated_at DESC);
`

/** These records use the application's one owned database and revision protocol. */
export class KnowledgeRepository {
  constructor(readonly db: Database) {}
  async initialize() { await this.db.exec(migration) }
  async policies(projectId: string): Promise<FactorPolicy[]> {
    return (await this.db.query<{ payload: FactorPolicy }>('SELECT payload FROM knowledge_policies WHERE project_id=$1 ORDER BY updated_at DESC,id', [projectId])).rows.map(row => row.payload)
  }
  async policy(projectId: string, id: string, db = this.db): Promise<FactorPolicy | null> {
    return (await db.query<{ payload: FactorPolicy }>('SELECT payload FROM knowledge_policies WHERE project_id=$1 AND id=$2', [projectId, id])).rows[0]?.payload || null
  }
  async approvedPolicy(projectId: string): Promise<FactorPolicy | null> {
    return (await this.policies(projectId)).find(policy => policy.status === 'approved') || null
  }
  async savePolicy(value: FactorPolicy, expected: number | undefined, action: string, actor: string): Promise<FactorPolicy> {
    return this.save('policies', 'policy', value, expected, action, actor)
  }
  async skills(projectId: string): Promise<DistilledSkill[]> {
    return (await this.db.query<{ payload: DistilledSkill }>('SELECT payload FROM knowledge_skills WHERE project_id=$1 ORDER BY updated_at DESC,id', [projectId])).rows.map(row => row.payload)
  }
  async skill(projectId: string, id: string): Promise<DistilledSkill | null> {
    return (await this.db.query<{ payload: DistilledSkill }>('SELECT payload FROM knowledge_skills WHERE project_id=$1 AND id=$2', [projectId, id])).rows[0]?.payload || null
  }
  async approvedSkills(owner: string): Promise<DistilledSkill[]> {
    return (await this.db.query<{ payload: DistilledSkill }>(`SELECT s.payload FROM knowledge_skills s JOIN projects p ON p.id=s.project_id WHERE p.owner_id=$1 AND s.payload->>'status'='approved' ORDER BY s.id`, [owner])).rows.map(row => row.payload)
  }
  async saveSkill(value: DistilledSkill, expected: number | undefined, action: string, actor: string): Promise<DistilledSkill> {
    return this.save('skills', 'skill', value, expected, action, actor)
  }
  async history(kind: 'policy' | 'skill', projectId: string, id: string) {
    const table = kind === 'policy' ? 'knowledge_policies' : 'knowledge_skills'
    const history = kind === 'policy' ? 'knowledge_policy_history' : 'knowledge_skill_history'
    return (await this.db.query(`SELECT h.revision,h.payload,h.action,h.actor,h.recorded_at FROM ${history} h JOIN ${table} r ON r.id=h.id WHERE r.project_id=$1 AND h.id=$2 ORDER BY h.revision DESC`, [projectId, id])).rows
  }
  private async save<T extends FactorPolicy | DistilledSkill>(kind: 'policies' | 'skills', historyKind: 'policy' | 'skill', value: T, expected: number | undefined, action: string, actor: string): Promise<T> {
    const table = kind === 'policies' ? 'knowledge_policies' : 'knowledge_skills'
    const history = historyKind === 'policy' ? 'knowledge_policy_history' : 'knowledge_skill_history'
    return this.db.transaction(async db => {
      const old = (await db.query<{ revision: number }>(`SELECT revision FROM ${table} WHERE id=$1 AND project_id=$2 FOR UPDATE`, [value.id, value.project_id])).rows[0]
      if (expected === undefined && old || expected !== undefined && (!old || old.revision !== expected)) throw new ExperienceError(409, 'KNOWLEDGE_VERSION_CONFLICT', '记录版本已变化，请刷新后重试。')
      if (old) {
        const updated = await db.query(`UPDATE ${table} SET payload=$1,revision=$2,updated_at=now() WHERE id=$3 AND project_id=$4 AND revision=$5 RETURNING id`, [JSON.stringify(value), value.revision, value.id, value.project_id, expected])
        if (!updated.rows.length) throw new ExperienceError(409, 'KNOWLEDGE_VERSION_CONFLICT', '记录版本已变化。')
      } else await db.query(`INSERT INTO ${table}(id,project_id,revision,payload) VALUES($1,$2,$3,$4)`, [value.id, value.project_id, value.revision, JSON.stringify(value)])
      await db.query(`INSERT INTO ${history}(id,revision,payload,action,actor) VALUES($1,$2,$3,$4,$5)`, [value.id, value.revision, JSON.stringify(value), action, actor])
      return value
    })
  }
}
