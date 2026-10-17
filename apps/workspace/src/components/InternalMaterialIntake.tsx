import { useState } from 'react'
import { IconUpload } from '@tabler/icons-react'
import './research-rounds.css'

export const MATERIAL_CATEGORIES = [
  ['resident_needs', '居民需求'], ['resident_satisfaction', '满意度调查'], ['structural_assessment', '结构与工程鉴定'],
  ['cost_funding', '预算与资金'], ['operations', '运营台账'], ['other', '其他项目资料'],
] as const
export type MaterialUploadMetadata = { material_category: typeof MATERIAL_CATEGORIES[number][0]; source_date?: string }

/** Only gathers form values; App owns the existing upload/parse/refresh request. */
export default function InternalMaterialIntake({ onUpload, disabled = false, compact = false, synthetic = false,initialCategory='resident_needs' }: {
  onUpload: (file: File, metadata: MaterialUploadMetadata) => Promise<void>; disabled?: boolean; compact?: boolean; synthetic?: boolean;initialCategory?:MaterialUploadMetadata['material_category'];
}) {
  const [category, setCategory] = useState<MaterialUploadMetadata['material_category']>(initialCategory)
  const [date, setDate] = useState('')
  return <div className={`internal-material-upload${compact ? ' is-compact' : ''}`}>
    {synthetic && <p><strong>合成演示项目：此处仅上传模拟资料，文件将标记为合成并与真实项目分开保存。</strong></p>}
    <div className="internal-material-fields">
      <label>资料类别<select aria-label="内部资料类别" value={category} disabled={disabled} onChange={event => setCategory(event.target.value as MaterialUploadMetadata['material_category'])}>{MATERIAL_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>资料形成日期<input type="date" aria-label="资料形成日期" value={date} disabled={disabled} onChange={event => setDate(event.target.value)}/></label>
      <label className={`secondary upload-button${disabled ? ' disabled' : ''}`}><IconUpload size={18}/>选择并上传文件<input type="file" aria-label="上传项目内部资料" accept=".md,.txt,.csv,.pdf,.docx,.xlsx" disabled={disabled} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void onUpload(file, { material_category: category, ...(date ? { source_date: date } : {}) })
      }}/></label>
    </div>
    {!compact && <p>可补充需求、满意度、鉴定、预算或运营文件。支持 TXT、Markdown、CSV、PDF、Word、Excel，单份不超过 10 MB；上传后保留为本项目内部资料。</p>}
  </div>
}
