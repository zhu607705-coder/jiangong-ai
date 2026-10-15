import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from '../../apps/workspace/src/uuid'

afterEach(() => vi.unstubAllGlobals())

describe('workspace secure UUIDs on HTTP IP deployments', () => {
  it('uses native randomUUID when available and retains its receiver', () => {
    const secureCrypto = {
      randomUUID: vi.fn(function (this: unknown) {
        expect(this).toBe(secureCrypto)
        return '00000000-0000-4000-8000-000000000000'
      }),
      getRandomValues: vi.fn(),
    }
    vi.stubGlobal('crypto', secureCrypto)
    expect(randomUUID()).toBe('00000000-0000-4000-8000-000000000000')
    expect(secureCrypto.randomUUID).toHaveBeenCalledOnce()
    expect(secureCrypto.getRandomValues).not.toHaveBeenCalled()
  })

  it('uses secure bytes and sets RFC 4122 version and variant bits without randomUUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      expect(bytes).toHaveLength(16)
      for (let index = 0; index < bytes.length; index++) bytes[index] = index
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })
    expect(randomUUID()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('replaces existing version and variant bits in secure random bytes', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) })
    expect(randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it.each([undefined, {}])('fails explicitly when a secure random source is unavailable (%s)', secureCrypto => {
    vi.stubGlobal('crypto', secureCrypto)
    expect(() => randomUUID()).toThrow('当前浏览器不支持安全随机数')
  })
})
