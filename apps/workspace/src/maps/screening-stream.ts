import type { MapScreenBounds, MapScreenCell, MapScreenProfile, MapScreenResult, MapScreenTheme } from '../../../host/generated/contracts'

export type ScreenEvent = { type: 'start'; id: string; cells: MapScreenCell[] } | { type: 'cell'; cell: MapScreenCell; completed: number; total: number } | { type: 'complete'; result: MapScreenResult } | { type: 'error'; message: string }
export async function scanMap(bounds: MapScreenBounds, profile: MapScreenProfile, theme: MapScreenTheme, signal: AbortSignal, receive: (event: ScreenEvent) => void) {
  const response = await fetch('/api/maps/screening/scan', { method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'haizhizi' }, body: JSON.stringify({ bounds, profile, theme }) })
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || '区域筛选未启动。')
  }
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', terminal = false
  const consume = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as ScreenEvent
    if (event.type === 'complete' || event.type === 'error') terminal = true
    receive(event)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const lines = pending.split('\n'); pending = lines.pop()!
      lines.forEach(consume)
      if (done) break
    }
    if (pending.trim()) consume(pending)
    if (!terminal && !signal.aborted) throw new Error('区域筛选连接提前结束，请重试。')
  } finally { await reader.cancel().catch(() => undefined) }
}
