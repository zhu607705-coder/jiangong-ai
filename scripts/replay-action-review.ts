/** Revalidate an actual completed DSH classification without another paid model request.
 * Reads only the explicitly supplied session. Writes drafts only with --write; never approves them.
 */
import { parseArgs } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import type { ActionReviewBatch, ExperienceCard } from '../apps/host/generated/contracts'
import type { ParsedDocument } from '../packages/experience/domain'
import { buildActionChunks } from '../packages/experience/chunking'
import { validateActionReviewBatch } from '../packages/experience/action-review'
import { canonical } from '../packages/intelligence/domain'
import { validate } from '../packages/contracts/validate'

const { values } = parseArgs({ options: { project: { type: 'string' }, document: { type: 'string' }, session: { type: 'string' },
  base: { type: 'string', default: 'http://127.0.0.1:4310' }, output: { type: 'string' }, write: { type: 'boolean', default: false } } })
if (!values.project || !values.document || !values.session) throw new Error('--project, --document and --session are required')
const origin = new URL(values.base!)
if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Replay is restricted to the local workbench')
const session = await fetch(origin + 'api/session'), cookie = session.headers.get('set-cookie')?.split(';')[0]
if (!session.ok || !cookie) throw new Error('Local session unavailable')
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(`/api/projects/${encodeURIComponent(values.project!)}/${path}`, origin), {
    method: body === undefined ? 'GET' : 'POST', headers: { cookie: cookie!, 'X-Requested-With': 'haizhizi', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const result = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(result)}`)
  return result as T
}
const state = await api<{ documents: ParsedDocument[]; cards: ExperienceCard[] }>('knowledge/pipeline')
const document = state.documents.find(document => document.id === values.document)
if (!document) throw new Error('Document not in current owned project')
const events = (await readFile(values.session, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
if (!events.some(event => event.type === 'turn/end' && event.data?.reason?.kind === 'completed')) throw new Error('Model session did not complete')
const prompts = events.filter(event => event.type === 'user/message').flatMap(event => event.data.content || []).map(block => block.text || '')
const prompt = prompts.find(text => text.includes('<untrusted_action_index>'))
if (!prompt) throw new Error('No action-index model prompt in this session')
const material = JSON.parse(prompt.match(/<untrusted_material>([\s\S]*?)<\/untrusted_material>/)![1]) as { document_id: string; version: string }[]
if (!material.length || material.some(slice => slice.document_id !== document.id || slice.version !== document.sha256)) throw new Error('Model material identity/version differs')
const recordedIndex = JSON.parse(prompt.match(/<untrusted_action_index>([\s\S]*?)<\/untrusted_action_index>/)![1])
const chunks = buildActionChunks(document).chunks, aliases = new Map(chunks.map((chunk, i) => [`c${i + 1}`, chunk.id]))
const byId = new Map([...aliases].map(([alias, id]) => [id, alias]))
const currentIndex = chunks.map(chunk => ({ id: byId.get(chunk.id), measure_key: chunk.measure_key, object_ref: chunk.object_ref, stage: chunk.stage,
  kind: chunk.kind, spans: chunk.spans.map(({ locator, quote }) => ({ locator, quote })), context_chunk_ids: chunk.context_chunk_ids.map(id => byId.get(id)) }))
if (canonical(recordedIndex) !== canonical(currentIndex)) throw new Error('Action index has changed; old short IDs cannot be reused')
const successful = new Set(events.filter(event => event.type === 'tool/result' && !event.data.message?.isError && !event.data.error).map(event => event.data.callId || event.data.message?.toolCallId))
const tool = events.filter(event => event.type === 'tool/call' && event.data.name === 'structured_output' && successful.has(event.data.callId)).at(-1)
if (!tool) throw new Error('No successful structured model result')
const reviewed = validate<ActionReviewBatch>('ActionReviewBatch', JSON.parse(tool.data.arguments))
const expand = (id: string) => aliases.get(id) || id
for (const measure of reviewed.measures) {
  measure.action_chunk_ids = measure.action_chunk_ids.map(expand); measure.context_chunk_ids = measure.context_chunk_ids.map(expand)
  for (const field of measure.fields) field.chunk_ids = field.chunk_ids.map(expand)
}
const result = validateActionReviewBatch(document, chunks, reviewed), cards: { id: string; revision: number; reused: boolean }[] = []
for (const draft of result.drafts) {
  const previous = state.cards.find(card => card.title === draft.title && card.status === 'draft'
    && canonical(card.knowledge?.chunks) === canonical(draft.knowledge?.chunks) && canonical(card.fields) === canonical(draft.fields))
  if (previous) cards.push({ id: previous.id, revision: previous.revision, reused: true })
  else if (values.write) {
    const saved = await api<ExperienceCard>('experiences', { draft })
    if (saved.status !== 'draft') throw new Error('Replay cannot approve knowledge')
    cards.push({ id: saved.id, revision: saved.revision, reused: false })
  }
}
const record = { checked_at: new Date().toISOString(), project_id: values.project, document_id: document.id, sha256: document.sha256,
  replayed_model_session: values.session, input_class: 'recorded_actual_model_response', new_model_calls: 0, approvals: 0,
  valid_drafts: result.drafts.length, rejected_measures: reviewed.measures.length - result.drafts.length, warnings: result.warnings, saved_cards: cards,
  scope: 'Source/index/version-exact replay of actual DSH output under current adapter validation; not another live call or quality benchmark' }
if (values.output) await writeFile(values.output, JSON.stringify(record, null, 2) + '\n')
console.log(JSON.stringify(record))
