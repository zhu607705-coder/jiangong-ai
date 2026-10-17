import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { join } from 'node:path'
import { OfflineAdapter } from './offline-adapter'
import { roles, domainPersona, type RoleId } from '../roles'
import type { CapabilityResult, ProjectInput } from '../../apps/host/generated/contracts'
import { validate } from '../../packages/contracts/validate'
import {DEEPSEEK_MODELS,canonicalDeepSeekModel} from './deepseek-catalog'

export type BridgeOptions = {
  runId: string; sessionRoot: string; executionMode: 'offline' | 'live'; model: string;
  pendingRoles: RoleId[]; project: ProjectInput; signal: AbortSignal;
  analyze: (role: RoleId, signal: AbortSignal) => Promise<CapabilityResult>;
  onStage: (role: RoleId, status: 'running' | 'completed', sessionId: string) => Promise<void>;
}

/** DSH owns agent creation, delegation, cancellation, tool execution and durable sessions. */
export async function runSpecialists(options: BridgeOptions): Promise<Map<RoleId, CapabilityResult>> {
  const ctx = new Context()
  const results = new Map<RoleId, CapabilityResult>()
  const toolCalls = new Map<RoleId, number>()
  let requests = 0
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(JsonlPersistence, { root: join(options.sessionRoot, options.runId), compression: 'none' })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjection)
    await ctx.plugin(SystemPrompt, { personaPrefix: domainPersona, personaSuffix: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 3 })
    await ctx.plugin(Subagents, { maxDepth: 1 })
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    if (options.executionMode === 'offline') ctx.llm.registerAdapter(['offline'], new OfflineAdapter())
    else await ctx.plugin(DeepSeek, { apiKeyEnv: 'DEEPSEEK_API_KEY',models:DEEPSEEK_MODELS })
    // One bounded gate, on the existing DSH extension seam; no second agent loop.
    ctx.on('llm/stream', (request, next) => {
      if (++requests > 12 || options.signal.aborted) throw new Error('RUN_BUDGET_EXCEEDED')
      return next()
    })
    for (const role of roles.filter(r => options.pendingRoles.includes(r.id))) {
      ctx.tools.register(defineTool({
        name: role.tool, description: `对当前冻结快照执行${role.label}的确定性证据检查。`, parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute() {
          if ((toolCalls.get(role.id) || 0) >= 1) throw new Error('ROLE_TOOL_BUDGET_EXCEEDED')
          toolCalls.set(role.id, 1)
          const result = validate<CapabilityResult>('CapabilityResult', await options.analyze(role.id, options.signal))
          results.set(role.id, result)
          return JSON.stringify(result)
        },
      }))
    }
    const route = options.executionMode === 'offline' ? { provider: 'offline', model: 'engineering-tools-v1' } : { provider: 'deepseek-official', model: canonicalDeepSeekModel(options.model) }
    const parentId = SessionId(options.runId)
    const parentHandle = await ctx.sessionPersistence.stat(parentId)
      ? await ctx.agents.resume({ resumeSessionId: parentId })
      : await ctx.agents.create({ sessionId: parentId, agentOptions: { ...route, maxTokens: 2000 } })
    try {
      const parent = parentHandle.agent
      const work = roles.filter(r => options.pendingRoles.includes(r.id)).map(async role => {
        const child = await ctx.subagents.start('spawn', { parent, signal: options.signal, label: role.label, maxDepth: 1,
          toolFilter: { allow: [role.tool] }, persona: domainPersona,
          prompt: [{ type: 'text', text: `项目 ${options.project.project_id}；角色 ${role.id}。调用 ${role.tool} 获取获授权的快照分析结果，保留 unknown 后结束。禁止委派。` }] })
        try {
          await options.onStage(role.id, 'running', String(child.id))
          const outcome = await child.result
          if (outcome.stopReason !== 'completed' || !results.has(role.id)) throw new Error(`SPECIALIST_FAILED:${role.id}:${outcome.stopReason}`)
          await options.onStage(role.id, 'completed', String(child.id))
        } finally { await child.dispose() }
      })
      const outcomes = await Promise.allSettled(work)
      const failure = outcomes.find(v => v.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    } finally { await parentHandle.dispose() }
    return results
  } finally { await ctx.fiber.dispose() }
}
