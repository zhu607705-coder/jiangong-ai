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
export type MapScreenProfile = "balanced" | "commercial" | "enterprise";
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
}
/**
 * This interface was referenced by `ProjectInput`'s JSON-Schema
 * via the `definition` "ComparisonPacket".
 */
export interface ComparisonPacket {
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
  criterion: "implementation" | "building" | "demand" | "organization" | "enterprise" | "resources";
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
  priority: ("implementation" | "adaptation" | "demand" | "operations" | "resources" | "access") | null;
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
  key: "implementation" | "adaptation" | "demand" | "operations" | "resources" | "access";
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
