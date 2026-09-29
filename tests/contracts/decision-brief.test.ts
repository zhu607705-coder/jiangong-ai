import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { projectInput } from '../../packages/contracts/validate'
import { assembleDecision } from '../../packages/decision/evaluate'
import { buildDecisionBrief } from '../../packages/decision/brief-view'
import { renderReport } from '../../apps/host/reports'
import type { ComparisonCriterion, DecisionPacket } from '../../apps/host/generated/contracts'

function packet(): DecisionPacket {
  const project = projectInput(JSON.parse(readFileSync('fixtures/inputs/01_auto.json', 'utf8')))
  project.candidate_ids = ['retain_and_reuse', 'selective_rebuild', 'defer_and_investigate']
  const result = assembleDecision({ project, runId: 'RUN-TEST', revision: 1, contextVersion: 1, snapshotHash: 'test', executionMode: 'offline', results: [], artifactRefs: [], impact: { changed_rule_ids: [], invalidated: [], reused: [], changed_paths: [] }, model: null })
  result.summary = '建议先走 defer_and_investigate：先补对象与权限证据再定路径。'
  const [retain, selective, investigate] = result.scenarios
  retain.title = '图C楼机电与空间专项改造'
  retain.actions = ['按图C楼机电系统和交流空间分别核对采购标项', '按目标楼栋编制工程量与不停业施工方案']
  retain.prerequisites.push('取得图C楼专项招标文件与资格条件正文', '核对本企业机电资质与类似业绩')
  retain.evidence_refs = ['S-01']
  selective.title = '西区局部拆改与专业界面'
  selective.prerequisites.push('取得西区项目标段划分与施工边界', '核对拟拆楼栋和相邻建筑保护方案')
  investigate.title = '暂缓基线：先补对象与权限证据再定路径'
  investigate.actions = ['先锁定目标楼栋身份与法定地块边界', '取得校方公开的专项采购文件']
  investigate.prerequisites.push('确认图C楼是否落在本次研究范围')
  result.scenarios = [retain, selective, investigate]
  result.findings = [{ id: 'F1', dimension: 'implementation', claim: '图C楼机电专项与交流空间改造分别形成采购标项，工期及资格条件需按原公告核对。', status: 'supported', evidence_refs: ['S-01'], opposition_refs: [], unknowns: ['后续采购是否沿用相同分包方式'] }]
  result.followups = [
    { id: 'decision-generic', title: '核查用途、权利取得与腾退条件。', why: '返回概率未达阈值。', priority: 1, status: 'suggested', impacted_paths: project.candidate_ids },
    { id: 'FU-SPECIFIC', title: '取得图C楼专项招标文件与资格条件正文', why: '核对机电资质、标段与工期后才可判断参与方式。', priority: 1, status: 'suggested', impacted_paths: ['retain_and_reuse'] },
  ]
  const judgment = (scenario_id: typeof project.candidate_ids[number], conclusion: string, unknowns: string[] = []) => ({ scenario_id, conclusion, unknowns, evidence_refs: ['S-01'] })
  const rows: [ComparisonCriterion['criterion'], string, string][] = [
    ['implementation', '图C楼机电与交流空间分别采购，但未取得专项招标正文。', '西区标段划分未公开。'],
    ['building', '图C楼改造先例不等于目标楼栋结构适配。', '拟拆楼栋和相邻建筑保护资料缺失。'],
    ['demand', '交流空间的实际使用人群与付费方未见原文。', '西区新增空间的使用主体未确认。'],
    ['organization', '可按单栋专项组织投标，需核对校方采购界面。', '新建和改造的合同主体尚不明确。'],
    ['enterprise', '公告列出机电资质门槛，尚需与本企业证书逐项比对。', '现有能力材料不能证明拆改资质。'],
    ['resources', '原公告披露工期，不得外推到后续项目。', '西区成本资料未取得。'],
  ]
  result.comparison = {
    summary: result.summary,
    criteria: rows.map(([criterion, a, b]) => ({ criterion, judgments: [judgment('retain_and_reuse', a, ['图C楼专项招标文件']), judgment('selective_rebuild', b, ['西区标段划分']), judgment('defer_and_investigate', criterion === 'enterprise' ? '企业适配待核，连续中标观察不足以支撑入口判断。' : '暂缓基线，先补对象与权限证据再定路径。')] })),
    tied_paths: [], unresolved_disagreements: [], followups: result.followups,
  }
  return result
}

