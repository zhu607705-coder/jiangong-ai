import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureHash = `scrypt$${'11'.repeat(16)}$${'22'.repeat(64)}`
async function configurationError() {
  try { await import('../../apps/host/config'); return null }
  catch (error) { return error instanceof Error ? error.message : 'Unexpected configuration failure' }
}
beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('HOST', '127.0.0.1')
  vi.stubEnv('TRUSTED_PUBLIC_ORIGIN', '')
  vi.stubEnv('TRUSTED_PUBLIC_ORIGINS', '')
  vi.stubEnv('ADMIN_PASSWORD_HASH', '')
  vi.stubEnv('PUBLIC_READ_ONLY', 'false')
  vi.stubEnv('COLLABORATIVE_WORKSPACE', 'false')
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('explicit campus collaborative configuration', () => {
  it('keeps collaboration off for existing local and private deployments', async () => {
    const { config } = await import('../../apps/host/config')
    expect(config.collaborativeWorkspace).toBe(false)
    vi.resetModules()
    vi.stubEnv('TRUSTED_PUBLIC_ORIGIN', 'http://10.70.223.113')
    expect(await configurationError()).toContain('administrator credentials')
  })
  it('accepts an explicit collaborative origin without requiring administrator credentials', async () => {
    vi.stubEnv('TRUSTED_PUBLIC_ORIGIN', 'http://10.70.223.113')
    vi.stubEnv('COLLABORATIVE_WORKSPACE', 'true')
    vi.stubEnv('TRUSTED_PUBLIC_ORIGINS', 'http://laneanew.cn,http://www.laneanew.cn')
    const { config } = await import('../../apps/host/config')
    expect(config.collaborativeWorkspace).toBe(true)
    expect(config.HOST).toBe('127.0.0.1')
    expect(config.requestOrigins.allowedOrigins.has('http://10.70.223.113')).toBe(true)
    expect(config.requestOrigins.allowedHosts.has('laneanew.cn')).toBe(true)
    expect(config.requestOrigins.allowedOrigins.has('http://www.laneanew.cn')).toBe(true)
  })
  it('requires a declared origin and preserves stored credentials instead of deleting them', async () => {
    vi.stubEnv('COLLABORATIVE_WORKSPACE', 'true')
    expect(await configurationError()).toContain('explicit trusted public origin')
    vi.resetModules()
    vi.stubEnv('TRUSTED_PUBLIC_ORIGIN', 'http://10.70.223.113')
    vi.stubEnv('ADMIN_PASSWORD_HASH', fixtureHash)
    vi.stubEnv('PUBLIC_READ_ONLY', 'true')
    const { config } = await import('../../apps/host/config')
    expect(config.collaborativeWorkspace).toBe(true)
    expect(config.ADMIN_PASSWORD_HASH).toBe(fixtureHash)
  })
})
