import { useEffect, useState } from 'react'
import { IconX, IconRefresh, IconArrowUpRight } from '@tabler/icons-react'
import { api } from '../api'
import type { MapDataCatalog } from '../../../host/generated/contracts'
import IntelligencePanel from '../intelligence/IntelligencePanel'

export default function DataSourcesPanel({onClose, onOpenProject}: {onClose: () => void; onOpenProject: (id: string) => void}) {
  const [catalog, setCatalog] = useState<MapDataCatalog | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [section,setSection]=useState<'projects'|'intelligence'>('projects')
  useEffect(() => {
    const controller = new AbortController(); setError('')
    api<MapDataCatalog>('/maps/data', undefined, controller.signal).then(setCatalog).catch(e => {if (!controller.signal.aborted) setError(e.message)})
    return () => controller.abort()
  }, [retry])
  return <aside className="map-data-panel glass-panel" aria-label="项目与数据来源">
    <header><div><small>DATA / 真实资料</small><h2>项目与数据</h2></div><button className="map-icon-button" onClick={onClose} aria-label="关闭项目数据"><IconX size={18} /></button></header>
    <nav className="intel-tabs" aria-label="项目数据与情报"><button className={section==='projects'?'is-active':''} onClick={()=>setSection('projects')}>项目资料</button><button className={section==='intelligence'?'is-active':''} onClick={()=>setSection('intelligence')}>资料检索</button></nav>
    {section==='intelligence'?<IntelligencePanel onOpenProject={onOpenProject}/>:<>
    <p>现有项目与可取得的资料，在同一处核对覆盖、来源和缺口。</p>
    {!catalog && !error && <p role="status">正在读取当前授权项目库…</p>}
    {error && <p role="alert">{error}</p>}
    {catalog && <>
      <div className="data-counts"><div><strong>{catalog.real_project_count}</strong><span>真实研究项目</span></div><div><strong>{catalog.projects.reduce((n,p) => n+p.public_source_count,0)}</strong><span>项目关联公开来源</span></div></div>
      <p className="data-scope-note">{catalog.synthetic_project_count} 个合成样例已排除 · {catalog.unlocated_project_count} 个项目未提供地图定位</p>
      <h3>已有项目</h3>
      {catalog.projects.length ? catalog.projects.map(p => <article key={p.project_id}>
        <button className="data-project-link" onClick={() => onOpenProject(p.project_id)}><strong>{p.name}</strong><IconArrowUpRight size={16} /></button>
        <p>{p.scope_label} · {p.located ? '已提供地图定位' : '未提供精确定位'}</p>
        <dl><div><dt>公开 / 内部来源</dt><dd>{p.public_source_count} / {p.internal_source_count}</dd></div><div><dt>结构化事实 / 上传文件</dt><dd>{p.fact_count} / {p.document_count}</dd></div><div><dt>项目更新时间</dt><dd>{p.updated_at.slice(0,10)}</dd></div></dl>
        <small>打开项目可查看原文、上传材料，并使用现有研究流程定向补查。</small>
      </article>) : <p>尚无真实项目。可从地图选点建立研究，并导入项目材料。</p>}
      <h3>当前能够获取的数据</h3>
      <ul className="data-availability"><li><strong>高德地图与场所</strong><span>位置、类别、周边记录、3D 楼块；按选区抓取并缓存。</span></li><li><strong>公开政府资料</strong><span>复用已完成研究的原文、来源和时间；新项目研究可定向检索。</span></li><li><strong>企业与项目文件</strong><span>已接 TXT、MD、CSV、PDF、DOCX、XLSX 导入；内部原文保留在项目中。</span></li></ul>
      <div className="data-gap"><strong>仍需接入</strong><p>交易与租赁样本、获取和改造成本、产权、建筑条件、运营需求。当前没有这些数据时不展示地价趋势、IRR 或综合投资评分。</p></div>
      <details><summary>数据口径</summary>{catalog.notes.map(note => <p key={note}>{note}</p>)}</details>
    </>}
    <button className="map-text-button" onClick={() => setRetry(v => v+1)}><IconRefresh size={14} />重新读取项目数据</button>
    </>}
  </aside>
}
