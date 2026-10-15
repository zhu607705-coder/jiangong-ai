import type { OperationsInput, OperationsSnapshot } from '../../../host/generated/contracts'
import type { StrategyDirection } from './strategy-direction-text'

const markers = { comprehensive: '【研究方向：综合整治】', rebuild: '【研究方向：原拆原建】' }
export function markOperationsDirection(input: OperationsInput, direction: StrategyDirection): OperationsInput {
  const scope = input.scope_note.split(/\r?\n/).filter(line => !Object.values(markers).includes(line))
  return { ...input, scope_note: [markers[direction], ...scope].join('\n') }
}
export function operationsSnapshotMatchesDirection(snapshot: OperationsSnapshot, direction: StrategyDirection, projectId: string, revision: number): boolean {
  const marked = snapshot.input.scope_note.split(/\r?\n/).filter(line => Object.values(markers).includes(line))
  return snapshot.project_id === projectId && snapshot.context_version === revision && marked.length === 1 && marked[0] === markers[direction]
}
