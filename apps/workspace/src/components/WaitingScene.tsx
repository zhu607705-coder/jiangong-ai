import { useEffect, useRef, useState } from 'react'
import './WaitingScene.css'

type WaitingVariant = 'boot' | 'map' | 'research'

type WaitingMotifProps = {
  variant: WaitingVariant
  stageKey?: string
  active?: boolean
}

type WaitingSceneProps = WaitingMotifProps & {
  title: string
  detail?: string
  compact?: boolean
}

// Suppress waits that finish before the animation would be useful.
function useDelayedAppearance() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 250)
    return () => window.clearTimeout(timer)
  }, [])
  return visible
}

function MotifArt({ variant, stageKey, active = true }: WaitingMotifProps) {
  const previousStage = useRef(stageKey)
  const [pageTurn, setPageTurn] = useState(0)

  useEffect(() => {
    if (active && previousStage.current !== undefined && stageKey !== undefined && previousStage.current !== stageKey) {
      setPageTurn(turn => turn + 1)
    }
    previousStage.current = stageKey
  }, [active, stageKey])

  return <span className={`waiting-motif waiting-motif--${variant}${active ? '' : ' waiting-is-idle'}`} aria-hidden="true">
    <svg className="waiting-street-plan" viewBox="0 0 192 120" fill="none" focusable="false">
      <path className="waiting-blocks" d="M8 31h31V13h31m58 6h45v22M14 111h42m78 0h43M17 52h24m116 32h27M81 17v18m91 64v13" />
      <rect className="waiting-block" x="19" y="55" width="23" height="16" rx="2" />
      <rect className="waiting-block" x="129" y="77" width="30" height="18" rx="2" />
      <path className="waiting-route-base" d="M18 92H50V64H78V76H112V50H154" />
      <path className="waiting-route-line" d="M18 92H50V64H78V76H112V50H154" />
      <g className="waiting-route-cursor">
        <circle className="waiting-cursor-glow" r="9" />
        <circle className="waiting-cursor-core" r="3.4" />
      </g>
    </svg>
    <span className="waiting-orbit">
      <span className="waiting-sheet-stack">
        <span className="waiting-sheet-back" />
        <span key={pageTurn} className={`waiting-sheet${pageTurn ? ' waiting-sheet--turn' : ''}`}>
          <i /><i /><i />
        </span>
      </span>
    </span>
  </span>
}

export function WaitingMotif(props: WaitingMotifProps) {
  const visible = useDelayedAppearance()
  return visible ? <MotifArt {...props} /> : null
}

export default function WaitingScene({ variant, title, detail, stageKey, compact = false, active = true }: WaitingSceneProps) {
  const visible = useDelayedAppearance()
  return <section className={`waiting-scene waiting-scene--${variant}${compact ? ' waiting-scene--compact' : ''}${active ? '' : ' waiting-is-idle'}${visible ? ' waiting-scene--visible' : ''}`} role="status" aria-live="polite" aria-atomic="true">
    <span className="waiting-art-slot" aria-hidden="true">{visible && <MotifArt variant={variant} stageKey={stageKey} active={active} />}</span>
    <span className="waiting-copy">
      <strong className="waiting-title">{title}</strong>
      {detail && <span className="waiting-detail">{detail}</span>}
    </span>
  </section>
}
