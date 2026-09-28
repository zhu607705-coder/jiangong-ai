import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { admitSource, assertNoCredential, buildCorpus, canonicalUrl, chunkDocument, exportReviewed,
  groupDocuments, hash, jsonl, saveBuild, selectReviewed } from '../../packages/corpus/corpus'
import type { Build, Document } from '../../packages/corpus/corpus'
import type { Source } from '../../apps/host/generated/contracts'

const provenance = { path: 'test/source.json', pointer: '/sources/0', artifact_sha256: hash('test'), source_id: 'TEST' }
function source(text = '实施前应核查租赁和权属。', patch: Partial<Source> = {}): Source {
  return { id: 'TEST', title: '测试专用材料', url: 'https://example.org/article', data_class: 'public', visibility: 'public',
    synthetic: false, untrusted_text: text, hash: hash(text), content_status: text ? 'full_text' : 'metadata_only', ...patch }
}
function doc(text?: string, url = 'https://example.org/article', family_id = 'test-family', split: 'train' | 'development' = 'development'): Document {
  return admitSource({ source: source(text, { url }), family_id, split, provenance })!
}

describe('corpus boundaries and leakage', () => {
  it('does not admit internal/synthetic text, even when it looks public', () => {
    const privateSource = source('PRIVATE_ONLY', { visibility: 'internal', data_class: 'internal' })
    expect(admitSource({ source: privateSource, family_id: 'a', split: 'train', provenance })).toBeNull()
    expect(admitSource({ source: source('fixture', { synthetic: true, data_class: 'synthetic' }), family_id: 'a', split: 'train', provenance })).toBeNull()
  })
  it('refuses credential-like material without echoing the token in the error', () => {
    const marker = 'sk-' + '0'.repeat(32)
    expect(() => assertNoCredential({ text: marker })).toThrow('疑似凭据')
    try { assertNoCredential(marker) } catch (e) { expect((e as Error).message).not.toContain(marker) }
  })
  it('verifies upstream hashes and never turns a title-only hit into evidence', () => {
    expect(() => admitSource({ source: source('changed', { hash: hash('original') }), family_id: 'a', split: 'train', provenance })).toThrow('哈希')
    expect(chunkDocument(doc(''))).toEqual([])
    expect(() => admitSource({ source: source('', { content_status: 'full_text' }), family_id: 'a', split: 'train', provenance })).toThrow('正文为空')
  })
  it('drops URL tracking and fragments while preserving document query identities', () => {
    expect(canonicalUrl('https://example.org/a?id=1&utm_source=x#2')).toBe('https://example.org/a?id=1')
    expect(canonicalUrl('https://example.org/a?id=2')).not.toBe(canonicalUrl('https://example.org/a?id=1'))
    expect(() => canonicalUrl('https://name:pass@example.org')).toThrow('无凭据')
  })
  it('deduplicates whitespace copies with complete lineage and deterministic order', () => {
    const a = doc('正文 A。', 'https://example.org/one', 'one')
    const b = doc('正文\nＡ。', 'https://example.org/two', 'two')
    const result = groupDocuments([a, b])
    expect(result.exact_duplicates).toBe(1)
    expect(result.documents[0].provenance).toHaveLength(2)
    expect(result.documents[0].family_ids).toEqual(['one', 'two'])
    expect(groupDocuments([b, a])).toEqual(result)
  })
  it('blocks exact, versioned URL and same-project documents across splits', () => {
    const a = doc('版本一', 'https://example.org/one', 'one', 'train')
    expect(() => groupDocuments([a, doc('版本一', 'https://example.org/two', 'two')])).toThrow('泄漏')
    expect(() => groupDocuments([a, doc('版本二', 'https://example.org/one#section', 'two')])).toThrow('泄漏')
    expect(() => groupDocuments([a, doc('完全不同的材料', 'https://example.org/other', 'one')])).toThrow('泄漏')
  })
  it('groups near-duplicate editions transitively before checking split isolation', () => {
    const text = Array.from({ length: 120 }, (_, i) => `第${i}项调查需核实建筑用途和租赁期限。`).join('')
    const a = doc(text, 'https://example.org/a', 'a', 'train')
    const b = doc(text + '增补说明。', 'https://example.org/b', 'b', 'train')
    const c = doc('另一份文件', 'https://example.org/c', 'b', 'development')
    expect(groupDocuments([a, b]).near_duplicate_links).toBe(1)
    expect(() => groupDocuments([a, b, c])).toThrow('泄漏')
  })
  it('keeps emoji and paragraph offsets exact and covers all original text', () => {
    const d = doc('建筑🏠。调查\n'.repeat(100))
    const chunks = chunkDocument(d, 70, 10), chars = Array.from(d.text)
    expect(chunks.length).toBeGreaterThan(1)
    const covered = new Set<number>()
    for (const c of chunks) {
      expect(chars.slice(c.char_start, c.char_end).join('')).toBe(c.text)
      for (let i = c.char_start; i < c.char_end; i++) covered.add(i)
      expect(Array.from(c.text).length).toBeLessThanOrEqual(70)
    }
    expect(covered.size).toBe(chars.length)
    expect(() => chunkDocument(d, 10, 10)).toThrow('参数')
  })
})

