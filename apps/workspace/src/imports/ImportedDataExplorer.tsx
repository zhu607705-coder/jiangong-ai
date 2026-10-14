import { useEffect, useMemo, useState } from 'react'
import type { Fact, MapScreenProfile, Source } from '../../../host/generated/contracts'
import { api } from '../api'
import DocumentEvidenceLineage from './DocumentEvidenceLineage'
import CrossDocumentMeasures from './CrossDocumentMeasures'
import { normalizeImportDocument, type ImportDocument } from './graph-model'
import type { EvidenceFocusLocation } from './evidence-focus'
import './evidence-decision-map.css'

type Props = {projectId:string;projectName:string;revision:number;sources:Source[];researchSources:Source[];facts:Fact[];profile?:MapScreenProfile;asOf?:string;onEvidence?:(refs:string[])=>void;focusLocation?:EvidenceFocusLocation}

/** File/quote views reuse the stored parser; decisions are shown separately above. */
export default function ImportedDataExplorer({projectId,revision,sources,researchSources,onEvidence,focusLocation}:Props) {
  const [loaded,setLoaded]=useState<{key:string;rows:ImportDocument[];error:string}>({key:'',rows:[],error:''})
  const key=`${projectId}:${revision}`
  useEffect(()=>{const controller=new AbortController();setLoaded({key:'',rows:[],error:''})
    void api<ImportDocument[]>(`/projects/${encodeURIComponent(projectId)}/documents`,undefined,controller.signal).then(rows=>{if(!controller.signal.aborted)setLoaded({key,rows,error:''})}).catch(error=>{if(!controller.signal.aborted)setLoaded({key,rows:[],error:error instanceof Error?error.message:'资料读取未完成。'})});return()=>controller.abort()
  },[key,projectId])
  const rows=loaded.key===key?loaded.rows:[]
  const documents=useMemo(()=>rows.map(normalizeImportDocument),[rows])
  const allSources=useMemo(()=>[...new Map([...sources,...researchSources].map(source=>[source.id,source])).values()],[sources,researchSources])
  return <section aria-label="材料、原文与举措对应">
    <CrossDocumentMeasures projectId={projectId} revision={revision} documents={documents} rawDocuments={rows} sources={allSources} onEvidence={onEvidence}/>
    <DocumentEvidenceLineage projectId={projectId} revision={revision} documents={documents} sources={allSources} onEvidence={onEvidence} focusLocation={focusLocation}/>
    <section className="import-file-list" aria-label="导入文件与数据预览"><header><h3>文件与数据预览</h3><p>{documents.length} 份导入文件 · 原文、表格和定位分别保留；全部解析内容可通过上方 Markdown / JSON 导出。</p></header>
      {loaded.key!==key&&<p role="status">正在读取导入文件…</p>}{loaded.error&&<p role="alert">{loaded.error}</p>}
      {documents.map(document=><details key={document.id} open={focusLocation?.documentId===document.id}><summary>{document.fileName} · {document.format} · {document.tables.length} 张表 / {document.segments.length} 个原文段</summary><p>材料版本：{document.hash||'未登记'} · 解析状态：{document.status}</p>
        {document.tables.map(table=><details key={table.id}><summary>{table.label} · {table.rowCount} 行 / {table.columnCount} 列</summary><div className="file-table-scroll"><table><thead><tr><th>原行</th>{table.columns.slice(0,14).map(column=><th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{table.previewRows.slice(0,10).map(row=><tr key={row.rowNumber}><td>{row.rowNumber}</td>{table.columns.slice(0,14).map(column=><td key={column.name}>{row.values[column.name]||''}</td>)}</tr>)}</tbody></table></div><p>预览最多10行、14列；完整数据保留在解析快照与导出中。</p></details>)}
        {document.segments.slice(0,12).map((segment,index)=><details key={index}><summary>原文 · {segment.locator}</summary><blockquote>{segment.text}</blockquote></details>)}
      </details>)}
      {!documents.length&&loaded.key===key&&!loaded.error&&<p>本项目未上传文件；下方保留已取得的公开资料与来源。</p>}
    </section>
  </section>
}
