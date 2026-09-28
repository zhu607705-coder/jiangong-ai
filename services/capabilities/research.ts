import { Context } from '@deepseek-ai/cordis'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { createHash } from 'node:crypto'
import { mountPublicWeb } from '../../runtime/dsh/public-web'
import type { ProjectInput, ResearchTrace, Source } from '../../apps/host/generated/contracts'
import { resolveScope } from './scope'

export function visibleText(html: string, url: string): string {
  const { document } = parseHTML(html)
  document.querySelectorAll('script,style,noscript,iframe,form').forEach(node => node.remove())
  const article = new Readability(document as unknown as Document, { charThreshold: 100 }).parse()
  return (article?.textContent || document.body?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 30000)
}

/** Only region names explicitly supplied for public research enter external queries. */
export async function collectPublicEvidence(project: ProjectInput, signal: AbortSignal): Promise<{ sources: Source[]; trace: ResearchTrace; scope?: ProjectInput['scope'] }> {
  if (project.synthetic) return { sources: [], trace: { status: 'not_applicable', queries: [], source_ids: [], warnings: ['合成项目不向互联网搜索虚构片区，模型只使用显式合成输入。'], reused: false } }
  const ctx = new Context(), sources: Source[] = [], warnings: string[] = []
  const region = project.scope.name.replace(/[\r\n<>]/g, ' ').slice(0, 100)
  const queries = [`${region} 存量建筑 城市更新 规划 site:gov.cn`, `${region} 公共服务 产业 运营需求 现状 site:gov.cn`]
  const found = new Map<string, { url: string; title?: string; snippet?: string; publishedAt?: string }>()
  try {
    await mountPublicWeb(ctx)
    const resolved = await resolveScope(ctx, project, signal)
    if (resolved.source) sources.push(resolved.source)
    if (resolved.warning) warnings.push(resolved.warning)
    for (const query of queries) {
      try {
        const result = await ctx.web.search({ query, maxResults: 3 }, signal)
        for (const source of result.sources) {
          const parsed = new URL(source.url)
          if (!['http:', 'https:'].includes(parsed.protocol)) continue
          if (!(parsed.hostname.endsWith('.gov.cn') || parsed.hostname === 'gov.cn')) continue
          found.set(source.url, source)
        }
      } catch { warnings.push('一轮原生搜索未成功或超时；本轮缺口保持未知。') }
    }
    for (const hit of [...found.values()].slice(0, 5)) {
      const id = `PUB-${createHash('sha256').update(hit.url).digest('hex').slice(0, 14)}`
      let text = hit.snippet || '', contentStatus: Source['content_status'] = text ? 'excerpt' : 'metadata_only'
      try {
        const response = await ctx.web.fetch({ url: hit.url }, signal)
        if (response.statusCode >= 200 && response.statusCode < 300) {
          text = response.body.kind === 'html' ? visibleText(response.body.content, hit.url) : response.body.content.slice(0, 30000)
          contentStatus = text ? 'full_text' : 'metadata_only'
          if (response.truncated) warnings.push(`来源 ${id} 原文被长度上限截断。`)
        } else warnings.push(`来源 ${id} 原文 HTTP ${response.statusCode}，不把标题当正文证据。`)
      } catch { warnings.push(`来源 ${id} 原文获取未成功，保留可用摘要或元数据，不推断正文内容。`) }
      sources.push({ id, title: hit.title || new URL(hit.url).hostname, url: hit.url, data_class: 'public', visibility: 'public', synthetic: false,
        untrusted_text: text, content_status: contentStatus, retrieved_at: new Date().toISOString(), ...(hit.publishedAt ? { published_at: hit.publishedAt } : {}),
        hash: createHash('sha256').update(text).digest('hex'), locator: hit.url })
    }
    return { sources, scope: resolved.scope, trace: { status: sources.some(s => s.content_status !== 'metadata_only') ? warnings.length ? 'partial' : 'success' : 'partial', queries, source_ids: sources.map(s => s.id), warnings: [...warnings, '公开检索不保证城市资料完整性；政策原文不直接等同于本项目适用或许可。'], reused: false } }
  } finally { await ctx.fiber.dispose() }
}
