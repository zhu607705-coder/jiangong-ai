import type { DecisionPacket, ProjectInput, RuntimeEvent } from '../../host/generated/contracts'
export type { DecisionPacket, ProjectInput, RuntimeEvent }
export type Project = { id: string; name: string; context_version: number; input: ProjectInput; runs?: Run[] }
export type Run = { id: string; revision: number; context_version: number; status: string; decision: DecisionPacket | null; error_code: string | null }
export type Diff = { available: boolean; from_revision: number | null; to_revision: number | null; changes: { path_id: string; title: string; field: string; before: unknown; after: unknown; rule_refs: string[] }[]; reused?: string[]; invalidated?: string[] }
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'haizhizi' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || `请求失败 (${response.status})`) }
  return response.json()
}
