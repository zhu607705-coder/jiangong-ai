import { describe, expect, it } from 'vitest'
import { isPublicReadRequest } from '../../apps/host/public-read'

describe('explicit public read and temporary calculation policy', () => {
  it.each([
    '/', '/assets/history-records.js', '/deliverables/方案.pdf', '/api/projects', '/api/projects/public-decisions',
    '/api/projects/P-one', '/api/projects/P-one/knowledge/pipeline',
    '/api/projects/P-one/community-operations', '/api/projects/P-one/construction-costs/export',
    '/api/projects/P-one/renewal-strategy', '/api/maps/screening/analysis/MAPCTX-one',
    '/api/maps/screening/renewal-mode/MAPCTX-one', '/api/runs/RUN-one/events',
  ])('allows published GET/HEAD: %s', path => {
    expect(isPublicReadRequest('GET', path)).toBe(true)
    expect(isPublicReadRequest('HEAD', path)).toBe(true)
  })
  it.each([
    '/api/projects/P-one/knowledge/retrieve', '/api/projects/P-one/knowledge/chunks',
    '/api/projects/P-one/knowledge/groups', '/api/projects/P-one/experiences/knowledge-match',
    '/api/projects/P-one/community-operations/preview', '/api/maps/geometry/wgs84',
  ])('allows inspected temporary query POST: %s', path => expect(isPublicReadRequest('POST', path)).toBe(true))
  it.each([
    ['POST','/api/projects'], ['POST','/api/projects/public-decisions'], ['POST','/api/projects/P-one/renewal-strategy'],
    ['POST','/api/projects/P-one/renewal-mode'], ['POST','/api/projects/P-one/documents'],
    ['POST','/api/projects/P-one/context-proposals'], ['POST','/api/projects/P-one/knowledge/extract'],
    ['POST','/api/projects/P-one/experiences/extract'], ['POST','/api/projects/P-one/community-operations/scenarios'],
    ['POST','/api/maps/screening/context'], ['POST','/api/maps/config'], ['POST','/api/intelligence/sync'],
    ['GET','/api/ready'], ['GET','/api/intelligence/status'], ['GET','/api/runs/RUN-one/trace'],
    ['GET','/server.env'], ['GET','/assets/%2e%2e%2fserver.env'],
    ['DELETE','/api/projects/P-one'], ['OPTIONS','/api/projects'],
  ])('does not grant admin operation %s %s', (method,path) => expect(isPublicReadRequest(method,path)).toBe(false))
})
