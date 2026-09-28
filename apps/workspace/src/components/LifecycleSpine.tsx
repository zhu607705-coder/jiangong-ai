// Adapted from CRE dashboard/src/components/workspace/LifecycleSpine.tsx (Apache-2.0).
// Domain stages, Chinese labels and local styling replace acquisition-specific types.
import { IconCheck } from '@tabler/icons-react'
export type Stage = { id: string; label: string; detail: string; done: boolean }
export default function LifecycleSpine({ stages, activeStageId, onFocusStage }: { stages: Stage[]; activeStageId: string; onFocusStage: (id: string) => void }) {
  return <nav className="lifecycle" aria-label="研判工作区">
    {stages.map((stage, index) => <button key={stage.id} className={stage.id === activeStageId ? 'stage active' : 'stage'} aria-current={stage.id === activeStageId ? 'page' : undefined} onClick={() => onFocusStage(stage.id)}>
      <span className={stage.done ? 'stage-dot done' : 'stage-dot'} aria-hidden="true">{stage.done ? <IconCheck size={12} /> : String(index + 1).padStart(2, '0')}</span>
      <span><strong>{stage.label}</strong><small>{stage.detail}</small></span>
    </button>)}
  </nav>
}