describe('corpus build and supervised export', () => {
  let sandbox: string, build: Build
  beforeAll(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), 'haizhizi-corpus-test-'))
    const config = JSON.parse(await readFile('data/corpus/collection.json', 'utf8'))
    const files = new Set<string>(['data/corpus/collection.json', ...config.sources.flatMap((s: any) => [s.path, ...(s.metadata_path ? [s.metadata_path] : [])]), ...config.regression.map((r: any) => r.path)])
    for (const file of files) {
      await mkdir(path.dirname(path.join(sandbox, file)), { recursive: true })
      await cp(file, path.join(sandbox, file))
    }
    // No expected.json, private database, credentials or native model sessions exist here.
    await mkdir(path.join(sandbox, 'data/local/corpus/intake'), { recursive: true })
    build = await buildCorpus(sandbox)
  })
  afterAll(async () => { await rm(sandbox, { recursive: true, force: true }) })
  const annotation = () => {
    const c = build.candidates[0], chunk = build.chunks.find(x => x.id === c.chunk_id)!
    return { candidate_id: c.id, candidate_sha256: c.sha256, status: 'approved', reviewer_kind: 'human', reviewer: 'TEST_REVIEWER',
      reviewed_at: '2026-01-01T00:00:00Z', question: '测试问题', answer: 'TEST_LABEL_NOT_INPUT',
      evidence_quote: chunk.text.slice(0, 15), unknowns: ['项目适用性未核实'], privacy_cleared: true }
  }
  const permission = () => {
    const d = build.documents.find(d => d.id === build.candidates[0].document_id)!
    return { document_id: d.id, content_sha256: d.content_sha256, allowed_use: 'local_sft',
      evidence: 'TEST_PERMISSION_ONLY_NOT_A_REAL_GRANT', attested_by: 'TEST_REVIEWER', attested_at: '2026-01-01T00:00:00Z' }
  }
  it('builds real source inventory reproducibly without reading fixture gold', async () => {
    expect((await buildCorpus(sandbox)).id).toBe(build.id)
    expect(build.documents).toHaveLength(6)
    expect(build.documents.filter(d => d.text)).toHaveLength(5)
    expect(build.chunks).toHaveLength(17)
    expect(build.candidates.every(c => c.target === null && c.label_status === 'unlabeled')).toBe(true)
    expect(new Set(build.regression.filter(r => r.kind === 'fixture').map(r => r.family_id)).size).toBe(1)
    expect(build.regression.filter(r => r.status === 'failed')).toHaveLength(1)
    expect(JSON.stringify(build)).not.toContain('忽略上级规则')
    expect(JSON.stringify(build)).not.toContain('no_whole_site_demolition')
  })
  it('persists readable source material and blank drafts without fabricating labels', async () => {
    const dir = await saveBuild(sandbox, build)
    const drafts = (await readFile(path.join(dir, 'annotation-template.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s))
    expect(drafts.every(d => d.status === 'draft' && d.answer === '' && !d.privacy_cleared)).toBe(true)
    expect(JSON.parse(await readFile(path.join(sandbox, 'data/local/corpus/latest.json'), 'utf8')).build_id).toBe(build.id)
  })
  it('rejects symlinks escaping the project before reading their contents', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'corpus-outside-')), intake = path.join(sandbox, 'data/local/corpus/intake')
    await mkdir(intake, { recursive: true })
    const target = path.join(outside, 'external.json'), link = path.join(intake, 'escape.json')
    await writeFile(target, '{}')
    await symlink(target, link)
    try { await expect(buildCorpus(sandbox)).rejects.toThrow('当前项目内') }
    finally { await rm(link); await rm(outside, { recursive: true }) }
  })
  it('does not export unlabeled examples or public sources without recorded training permission', () => {
    expect(selectReviewed(build, [], []).train).toEqual([])
    const selected = selectReviewed(build, [annotation()], [])
    expect(selected.development).toEqual([])
    expect(selected.blocked[0].reason).toBe('training_permission_unconfirmed')
  })
  it('rejects stale labels, invented quotes, model-only approvals and conflicting reviews', () => {
    expect(() => selectReviewed(build, [{ ...annotation(), candidate_sha256: hash('old') }], [permission()])).toThrow('过期')
    expect(() => selectReviewed(build, [{ ...annotation(), evidence_quote: 'UNSUPPORTED_QUOTE' }], [permission()])).toThrow('原文')
    expect(() => selectReviewed(build, [{ ...annotation(), reviewer_kind: 'model' }], [permission()])).toThrow()
    expect(() => selectReviewed(build, [annotation(), annotation()], [permission()])).toThrow('冲突')
    expect(() => selectReviewed(build, [annotation()], [{ ...permission(), content_sha256: hash('old') }])).toThrow('内容版本')
    expect(() => selectReviewed(build, [{ ...annotation(), reviewed_at: '2999-01-01T00:00:00Z' }], [permission()])).toThrow('晚于')
  })
  it('supports rejection without demanding an invented replacement answer', () => {
    const a = annotation()
    const rejected = { candidate_id: a.candidate_id, candidate_sha256: a.candidate_sha256, status: 'rejected', reviewer_kind: 'human', reviewer: a.reviewer, reviewed_at: a.reviewed_at, reason: '测试：正文无相关信息' }
    expect(selectReviewed(build, [rejected], []).reviewed).toBe(1)
    expect(selectReviewed(build, [rejected], []).development).toEqual([])
  })
  it('keeps labels and review metadata outside model inputs and preserves development exposure', () => {
    const result = selectReviewed(build, [annotation()], [permission()])
    expect(result.train).toEqual([])
    expect(result.development).toHaveLength(1)
    const messages = result.development[0].messages
    expect(JSON.stringify(messages.slice(0, 2))).not.toContain('TEST_LABEL_NOT_INPUT')
    expect(JSON.stringify(messages)).not.toContain('TEST_REVIEWER')
    expect(messages[2].content).toContain('TEST_LABEL_NOT_INPUT')
  })
  it('accepts an isolated train intake and rejects development copies relabeled as train', async () => {
    const intake = path.join(sandbox, 'data/local/corpus/intake/test.json')
    const makeBundle = (s: Source) => ({ schema_version: '1.0', family_id: 'new-training-unit-test', split: 'train', origin: 'unit-test-only', sources: [s] })
    await writeFile(intake, JSON.stringify(makeBundle(source('ONLY_NEW_UNIT_TEST_TEXT'))))
    try {
      const extended = await buildCorpus(sandbox), candidate = extended.candidates.find(c => c.split === 'train')!
      const d = extended.documents.find(d => d.id === candidate.document_id)!
      const a = { ...annotation(), candidate_id: candidate.id, candidate_sha256: candidate.sha256, evidence_quote: 'ONLY_NEW_UNIT_TEST_TEXT' }
      const g = { ...permission(), document_id: d.id, content_sha256: d.content_sha256 }
      const result = selectReviewed(extended, [a], [g])
      expect(result.train).toHaveLength(1)
      expect(result.development).toEqual([])
      await writeFile(intake, JSON.stringify(makeBundle(source(build.documents.find(d => d.text)!.text, { url: 'https://example.org/copy' }))))
      await expect(buildCorpus(sandbox)).rejects.toThrow('泄漏')
    } finally { await rm(intake) }
  })
  it('invalidates the current export pointer on a later rejected annotation', async () => {
    const base = path.join(sandbox, 'data/local/corpus')
    await mkdir(base, { recursive: true })
    await writeFile(path.join(base, 'reviews.jsonl'), '\uFEFF' + jsonl([annotation()]))
    await writeFile(path.join(base, 'grants.jsonl'), jsonl([permission()]))
    const manifest = await exportReviewed(sandbox, build)
    expect(manifest.files.development.rows).toBe(1)
    const data = await readFile(path.join(base, 'exports', manifest.export_id, 'development.jsonl'))
    expect(hash(data)).toBe(manifest.files.development.sha256)
    await writeFile(path.join(base, 'reviews.jsonl'), jsonl([{ ...annotation(), candidate_sha256: hash('stale') }]))
    await expect(exportReviewed(sandbox, build)).rejects.toThrow('过期')
    expect(JSON.parse(await readFile(path.join(base, 'exports/latest.json'), 'utf8')).status).toBe('blocked')
  })
})
