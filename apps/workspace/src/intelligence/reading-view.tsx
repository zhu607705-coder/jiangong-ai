import React from 'react'

/** A read-only view of the existing list/detail response. Never updates a Source,
 * classification, event link or score, and never initiates a request. */
export interface ReadingItem {
  title: string
  url: string
  status: string
  published_at: string | null
  date_status?: string
  score: number | null
  analysis?: {
    status?: string
    scores?: number[]
    structure?: { locator_quote?: string | null }
  }
}
const ccgpHost = (url: string): boolean => {
  try { const host = new URL(url).hostname.toLowerCase(); return host === 'ccgp.gov.cn' || host.endsWith('.ccgp.gov.cn') }
  catch { return false }
}

/** Strip a known publisher trailer only, not arbitrary text after a dash.
 * The persisted title and the source link remain unchanged. */
export function readingTitle(title: string, url: string): string {
  if (!ccgpHost(url)) return title
  const cleaned = title.replace(/\s*[_|｜—–-]+\s*中国政府采购网(?:\s*[_|｜—–-]+\s*中华人民共和国财政部唯一指定政府采购信息网络发布媒体)?\s*$/, '').trim()
  return cleaned || title
}
export function publisherLabel(url: string): string {
  if (ccgpHost(url)) return '中国政府采购网'
  try { return new URL(url).hostname }
  catch { return '原始来源' }
}

type NoticeKind = { label: string; basis: string }
/** Document kinds describe this notice, NOT the latest state of the project. */
export function noticeKind(title: string, url: string): NoticeKind {
  const clean = readingTitle(title, url).replace(/[（(](?:第[一二三四五六七八九十\d]+次|重新招标)[）)]$/, '').trim()
  const rules: [RegExp, string][] = [
    [/中标候选人.{0,12}(?:公示|公告)$/, '候选人公示'],
    [/(?:更正|变更|澄清).{0,12}公告$/, '更正公告'],
    [/(?:终止|废标|流标).{0,12}公告$/, '终止 / 废标公告'],
    [/合同.{0,8}(?:公告|公示)$/, '合同公告'],
    [/成交(?:结果)?公告$/, '成交结果'],
    [/中标(?:[（(]成交[）)])?(?:结果)?公告$/, '中标结果'],
    [/采购意向(?:公开|公告|公示)?$/, '采购意向'],
    [/公开招标公告$/, '招标公告'],
    [/(?:竞争性磋商|竞争性谈判|询价|单一来源|采购)公告$/, '采购公告'],
  ]
  const titleKind = rules.find(([pattern]) => pattern.test(clean))?.[1]
  let columnKind: string | undefined
  if (ccgpHost(url)) {
    const code = new URL(url).pathname.match(/^\/cggg\/(?:zygg|dfgg)\/(gkzb|jzxcs|jzxtp|cjgg|zbgg|gzgg)\//)?.[1]
    columnKind = code && ({ gkzb: '招标公告', jzxcs: '采购公告', jzxtp: '采购公告', cjgg: '成交结果', zbgg: '中标结果', gzgg: '更正公告' } as Record<string, string>)[code]
  }
  if (titleKind && columnKind && titleKind !== columnKind) return { label: '公告类型待核', basis: '原始标题与来源栏目不同' }
  return { label: titleKind || columnKind || '公开资料', basis: titleKind ? '按原始标题识别' : columnKind ? '按来源栏目识别' : '未识别公告类型' }
}
export function publicationLabel(item: Pick<ReadingItem, 'published_at' | 'date_status'>): string {
  if (!item.published_at) return '发布日期未载'
  const value = item.published_at
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/)
  if (!day) return '日期待核'
  const check = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])))
  if (check.toISOString().slice(0, 10) !== day[0].replace(/T$/, '')) return '日期待核'
  if (item.date_status === 'conflict' || item.date_status === 'undated') return '日期待核'
  const stamp = new Date(value)
  if (!Number.isFinite(stamp.getTime())) return '日期待核'
  const displayed = value.length === 10 ? value : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(stamp)
  return `${item.date_status === 'search_only' ? '索引日期' : '发布'} ${displayed}`
}
const workflow: Record<string, string> = { unscored: 'AI 待分类', ready: 'AI 已分类', needs_review: 'AI 待核', failed: 'AI 未完成', irrelevant: 'AI 已排除' }
export function NoticeMeta({ item }: { item: ReadingItem }) {
  const kind = noticeKind(item.title, item.url)
  return <div className="intel-reading-meta">
    <strong title={kind.basis}>{kind.label}</strong>
    <span>{publicationLabel(item)}</span>
    <span className="intel-reading-workflow">{workflow[item.status] || 'AI 状态待核'}</span>
  </div>
}
const scoreValue = (score: unknown): score is number => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100
export function ReadingEvidence({ item }: { item: ReadingItem }) {
  const ready = item.status === 'ready' && (!item.analysis?.status || item.analysis.status === 'ready')
  const scores = item.analysis?.scores || []
  const quote = ready ? item.analysis?.structure?.locator_quote : null
  if (!ready) return null
  return <section className="intel-reading-evidence" aria-label="阅读优先级与分类引文">
    {scoreValue(item.score) && <div className="intel-reading-score"><span>阅读优先级</span><strong>{item.score}<small> / 100</small></strong></div>}
    {scores.length === 2 && scores.every(scoreValue) && <p className="intel-reading-score-runs">两次评分：{scores[0]} / {scores[1]}</p>}
    {quote && <div className="intel-reading-quote"><strong>分类引文</strong><blockquote>{quote}</blockquote></div>}
  </section>
}
