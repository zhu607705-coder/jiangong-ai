// Selective Apache-2.0 port of CRE workpaper-renderer.js:table.
// Patch: escape user-provided pipes and newlines; retain no financial demo logic.
export function table(lines: string[], headers: string[], rows: unknown[][]) {
  const cell = (value: unknown) => String(value ?? '未知').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
  lines.push(`| ${headers.map(cell).join(' | ')} |`)
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`)
  rows.forEach(row => { lines.push(`| ${row.map(cell).join(' | ')} |`) })
}
