/* Generated from packages/contracts/schema.json. Run npm run contracts. */

/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "CandidateId".
 */
export type CandidateId = "retain_and_reuse" | "selective_rebuild" | "whole_site_rebuild" | "defer_and_investigate";
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ResearchDimension".
 */
export type ResearchDimension = "demand" | "supply" | "adaptation" | "implementation" | "operations" | "resources";
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenProfile".
 */
export type MapScreenProfile = "balanced" | "commercial" | "enterprise" | "neighborhood";
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenTheme".
 */
export type MapScreenTheme =
  "overall" | "implementation" | "adaptation" | "demand" | "supply" | "operations" | "resources" | "access";

export interface ProjectInput {
  schema_version: "2.0";
  project_id: string;
  synthetic: boolean;
  purpose: string;
  mode: "automatic" | "enterprise";
  role: "investment_manager" | "planner" | "executive";
  as_of: string;
  scope: Scope;
  /**
   * @maxItems 5000
   */
  facts: Fact[];
  /**
   * @maxItems 1000
   */
  sources: Source[];
  /**
   * @maxItems 1000
   */
  context_rules: ExperienceRule[];
  /**
   * @minItems 1
   * @maxItems 3
   */
  candidate_ids: CandidateId[];
  events: InputEvent[];
  business_profile?: "general" | "neighborhood";
  knowledge_query?: KnowledgeQuery;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Scope".
 */
export interface Scope {
  name: string;
  geometry: Geometry | null;
  coordinate_encoding: "WGS84";
  legal_parcel_confirmed: boolean;
  city?: string;
  region_pack?: string;
  centroid?: GeoPoint;
  map_anchor?: MapAnchor;
  resolution_status?: "provided_polygon" | "place_point" | "ambiguous" | "uncovered";
  resolution_note?: string;
  boundary_source?: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Geometry".
 */
export interface Geometry {
  type: "Polygon";
  /**
   * @minItems 1
   */
  coordinates: number[][][];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "GeoPoint".
 */
export interface GeoPoint {
  latitude: number;
  longitude: number;
  label: string;
  source_id: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapAnchor".
 */
export interface MapAnchor {
  provider: "amap";
  coordinate_encoding: "GCJ-02";
  longitude: number;
  latitude: number;
  name: string;
  poi_id?: string;
  address?: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Fact".
 */
export interface Fact {
  id: string;
  kind: string;
  value: Inventory | (string | number | boolean | null);
  unit: string | null;
  source_id: string;
  object_ref?: string;
  observed_at?: string;
  locator?: string;
  scope_kind?: "object" | "project" | "shared";
  /**
   * @maxItems 100
   */
  applies_to?: string[];
  /**
   * 事实、估算、方案假设或缺失；未标注不自动视为已核实。
   */
  epistemic_status?: "fact" | "estimate" | "assumption" | "missing";
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Inventory".
 */
export interface Inventory {
  gfa_m2: number | null;
  vacant_m2: number | null;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Source".
 */
export interface Source {
  id: string;
  title: string;
  data_class: "synthetic" | "public" | "internal" | "semi_synthetic";
  visibility: "public" | "internal";
  synthetic: boolean;
  untrusted_text?: string;
  url?: string;
  retrieved_at?: string;
  expires_at?: string;
  locator?: string;
  hash?: string;
  license?: string;
  content_status?: "full_text" | "excerpt" | "metadata_only" | "uploaded";
  published_at?: string;
  parse_status?: "extracted" | "empty" | "ocr_required";
  search_published_at?: string;
  date_status?: "verified" | "search_only" | "conflict" | "undated";
  /**
   * @maxItems 100
   */
  object_refs?: string[];
  evidence_scope?: "object" | "area" | "background";
  raw_hash?: string;
  records_truncated?: boolean;
  body_truncated?: boolean;
  /**
   * 原始结构化记录快照，保留解析时的来源标识和原文哈希；读取时映射到当前来源命名空间。缺失表示未保留，空数组表示解析后无保留记录。
   *
   * @maxItems 50
   */
  public_records?: PublicRecord[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "PublicRecord".
 */
export interface PublicRecord {
  id: string;
  adapter: "landchina" | "construction" | "statistics" | "procurement";
  subject: string;
  scope: "object" | "area";
  period: string;
  source_id: string;
  /**
   * @maxItems 40
   */
  fields: PublicField[];
  source_hash?: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "PublicField".
 */
export interface PublicField {
  key: string;
  label: string;
  value: string | number | null;
  unit: string;
  raw: string;
  locator: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ExperienceRule".
 */
export interface ExperienceRule {
  id: string;
  kind: "organizational_constraint" | "preference" | "capability_lead" | "fact_candidate" | "unknown" | "heuristic";
  scope: "project";
  predicate: string;
  value: string | number | boolean | null;
  source_id: string;
  authority_status: "project_confirmed" | "unverified";
  supersedes: string | null;
  note: string;
  project_id?: string;
  original_text?: string;
  active?: boolean;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "InputEvent".
 */
export interface InputEvent {
  kind: string;
  changed_rule_ids?: string[];
  revision?: number;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeQuery".
 */
export interface KnowledgeQuery {
  measure_key: string;
  question: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Finding".
 */
export interface Finding {
  id: string;
  dimension: "implementation" | "building" | "demand" | "organization" | "enterprise" | "resources";
  claim: string;
  status: "supported" | "conditional" | "unknown" | "conflict";
  evidence_refs: string[];
  opposition_refs: string[];
  unknowns: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Metric".
 */
export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: string | null;
  status: "known" | "unknown" | "conflict";
  source_refs: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Scenario".
 */
export interface Scenario {
  id: CandidateId;
  title: string;
  status: "conditional" | "blocked" | "investigate";
  actions: string[];
  prerequisites: string[];
  blockers: string[];
  evidence_refs: string[];
  rule_refs: string[];
  counterevidence: string[];
  enterprise_fit: string;
  resource_status: string;
  demolition_scope: "none" | "partial" | "whole_site";
  preference_notes: string[];
  /**
   * @minItems 1
   * @maxItems 6
   */
  action_specs?: ActionSpec[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ActionSpec".
 */
export interface ActionSpec {
  kind: "retain" | "partial_demolition" | "whole_demolition" | "retrofit" | "use_change" | "investigate" | "phase_work";
  objects: string[];
  condition: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Review".
 */
export interface Review {
  id: string;
  severity: "high" | "medium" | "low";
  issue: string;
  target_refs: string[];
  evidence_refs: string[];
  recommendation: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Followup".
 */
export interface Followup {
  id: string;
  priority: number;
  title: string;
  why: string;
  impacted_paths: CandidateId[];
  status: "suggested" | "requested";
  /**
   * @minItems 0
   * @maxItems 100
   */
  evidence_refs?: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "Impact".
 */
export interface Impact {
  changed_rule_ids: string[];
  invalidated: string[];
  reused: string[];
  changed_paths: CandidateId[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DecisionPacket".
 */
export interface DecisionPacket {
  schema_version: "2.0";
  project_id: string;
  run_id: string;
  revision: number;
  snapshot_hash: string;
  context_version: number;
  mode: "automatic" | "enterprise";
  execution_mode: "offline" | "live";
  synthetic: boolean;
  status: "success" | "partial" | "empty" | "blocked" | "failed";
  summary: string;
  as_of: string;
  created_at: string;
  findings: Finding[];
  metrics: Metric[];
  scenarios: Scenario[];
  reviews: Review[];
  followups: Followup[];
  sources: Source[];
  context_rules: ExperienceRule[];
  impact: Impact;
  warnings: string[];
  missing_fields: string[];
  artifact_refs: string[];
  runtime: string;
  model: string | null;
  comparison?: ComparisonPacket;
  model_calls?: ModelCall[];
  research?: ResearchTrace;
  analysis_method?: "deterministic_checks" | "model_assisted";
  unresolved_disagreements?: string[];
  scope?: Scope;
  decision_support?: DecisionSupport;
  neighborhood_action?: NeighborhoodActionAdvice;
  knowledge?: KnowledgeTrace;
  knowledge_agent?: KnowledgeAgentReport;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ComparisonPacket".
 */
export interface ComparisonPacket {
  /**
   * 比较维度的语义版本；历史结果未提供时保留旧六维，不按当前项目方向重新标注。
   */
  policy_version?: string;
  summary: string;
  /**
   * @minItems 3
   * @maxItems 6
   */
  criteria: ComparisonCriterion[];
  tied_paths: CandidateId[];
  unresolved_disagreements: string[];
  /**
   * @minItems 1
   * @maxItems 6
   */
  followups: Followup[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ComparisonCriterion".
 */
export interface ComparisonCriterion {
  criterion:
    | "implementation"
    | "building"
    | "demand"
    | "organization"
    | "enterprise"
    | "resources"
    | "supply"
    | "adaptation"
    | "operations";
  judgments: CriterionJudgment[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "CriterionJudgment".
 */
export interface CriterionJudgment {
  scenario_id: CandidateId;
  conclusion: string;
  evidence_refs: string[];
  unknowns: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ModelCall".
 */
export interface ModelCall {
  stage: string;
  requested_model: string;
  returned_model: string | null;
  finish_reason: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  session_id: string | null;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  error_code?: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ResearchTrace".
 */
export interface ResearchTrace {
  status: "success" | "partial" | "blocked" | "not_applicable";
  queries: string[];
  source_ids: string[];
  warnings: string[];
  reused: boolean;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DecisionSupport".
 */
export interface DecisionSupport {
  status: "completed" | "unavailable" | "failed";
  provider: "qwen_systemone";
  model: string;
  policy_version: string;
  input_hash: string;
  created_at: string;
  request_id: string | null;
  duration_ms: number;
  input_tokens: number | null;
  answers: {
    next_action: DecisionChoice;
    priority_dimension: DecisionChoice;
    evidence_sufficient: number;
  } | null;
  action: ("investigate" | "resolve_blocker" | "compare" | "review") | null;
  priority: ("implementation" | "adaptation" | "demand" | "operations" | "resources" | "access" | "supply") | null;
  next_step: string;
  /**
   * @maxItems 12
   */
  guard_reasons: string[];
  input_source_ids: string[];
  thresholds: {
    min_confidence: number;
    min_choice_probability: number;
    min_sufficiency: number;
  };
  error_code: string | null;
  dashboard?: DecisionDashboard;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DecisionChoice".
 */
export interface DecisionChoice {
  choice: string;
  confidence: number;
  probabilities: {
    [k: string]: number;
  };
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DecisionDashboard".
 */
export interface DecisionDashboard {
  policy_version: string;
  purpose: string;
  /**
   * @maxItems 6
   */
  dimensions: DimensionScore[];
  model: string;
  request_id: string | null;
  status: "completed" | "partial" | "unavailable";
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DimensionScore".
 */
export interface DimensionScore {
  key: ResearchDimension;
  value: number | null;
  confidence: number | null;
  /**
   * @maxItems 8
   */
  evidence_refs: string[];
  basis: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "NeighborhoodActionAdvice".
 */
export interface NeighborhoodActionAdvice {
  decision: "proceed" | "supplement" | "defer";
  label: string;
  rule_version: string;
  reasons: {
    text: string;
    evidence_refs: string[];
  }[];
  missing: {
    key: string;
    label: string;
    where: string;
    impact: string;
  }[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeTrace".
 */
export interface KnowledgeTrace {
  policy_version: "knowledge-routing-v1" | "knowledge-routing-v2";
  evaluated_as_of: string;
  query: KnowledgeQuery;
  route: "case_hit" | "rule_hit" | "combined_hit" | "agent_fallback";
  /**
   * @maxItems 20
   */
  case_hits: KnowledgeMatch[];
  /**
   * @maxItems 20
   */
  rule_hits: KnowledgeMatch[];
  /**
   * @maxItems 100
   */
  candidates: KnowledgeMatch[];
  /**
   * @maxItems 30
   */
  reasons: string[];
  fallback_status: "not_needed" | "pending" | "offline_only" | "blocked_external" | "executed";
  agent_status?: "pending" | "executed" | "offline_only" | "blocked_external";
  grouping?: KnowledgeGrouping;
  factor_policy?: KnowledgePolicyEvaluation;
  /**
   * @maxItems 30
   */
  skill_refs?: {
    skill_id: string;
    revision: number;
  }[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeMatch".
 */
export interface KnowledgeMatch {
  card_id: string;
  card_revision: number;
  title: string;
  source_project_id: string;
  kind: "case" | "rule";
  origin: "project_case" | "official_policy" | "research_paper" | "practice";
  measure_key: string;
  measure_name: string;
  similarity: number;
  related: boolean;
  transferability: "transferable" | "conditional" | "not_transferable";
  /**
   * @maxItems 30
   */
  conditions: KnowledgeConditionMatch[];
  /**
   * @maxItems 20
   */
  exclusions: KnowledgeConditionMatch[];
  /**
   * @maxItems 30
   */
  similar_conditions: string[];
  /**
   * @maxItems 30
   */
  important_differences: string[];
  /**
   * @maxItems 30
   */
  reuse_premises: string[];
  /**
   * @maxItems 30
   */
  unknowns: string[];
  recommendation: string | null;
  /**
   * @maxItems 100
   */
  evidence_refs: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeConditionMatch".
 */
export interface KnowledgeConditionMatch {
  condition: KnowledgeCondition;
  state: "matched" | "unmatched" | "unknown" | "conflict";
  /**
   * @maxItems 100
   */
  fact_refs: string[];
  /**
   * @maxItems 100
   */
  evidence_refs: string[];
  reason: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeCondition".
 */
export interface KnowledgeCondition {
  fact_kind: string;
  label: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";
  value: string | number | boolean;
  unit: string | null;
  /**
   * @minItems 1
   * @maxItems 5
   */
  evidence: ExperienceEvidence[];
  /**
   * 原文条件取值或词句；value可为人工复核的归一化映射，二者分开记录，不把布尔词义映射当作原文事实。
   */
  source_value?: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ExperienceEvidence".
 */
export interface ExperienceEvidence {
  document_id: string;
  version: string;
  locator: string;
  quote: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeGrouping".
 */
export interface KnowledgeGrouping {
  policy_id: string | null;
  policy_revision: number | null;
  policy_status: "draft" | "approved" | "rejected" | "none";
  /**
   * @maxItems 200
   */
  groups: KnowledgeGroup[];
  /**
   * @maxItems 200
   */
  unassigned: {
    card_id: string;
    reason: string;
  }[];
  candidate_count: number;
  truncated: boolean;
  source_fingerprint: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeGroup".
 */
export interface KnowledgeGroup {
  id: string;
  measure_key: string;
  stage: string;
  kind: "case" | "rule";
  /**
   * @maxItems 200
   */
  card_refs: SkillCardRef[];
  diameter: number | null;
  min_coverage: number | null;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "SkillCardRef".
 */
export interface SkillCardRef {
  card_id: string;
  revision: number;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgePolicyEvaluation".
 */
export interface KnowledgePolicyEvaluation {
  policy_id: string;
  revision: number;
  /**
   * @maxItems 100
   */
  checks: PolicyFactorCheck[];
  guard: "none" | "supplement" | "defer";
  /**
   * @maxItems 100
   */
  evidence_refs: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "PolicyFactorCheck".
 */
export interface PolicyFactorCheck {
  key: string;
  label: string;
  state: "matched" | "unmatched" | "unknown" | "conflict";
  reason: string;
  /**
   * @maxItems 100
   */
  evidence_refs: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeAgentReport".
 */
export interface KnowledgeAgentReport {
  policy_version: "knowledge-agent-v1";
  assessment: KnowledgeAgentAssessment;
  final_action: "proceed" | "supplement" | "defer";
  /**
   * @minItems 0
   * @maxItems 100
   */
  decision_evidence_refs: string[];
  /**
   * @minItems 0
   * @maxItems 30
   */
  guard_reasons: string[];
  /**
   * @minItems 0
   * @maxItems 40
   */
  assessed_card_ids: string[];
  /**
   * @maxItems 100
   */
  final_citations?: KnowledgeCitation[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeAgentAssessment".
 */
export interface KnowledgeAgentAssessment {
  summary: string;
  decision: KnowledgeAgentDecision;
  /**
   * @minItems 1
   * @maxItems 8
   */
  recommendations: KnowledgeAgentAdvice[];
  /**
   * @minItems 0
   * @maxItems 10
   */
  disagreements: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeAgentDecision".
 */
export interface KnowledgeAgentDecision {
  action: "proceed" | "supplement" | "defer";
  reasoning: string;
  /**
   * @minItems 1
   * @maxItems 10
   */
  citations: KnowledgeCitation[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeCitation".
 */
export interface KnowledgeCitation {
  source_id: string;
  locator: string;
  quote: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "KnowledgeAgentAdvice".
 */
export interface KnowledgeAgentAdvice {
  measure_key: string;
  advice: string;
  reasoning: string;
  /**
   * @minItems 1
   * @maxItems 10
   */
  matched_card_ids: string[];
  /**
   * @minItems 1
   * @maxItems 20
   */
  matched_condition_keys: string[];
  /**
   * @minItems 1
   * @maxItems 10
   */
  citations: KnowledgeCitation[];
  /**
   * @minItems 0
   * @maxItems 10
   */
  unknowns: string[];
  /**
   * @minItems 0
   * @maxItems 5
   */
  next_steps: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "CapabilityResult".
 */
export interface CapabilityResult {
  status: "success" | "partial" | "empty" | "blocked" | "failed";
  findings: Finding[];
  metrics: Metric[];
  warnings: string[];
  missing_fields: string[];
  artifact_refs: string[];
  version: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RuntimeEvent".
 */
export interface RuntimeEvent {
  id: number;
  run_id: string;
  stage: string;
  status: "running" | "completed" | "failed" | "blocked" | "reused";
  message: string;
  artifact_ref: string | null;
  created_at: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ScenarioProposal".
 */
export interface ScenarioProposal {
  /**
   * @minItems 2
   * @maxItems 3
   */
  scenarios: Scenario[];
  rationale: string;
  unresolved: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ReviewPacket".
 */
export interface ReviewPacket {
  /**
   * @minItems 1
   * @maxItems 8
   */
  reviews: Review[];
  unresolved_disagreements: string[];
  needs_revision: boolean;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ModelRule".
 */
export interface ModelRule {
  kind: "organizational_constraint" | "preference" | "capability_lead" | "fact_candidate" | "unknown" | "heuristic";
  predicate:
    | "no_whole_site_demolition"
    | "prefer_phasing"
    | "renewal_experience"
    | "active_lease"
    | "structural_safety"
    | "unclassified_experience"
    | "untrusted_instruction";
  value: string | boolean | null;
  original_text: string;
  note: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ModelContext".
 */
export interface ModelContext {
  /**
   * @maxItems 20
   */
  rules: ModelRule[];
  warnings: string[];
  unclassified: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenBounds".
 */
export interface MapScreenBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenTarget".
 */
export interface MapScreenTarget {
  kind: "point" | "cell";
  longitude: number;
  latitude: number;
  radius_m: number | null;
  bounds: MapScreenBounds | null;
  geometry?: MapRegionGeometry | null;
  label?: string;
  object_ref?: string;
  label_origin?: "public" | "project" | "unresolved";
  boundary_source?: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapRegionGeometry".
 */
export interface MapRegionGeometry {
  type: "Polygon";
  /**
   * @minItems 1
   * @maxItems 20
   */
  coordinates: number[][][];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenPoi".
 */
export interface MapScreenPoi {
  id: string;
  name: string;
  category: string;
  longitude: number;
  latitude: number;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenEvidence".
 */
export interface MapScreenEvidence {
  key: "transit" | "activity" | "work_live" | "civic";
  source_id: string;
  label: string;
  types_query: string;
  status: "available" | "failed" | "capped";
  reported_count: number | null;
  /**
   * @maxItems 25
   */
  sample: MapScreenPoi[];
  retrieved_at: string;
  issue: string | null;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenContext".
 */
export interface MapScreenContext {
  id: string;
  target: MapScreenTarget;
  provider: "amap";
  coordinate_encoding: "GCJ-02";
  created_at: string;
  expires_at: string;
  address: string | null;
  /**
   * @maxItems 4
   */
  groups: MapScreenEvidence[];
  status: "complete" | "partial";
  /**
   * @maxItems 12
   */
  gaps: string[];
  metric_note: string;
  city: string | null;
  local_projects: MapProjectEvidence[];
  project_revision: string;
  /**
   * @maxItems 12
   */
  research_sources?: Source[];
  /**
   * @maxItems 100
   */
  research_records?: PublicRecord[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapProjectEvidence".
 */
export interface MapProjectEvidence {
  project_id: string;
  name: string;
  relation: "within_scope" | "city_background";
  scope_label: string;
  updated_at: string;
  context_version: number;
  source_count: number;
  fact_count: number;
  document_count: number;
  sources: Source[];
  facts: Fact[];
  rules: ExperienceRule[];
  business_profile?: "general" | "neighborhood";
  as_of?: string;
  neighborhood_action?: NeighborhoodActionAdvice;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenClaim".
 */
export interface MapScreenClaim {
  text: string;
  /**
   * @minItems 1
   * @maxItems 4
   */
  evidence_refs: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapPreliminaryAssessment".
 */
export interface MapPreliminaryAssessment {
  summary: string;
  /**
   * @maxItems 1
   */
  opportunities: MapScreenClaim[];
  /**
   * @maxItems 1
   */
  cautions: MapScreenClaim[];
  /**
   * @maxItems 1
   */
  unknowns: string[];
  /**
   * @maxItems 1
   */
  next_steps: string[];
  /**
   * @maxItems 6
   */
  factors?: MapDecisionFactor[];
  /**
   * @maxItems 6
   */
  dimension_evidence?: DimensionEvidence[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapDecisionFactor".
 */
export interface MapDecisionFactor {
  key: "implementation" | "adaptation" | "demand" | "operations" | "resources" | "access" | "supply";
  state: "supported" | "conditional" | "blocked" | "unknown";
  summary: string;
  /**
   * @maxItems 4
   */
  evidence_refs: string[];
  quote: string;
  conflict?: boolean;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DimensionEvidence".
 */
export interface DimensionEvidence {
  key: ResearchDimension;
  source_id: string;
  quote: string;
  basis: string;
  record_id?: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenAnalysis".
 */
export interface MapScreenAnalysis {
  context_id: string;
  profile: MapScreenProfile;
  status: "completed" | "unavailable" | "failed" | "insufficient_data" | "partial";
  assessment: MapPreliminaryAssessment | null;
  /**
   * @maxItems 6
   */
  model_calls: ModelCall[];
  reason: string | null;
  created_at: string;
  decision_support?: DecisionSupport;
  /**
   * @maxItems 12
   */
  research_sources?: Source[];
  /**
   * @maxItems 100
   */
  research_records?: PublicRecord[];
  /**
   * @maxItems 12
   */
  adapter_receipts?: AdapterReceipt[];
  research?: ResearchTrace;
  reused_from_context_id?: string;
  refresh_required?: boolean;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "AdapterReceipt".
 */
export interface AdapterReceipt {
  source_id: string;
  adapter: string;
  status: "success" | "empty" | "access_required" | "schema_changed" | "unsupported" | "truncated";
  /**
   * @maxItems 50
   */
  record_ids: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenCell".
 */
export interface MapScreenCell {
  id: string;
  label: string;
  bounds: MapScreenBounds;
  context: MapScreenContext | null;
  tier: "pending" | "strong" | "moderate" | "sparse" | "empty" | "incomplete";
  rank: number | null;
  metric_value: number | null;
  geometry?: MapRegionGeometry;
  /**
   * @minItems 2
   * @maxItems 2
   */
  anchor?: number[];
  boundary_source?: string;
  area_m2?: number;
  /**
   * @maxItems 6
   */
  factors?: MapDecisionFactor[];
  dashboard?: DecisionDashboard;
  analysis_available?: boolean;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapScreenResult".
 */
export interface MapScreenResult {
  id: string;
  bounds: MapScreenBounds;
  profile: MapScreenProfile;
  created_at: string;
  /**
   * @maxItems 24
   */
  cells: MapScreenCell[];
  status: "completed" | "partial";
  method: string;
  comparison_count: number;
  /**
   * @maxItems 10
   */
  notes: string[];
  theme: MapScreenTheme;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapDataProject".
 */
export interface MapDataProject {
  project_id: string;
  name: string;
  scope_label: string;
  city: string;
  located: boolean;
  source_count: number;
  public_source_count: number;
  internal_source_count: number;
  fact_count: number;
  document_count: number;
  updated_at: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MapDataCatalog".
 */
export interface MapDataCatalog {
  created_at: string;
  projects: MapDataProject[];
  real_project_count: number;
  synthetic_project_count: number;
  unlocated_project_count: number;
  notes: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ExperienceField".
 */
export interface ExperienceField {
  key:
    | "decision_question"
    | "background"
    | "key_conditions"
    | "alternatives"
    | "proposal"
    | "actual_decision"
    | "decision_basis"
    | "implementation"
    | "outcome"
    | "applicability";
  value: string | null;
  /**
   * @maxItems 5
   */
  evidence: ExperienceEvidence[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ExperienceDraft".
 */
export interface ExperienceDraft {
  title: string;
  project_type: string;
  development_mode: string;
  stage: string;
  /**
   * @maxItems 10
   */
  fields: ExperienceField[];
  knowledge?: ExperienceKnowledge;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ExperienceKnowledge".
 */
export interface ExperienceKnowledge {
  kind: "case" | "rule";
  origin: "project_case" | "official_policy" | "research_paper" | "practice";
  measure_key: string;
  measure_name: string;
  /**
   * @maxItems 30
   */
  conditions: KnowledgeCondition[];
  /**
   * @maxItems 20
   */
  exclusions: KnowledgeCondition[];
  /**
   * @maxItems 10
   */
  transfer_notes: string[];
  evidence_level:
    | "proposal_only"
    | "implementation_record"
    | "observational_study"
    | "controlled_study"
    | "official_policy"
    | "expert_practice"
    | "not_reported";
  /**
   * @maxItems 100
   */
  chunks?: ActionChunk[];
  /**
   * @maxItems 100
   */
  factors?: MeasureFactor[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ActionChunk".
 */
export interface ActionChunk {
  id: string;
  document_id: string;
  document_version: string;
  measure_key: string;
  object_ref: string | null;
  stage: string;
  kind: "action" | "context";
  classification: "local" | "model";
  /**
   * @maxItems 100
   */
  spans: ExperienceEvidence[];
  text: string;
  /**
   * @maxItems 100
   */
  context_chunk_ids: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MeasureFactor".
 */
export interface MeasureFactor {
  key: string;
  label: string;
  value: string | number | boolean | null;
  unit: string | null;
  object_ref: string | null;
  stage: string;
  observed_at: string | null;
  association: "direct" | "shared" | "unresolved" | "derived";
  amount_kind:
    "budget" | "contract" | "paid" | "committed" | "maintenance" | "package_total" | "unknown" | "not_applicable";
  epistemic_status: "fact" | "estimate" | "scenario_assumption" | "missing";
  /**
   * @maxItems 30
   */
  evidence: ExperienceEvidence[];
  derivation?: MeasureCalculation;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "MeasureCalculation".
 */
export interface MeasureCalculation {
  formula: "cost_per_unit" | "cost_per_area" | "cost_per_person";
  numerator_key: string;
  denominator_key: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ExperienceCard".
 */
export interface ExperienceCard {
  title: string;
  project_type: string;
  development_mode: string;
  stage: string;
  /**
   * @maxItems 10
   */
  fields: ExperienceField[];
  id: string;
  project_id: string;
  status: "draft" | "approved" | "rejected";
  revision: number;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  knowledge?: ExperienceKnowledge;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ExperienceDraftBatch".
 */
export interface ExperienceDraftBatch {
  /**
   * @maxItems 20
   */
  drafts: ExperienceDraft[];
  /**
   * @maxItems 20
   */
  warnings: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "FactorDefinition".
 */
export interface FactorDefinition {
  key: string;
  label: string;
  value_type: "number" | "category" | "boolean" | "ordinal";
  role: "mandatory" | "key" | "background" | "discarded" | "pending";
  weight: number;
  unit: string | null;
  scale: number | null;
  /**
   * @maxItems 50
   */
  measure_keys: string[];
  /**
   * @maxItems 30
   */
  evidence: ExperienceEvidence[];
  condition?: KnowledgeCondition;
  on_unmet?: "supplement" | "defer";
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "FactorPolicy".
 */
export interface FactorPolicy {
  id: string;
  project_id: string;
  revision: number;
  status: "draft" | "approved" | "rejected";
  /**
   * @maxItems 100
   */
  definitions: FactorDefinition[];
  min_coverage: number;
  max_distance: number;
  note: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DistilledSkill".
 */
export interface DistilledSkill {
  id: string;
  project_id: string;
  revision: number;
  status: "draft" | "approved" | "rejected";
  title: string;
  measure_key: string;
  /**
   * @maxItems 20
   */
  card_refs: SkillCardRef[];
  /**
   * @maxItems 100
   */
  input_keys: string[];
  /**
   * @maxItems 100
   */
  preconditions: KnowledgeCondition[];
  /**
   * @maxItems 100
   */
  exclusions: KnowledgeCondition[];
  /**
   * @maxItems 20
   */
  procedure: string[];
  /**
   * @maxItems 20
   */
  validation_points: string[];
  /**
   * @maxItems 20
   */
  counterexamples: string[];
  /**
   * @maxItems 1
   */
  allowed_tools: "knowledge_evidence"[];
  method: "compiled" | "model";
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}
