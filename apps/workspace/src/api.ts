import type { DecisionPacket, ProjectInput, RuntimeEvent } from '../../host/generated/contracts'
export type { DecisionPacket, ProjectInput, RuntimeEvent }
export type Project = { id: string; name: string; context_version: number; input: ProjectInput; runs?: Run[] }
export type Run = { id: string; revision: number; context_version: number; status: string; decision: DecisionPacket | null; error_code: string | null }
export type Diff = { available: boolean; from_revision: number | null; to_revision: number | null; changes: { path_id: string; title: string; field: string; before: unknown; after: unknown; rule_refs: string[] }[]; reused?: string[]; invalidated?: string[] }
const pendingReads = new Map<string, Promise<unknown>>()
export const ADMIN_LOGIN_REQUIRED_EVENT = 'haizhizi:admin-login-required'
export const ADMIN_LOGIN_REQUESTED_EVENT = 'haizhizi:admin-login-requested'
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'haizhizi' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(ADMIN_LOGIN_REQUIRED_EVENT))
    if (response.status === 403 && error.code === 'ADMIN_REQUIRED' && body !== undefined && typeof window !== 'undefined') window.dispatchEvent(new Event(ADMIN_LOGIN_REQUESTED_EVENT))
    if (response.status === 403 && error.code === 'ADMIN_REQUIRED') throw new Error('此操作需要管理员登录，公开浏览为只读模式。')
    throw new Error(error.detail || `请求失败 (${response.status})`)
  }
  return response.json()
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (body !== undefined) pendingReads.clear()
  if (body !== undefined || signal) return request<T>(path, body, signal)
  let pending = pendingReads.get(path)
  if (!pending) {
    pending = request<T>(path)
    pendingReads.set(path, pending)
    const active = pending
    void active.finally(() => { if (pendingReads.get(path) === active) pendingReads.delete(path) }).catch(() => {})
  }
  // Share transport only while in flight; callers retain separate mutable snapshots.
  return structuredClone(await pending) as T
}
