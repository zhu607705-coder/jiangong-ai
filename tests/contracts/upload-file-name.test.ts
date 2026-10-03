import { describe, expect, it } from 'vitest'
import { uploadFileName } from '../../apps/host/ingest'

describe('explicit UTF-8 upload filename', () => {
  it('preserves Chinese, emoji and spaces using metadata rather than guessing a header encoding', () => {
    const name = '翠苑一区 朱航成 🏠 历史报道.txt'
    const header = Buffer.from(name, 'utf8').toString('latin1')
    expect(header).not.toBe(name)
    expect(uploadFileName(header, name)).toBe(name)
    // A legitimate Latin-1 name is retained too; there is no blanket conversion.
    expect(uploadFileName('café.txt', 'café.txt')).toBe('café.txt')
  })

  it('keeps legacy clients and case-insensitive format matching', () => {
    expect(uploadFileName('experience.md', undefined)).toBe('experience.md')
    expect(uploadFileName('REPORT.TXT', '报告.txt')).toBe('报告.txt')
  })

  it.each([['duplicate.txt', 'duplicate.txt'], { value: 'file.txt' }, 1, null].map(value => ({ value })))('rejects non-string or duplicate metadata: $value', ({ value }) => {
    expect(() => uploadFileName('file.txt', value)).toThrow()
  })

  it.each(['', ' '.repeat(4), `${'a'.repeat(247)}.txt`, '../file.txt', 'dir/file.txt', 'dir\\file.txt', 'C:file.txt', 'bad\nfile.txt', 'bad\u0000file.txt', 'bad\u0085file.txt', 'bad\ud800file.txt'])('rejects unsafe or overlong metadata: %j', value => {
    expect(() => uploadFileName('file.txt', value)).toThrow()
  })

  it('rejects a changed parser format', () => {
    expect(() => uploadFileName('file.txt', '报告.pdf')).toThrow()
  })
})
