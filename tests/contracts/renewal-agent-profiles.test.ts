import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { loadRenewalAgentProfile, type RenewalAgentRole } from '../../runtime/agents/renewal/profiles'

// Observe actual file reads, including rejected inputs, without replacing the
// files with fixtures: profile text and fingerprints come from the real files.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})
afterEach(() => vi.clearAllMocks())

const base = new URL('../../runtime/agents/renewal/', import.meta.url)
const roles: RenewalAgentRole[] = ['planner', 'building_delivery', 'cost_value', 'residents_operations', 'synthesis']

it.each(roles)('loads the common and %s Markdown from only the host allowlist', async role => {
  const profile = await loadRenewalAgentProfile(role)
  const reads = vi.mocked(readFile).mock.calls
  expect(reads.map(([path]) => fileURLToPath(path as URL))).toEqual([
    fileURLToPath(new URL('AGENTS.md', base)), fileURLToPath(new URL(`${role}/AGENTS.md`, base)),
  ])
  expect(reads.every(([, encoding]) => encoding === 'utf8')).toBe(true)
  const [common, specialist] = await Promise.all(vi.mocked(readFile).mock.results.map(row => row.value))
  expect(profile).toEqual({ role, content: common + '\n\n' + specialist, sha256: createHash('sha256').update(common + '\n\n' + specialist, 'utf8').digest('hex') })
  expect(profile.content).toContain('# 更新研判共同职责')
  expect(profile.content).toContain(`# ${role}：`)
  expect(profile.content).toContain('来源短 ID')
  expect(Object.keys(profile).sort()).toEqual(['content', 'role', 'sha256'])
  expect(Object.isFrozen(profile)).toBe(true)
})

it.each([
  undefined, null, 0, {}, ['planner'], new String('planner'), '', '__proto__', 'constructor', 'toString',
  '../AGENTS.md', './planner/AGENTS.md', 'planner/../../AGENTS.md', 'planner%2f..%2fAGENTS.md', 'Planner',
  'D:\\建工ai\\AGENTS.md', '/etc/passwd', 'https://example.com/AGENTS.md',
])('rejects role input %j before any filesystem access', async role => {
  await expect(loadRenewalAgentProfile(role)).rejects.toThrow('RENEWAL_AGENT_PROFILE_UNKNOWN_ROLE')
  expect(readFile).not.toHaveBeenCalled()
})

it('does not coerce untrusted role objects into a file selector', async () => {
  const toString = vi.fn(() => 'planner')
  await expect(loadRenewalAgentProfile({ toString })).rejects.toThrow('RENEWAL_AGENT_PROFILE_UNKNOWN_ROLE')
  expect(toString).not.toHaveBeenCalled()
  expect(readFile).not.toHaveBeenCalled()
})

it('has stable fingerprints for the same content and distinct fingerprints per role', async () => {
  const profiles = await Promise.all(roles.map(loadRenewalAgentProfile))
  const repeated = await loadRenewalAgentProfile('planner')
  expect(repeated).toEqual(profiles[0])
  expect(profiles.every(profile => /^[a-f0-9]{64}$/.test(profile.sha256))).toBe(true)
  expect(new Set(profiles.map(profile => profile.sha256)).size).toBe(roles.length)
  const allowedFiles = new Set(['AGENTS.md', ...roles.map(role => `${role}/AGENTS.md`)].map(path => fileURLToPath(new URL(path, base))))
  for (const [path] of vi.mocked(readFile).mock.calls) expect(allowedFiles.has(fileURLToPath(path as URL))).toBe(true)
})

it.each(roles)('guides %s through bounded RAG, facts, inference and adjustable scenarios', async role => {
  const { content } = await loadRenewalAgentProfile(role)
  for (const term of ['受限 RAG', 'query', 'offset/limit', 'observations', 'logical_inference', 'scenario', 'reasoned_proposals', 'premises', 'assumptions', 'verification', 'evidence_refs', 'parameters']) expect(content).toContain(term)
  expect(content).toContain('无直接证据时 observations 可为空')
  expect(content).toContain('不能变成结构鉴定、资金到账或法定同意率')
  expect(content).toContain('不编引文')
  expect(content).toContain('结果变化须能回到')
  expect(content).not.toContain('observations 为 1 至 4 条')
  expect(content).not.toContain('由宿主记录该分支未完成')
})
