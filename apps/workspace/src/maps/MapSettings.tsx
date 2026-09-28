import { useState } from 'react'
import { createPortal } from 'react-dom'
import { IconX, IconExternalLink, IconKey, IconCheck } from '@tabler/icons-react'
import { api } from '../api'
import type { MapConfiguration } from '../../../../packages/maps/types'

export default function MapSettings({ configured, onClose, onSaved }: { configured: boolean; onClose: () => void; onSaved: (value: MapConfiguration) => void }) {
  const [key, setKey] = useState(''), [code, setCode] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('')
  return createPortal(<div className="map-settings-backdrop" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
    <section className="map-settings" role="dialog" aria-modal="true" aria-labelledby="map-settings-title" onClick={e => e.stopPropagation()}>
      <div className="map-card-heading"><span className="map-eyebrow"><IconKey size={15} /> MAP CONNECTION</span><button className="map-icon-button" aria-label="关闭地图设置" onClick={onClose}><IconX size={19} /></button></div>
      <h2 id="map-settings-title">连接你的高德地图</h2>
      <p>连接后即可浏览真实道路、建筑楼块与卫星影像。</p>
      {configured && <div className="map-inline-note"><IconCheck size={15} /> 已保存配置；填写下方两项可更换。</div>}
      <form onSubmit={async e => {
        e.preventDefault(); setSaving(true); setError('')
        try { const config = await api<MapConfiguration>('/maps/config', { js_key: key.trim(), security_code: code.trim() }); setKey(''); setCode(''); onSaved(config) }
        catch (e) { setError(e instanceof Error ? e.message : '保存失败') }
        finally { setSaving(false) }
      }}>
        <label htmlFor="amap-js-key">Web 端（JS API）Key</label><input id="amap-js-key" type="password" autoFocus autoComplete="off" required value={key} onChange={e => setKey(e.target.value)} placeholder="高德开放平台的 JS API Key" />
        <label htmlFor="amap-security-code">配套安全密钥</label><input id="amap-security-code" type="password" autoComplete="off" required value={code} onChange={e => setCode(e.target.value)} placeholder="securityJsCode" />
        <small>安全密钥仅保存在本机服务端；这里不使用 DeepSeek API Key。</small>
        {error && <p className="map-error" role="alert">{error}</p>}
        <button type="submit" className="map-primary" disabled={saving || !key.trim() || !code.trim()}>{saving ? '正在保存…' : '保存并连接地图'}</button>
      </form>
      <a href="https://lbs.amap.com/api/javascript-api-v2/prepare" target="_blank" rel="noreferrer">在高德开放平台创建 Key <IconExternalLink size={14} /></a>
    </section>
  </div>, document.body)
}
