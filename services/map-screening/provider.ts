import { createHash } from 'node:crypto'
import { AmapSettings, amapUpstream } from '../../apps/host/amap'
import { ensureHarnessNetwork } from '../../runtime/dsh/public-web'

export interface MapProvider {
  query(path: string, parameters: Record<string, string>, signal: AbortSignal): Promise<any>;
  revision(): string;
}

/** Fixed AMap adapter with a small shared request budget, not another search or agent runtime. */
export class AmapEvidenceProvider implements MapProvider {
  private tail: Promise<void> = Promise.resolve()
  private lastStart = 0
  constructor(private settings: AmapSettings) {}
  revision() { return this.settings.publicConfiguration().revision }
  async query(path: string, parameters: Record<string, string>, signal: AbortSignal): Promise<any> {
    const task = this.tail.then(async () => {
      signal.throwIfAborted()
      const delay = Math.max(0, this.lastStart + 500 - Date.now())
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      signal.throwIfAborted()
      const credentials = this.settings.getCredentials()
      if (!credentials) throw new Error('AMAP_NOT_CONFIGURED')
      const params = new URLSearchParams({ ...parameters, s: 'rsv3', platform: 'JS', logversion: '2.0', output: 'JSON' })
      const url = amapUpstream('/_AMapService' + path + '?' + params, credentials)
      await ensureHarnessNetwork()
      this.lastStart = Date.now()
      try {
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) })
        if (!response.ok) throw new Error('AMAP_HTTP_FAILED')
        const raw = await response.text()
        if (raw.length > 300_000) throw new Error('AMAP_RESPONSE_TOO_LARGE')
        const result = JSON.parse(raw)
        if (String(result.status) !== '1') throw new Error('AMAP_QUERY_REJECTED')
        return result
      } catch (error) {
        signal.throwIfAborted()
        // Transport exceptions can contain signed URLs. Never surface or persist them.
        throw new Error('AMAP_SOURCE_UNAVAILABLE')
      }
    })
    this.tail = task.then(() => undefined, () => undefined)
    return task
  }
}
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
