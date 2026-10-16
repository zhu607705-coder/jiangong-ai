import {createHash} from 'node:crypto'
import type {Database,ProjectRecord} from '../../apps/host/store'
import type {RagSemanticIndex} from '../../apps/host/generated/contracts'
import type {RetrievalCandidate} from './retrieval'

export const RAG_INDEX_POLICY='dsh-concept-windows-v1'
export type SemanticWindow={id:string;candidate_id:string;version:string;locator:string;start:number;end:number;text:string;title:string}
export type SemanticEntry=RagSemanticIndex['entries'][number]&{candidate_id:string;version:string;locator:string;start:number;end:number}

/** Indexes describe original windows; summaries never replace evidence or become project facts. */
export function semanticWindows(candidates:RetrievalCandidate[]):SemanticWindow[] {
  return candidates.flatMap(candidate=>{
    const windows:SemanticWindow[]=[]
    for(let start=0;start<candidate.text.length;start+=3800) {
      const end=Math.min(start+4000,candidate.text.length)
      const id='W-'+createHash('sha256').update(JSON.stringify([candidate.id,candidate.version,candidate.text,start,end,RAG_INDEX_POLICY])).digest('hex')
      windows.push({id,candidate_id:candidate.id,version:candidate.version,locator:candidate.locator,start,end,text:candidate.text.slice(start,end),title:candidate.file_name})
      if(end===candidate.text.length)break
    }
    return windows
  })
}

export class SemanticIndexRepository {
  private ready:Promise<unknown>|undefined
  constructor(private db:Database){}
  private initialize(){return this.ready??=this.db.exec(`CREATE TABLE IF NOT EXISTS project_rag_semantic_index (
    owner_id TEXT NOT NULL,project_id TEXT NOT NULL,window_id TEXT NOT NULL,model TEXT NOT NULL,policy TEXT NOT NULL,
    payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id,project_id,window_id,model,policy))`)}
  async load(project:ProjectRecord,windows:SemanticWindow[],model:string):Promise<SemanticEntry[]> {
    await this.initialize()
    if(!windows.length)return []
    const rows=await this.db.query<{payload:SemanticEntry}>(`SELECT payload FROM project_rag_semantic_index
      WHERE owner_id=$1 AND project_id=$2 AND window_id=ANY($3::text[]) AND model=$4 AND policy=$5`,
      [project.owner_id,project.id,windows.map(window=>window.id),model,RAG_INDEX_POLICY])
    return rows.rows.map(row=>row.payload)
  }
  async save(project:ProjectRecord,entry:SemanticEntry,model:string) {
    await this.initialize()
    await this.db.query(`INSERT INTO project_rag_semantic_index(owner_id,project_id,window_id,model,policy,payload)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[project.owner_id,project.id,entry.source_id,model,RAG_INDEX_POLICY,JSON.stringify(entry)])
  }
}
