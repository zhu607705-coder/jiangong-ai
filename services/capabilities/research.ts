import { Context } from '@deepseek-ai/cordis'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { createHash, randomUUID } from 'node:crypto'
import { mountPublicWeb } from '../../runtime/dsh/public-web'
import { LiveSession } from '../../runtime/dsh/live-session'
import { config } from '../../apps/host/config'
import type { ProjectInput, ResearchTrace, Source } from '../../apps/host/generated/contracts'
import { classifyPublicSource, publicSearchPlan, PUBLIC_SOURCE_CATALOG, type PublicSourceTier } from '../../packages/research/public-sources'
import { resolveScope } from './scope'

export function visibleText(html: string, url: string): string {
  const { document } = parseHTML(html)
  document.querySelectorAll('script,style,noscript,iframe,form').forEach(node => node.remove())
  const article = new Readability(document as unknown as Document, { charThreshold: 100 }).parse()
  return (article?.textContent || document.body?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 30000)
}

type SearchHit = { url: string; title?: string; snippet?: string; publishedAt?: string; tier: PublicSourceTier; catalogId: string | null }
const tierRank: Record<PublicSourceTier, number> = { primary_database: 0, official_publication: 1, supplementary: 2 }

async function dshSearchQueries(project: ProjectInput, region: string, signal: AbortSignal): Promise<string[]> {
  const fallback = publicSearchPlan(region).map(need => need.queries[0]).slice(0, 6)
  if (!config.modelConfigured) return fallback
  const allowedFacts = [...new Set(project.facts.filter(f => project.sources.find(s => s.id === f.source_id)?.visibility === 'public').map(f => f.kind))].slice(0, 20)
  const catalog = PUBLIC_SOURCE_CATALOG.map(item => ({ name: item.name, domains: item.domains, uses: item.uses }))
  const live = await LiveSession.open('RESEARCH-PLAN-' + randomUUID(), signal)
  try {
    const prompt = '你负责为建造前投资研判规划公开资料检索。研究范围：' + region + '。当前已有公开事实类型：' + JSON.stringify(allowedFacts) +
      '。优先从公开数据库和官方业务系统核实事实，再用开放式全网查询补充最新公告、运营和反证。可用来源目录：' + JSON.stringify(catalog) +
      '。生成4–6条互补搜索式，每条都必须包含“' + region + '”，避免同义重复；至少3条面向官方数据库或政府系统，最多2条开放式全网查询。只规划会改变实施路径的资料，不做城市百科式搜索。使用ResearchTrace结构返回：status=partial，queries填写检索式，source_ids=[]，warnings=[]，reused=false。'
    const result = await live.call<ResearchTrace>('research_plan', prompt, 'ResearchTrace')
    const queries = [...new Set(result.value.queries.map(q => q.replace(/[\r\n<>]/g, ' ').trim()).filter(q => q.includes(region) && q.length >= region.length + 2 && q.length <= 180))].slice(0, 6)
    return queries.length >= 3 ? queries : fallback
  } catch {
    signal.throwIfAborted()
    return fallback
  } finally { await live.close() }
}

/**
 * DSH plans evidence-gap queries and DSH Search executes them across the web.
 * Public databases and official systems are fetched before general web material.
 */
export async function collectPublicEvidence(project: ProjectInput, signal: AbortSignal): Promise<{ sources: Source[]; trace: ResearchTrace; scope?: ProjectInput['scope'] }> {
  if (project.synthetic) return { sources: [], trace: { status: 'not_applicable', queries: [], source_ids: [], warnings: [], reused: false } }
  const ctx = new Context(), sources: Source[] = [], warnings: string[] = []
  const region = project.scope.name.replace(/[\r\n<>]/g, ' ').slice(0, 100)
  const queries = await dshSearchQueries(project, region, signal)
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
