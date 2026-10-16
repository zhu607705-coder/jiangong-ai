import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import './strategy-content-notice.css'

export default function StrategyContentNotice({packet}:{packet:StrategyPacket}) {
  const review=packet.content_review
  if(!review?.issues.length) return null
  return <aside className="strategy-content-notice" aria-label="方案待核清单">
    <div><strong>方案已生成 · {review.issues.length} 项待核</strong><span>可以继续查看、比较和测算。</span></div>
    <details><summary>查看待核清单</summary><ul>{review.issues.map(issue=><li key={`${issue.code}:${issue.path}`}><span>{issue.message}</span><code>{issue.path}</code></li>)}</ul></details>
    {!!review.follow_up?.search_queries.length&&<div className="strategy-follow-up"><strong>下一步搜索与阅读</strong>{review.follow_up.search_queries.map(query=><p key={query}>{query}<a href={`https://www.bing.com/search?q=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">检索公开资料 ↗</a></p>)}</div>}
    {review.follow_up?.reading_focus.map(text=><p key={text}>{text}</p>)}
    {!!review.follow_up?.internal_data.length&&<details><summary>需要内部补充的资料</summary><ul>{review.follow_up.internal_data.map(text=><li key={text}>{text}</li>)}</ul></details>}
    {review.recovered_from&&<p>已恢复本轮实际模型输出，原失败记录保留。</p>}
  </aside>
}
