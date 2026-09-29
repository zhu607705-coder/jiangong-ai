/**
 * Selective MIT port from KKKKhazix/AIHOT@589f79eff09470b31ba8a7f1d9eb62d36ff2be6c.
 * Copyright (c) 2026 数字生命卡兹克. See licenses/AIHOT-LICENSE.txt.
 * Sources: events/relate.ts, sources/json-list.ts, editorial/analyze.ts, events/hot.ts.
 * Patches: no AIHOT DB/config/runtime imports; string event IDs; explicit invalid-data rejection;
 * guarded property traversal; configurable windows (construction events are not 48h news).
 */
export const RELATIONS = ['SAME_OCCURRENCE', 'SAME_STORY', 'UNRELATED', 'ROUNDUP'] as const
export type Relation = typeof RELATIONS[number]
export interface Candidate { factId: string; storyId: string; storyRoot: boolean; score: number }
export interface Verdict { relation: Relation; confidence: number; note: string }

export function sameOccurrence(cands: Candidate[], verdicts: Map<string, Verdict>): Candidate[] {
  return cands.filter(c => verdicts.get(c.factId)?.relation === 'SAME_OCCURRENCE')
    .sort((a, b) => (verdicts.get(b.factId)!.confidence - verdicts.get(a.factId)!.confidence) || (b.score - a.score))
}
export function storyForDevelopment(cands: Candidate[], verdicts: Map<string, Verdict>): Candidate | null {
  return cands.filter(c => c.storyRoot && verdicts.get(c.factId)?.relation === 'SAME_STORY').sort((a, b) => b.score - a.score)[0] ?? null
}
export function firmlyTied(relation: string | undefined, confidence: number | undefined, minConfidence = 0.8): boolean {
  return (relation === 'SAME_OCCURRENCE' || relation === 'SAME_STORY') && (confidence ?? 0) >= minConfidence
}
export function reportText(title: string, summary: string | null | undefined): string {
  return `${title}。${(summary ?? '').slice(0, 300)}`
}
/** Upstream's lexical fallback, NOT a semantic embedding or evidence of event identity. */
export function lexicalSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const chars = [...s.replace(/\s+/g, '')]
    return new Set(chars.map((_c, i) => chars.slice(i, i + 2).join('')).filter(g => g.length === 2))
  }
  const g = grams(a), h = grams(b)
  if (!g.size || !h.size) return 0
  let inter = 0
  for (const x of g) if (h.has(x)) inter++
  return inter / Math.min(g.size, h.size)
}
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(seg)) return undefined
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)]
    else if (typeof cur === 'object' && Object.hasOwn(cur, seg)) cur = (cur as Record<string, unknown>)[seg]
    else return undefined
  }
  return cur
}
export function renderTemplate(template: string, item: unknown): string | null {
  let missing = false
  const out = template.replace(/\{(raw:)?([^}]+)\}/g, (_m, raw: string | undefined, path: string) => {
    const v = getPath(item, path)
    if (v === undefined || v === null || v === '' || typeof v === 'object') { missing = true; return '' }
    return raw ? String(v) : encodeURIComponent(String(v)).replace(/%2F/g, '/')
  })
  return missing ? null : out
}
/** Same prompt, separate invocations. This does not imply independent vendors or calibrated truth. */
export function selection(scores: readonly number[], threshold: number) {
  if (scores.length !== 2 || scores.some(s => !Number.isInteger(s) || s < 0 || s > 100) || !Number.isFinite(threshold))
    throw new Error('INVALID_SELECTION_SCORES')
  return { selected: scores[0] + scores[1] >= 2 * threshold, score: Math.floor((scores[0] + scores[1]) / 2), disagreement: Math.abs(scores[0] - scores[1]) }
}
/** Port of hot.ts's participant grouping / max(source time) / exponential decay. */
export function momentum(signals: { group: string; at: string | null }[], now: number, windowHours = 168, halfLifeHours = 72) {
  if (!(windowHours > 0 && halfLifeHours > 0 && Number.isFinite(now))) throw new Error('INVALID_MOMENTUM_WINDOW')
  const latest = new Map<string, number>()
  for (const s of signals) {
    const t = Date.parse(s.at ?? '')
    if (!s.group || !Number.isFinite(t) || t > now || t <= now - windowHours * 3600000) continue
    latest.set(s.group, Math.max(latest.get(s.group) ?? -Infinity, t))
  }
  let heat = 0
  for (const t of latest.values()) heat += Math.pow(0.5, (now - t) / 3600000 / halfLifeHours)
  return { participants: latest.size, heat: Math.round(heat * 1000) / 1000 }
}
