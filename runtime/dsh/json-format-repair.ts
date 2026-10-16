import schema from '../../packages/contracts/schema.json'

/** Formatting only: retain JSON.parse as the parser and never fill missing data. */
export function repairStructuredToolJson(raw: string): { value: Record<string, unknown>; edits: string[] } | null {
  if (raw.length > 250000) return null
  try { JSON.parse(raw); return null } catch { /* Only malformed tool arguments enter recovery. */ }
  let text = raw.trim().replace(/^\uFEFF/, '')
  const edits = new Set<string>()
  const fence = /^```(?:json)?\s*\n([\s\S]*)\n```$/i.exec(text)
  if (fence) { text = fence[1]; edits.add('outer_json_fence') }
  let output = '', inString = false, escaped = false, embeddedQuote = false, key = false, previous = ''
  const stack: string[] = []
  const next = (at: number) => { while (at < text.length && /\s/.test(text[at])) at++; return text[at] || '' }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) { output += char; escaped = false; continue }
      if (char === '\\') { output += char; escaped = true; continue }
      if (char === '"') {
        if (!key && (embeddedQuote || /[\p{L}\p{N}]/u.test(next(i + 1)))) {
          output += '\\"'; embeddedQuote = !embeddedQuote; edits.add('escaped_inner_quotes'); continue
        }
        output += char; inString = false; previous = 'string'; continue
      }
      if (char.charCodeAt(0) < 32) { output += JSON.stringify(char).slice(1, -1); edits.add('escaped_control_character') }
      else output += char
      continue
    }
    if (char === '"') {
      inString = true; key = stack.at(-1) === '{' && (previous === '{' || previous === ',')
    } else if (char === ',' && ['}', ']'].includes(next(i + 1))) {
      edits.add('trailing_comma'); continue
    } else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return null
    }
    output += char
    if (!/\s/.test(char)) previous = char
  }
  if (inString || escaped || embeddedQuote || stack.length || !edits.size) return null
  try {
    const value: unknown = JSON.parse(output)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return { value: value as Record<string, unknown>, edits: [...edits] }
  } catch { return null }
}

/** Group narrative list items without deleting text or changing evidence/parameter arrays. */
export function normalizeResearchNoteLayout(type: string, value: unknown): { value: unknown; edits: string[] } {
  if(type!=='RenewalResearchNote'||!value||typeof value!=='object'||!Array.isArray((value as Record<string,unknown>).reasoned_proposals))return {value,edits:[]}
  const copy=structuredClone(value) as Record<string,unknown>,edits:string[]=[]
  const limits=schema.definitions.RenewalResearchNote.properties.reasoned_proposals.items.properties
  for(const [index,row] of (copy.reasoned_proposals as unknown[]).entries()) {
    if(!row||typeof row!=='object')continue
    for(const field of ['premises','assumptions'] as const) {
      const original=(row as Record<string,unknown>)[field],limit=limits[field]
      if(!Array.isArray(original)||original.length<=limit.maxItems||!original.every(item=>typeof item==='string'&&item.trim()))continue
      const grouped=[...original] as string[]
      while(grouped.length>limit.maxItems) {
        let at=-1,shortest=Infinity
        for(let i=0;i<grouped.length-1;i++) {
          const length=[...`${grouped[i]}；${grouped[i+1]}`].length
          if(length<=limit.items.maxLength&&length<shortest){at=i;shortest=length}
        }
        if(at<0)break
        grouped.splice(at,2,`${grouped[at]}；${grouped[at+1]}`)
      }
      if(grouped.length<=limit.maxItems){(row as Record<string,unknown>)[field]=grouped;edits.push(`reasoned_proposals[${index}].${field}`)}
    }
  }
  return {value:copy,edits}
}
