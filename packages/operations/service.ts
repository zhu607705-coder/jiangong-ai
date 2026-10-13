import { randomUUID } from 'node:crypto'
import type { ProjectRecord, Store } from '../../apps/host/store'
import { config } from '../../apps/host/config'
import { validate } from '../contracts/validate'
import { canonical, hash } from '../intelligence/domain'
import { isOperationsOriginal } from './sources'
import type { OperationsInput, OperationsResult, OperationsSnapshot, OperationsObservationInput, OperationsObservation, OperationsComparison, OperationsWorkspace, OperationsValue } from '../../apps/host/generated/contracts'

export class OperationsError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
export type OperationsCalculator = {
  evaluate(input: OperationsInput): Promise<OperationsResult>
  compare(snapshot: OperationsSnapshot, observation: OperationsObservation): Promise<OperationsComparison>
}
const digest = (value: unknown) => hash(canonical(value))
export function shanghaiDate(now = new Date()): string { return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) }

async function capability<T>(route: string, value: unknown, contract: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${config.capabilityUrl}/operations/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Capability-Token': config.capabilityToken },
      body: JSON.stringify(value), signal: AbortSignal.timeout(15000),
    })
  } catch { throw new OperationsError(503, 'OPERATIONS_CAPABILITY_UNAVAILABLE', '运营计算服务暂不可用，请检查本地专业能力服务后重试。') }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: unknown }
    throw new OperationsError(response.status === 422 ? 422 : 503, 'OPERATIONS_CALCULATION_FAILED', typeof body.detail === 'string' ? body.detail : '运营参数校验未通过，请核对单位、来源和排班。')
  }
  return validate<T>(contract, await response.json())
}
export const operationsCalculator: OperationsCalculator = {
  evaluate: input => capability('evaluate', input, 'OperationsResult'),
  compare: (snapshot, observation) => capability('compare', { snapshot, observation }, 'OperationsComparison'),
}

/** Enumerate the labelled inputs for provenance checks and snapshot reports. */
export function operationsValues(input: OperationsInput): { label: string; item: OperationsValue }[] {
  const monthlyFields = ['capacity_per_slot', 'available_slots', 'demand_visits'] as const
  const financialFields = ['paid_share', 'fee_per_visit', 'variable_cost_per_visit'] as const
  return [
    { label: '目标居民人数', item: input.target_population }, { label: '月度目标居民去重服务人数', item: input.unique_users },
    ...input.services.flatMap(service => [
      ...[...(service.time_blocks ? [] : monthlyFields), ...financialFields].map(field => ({ label: `${service.name} / ${field}`, item: service[field] })),
      ...(service.time_blocks || []).flatMap(block => (['slots', 'capacity_per_slot', 'demand_visits'] as const)
        .map(field => ({ label: `${service.name} / ${block.name} / ${field}`, item: block[field] }))),
    ]),
    ...input.cash_items.map(row => ({ label: row.description, item: row.amount })),
  ]
}

