import { useEffect, useRef, useState } from 'react'

export function useAnalysisMotion() {
  const [reduced, setReduced] = useState(false)
  const [userReduced, setUserReduced] = useState(false)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(preference.matches)
    change(); preference.addEventListener('change', change)
    return () => preference.removeEventListener('change', change)
  }, [])
  return { enabled: !reduced && !userReduced, userReduced, setUserReduced }
}

/** Display interpolation only. Source values, tooltips and accessible labels retain exact results. */
export function useAnimatedValues(target: (number | null)[], enabled: boolean, duration = 650) {
  const [displayed, setDisplayed] = useState(target)
  const current = useRef(target)
  const signature = target.join('|')
  useEffect(() => {
    if (!enabled) { current.current = target; setDisplayed(target); return }
    const initial = current.current, start = performance.now()
    let frame: number
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration), eased = 1 - (1 - progress) ** 3
      const values = target.map((end, index) => end === null ? null : (initial[index] ?? end) + (end - (initial[index] ?? end)) * eased)
      current.current = values; setDisplayed(values)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [signature, enabled, duration])
  return enabled ? displayed : target
}

export function AnimatedNumber({ value, enabled, decimals = 0 }: { value: number; enabled: boolean; decimals?: number }) {
  const [shown, setShown] = useState(enabled ? 0 : value)
  const current = useRef(enabled ? 0 : value)
  useEffect(() => {
    if (!enabled) { current.current = value; setShown(value); return }
    const start = performance.now(), initial = current.current
    let frame: number
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 700)
      const next = initial + (value - initial) * (1 - (1 - progress) ** 3)
      current.current = next; setShown(next)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, enabled])
  return <span aria-label={value.toLocaleString('zh-CN', { maximumFractionDigits: decimals })} aria-live="off">{shown.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>
}
