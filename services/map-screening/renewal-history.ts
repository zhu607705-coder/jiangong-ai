import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ConstructionCostLibrary } from '../../packages/construction-costs/library'
import type { ModeHistory,RenewalModeInput } from '../../packages/retrofit/renewal-mode'
import {rankHistory,caseContext} from '../../packages/retrofit/case-matching'

/** Uses the already imported workbook snapshot and the existing official cost library. */
export async function renewalHistory(library: ConstructionCostLibrary, root = process.cwd(),input?:RenewalModeInput): Promise<ModeHistory> {
  const snapshot = JSON.parse(await readFile(resolve(root, 'data/imports/renewal-database-20261014/history-records.json'), 'utf8'))
  const rows = snapshot.records as { id: string; project_name: string; city: string | null; province: string | null; year: number | null; work_type_original: string | null;
    renovation_scope_original?:string|null;amounts_yuan: Record<string, number | null>; verification: { review_status: string }; source: { locator: string; document_id: string; amount_url: string | null } }[]
  const provinces: Record<string, number> = {}
  for (const row of rows) if (row.province) provinces[row.province] = (provinces[row.province] || 0) + 1
  const official = await library.search({})
  return { snapshot_date: snapshot.snapshot_date, total: rows.length, provinces,
    contract_count: rows.filter(row => row.amounts_yuan.contract_price !== null).length,
    settlement_count: rows.filter(row => row.amounts_yuan.settlement !== null).length,
    records:rankHistory(rows.filter(row=>!row.year||row.year<=Number((input?.reference_as_of||new Date().toISOString()).slice(0,4))).map(row=>({...row,scope:row.renovation_scope_original||null})),input?caseContext(input):undefined,24).map(row => ({ id: row.id, project_name: row.project_name,
      city: row.city, year: row.year, work_type: row.work_type_original, amounts_yuan: row.amounts_yuan, locator: row.source.locator,
      document_id: row.source.document_id, review_status: row.verification.review_status, url: row.source.amount_url,scope:row.scope })),
    official_costs:rankHistory(official.items.filter(row=>!(row.source.published_at||row.notice_date)||String(row.source.published_at||row.notice_date).slice(0,10)<=(input?.reference_as_of||new Date().toISOString()).slice(0,10)).map(row=>({...row,scope:row.scope_quote||row.scale_quote||null})),input?caseContext(input):undefined,24).map(row => ({
      id: row.id, project_name: row.project_name, city: row.city, amount_yuan: row.amount_yuan, amount_kind: row.amount_kind,
      scope: row.scope, url: row.source.url, date: row.contract_date || row.notice_date || row.source.published_at,
    })) }
}