export class OperationsService {
  constructor(readonly store: Store, readonly calculator = operationsCalculator) {}
  async initialize() {
    await this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS operation_scenarios (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        input_hash TEXT NOT NULL, context_version INTEGER NOT NULL,
        payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(project_id,input_hash,context_version)
      );
      CREATE TABLE IF NOT EXISTS operation_observations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        snapshot_id TEXT NOT NULL REFERENCES operation_scenarios(id),
        facility_id TEXT NOT NULL, period TEXT NOT NULL,
        payload JSONB NOT NULL, comparison JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(project_id,facility_id,period)
      );`)
  }
  checkedInput(value: unknown): OperationsInput {
    const input = validate<OperationsInput>('OperationsInput', value)
    for (const { item } of operationsValues(input)) {
      if (item.as_of > shanghaiDate()) throw new OperationsError(422, 'FUTURE_INPUT_SOURCE', '依据取得日期不能晚于今天；测算月份可以是未来月份。')
    }
    for (const bound of input.analysis_bounds || []) {
      if (bound.as_of > shanghaiDate()) throw new OperationsError(422, 'FUTURE_INPUT_SOURCE', '参数范围依据的取得日期不能晚于今天。')
    }
    return input
  }
  async preview(value: unknown) {
    return this.calculator.evaluate(this.checkedInput(value))
  }
  async snapshot(project: ProjectRecord, id: string): Promise<OperationsSnapshot> {
    const row = (await this.store.db.query<{ payload: OperationsSnapshot }>('SELECT payload FROM operation_scenarios WHERE id=$1 AND project_id=$2', [id, project.id])).rows[0]
    if (!row) throw new OperationsError(404, 'OPERATIONS_SNAPSHOT_NOT_FOUND', '当前项目没有这份运营预测。')
    return row.payload
  }
  async workspace(project: ProjectRecord): Promise<OperationsWorkspace> {
    const scenarios = (await this.store.db.query<{ payload: OperationsSnapshot }>('SELECT payload FROM operation_scenarios WHERE project_id=$1 ORDER BY created_at DESC,id DESC', [project.id])).rows.map(row => row.payload)
    const rows = (await this.store.db.query<{ payload: OperationsObservation; comparison: OperationsComparison }>('SELECT payload,comparison FROM operation_observations WHERE project_id=$1 ORDER BY created_at DESC,id DESC', [project.id])).rows
    return { scenarios, observations: rows.map(row => row.payload), comparisons: rows.map(row => row.comparison) }
  }
  async freeze(project: ProjectRecord, value: unknown, expectedVersion: number): Promise<OperationsSnapshot> {
    const input = this.checkedInput(value), result = await this.calculator.evaluate(input)
    const inputHash = digest({ input, model_version: result.model_version })
    return this.store.db.transaction(async db => {
      const current = (await db.query<{ context_version: number }>('SELECT context_version FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [project.id, project.owner_id])).rows[0]
      if (!current || current.context_version !== expectedVersion) throw new OperationsError(409, 'CONTEXT_VERSION_CONFLICT', '项目依据已更新，请刷新后重新测算与保存。')
      const existing = (await db.query<{ payload: OperationsSnapshot }>('SELECT payload FROM operation_scenarios WHERE project_id=$1 AND input_hash=$2 AND context_version=$3', [project.id, inputHash, expectedVersion])).rows[0]
      if (existing) return existing.payload
      const snapshot: OperationsSnapshot = { id: `OPS-${randomUUID()}`, project_id: project.id, context_version: expectedVersion,
        input_hash: inputHash, created_at: new Date().toISOString(), input, result }
      validate('OperationsSnapshot', snapshot)
      await db.query('INSERT INTO operation_scenarios(id,project_id,input_hash,context_version,payload) VALUES($1,$2,$3,$4,$5)', [snapshot.id, project.id, inputHash, expectedVersion, JSON.stringify(snapshot)])
      return snapshot
    })
  }
  async observe(project: ProjectRecord, snapshotId: string, value: unknown): Promise<OperationsObservation> {
    const input = validate<OperationsObservationInput>('OperationsObservationInput', value), snapshot = await this.snapshot(project, snapshotId)
    if (input.facility_id !== snapshot.input.facility_id || input.period !== snapshot.input.period) throw new OperationsError(422, 'OBSERVATION_SCOPE', '实际记录必须与冻结预测为同一个中心、同一个月份。')
    const today = shanghaiDate()
    if (input.period >= today.slice(0, 7) || input.collected_at.slice(0, 7) <= input.period || input.collected_at > today) {
      throw new OperationsError(422, 'OBSERVATION_PERIOD', '完整月度实绩须在该月结束后取得，采集日期不能晚于今天。')
    }
    if (!Object.values(input.metrics).some(number => number !== null)) throw new OperationsError(422, 'OBSERVATION_EMPTY', '至少填写一项有原始依据的实际指标；未知项保持空白。')
    for (const key of ['served_visits', 'unique_users'] as const) {
      if (input.metrics[key] !== null && !Number.isSafeInteger(input.metrics[key])) throw new OperationsError(422, 'OBSERVATION_COUNT', '实际服务人次和去重人数须为整数。')
    }
    if (input.metrics.unique_users !== null && input.metrics.served_visits !== null && input.metrics.unique_users > input.metrics.served_visits) throw new OperationsError(422, 'OBSERVATION_DENOMINATOR', '去重服务人数不能大于服务人次。')
    // Read the latest owner-scoped project; a synthetic fixture or mere URL cannot attest actual operations.
    const current = await this.store.project(project.id, project.owner_id)
    const source = current?.input.sources.find(source => source.id === input.source_id)
    if (current?.input.synthetic || !source || !isOperationsOriginal(source)) {
      throw new OperationsError(422, 'OBSERVATION_SOURCE', '实际记录须引用当前真实项目已导入的台账或原始材料；演示资料和仅有链接的记录不能登记实绩。')
    }
    if (source.published_at?.slice(0, 10) && source.published_at.slice(0, 10) > input.collected_at) throw new OperationsError(422, 'OBSERVATION_SOURCE_DATE', '材料发布日期晚于所填采集日期，请核对时点。')
    const observation: OperationsObservation = { id: `ACT-${randomUUID()}`, project_id: project.id, snapshot_id: snapshot.id,
      created_at: new Date().toISOString(), source_hash: digest({ source }), source_title: source.title, source_snapshot: structuredClone(source), input }
    const comparison = await this.calculator.compare(snapshot, observation)
    return this.store.db.transaction(async db => {
      const fresh = (await db.query<ProjectRecord>('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [project.id, project.owner_id])).rows[0]
      const latestSource = fresh?.input.sources.find(row => row.id === source.id)
      if (!latestSource || digest({ source: latestSource }) !== observation.source_hash) throw new OperationsError(409, 'OBSERVATION_SOURCE_CHANGED', '实绩原始依据刚被更新，请刷新并重新核对。')
      const found = (await db.query('SELECT id FROM operation_observations WHERE project_id=$1 AND facility_id=$2 AND period=$3', [project.id, input.facility_id, input.period])).rows[0]
      if (found) throw new OperationsError(409, 'OBSERVATION_EXISTS', '该中心该月已有冻结实绩，不能重复录入或改换校准/留出用途。')
      await db.query('INSERT INTO operation_observations(id,project_id,snapshot_id,facility_id,period,payload,comparison) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [observation.id, project.id, snapshot.id, input.facility_id, input.period, JSON.stringify(observation), JSON.stringify(comparison)])
      return observation
    })
  }
}
