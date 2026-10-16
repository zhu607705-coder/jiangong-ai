import type { RenewalModeGateCheck } from '../../../../packages/retrofit/renewal-mode'

export type DecisionTone = 'danger' | 'warning' | 'success' | 'neutral'

/** Presentation of the existing gate; a triggered necessity means a structural concern. */
export function renewalCheckEmphasis(check: RenewalModeGateCheck): { tone: DecisionTone; label: string } {
  if (check.state === 'conflict') return { tone: 'danger', label: '记录冲突' }
  if (check.state === 'unknown') return { tone: 'warning', label: '待核实' }
  if (check.group === 'necessity') return check.state === 'met'
    ? { tone: 'danger', label: '拆建必要性已触发' }
    : { tone: 'success', label: '未触发拆建必要性' }
  return check.state === 'met'
    ? { tone: 'success', label: '已满足' }
    : { tone: 'danger', label: '未满足' }
}

/** Uses the dashboard's existing five ordinal levels, never an approval threshold. */
export function dimensionEmphasis(value: number | null | undefined): { tone: DecisionTone; label: string } {
  if (value == null || !Number.isFinite(value)) return { tone: 'neutral', label: '待评价' }
  const level = Math.round(value)
  return level <= 2 ? { tone: 'danger', label: '弱项' }
    : level === 3 ? { tone: 'warning', label: '中等适配' }
      : { tone: 'success', label: '较高适配' }
}
