import { IconScan, IconX, IconChevronDown, IconDatabase } from '@tabler/icons-react'
import { useState } from 'react'
import { SCREEN_THEMES, SCREEN_TIERS } from '../../../../packages/maps/screening-policy'
import type { MapScreenCell, MapScreenTheme, MapScreenResult } from '../../../host/generated/contracts'

export default function ScreeningControls({ theme, onTheme, running, completed, cells, result, error, onScan, onCancel, onClear, onCell, onData, enabled, stale }: {
  theme: MapScreenTheme; onTheme: (p: MapScreenTheme) => void; running: boolean; completed: number; cells: MapScreenCell[];
  result: MapScreenResult | null; error: string; onScan: () => void; onCancel: () => void; onClear: () => void;
  onCell: (cell: MapScreenCell) => void; onData: () => void; enabled: boolean; stale: boolean;
}) {
  const [methodOpen, setMethodOpen] = useState(false)
  return <section className="screening-controls glass-panel" aria-label="地图快速筛选">
    <div className="screening-control-row"><select aria-label="地图标色专题" value={theme} disabled={running} onChange={e => onTheme(e.target.value as MapScreenTheme)}>{Object.entries(SCREEN_THEMES).filter(([id])=>id!=='access').map(([id,p]) => <option value={id} key={id}>{p.label}</option>)}</select>
      <button className="screening-start" disabled={!enabled || running} onClick={onScan}><IconScan size={17} />{running ? '正在读取…' : '一键标色'}</button>
      <button aria-label="项目数据" title="项目数据" onClick={onData}><IconDatabase size={18} /></button></div>
    {running && <div className="screening-progress"><progress aria-label="区块读取进度" max={cells.length || 1} value={cells.length?completed:undefined} /><button onClick={onCancel}>停止</button></div>}
    {(result || error) && <div className="screening-results-summary">
      {error && <p role="status">{error}</p>}
      {result && <><div className="screening-legend">{(['strong','moderate','sparse','incomplete'] as const).map(tier => <span key={tier}><i style={{background:SCREEN_TIERS[tier].color}} />{SCREEN_TIERS[tier].label}</span>)}</div>
        {!cells.length && <p>暂无街区边界，可点选建筑研判。</p>}
        {stale && <p>已保留上次范围</p>}
        <div className="screening-tools"><button onClick={() => setMethodOpen(v => !v)} aria-expanded={methodOpen}>标色依据 <IconChevronDown size={14} /></button><button onClick={onClear}>清除</button></div>
      </>}
    </div>}
    {result?.notes.some(n => n.includes("OpenStreetMap")) && <a className="map-boundary-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
    {methodOpen && <div className="screening-method"><p>按项目范围、道路水系与建筑轮廓划分。颜色读取当前方案的六维研判；灰色对象点选后研究。</p><p>切换维度复用本轮资料。适配度≥3.5为优先研究，≤2为调整路径；综合视图需六维齐全，明确阻点优先。</p>{result?.notes.map((note,i)=><p key={i}>{note}</p>)}<div className="screening-cell-list">{cells.map(c=><button key={c.id} onClick={()=>onCell(c)}>{c.label}</button>)}</div></div>}
  </section>
}
