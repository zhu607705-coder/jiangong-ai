import type { Source } from '../../apps/host/generated/contracts'

/** Admission identifies a candidate original; the operator must still check its scope and figures. */
export function isOperationsOriginal(source: Source): boolean {
  return !source.synthetic && !['synthetic', 'semi_synthetic'].includes(source.data_class)
    && !!source.untrusted_text?.trim() && ['uploaded', 'full_text'].includes(source.content_status || '')
    && !/(?:AI.{0,8}(?:草稿|模拟|生成)|合成(?:数据|演示|样本)|模拟(?:数据|台账)|情景(?:模拟|演示))/i.test(source.title)
}
