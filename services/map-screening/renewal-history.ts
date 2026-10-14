import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ConstructionCostLibrary } from '../../packages/construction-costs/library'
import type { ModeHistory } from '../../packages/retrofit/renewal-mode'

/** Uses the already imported workbook snapshot and the existing official cost library. */
export async function renewalHistory(library: ConstructionCostLibrary, root = process.cwd()): Promise<ModeHistory> {
  const snapshot = JSON.parse(await readFile(resolve(root, 'data/imports/renewal-database-20261014/history-records.json'), 'utf8'))
  const rows = snapshot.records as { id: string; project_name: string; city: string | null; province: string | null; year: number | null; work_type_original: string | null;
    amounts_yuan: Record<string, number | null>; verification: { review_status: string }; source: { locator: string; document_id: string; amount_url: string | null } }[]
  const provinces: Record<string, number> = {}
  for (const row of rows) if (row.province) provinces[row.province] = (provinces[row.province] || 0) + 1
  const official = await library.search({})
  return { snapshot_date: snapshot.snapshot_date, total: rows.length, provinces,
    contract_count: rows.filter(row => row.amounts_yuan.contract_price !== null).length,
    settlement_count: rows.filter(row => row.amounts_yuan.settlement !== null).length,
    records: rows.filter(row => /浙工新村|凤南一村|彭一小区|彭浦新村/.test(row.project_name)).slice(0, 12).map(row => ({ id: row.id, project_name: row.project_name,
      city: row.city, year: row.year, work_type: row.work_type_original, amounts_yuan: row.amounts_yuan, locator: row.source.locator,
      document_id: row.source.document_id, review_status: row.verification.review_status, url: row.source.amount_url })),
    official_costs: official.items.filter(row => /浙工新村|凤南一村|彭一小区|彭浦新村/.test(row.project_name)).slice(0, 12).map(row => ({
      id: row.id, project_name: row.project_name, city: row.city, amount_yuan: row.amount_yuan, amount_kind: row.amount_kind,
      scope: row.scope_quote || null, url: row.source.url, date: row.contract_date || row.notice_date,
    })) }
}
