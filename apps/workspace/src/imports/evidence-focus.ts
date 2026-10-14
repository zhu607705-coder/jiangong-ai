import type { ActionChunk } from '../../../host/generated/contracts'
import type { ParsedDocument } from './graph-model'

export type EvidenceFocusLocation = {documentId:string; version:string; locator:string; quote?:string; token?:number}

export function evidenceFocusKey(location: EvidenceFocusLocation) {
  return JSON.stringify([location.documentId,location.version,location.locator,location.quote || '',location.token ?? null])
}

/** Navigation uses the same source identity as citation binding; it never substitutes another document version. */
export function resolveEvidenceFocus(document: ParsedDocument | undefined, chunks: ActionChunk[], location: EvidenceFocusLocation):
  {status:'matched'; chunk:ActionChunk; locator:string; quote:string; alias:boolean} | {status:'document-missing'|'version-mismatch'|'not-found'|'quote-mismatch'} {
  if (!document || document.id !== location.documentId) return {status:'document-missing'}
  if (!location.version || document.hash !== location.version) return {status:'version-mismatch'}
  const candidates = chunks.filter(chunk => chunk.document_id === location.documentId && chunk.document_version === location.version)
  if (!candidates.length && chunks.some(chunk=>chunk.document_id===location.documentId && chunk.document_version!==location.version)) return {status:'version-mismatch'}
  const locatorCandidates = [{locator:location.locator,alias:false}]
  const tableLocator = /^table:(\d+)\/row:(\d+)$/.exec(location.locator)
  if (tableLocator && ['md','txt'].includes(document.format)) {
    const row = document.tables[Number(tableLocator[1])-1]?.previewRows.find(row=>row.rowNumber===Number(tableLocator[2]))
    // Only the parser's exact Line/Text mirror qualifies; identical text in another row is not an alias.
    if (row && Object.keys(row.values).length === 2 && Object.keys(row.values).every(key=>key==='Line'||key==='Text')
      && /^\d+$/.test(row.values.Line) && Number(row.values.Line)>0) {
      const canonical = `line:${Number(row.values.Line)}`
      const quotes = [...new Set(candidates.flatMap(chunk => chunk.spans.filter(span => span.document_id === document.id && span.version === location.version
        && span.locator === canonical && !!span.quote.trim()).map(span=>span.quote)))]
      const covered = Array.from({length:row.values.Text.length},()=>false)
      for (const quote of quotes) {
        for (let start=row.values.Text.indexOf(quote);start>=0;start=row.values.Text.indexOf(quote,start+1)) {
          for (let index=start;index<start+quote.length;index++) covered[index]=true
        }
      }
      const literalMirror = !!covered.length && covered.every((value,index)=>value || /\s/.test(row.values.Text[index]))
      if (literalMirror) locatorCandidates.unshift({locator:canonical,alias:true})
    }
  }
  let locatorExists = false
  for (const target of locatorCandidates) {
    const matches = candidates.flatMap(chunk => chunk.spans.filter(span=>span.document_id===location.documentId && span.version===location.version
      && span.locator===target.locator && !!span.quote.trim()).map(span=>({chunk,span})))
    if (matches.length) locatorExists = true
    const quote = location.quote?.trim()
    const matching = matches.filter(({span})=>!quote || span.quote.includes(quote) || quote.includes(span.quote))
      .sort((before,after)=>{
        if (!quote) return after.span.quote.length-before.span.quote.length
        const position = (text:string) => text === quote ? [-1,0] : quote.includes(text) ? [0,quote.indexOf(text)] : [1,text.indexOf(quote)]
        const from=position(before.span.quote), to=position(after.span.quote)
        return from[0]-to[0] || from[1]-to[1] || after.span.quote.length-before.span.quote.length
      })
    if (matching[0]) return {status:'matched',chunk:matching[0].chunk,locator:target.locator,quote:matching[0].span.quote,alias:target.alias}
  }
  return {status:locatorExists?'quote-mismatch':'not-found'}
}
