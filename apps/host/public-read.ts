/** Only inspected read paths are public; method names alone do not establish read-only behavior. */
const project = '/api/projects/[^/]+'
const readPaths = [
  /^\/(?:index\.html|favicon\.(?:ico|svg))?$/i,
  /^\/assets\/[^/]+$/i,
  /^\/deliverables\/[^/]+\.(?:pdf|md|docx)$/i,
  /^\/api\/projects\/?$/i,
  /^\/api\/projects\/public-decisions\/?$/i,
  // Project input uses its public projection. Only separately published strategy/mode and public cost material remain readable.
  new RegExp(`^${project}(?:/(?:renewal-mode|renewal-strategy|construction-costs(?:/export)?))?/?$`, 'i'),
  /^\/api\/intelligence\/(?:search|projects|items\/[^/]+)\/?$/i,
  /^\/api\/maps\/(?:config|data|screening\/profiles|screening\/renewal-mode\/[^/]+|screening\/analysis\/[^/]+)\/?$/i,
  /^\/_AMapService\/.+$/i,
]
const queryPaths = [
  new RegExp(`^${project}/community-operations/preview/?$`, 'i'),
  /^\/api\/maps\/geometry\/wgs84\/?$/i,
]
export function isPublicReadRequest(method: string, path: string): boolean {
  if (/%(?:2f|5c|2e)|\\/i.test(path)) return false
  const verb = method.toUpperCase()
  if (verb === 'GET' || verb === 'HEAD') return readPaths.some(pattern => pattern.test(path))
  return verb === 'POST' && queryPaths.some(pattern => pattern.test(path))
}
