import { describe, expect, it } from 'vitest'
import type { OperationsInput, OperationsSnapshot } from '../../apps/host/generated/contracts'
import type { Store } from '../../apps/host/store'
import { OperationsService, operationsValues } from '../../packages/operations/service'
import { renderOperationsReport } from '../../packages/operations/report'
import evidence from '../../research/test_results/scientific-methods-results.json'

const service = new OperationsService({} as Store)
describe('scientific input provenance and report integration', () => {
  it('enumerates labelled time-block scalars rather than treating arrays as values', () => {
    const input = structuredClone(evidence.time_block_input) as OperationsInput
    const values = operationsValues(service.checkedInput(input))
    expect(values.some(row => Array.isArray(row.item))).toBe(false)
    expect(values.filter(row => row.label.includes('时段1'))).toHaveLength(3)
    expect(values.some(row => row.label === '活动服务 / available_slots')).toBe(false)
  })
  it('rejects future source dates inside a time block', () => {
    const input = structuredClone(evidence.time_block_input) as OperationsInput
    input.services[0].time_blocks![0].slots.as_of = '2099-01-01'
    expect(() => service.checkedInput(input)).toThrow('日期不能晚于今天')
  })
  it('rejects future sensitivity-range evidence dates', () => {
    const input = structuredClone(evidence.pressure_input) as OperationsInput
    input.analysis_bounds![0].as_of = '2099-01-01'
    expect(() => service.checkedInput(input)).toThrow('日期不能晚于今天')
  })
  it('exports backend switching values and tested range without inventing confidence claims', () => {
    const snapshot = { id: 'SCIENCE-REPORT-FIXTURE', project_id: 'FIXTURE', context_version: 0, input_hash: 'a'.repeat(64),
      created_at: '2026-10-13T00:00:00Z', input: evidence.pressure_input, result: evidence.pressure } as OperationsSnapshot
    const report = renderOperationsReport(snapshot, { scenarios: [snapshot], observations: [], comparisons: [] })
    expect(report).toContain('11.25')
    expect(report).toContain('1440')
    expect(report).toContain('参数敏感性')
    expect(report).toContain('最低结余参数')
    expect(report).toContain('待取得同一中心')
  })
})
