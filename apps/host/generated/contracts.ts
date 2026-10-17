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
  representations?: SourceRepresentation[];
  representation_id?: string;
  canonical_source_id?: string;
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
 * via the `definition` "SourceRepresentation".
 */
export interface SourceRepresentation {
  id: string;
  kind: "raw_html" | "raw_text" | "deepseek_markdown" | "search_content";
  sha256: string;
  origin_hash: string | null;
  extractor: string;
  received_at: string;
  offset_encoding: "UTF-16";
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
 * via the `definition` "MapScoreEstimates".
 */
export interface MapScoreEstimates {
  /**
   * @maxItems 6
   */
  dimensions: RenewalReasonedDimension[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RenewalReasonedDimension".
 */
export interface RenewalReasonedDimension {
  key: "demand" | "supply" | "adaptation" | "implementation" | "operations" | "resources";
  level: "low" | "medium" | "high";
  basis: "logical_inference" | "scenario_assumption";
  /**
   * @minItems 1
   * @maxItems 3
   */
  premises: string[];
  /**
   * @maxItems 3
   */
  assumptions: string[];
  reason: string;
  verification: string;
  /**
   * @maxItems 4
   */
  evidence_refs: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DecisionResearchRouting".
 */
export interface DecisionResearchRouting {
  policy: "decision-research-routing-v1";
  request_id: string;
  /**
   * @maxItems 3
   */
  tasks: {
    role: "building_delivery" | "cost_value" | "residents_operations";
    effort: "skip" | "brief" | "standard" | "deep";
    confidence: number;
  }[];
  input_hash: string;
  duration_ms: number;
  input_tokens: number;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RenewalResearchPlan".
 */
export interface RenewalResearchPlan {
  summary: string;
  /**
   * @maxItems 3
   */
  tasks: {
    id: string;
    role: "building_delivery" | "cost_value" | "residents_operations";
    question: string;
    /**
     * @minItems 1
     * @maxItems 10
     */
    source_ids: string[];
    /**
     * @maxItems 12
     */
    question_ids?: string[];
  }[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RenewalResearchNote".
 */
export interface RenewalResearchNote {
  task_id: string;
  summary: string;
  /**
   * @maxItems 4
   */
  observations: {
    source_id: string;
    quote: string;
    locator: string;
    inference: string;
  }[];
  /**
   * @maxItems 4
   */
  missing_data: string[];
  /**
   * @maxItems 3
   */
  reasoned_proposals?: {
    kind: "logical_inference" | "scenario";
    /**
     * @minItems 1
     * @maxItems 3
     */
    premises: string[];
    /**
     * @maxItems 3
     */
    assumptions: string[];
    conclusion: string;
    verification: string;
    /**
     * @maxItems 4
     */
    evidence_refs: string[];
    /**
     * @maxItems 4
     */
    parameters?: {
      name: string;
      value: number;
      unit: string;
      low: number;
      high: number;
      basis: string;
    }[];
  }[];
  /**
   * @maxItems 4
   */
  investigation_requests?: {
    /**
     * @maxItems 6
     */
    question_ids: string[];
    /**
     * @maxItems 6
     */
    missing_fields: string[];
    /**
     * @maxItems 6
     */
    suggested_queries: string[];
    /**
     * @maxItems 6
     */
    domain_hints: string[];
    /**
     * @maxItems 6
     */
    affected_decisions: string[];
  }[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RenewalWorkPackage".
 */
export interface RenewalWorkPackage {
  id: string;
  target: string;
  target_basis: "object_source" | "project_scope" | "scenario";
  source_id: string | null;
  quote: string;
  locator: string;
  intervention: string;
  scope: string;
  quantity: number | null;
  unit: string | null;
  quantity_basis: "source" | "scenario" | "unknown";
  delivery: string;
  priority: "first" | "next" | "reserve";
  /**
   * @maxItems 5
   */
  preconditions: string[];
  /**
   * @minItems 0
   * @maxItems 8
   */
  evidence_refs: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RenewalInternalDataRequest".
 */
export interface RenewalInternalDataRequest {
  id: string;
  key: "resident_wellbeing" | "elevator_usage" | "meal_attendance" | "other";
  metric: string;
  purpose: string;
  collection_method: string;
  unit: string;
  period: string;
  denominator: string;
  /**
   * @maxItems 8
   */
  related_package_ids: string[];
  /**
   * @maxItems 8
   */
  evidence_refs: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsTimeBlock".
 */
export interface OperationsTimeBlock {
  id: string;
  name: string;
  slots: OperationsValue;
  capacity_per_slot: OperationsValue;
  demand_visits: OperationsValue;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsValue".
 */
export interface OperationsValue {
  value: number | null;
  unit: string;
  status: "factual" | "reference" | "assumption" | "missing";
  source_kind: "observation" | "public_record" | "literature" | "interview" | "demo" | "missing";
  source: string;
  as_of: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsAnalysisBound".
 */
export interface OperationsAnalysisBound {
  id: string;
  target: "service_demand_multiplier" | "service_fee" | "service_paid_share" | "service_variable_cost" | "cash_amount";
  item_id: string;
  low: number;
  high: number;
  unit: string;
  origin: "manual_scenario" | "literature_range" | "observed_range";
  basis: string;
  source_ref: string;
  as_of: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsThreshold".
 */
export interface OperationsThreshold {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  status: "feasible" | "infeasible" | "not_identifiable" | "already_balanced";
  basis: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsSensitivity".
 */
export interface OperationsSensitivity {
  id: string;
  label: string;
  low: number;
  base: number;
  high: number;
  low_balance: number | null;
  base_balance: number | null;
  high_balance: number | null;
  span: number | null;
  basis: string;
  source_ref: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsJointRange".
 */
export interface OperationsJointRange {
  tested_corners: number;
  valid_corners: number;
  min_balance: number | null;
  max_balance: number | null;
  worst_gap: number | null;
  min_at: {
    id: string;
    value: number;
  }[];
  max_at: {
    id: string;
    value: number;
  }[];
  label: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsScientificResult".
 */
export interface OperationsScientificResult {
  method_version: string;
  break_even: OperationsThreshold[];
  sensitivity: OperationsSensitivity[];
  joint_range: OperationsJointRange | null;
  notes: string[];
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
  usage_status?: "unknown" | "reported";
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
  acquisition?: {
    provider: string;
    cached_sources: number;
    new_sources: number;
    refreshed_sources: number;
    fetch_attempts: number;
    new_evidence_budget: number;
    refresh_budget: number;
  };
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "DecisionSupport".
 */
export interface DecisionSupport {
  error_detail?: string;
  /**
   * @maxItems 32
   */
  format_notes?: string[];
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
  renewal_mode?: RenewalModeAssessment;
  provisional_dashboard?: DecisionDashboard;
  research_routing?: DecisionResearchRouting;
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
 * via the `definition` "RenewalModeAssessment".
 */
export interface RenewalModeAssessment {
  policy_version: string;
  model_choice: DecisionChoice;
  priority_constraint: DecisionChoice;
  evidence_basis: DecisionChoice;
  direction: "comprehensive" | "rebuild" | "compare" | "investigate";
  status: "preliminary" | "constrained" | "uncertain";
  summary: string;
  /**
   * @maxItems 12
   */
  reasons: string[];
  next_step: string;
  /**
   * @maxItems 20
   */
  source_ids: string[];
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
  completion?: {
    execution: "completed" | "failed" | "cancelled" | "incomplete";
    evidence: "complete" | "partial" | "missing";
    version: "current" | "stale";
    evidence_revision: string;
    missing_dimensions: ("demand" | "supply" | "adaptation" | "implementation" | "operations" | "resources")[];
  };
  provisional_dashboard?: DecisionDashboard;
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
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ActionFieldSelection".
 */
export interface ActionFieldSelection {
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
  value: string;
  /**
   * @minItems 1
   * @maxItems 30
   */
  chunk_ids: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ActionReviewMeasure".
 */
export interface ActionReviewMeasure {
  measure_key: string;
  measure_name: string;
  kind: "case" | "rule";
  origin: "project_case" | "official_policy" | "research_paper" | "practice";
  /**
   * @minItems 1
   * @maxItems 30
   */
  action_chunk_ids: string[];
  /**
   * @maxItems 30
   */
  context_chunk_ids: string[];
  /**
   * @maxItems 10
   */
  fields: ActionFieldSelection[];
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
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ActionReviewBatch".
 */
export interface ActionReviewBatch {
  /**
   * @maxItems 3
   */
  measures: ActionReviewMeasure[];
  /**
   * @maxItems 30
   */
  warnings: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsService".
 */
export interface OperationsService {
  /**
   * @minItems 1
   * @maxItems 100
   */
  time_blocks?: OperationsTimeBlock[];
  id: string;
  name: string;
  capacity_per_slot: OperationsValue;
  available_slots: OperationsValue;
  demand_visits: OperationsValue;
  paid_share: OperationsValue;
  fee_per_visit: OperationsValue;
  variable_cost_per_visit: OperationsValue;
  resource_id: string;
  schedule_note: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsCashItem".
 */
export interface OperationsCashItem {
  economic_item_id: string;
  description: string;
  kind:
    | "fixed_cost"
    | "other_earned_income"
    | "government_purchase"
    | "operating_subsidy"
    | "other_support"
    | "government_direct_cost";
  amount: OperationsValue;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsInput".
 */
export interface OperationsInput {
  /**
   * @maxItems 6
   */
  analysis_bounds?: OperationsAnalysisBound[];
  name: string;
  facility_id: string;
  facility_name: string;
  period: string;
  scope_note: string;
  target_population: OperationsValue;
  unique_users: OperationsValue;
  cost_scope_complete: boolean;
  /**
   * @minItems 1
   * @maxItems 20
   */
  services: OperationsService[];
  /**
   * @maxItems 100
   */
  cash_items: OperationsCashItem[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsMetrics".
 */
export interface OperationsMetrics {
  capacity_visits: number | null;
  served_visits: number | null;
  unmet_visits: number | null;
  utilization: number | null;
  unique_users: number | null;
  coverage: number | null;
  fee_income: number | null;
  earned_income: number | null;
  operating_cost: number | null;
  government_purchase: number | null;
  operating_subsidy: number | null;
  other_support: number | null;
  balance_before_support: number | null;
  balance_after_support: number | null;
  unfunded_gap: number | null;
  required_subsidy: number | null;
  government_outlay: number | null;
  government_cost_per_visit: number | null;
  commercial_cost_coverage: number | null;
  government_direct_cost: number | null;
  total_service_cost: number | null;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsServiceMetrics".
 */
export interface OperationsServiceMetrics {
  capacity_method?: "monthly_aggregate" | "time_blocks";
  monthly_pooled_upper_bound?: number | null;
  aggregation_overstatement_visits?: number | null;
  id: string;
  name: string;
  capacity_visits: number | null;
  served_visits: number | null;
  unmet_visits: number | null;
  utilization: number | null;
  fee_income: number | null;
  variable_cost: number | null;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsMissing".
 */
export interface OperationsMissing {
  field: string;
  reason: string;
  collect_from: string;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsResult".
 */
export interface OperationsResult {
  science?: OperationsScientificResult;
  model_version: string;
  result_kind: "scenario_prediction";
  status: "complete" | "partial";
  metrics: OperationsMetrics;
  services: OperationsServiceMetrics[];
  missing: OperationsMissing[];
  warnings: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsSnapshot".
 */
export interface OperationsSnapshot {
  id: string;
  project_id: string;
  context_version: number;
  input_hash: string;
  created_at: string;
  input: OperationsInput;
  result: OperationsResult;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsObservedMetrics".
 */
export interface OperationsObservedMetrics {
  served_visits: number | null;
  unique_users: number | null;
  fee_income: number | null;
  operating_cost: number | null;
  government_purchase: number | null;
  operating_subsidy: number | null;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsObservationInput".
 */
export interface OperationsObservationInput {
  facility_id: string;
  period: string;
  source_id: string;
  locator: string;
  collected_at: string;
  split: "calibration" | "holdout";
  note: string;
  metrics: OperationsObservedMetrics;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsObservation".
 */
export interface OperationsObservation {
  id: string;
  project_id: string;
  snapshot_id: string;
  created_at: string;
  source_hash: string;
  source_title: string;
  input: OperationsObservationInput;
  source_snapshot: Source;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsDifference".
 */
export interface OperationsDifference {
  metric:
    "served_visits" | "unique_users" | "fee_income" | "operating_cost" | "government_purchase" | "operating_subsidy";
  predicted: number | null;
  observed: number | null;
  error: number | null;
  absolute_error: number | null;
  percentage_error: number | null;
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsComparison".
 */
export interface OperationsComparison {
  snapshot_id: string;
  observation_id: string;
  split: "calibration" | "holdout";
  timing: "prospective" | "retrospective";
  differences: OperationsDifference[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "OperationsWorkspace".
 */
export interface OperationsWorkspace {
  scenarios: OperationsSnapshot[];
  observations: OperationsObservation[];
  comparisons: OperationsComparison[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RenewalStrategy".
 */
export interface RenewalStrategy {
  /**
   * @minItems 6
   * @maxItems 6
   */
  reasoning_dimensions?: RenewalReasonedDimension[];
  /**
   * @maxItems 6
   */
  internal_data_requests?: RenewalInternalDataRequest[];
  round_review?: {
    summary: string;
    /**
     * @maxItems 8
     */
    changes: {
      topic: string;
      before: string;
      after: string;
      reason: string;
      /**
       * @minItems 0
       * @maxItems 8
       */
      evidence_refs: string[];
    }[];
    /**
     * @maxItems 8
     */
    missing_materials: {
      topic: string;
      request: string;
      reason: string;
      /**
       * @maxItems 8
       */
      evidence_refs: string[];
    }[];
  };
  decision_brief?: {
    renewal: {
      conclusion: string;
      reason: string;
      /**
       * @minItems 0
       * @maxItems 8
       */
      evidence_refs: string[];
    };
    investment: {
      conclusion: string;
      reason: string;
      stage: "preliminary" | "construction" | "hold";
      /**
       * @minItems 0
       * @maxItems 8
       */
      evidence_refs: string[];
    };
    returns: {
      financial: string;
      social: string;
      /**
       * @minItems 0
       * @maxItems 8
       */
      evidence_refs: string[];
    };
  };
  headline: string;
  summary: string;
  preferred_mode: "comprehensive" | "rebuild" | "compare";
  /**
   * @maxItems 6
   */
  rationale: {
    point: string;
    source_id: string;
    quote: string;
  }[];
  /**
   * @maxItems 2
   */
  paths: {
    mode: "comprehensive" | "rebuild";
    /**
     * @maxItems 6
     */
    work_packages?: RenewalWorkPackage[];
    title: string;
    description: string;
    /**
     * @maxItems 5
     */
    actions: {
      title: string;
      detail: string;
      /**
       * @maxItems 8
       */
      evidence_refs: string[];
    }[];
    /**
     * @maxItems 5
     */
    requirements: string[];
  }[];
  /**
   * @maxItems 6
   */
  dimensions: {
    key: "demand" | "supply" | "adaptation" | "implementation" | "operations" | "resources";
    current: string;
    current_level: "low" | "medium" | "high" | "unknown";
    comprehensive: string;
    comprehensive_level: "low" | "medium" | "high" | "unknown";
    rebuild: string;
    rebuild_level: "low" | "medium" | "high" | "unknown";
    /**
     * @maxItems 8
     */
    evidence_refs: string[];
  }[];
  /**
   * @maxItems 5
   */
  next_checks: {
    title: string;
    detail: string;
    /**
     * @maxItems 8
     */
    evidence_refs: string[];
  }[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RagQueryPlan".
 */
export interface RagQueryPlan {
  /**
   * @maxItems 3
   */
  queries: string[];
  /**
   * @maxItems 12
   */
  concepts: string[];
  /**
   * @maxItems 4
   */
  subquestions: string[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RagSemanticIndex".
 */
export interface RagSemanticIndex {
  /**
   * @maxItems 12
   */
  entries: {
    source_id: string;
    summary: string;
    /**
     * @maxItems 12
     */
    concepts: string[];
    /**
     * @maxItems 3
     */
    questions: string[];
  }[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RagSemanticSelection".
 */
export interface RagSemanticSelection {
  /**
   * @maxItems 15
   */
  matches: {
    source_id: string;
    reason: string;
  }[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "RagAnswer".
 */
export interface RagAnswer {
  /**
   * @maxItems 5
   */
  claims: {
    text: string;
    /**
     * @maxItems 3
     */
    citations: {
      source_id: string;
      quote: string;
    }[];
  }[];
  /**
   * @maxItems 5
   */
  missing: string[];
  /**
   * @maxItems 3
   */
  public_queries: string[];
  /**
   * @maxItems 4
   */
  internal_requests: string[];
  /**
   * @maxItems 3
   */
  reasoned_guidance?: {
    conclusion: string;
    /**
     * @minItems 1
     * @maxItems 4
     */
    assumptions: string[];
    verification: string;
  }[];
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "InvestigationAdvice".
 */
export interface InvestigationAdvice {
  summary: string;
  /**
   * @minItems 1
   * @maxItems 3
   */
  steps: {
    task_id: string;
    action: string;
    reason: string;
    material: string;
    channel: string;
    completion_check: string;
    /**
     * @maxItems 6
     */
    evidence_refs: string[];
  }[];
}
