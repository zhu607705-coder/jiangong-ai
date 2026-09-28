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
  const metric = SCREEN_THEMES[theme], [low, high] = metric.breaks
  const legend = {strong: `≥${high}`, moderate: `${low}–${high-1}`, sparse: `1–${low-1}`, empty: '0', incomplete: '待补核'}
  return <section className="screening-controls glass-panel" aria-label="地图快速筛选">
    <div className="screening-heading"><strong>发现与筛选</strong><button onClick={onData}><IconDatabase size={14} />项目数据</button></div>
    <div className="screening-control-row"><span>标色专题</span><select aria-label="地图标色专题" value={theme} disabled={running} onChange={e => onTheme(e.target.value as MapScreenTheme)}>{Object.entries(SCREEN_THEMES).map(([id,p]) => <option value={id} key={id}>{p.label}</option>)}</select></div>
    <button className="screening-start" disabled={!enabled || running} onClick={onScan}><IconScan size={17} />{running ? `正在汇集 ${completed}/9 格…` : '一键标色 · 中心片区'}</button>
    {running && <div className="screening-progress"><progress max={9} value={completed} /><button onClick={onCancel}>停止</button></div>}
    {(cells.length > 0 || error) && <div className="screening-results-summary">
      <div className="screening-result-title"><strong>{result ? metric.label : running ? '已锁定本轮 3×3 范围' : '本轮未完成'}</strong><button aria-label="清除地图初筛" onClick={onClear}><IconX size={14} /></button></div>
      {error && <p className="screening-error" role="status">{error}</p>}
      {result && <>
        <div className="screening-legend">{(['strong','moderate','sparse','empty','incomplete'] as const).map(tier => <span key={tier}><i style={{background:SCREEN_TIERS[tier].color}} />{legend[tier]}{tier !== 'incomplete' ? metric.unit : ''}</span>)}</div>
        <p>{result.comparison_count}/9 格有该专题资料 · {new Date(result.created_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 快照</p>
        <div className="screening-cell-list">{result.cells.map(c => <button key={c.id} onClick={() => onCell(c)} aria-label={`${c.label} ${c.metric_value === null ? '待补核' : `${c.metric_value}${metric.unit}`}`}><i style={{background:SCREEN_TIERS[c.tier].color}} />{c.id}<b>{c.metric_value === null ? '—' : c.metric_value}</b></button>)}</div>
        {stale && <p className="screening-stale">视野已移动，筛选范围保持不变。再次标色才会更新范围。</p>}
      </>}
    </div>}
    <p className="screening-caption">{metric.note}</p>
    <button className="screening-method-toggle" onClick={() => setMethodOpen(v => !v)} aria-expanded={methodOpen}>范围与数据口径 <IconChevronDown size={12} /></button>
    {methodOpen && <div className="screening-method"><p>以点击时地图中心建立 3×3 分析格网，最大约 1.8×1.6 公里（随纬度变化）。格网不是法定地块。后续拖动地图不改变范围，不调用模型。</p><p>固定数量分级，不按当前最大值重新定色。不同面积或时点的网格不能直接比较密度。检索失败或超过完整性核验阈值时标灰，真实零条单独显示。</p><p>切换专题复用同一快照，不重新抓取。项目专题读取当前授权项目库，不包括城市级背景资料和合成测试记录。投资价值仍需交易、成本、需求与实施资料。</p></div>}
  </section>
}