describe('decision brief projection from existing evidence', () => {
  it('shows path-specific conditions before shared policy boilerplate', () => {
    const brief = buildDecisionBrief(packet())
    expect(packet().runtime).toBe('DeepSeek Harness 0.2.0-rc.1')
    expect(brief.paths[0].conditions[0]).toContain('图C楼专项招标文件')
    expect(brief.paths[1].conditions[0]).toContain('西区项目标段')
    expect(brief.paths[0].conditions).not.toContain('核实地块和建筑权属、现有租约及实施权限')
    expect(brief.investigation?.title).toContain('目标楼栋身份')
    expect(brief.investigation?.title).not.toContain('暂缓基线')
  })

  it('combines the six judgments into three evidence-linked questions per path', () => {
    const brief = buildDecisionBrief(packet())
    expect(brief.paths).toHaveLength(2)
    expect(brief.paths[0].themes).toHaveLength(3)
    expect(brief.paths[0].themes[0].judgments).toHaveLength(2)
    expect(brief.paths[0].themes[0].sourceRefs).toContain('S-01')
    expect(brief.paths[0].themes[2].judgments.join('')).toContain('机电资质门槛')
    expect(JSON.stringify(brief)).not.toMatch(/暂缓基线|企业适配待核|不足以支撑入口判断|defer_and_investigate/)
  })

  it('uses the specific follow-up and surfaces substantive findings in the report', () => {
    const value = packet(), brief = buildDecisionBrief(value), report = renderReport(value)
    expect(brief.nextActions[0].title).toContain('图C楼专项招标文件')
    expect(brief.summary).toContain('图C楼机电专项')
    expect(report).toContain('图C楼机电专项与交流空间改造分别形成采购标项')
    expect(report).toContain('S-01')
    expect(report).toContain('取得图C楼专项招标文件与资格条件正文')
    expect(report).not.toMatch(/暂缓基线|企业适配待核|不足以支撑入口判断|defer_and_investigate/)
  })

  it('keeps missing evidence missing instead of inventing a positive recommendation', () => {
    const sparse = packet()
    sparse.findings = []
    sparse.comparison = undefined
    const brief = buildDecisionBrief(sparse)
    expect(brief.summary).not.toContain('图C楼机电专项与交流空间改造分别形成采购标项')
    expect(brief.investigation?.actions).toContain('先锁定目标楼栋身份与法定地块边界')
  })

  it('never presents a blocked option as an actionable implementation path', () => {
    const value = packet()
    value.scenarios[0].status = 'blocked'
    value.scenarios[0].blockers = ['本项目明确禁止这项施工动作']
    expect(buildDecisionBrief(value).paths[0].actions).toEqual([])
    expect(renderReport(value)).not.toContain('按图C楼机电系统和交流空间分别核对采购标项')
  })

  it('retains binding project context when repeated generic prerequisites are hidden', () => {
    const value = packet()
    value.context_rules.push({ id: 'R-LOCAL', original_text: '本项目不整体拆除，存量楼栋需分期施工', active: true } as DecisionPacket['context_rules'][number])
    value.scenarios[0].rule_refs.push('R-LOCAL')
    expect(buildDecisionBrief(value).paths[0].organizationNotes).toContain('本项目不整体拆除，存量楼栋需分期施工')
    expect(renderReport(value)).toContain('本项目不整体拆除，存量楼栋需分期施工')
  })

  it('does not turn an old procurement example into an immediate bid instruction', () => {
    const value = packet()
    value.scenarios[0].actions.unshift('按历史标项工期，投90–120日历天短窗口标项')
    expect(buildDecisionBrief(value).paths[0].actions).not.toContain('按历史标项工期，投90–120日历天短窗口标项')
    expect(renderReport(value)).not.toContain('投90–120日历天短窗口标项')
  })

  it('works across the ten topical domains without borrowing the campus case', () => {
    const topical = JSON.parse(readFileSync('runtime/skills/investment-brief/references/cases.json', 'utf8')).cases.filter((c: {id:string}) => c.id.startsWith('HOT26-')) as {id:string;name:string;domain:string;published_fact:string;next_check:string}[]
    expect(topical).toHaveLength(10)
    for (const reference of topical) {
      const value = packet()
      value.sources[0].title = reference.name
      value.findings[0].claim = reference.published_fact
      value.scenarios[0].title = `${reference.domain}专项参与路径`
      value.scenarios[0].prerequisites = ['核实地块和建筑权属、现有租约及实施权限', reference.next_check]
      value.followups = [{ id: `FU-${reference.id}`, title: reference.next_check, why: '核对本领域项目的实际对象与实施阶段。', priority: 1, status: 'suggested', impacted_paths: ['retain_and_reuse'] }]
      value.comparison = undefined
      const brief = buildDecisionBrief(value), report = renderReport(value)
      expect(brief.paths[0].title).toContain(reference.domain)
      expect(brief.paths[0].conditions).toContain(reference.next_check)
      expect(brief.summary).toContain(reference.published_fact.split(/[：；。]/)[0])
      expect(report).toContain(reference.published_fact)
      expect(report).toContain(reference.name)
    }
  })
})
