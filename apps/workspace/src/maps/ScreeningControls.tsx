import { IconScan, IconX, IconChevronDown, IconDatabase } from '@tabler/icons-react'
import { useState } from 'react'
import { screenThemes, screenTiers } from '../../../../packages/maps/screening-policy'
import type { MapScreenCell, MapScreenTheme, MapScreenResult, MapScreenProfile } from '../../../host/generated/contracts'

export default function ScreeningControls({ profile, onProfile, theme, onTheme, running, completed, cells, result, error, onScan, onCancel, onClear, onCell, onData, enabled, stale }: {
  profile:MapScreenProfile; onProfile:(profile:MapScreenProfile)=>void; theme: MapScreenTheme; onTheme: (p: MapScreenTheme) => void; running: boolean; completed: number; cells: MapScreenCell[];
  result: MapScreenResult | null; error: string; onScan: () => void; onCancel: () => void; onClear: () => void;
  onCell: (cell: MapScreenCell) => void; onData: () => void; enabled: boolean; stale: boolean;
}) {
  const [methodOpen, setMethodOpen] = useState(false)
  const neighborhood = profile === 'neighborhood'
  const tiers = screenTiers(profile)
  return <section className="screening-controls glass-panel" aria-label="地图快速筛选">
    <div className="screening-profile-row"><label>研究方向 <select aria-label="地图研究方向" value={profile} disabled={running} onChange={e=>onProfile(e.target.value as MapScreenProfile)}><option value="neighborhood">老旧小区改造</option><optgroup label="其他方向（历史通用）"><option value="balanced">片区更新</option><option value="commercial">商业配套</option><option value="enterprise">产业办公</option></optgroup></select></label></div>
    <div className="screening-control-row"><select aria-label="地图标色专题" value={theme} disabled={running} onChange={e => onTheme(e.target.value as MapScreenTheme)}>{Object.entries(screenThemes(profile)).filter(([id])=>id!=='access').map(([id,p]) => <option value={id} key={id}>{p.label}</option>)}</select>
      <button className="screening-start" disabled={!enabled || running} onClick={onScan}><IconScan size={17} />{running ? '正在读取…' : '一键标色'}</button>
      <button aria-label="项目数据" title="项目数据" onClick={onData}><IconDatabase size={18} /></button></div>
    {running && <div className="screening-progress"><progress aria-label="区块读取进度" max={cells.length || 1} value={cells.length?completed:undefined} /><button onClick={onCancel}>停止</button></div>}
    {(result || error) && <div className="screening-results-summary">
      {error && <p role="status">{error}</p>}
      {result && <><div className="screening-legend">{(['strong','moderate','sparse','incomplete'] as const).map(tier => <span key={tier}><i style={{background:tiers[tier].color}} />{tiers[tier].label}</span>)}</div>
        {!cells.length && <p>暂无街区边界，可框选区域或点选建筑研判。</p>}
        {result.status==='partial'&&result.notes.find(n=>/未返回|隔离/.test(n))&&<p role="status">{result.notes.find(n=>/未返回|隔离/.test(n))}</p>}
        {stale && <p>已保留上次范围</p>}
        <div className="screening-tools"><button onClick={() => setMethodOpen(v => !v)} aria-expanded={methodOpen}>标色依据 <IconChevronDown size={14} /></button><button onClick={onClear}>清除</button></div>
      </>}
    </div>}
    {result?.notes.some(n => n.includes("OpenStreetMap")) && <a className="map-boundary-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
    {methodOpen && <div className="screening-method"><p>按项目范围、道路水系与建筑轮廓划分。{neighborhood ? '颜色表示已关联项目的研究行动，依据项目研判时点；灰色对象尚未关联可用资料。' : '颜色读取当前方案的六维研判；灰色对象点选后研究。'}</p><p>{neighborhood ? '切换专题复用本轮资料。适配评分与资料覆盖分别查看，六维高分不能抵消已确认的否决条件；附近楼栋不继承整小区的确认。' : '切换维度复用本轮资料。适配度≥3.5为优先研究，≤2为调整路径；综合视图需六维齐全，明确阻点优先。'}</p>{result?.notes.map((note,i)=><p key={i}>{note}</p>)}<div className="screening-cell-list">{cells.map(c=><button key={c.id} onClick={()=>onCell(c)}>{c.label}</button>)}</div></div>}
  </section>
}
