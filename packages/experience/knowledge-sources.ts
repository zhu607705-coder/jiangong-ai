import type { ExperienceEvidence, ProjectInput, Source } from '../../apps/host/generated/contracts'
import { hash } from '../intelligence/domain'
import { originalSource } from './repository'
import type { ParsedDocument } from './document-slices'

/** Additional reviewed knowledge uses the same original-citation envelope as case cards. */
export function reviewedKnowledgeSource(id: string, title: string, value: unknown, references: ExperienceEvidence[], documents: ParsedDocument[], sources: Source[], synthetic: ProjectInput['synthetic']): Source {
  const byId = new Map(documents.map(document => [document.id, document]))
  const citations = [...new Map(references.map(evidence => {
    const document = byId.get(evidence.document_id), source = document ? originalSource(document, sources) : undefined
    return [[evidence.document_id, evidence.version, evidence.locator, evidence.quote].join('|'), { ...evidence,
      original_source: source ? { id: source.id, visibility: source.visibility, hash: source.hash, locator: source.locator, url: source.url } : null }] as const
  })).values()]
  const visibility = citations.length > 0 && citations.every(cite => cite.original_source?.visibility === 'public') ? 'public' : 'internal'
  const text = JSON.stringify({ value, citations, boundary: '复核的方法参考；不替代当前项目事实、工程许可或专业鉴定。' })
  return { id, title, visibility, data_class: synthetic ? 'synthetic' : visibility === 'public' ? 'public' : 'internal', synthetic,
    untrusted_text: text, hash: hash(text), locator: `knowledge:${id}`, content_status: 'excerpt' }
}
