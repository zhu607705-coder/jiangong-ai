import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/** Host-owned Markdown only; these paths never come from a model or source. */
const profileFiles = Object.freeze({
  planner: new URL('./planner/AGENTS.md', import.meta.url),
  building_delivery: new URL('./building_delivery/AGENTS.md', import.meta.url),
  cost_value: new URL('./cost_value/AGENTS.md', import.meta.url),
  residents_operations: new URL('./residents_operations/AGENTS.md', import.meta.url),
  synthesis: new URL('./synthesis/AGENTS.md', import.meta.url),
})
const commonFile = new URL('./AGENTS.md', import.meta.url)

export type RenewalAgentRole = keyof typeof profileFiles
export type RenewalAgentProfile = Readonly<{ role: RenewalAgentRole; content: string; sha256: string }>

/**
 * The installed DSH exposes per-child SubagentStartRequest.persona, not an
 * automatic AGENTS.md loader. The host injects content into that native field;
 * no filesystem tool or global coding-agent instructions reach the model.
 */
export async function loadRenewalAgentProfile(role: unknown): Promise<RenewalAgentProfile> {
  if (typeof role !== 'string' || !Object.hasOwn(profileFiles, role)) throw new Error('RENEWAL_AGENT_PROFILE_UNKNOWN_ROLE')
  const selectedRole = role as RenewalAgentRole
  const [common, specialist] = await Promise.all([readFile(commonFile, 'utf8'), readFile(profileFiles[selectedRole], 'utf8')])
  const content = common + '\n\n' + specialist
  return Object.freeze({ role: selectedRole, content, sha256: createHash('sha256').update(content, 'utf8').digest('hex') })
}
