import { describe, expect, it } from 'vitest'
import { requestOriginPolicy } from '../../apps/host/request-origin'

describe('explicit workbench request origins', () => {
  it('preserves local defaults and rejects remote hosts by default', () => {
    const policy = requestOriginPolicy(4310, 5173)
    expect(policy.allowedHosts.has('127.0.0.1:4310')).toBe(true)
    expect(policy.allowedOrigins.has('http://localhost:5173')).toBe(true)
    expect(policy.allowedHosts.has('10.70.223.113')).toBe(false)
    expect(policy.publicOrigin).toBeNull()
  })
  it('adds only the configured host and origin', () => {
    const policy = requestOriginPolicy(4310, 15173, 'http://10.70.223.113')
    expect(policy.publicOrigin).toBe('http://10.70.223.113')
    expect(policy.allowedHosts.has('10.70.223.113')).toBe(true)
    expect(policy.allowedOrigins.has('http://10.70.223.113')).toBe(true)
    expect(policy.allowedHosts.has('10.70.223.113:4310')).toBe(false)
    expect(policy.allowedHosts.has('attacker.example')).toBe(false)
    expect(policy.allowedOrigins.has('https://10.70.223.113')).toBe(false)
    expect(policy.allowedOrigins.has('http://attacker.example')).toBe(false)
  })
  it('supports an explicit HTTPS port and canonical trailing slash', () => {
    const policy = requestOriginPolicy(4310, 5173, 'https://workbench.example:8443/')
    expect(policy.allowedHosts.has('workbench.example:8443')).toBe(true)
    expect(policy.allowedOrigins.has('https://workbench.example:8443')).toBe(true)
  })
  it('accepts the named domain and www alias while preserving IP access', () => {
    const policy = requestOriginPolicy(4310, 5173, 'http://10.70.223.113', 'http://laneanew.cn, http://www.laneanew.cn')
    expect(policy.publicOrigin).toBe('http://10.70.223.113')
    for (const host of ['10.70.223.113', 'laneanew.cn', 'www.laneanew.cn']) {
      expect(policy.allowedHosts.has(host)).toBe(true)
      expect(policy.allowedOrigins.has(`http://${host}`)).toBe(true)
    }
    expect(policy.allowedHosts.has('attacker.laneanew.cn')).toBe(false)
    expect(policy.allowedOrigins.has('https://laneanew.cn')).toBe(false)
    expect(policy.allowedHosts.has('laneanew.cn:4310')).toBe(false)
  })
  it.each(['https://*.laneanew.cn', 'http://user:password@laneanew.cn', 'http://laneanew.cn/path'])('rejects unsafe domain aliases: %s', value => {
    expect(() => requestOriginPolicy(4310, 5173, 'http://10.70.223.113', value)).toThrow('TRUSTED_PUBLIC_ORIGINS')
  })
  it('does not enable remote aliases without the primary deployment origin', () => {
    expect(() => requestOriginPolicy(4310, 5173, '', 'http://laneanew.cn')).toThrow('requires TRUSTED_PUBLIC_ORIGIN')
  })
  it.each([
    'not an origin', 'ftp://10.70.223.113', 'http://user:password@10.70.223.113',
    'http://10.70.223.113/path', 'http://10.70.223.113?token=value',
    'http://10.70.223.113#fragment', 'http://*.example.com',
    'http://10.70.223.113,https://attacker.example',
  ])('rejects a value that is not one origin: %s', value => {
    expect(() => requestOriginPolicy(4310, 5173, value)).toThrow('TRUSTED_PUBLIC_ORIGIN')
  })
})
