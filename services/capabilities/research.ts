import { Context } from '@deepseek-ai/cordis'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { createHash } from 'node:crypto'
import { mountPublicWeb } from '../../runtime/dsh/public-web'
import type { ProjectInput, ResearchTrace, Source } from '../../apps/host/generated/contracts'
import { classifyPublicSource, publicSearchPlan, type PublicSourceTier } from '../../packages/research/public-sources'
import { resolveScope } from './scope'

export function visibleText(html: string, url: string): string {
  const { document } = parseHTML(html)
  document.querySelectorAll('script,style,noscript,iframe,form').forEach(node => node.remove())
  const article = new Readability(document as unknown as Document, { charThreshold: 100 }).parse()
  return (article?.textContent || document.body?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 30000)
}

type SearchHit = { url: string; title?: string; snippet?: string; publishedAt?: string; tier: PublicSourceTier; catalogId: string | null }
const tierRank: Record<PublicSourceTier, number> = { primary_database: 0, official_publication: 1, supplementary: 2 }

/**
 * Public research uses DSH Search across the web, but source selection is evidence-first:
 * public databases and official systems are fetched before general web material.
 */
export async function collectPublicEvidence(project: ProjectInput, signal: AbortSignal): Promise<{ sources: Source[]; trace: ResearchTrace; scope?: ProjectInput['scope'] }> {
  if (project.synthetic) return { sources: [], trace: { status: 'not_applicable', queries: [], source_ids: [], warnings: [], reused: false } }
  const ctx = new Context(), sources: Source[] = [], warnings: string[] = []
  const region = project.scope.name.replace(/[\r\n<>]/g, ' ').slice(0, 100)
  const plan = publicSearchPlan(region)
  // One query per decision need keeps latency bounded; DSH still searches the full web.
  // The second query is a documented fallback for a later gap-research round.
  const queries = plan.map(need => need.queries[0])
  const found = new Map<string, SearchHit>()
  try {
    await mountPublicWeb(ctx)
    const resolved = await resolveScope(ctx, project, signal)
    if (resolved.source) sources.push(resolved.source)
    if (resolved.warning) warnings.push(resolved.warning)

    for (const query of queries) {
      try {
        const result = await ctx.web.search({ query, maxResults: 4 }, signal)
        for (const source of result.sources) {
          const parsed = new URL(source.url)
          if (!['http:', 'https:'].includes(parsed.protocol)) continue
          const authority = classifyPublicSource(source.url)
          const previous = found.get(source.url)
          const hit = { ...source, tier: authority.tier, catalogId: authority.catalog_id }
          if (!previous || tierRank[hit.tier] < tierRank[previous.tier]) found.set(source.url, hit)
        }
      } catch { warnings.push('一轮公开检索未成功，相关资料缺口已保留。') }
    }

    const ranked = [...found.values()].sort((a, b) => tierRank[a.tier] - tierRank[b.tier])
    const selected = [
      ...ranked.filter(hit => hit.tier !== 'supplementary').slice(0, 8),
      ...ranked.filter(hit => hit.tier === 'supplementary').slice(0, 2),
    ]

    for (const hit of selected) {
      const id = `PUB-${createHash('sha256').update(hit.url).digest('hex').slice(0, 14)}`
      let text = hit.snippet || '', contentStatus: Source['content_status'] = text ? 'excerpt' : 'metadata_only'
      try {
        const response = await ctx.web.fetch({ url: hit.url }, signal)
        if (response.statusCode >= 200 && response.statusCode < 300) {
          text = response.body.kind === 'html' ? visibleText(response.body.content, hit.url) : response.body.content.slice(0, 30000)
          contentStatus = text ? 'full_text' : 'metadata_only'
          if (response.truncated) warnings.push(`来源 ${id} 原文被长度上限截断。`)
        } else warnings.push(`来源 ${id} 原文 HTTP ${response.statusCode}。`)
      } catch {
        // Search snippets remain useful as a lead, but never become full-text evidence.
        warnings.push(`来源 ${id} 原文未取得，保留搜索摘要。`)
      }
      sources.push({
        id,
        title: hit.title || new URL(hit.url).hostname,
        url: hit.url,
        data_class: 'public',
        visibility: 'public',
        synthetic: false,
        untrusted_text: text,
        content_status: contentStatus,
        retrieved_at: new Date().toISOString(),
        ...(hit.publishedAt ? { published_at: hit.publishedAt } : {}),
        hash: createHash('sha256').update(text).digest('hex'),
        locator: `${hit.tier}:${hit.catalogId || 'web'}:${hit.url}`,
      })
    }

    const usable = sources.some(s => s.content_status !== 'metadata_only')
    return {
      sources,
      scope: resolved.scope,
      trace: {
        status: usable ? warnings.length ? 'partial' : 'success' : 'partial',
        queries,
        source_ids: sources.map(s => s.id),
        warnings,
        reused: false,
      },
    }
  } finally { await ctx.fiber.dispose() }
}
