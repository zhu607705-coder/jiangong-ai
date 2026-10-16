import { lazy, Suspense, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { randomUUID } from './uuid';
import { projectInput as validateProjectCreationInput, ContractError,contractErrorMessage } from '../../../packages/contracts/validate';
import { useWorkbenchAccess, WorkbenchAccessContext } from './AdminAccess';
import { isQiushiDemoProject, QIUSHI_SOURCE_PROJECT_ID } from '../../../packages/retrofit/qiushi-demo';
import {
  IconArrowRight,
  IconArrowUpRight,
  IconCheck,
  IconChevronRight,
  IconDownload,
  IconFileText,
  IconLayersIntersect,
  IconMap2,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
  IconX,
  IconAlertTriangle,
} from "@tabler/icons-react";
import WorkspaceFrame, { type WorkspaceGlobalView } from "./components/WorkspaceFrame";
import { GlobalProjects, GlobalKnowledge } from './components/GlobalWorkspace';
import GlobalKnowledgeCatalog from './components/GlobalKnowledgeCatalog';
import ProjectOverview from './components/ProjectOverview';
import ProjectDecisionGuidance from './components/ProjectDecisionGuidance';
import ProjectEvidenceDrawer, { type ProjectEvidenceReference } from './components/ProjectEvidenceDrawer';
import ProjectTasksPage from './components/ProjectTasksPage';
import ProjectResultsPage from './components/ProjectResultsPage';
import './workspace-navigation.css';
import './qiushi-demo-replay.css';
import MapWorkspace from "./maps/MapWorkspace";
import { toProjectAnchor } from "./maps/amap-client";
import type { MapScreenContext, KnowledgeQuery, Source } from '../../host/generated/contracts';
import { DecisionRoute } from './components/DecisionRoute';
import { WaitingMotif } from './components/WaitingScene';
import ImportedDataExplorer from './imports/ImportedDataExplorer';
import LogicEvidencePanel from './components/LogicEvidencePanel';
import RagEvidenceSearch from './imports/RagEvidenceSearch';
import FloatingEvidenceSearch from './imports/FloatingEvidenceSearch';
import type { RetrievalHit } from '../../../packages/experience/retrieval';
import type { StrategyPacket, PublicStrategyIndexResponse } from '../../../packages/retrofit/strategy';
import { initialWorkbenchProject, publicDecisionHref, readWorkbenchLink, resolveProjectLocation, PROJECT_PAGES, writeWorkbenchLink, type WorkbenchView, type ProjectPage, type SchemePane } from './public-decisions';
import { findRetrievalDecisionElement, findRetrievalFeatureElement, focusRetrievalElement, retrievalDecisionLocations, retrievalFeatureLocations, retrievalSourceIds, retrievalQuote, sourceHitFocus, type RetrievalDecisionLocation, type RetrievalFeatureLocation, type SourceHitFocusResult } from './imports/retrieval-navigation';
import NeighborhoodPanel, { createNeighborhoodDraft, type NeighborhoodDraft } from './components/NeighborhoodPanel';
import CommunityOperationsPanel from './components/CommunityOperationsPanel';
import CompleteCommunityDemo from './components/CompleteCommunityDemo';
import StrategyOverview, { type StrategyDirectionSelection } from './components/StrategyOverview';
import InternalMaterialIntake, { type MaterialUploadMetadata } from './components/InternalMaterialIntake';
import DecisionComparison from './components/DecisionComparison';
import type { ResearchRoundsResponse } from '../../../packages/retrofit/research-rounds';
import { MODE_LABELS } from '../../../packages/retrofit/renewal-mode';
import { currentDirectionText } from './components/strategy-direction-text';
import StrategyInvestigations from './components/StrategyInvestigations';
import { DemoPlanVersions, DemoInvestigationPanel } from './components/CommunityDemoWorkflow';
import ConstructionCostLibrary from './components/ConstructionCostLibrary';
import ExperienceLibrary from './components/ExperienceLibrary';
import { publicMapContext, handoffPublicSources } from '../../../packages/maps/public-context';
import { buildDecisionBrief } from '../../../packages/decision/brief-view';
import {
  api,
  type Project,
  type ProjectInput,
  type Run,
  type DecisionPacket,
  type RuntimeEvent,
  type Diff,
} from "./api";

const factLabel: Record<string, string> = {
  building_inventory: "建筑清单",
  rights_status: "权属状态",
  structural_assessment: "结构检测",
  table_row: "表格原始记录",
};
const stateLabel = {
  conditional: "有条件待核",
  blocked: "已被条件阻断",
  investigate: "调查基线",
};
const roleLabel: Record<string, string> = {
  building_feasibility: "建筑与实施",
  demand_operations: "需求与运营",
  case_enterprise: "企业适配",
  scenarios: "路径检查",
  critic: "反证检查",
  comparator: "条件比较",
  report: "报告",
  snapshot: "资料快照",
  knowledge: "案例与规则匹配",
  knowledge_agent: "命中依据的Agent研判",
  decision: "决策包",
  error: "运行异常",
};
const sampleExperience =
  "我们做过厂房更新，本项目不整体拆除。有一栋还在出租，最好分期推进。结构能不能改还不确定。";
const show = (value: unknown) =>
  value == null ? "—" : Array.isArray(value) ? value.join("；") : String(value);
const KnowledgeAgentReport = lazy(() => import('./components/KnowledgeAgentReport'));

function RegionView({ project }: { project: Project }) {
  const ring = project.input.scope.geometry?.coordinates[0];
  const point = project.input.scope.centroid;
  if (!ring && point)
    return (
      <div className="region-view empty-region">
        <IconMap2 size={36} stroke={1} />
        <strong>{point.label}</strong>
        <span>
          {point.latitude.toFixed(4)}°N / {point.longitude.toFixed(4)}°E
        </span>
        <small>仅地名代表点，研究边界仍未知</small>
        <small>GeoNames via Open-Meteo</small>
      </div>
    );
  if (!ring)
    return (
      <div className="region-view empty-region">
        <IconMap2 size={36} stroke={1} />
        <span>尚未提供研究范围几何</span>
        <small>
          {project.input.scope.resolution_note ||
            "地名已保存，覆盖数据与边界仍待补充"}
        </small>
      </div>
    );
  const xs = ring.map((p) => p[0]),
    ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const points = ring
    .map(
      (p) =>
        `${35 + ((p[0] - minX) / (maxX - minX || 1)) * 220},${155 - ((p[1] - minY) / (maxY - minY || 1)) * 110}`,
    )
    .join(" ");
  return (
    <div className="region-view">
      <svg
        viewBox="0 0 290 200"
        role="img"
        aria-label="根据输入 Polygon 绘制的研究范围示意"
      >
        <defs>
          <pattern
            id="grid"
            width="16"
            height="16"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 16 0 L 0 0 0 16"
              fill="none"
              stroke="var(--color-line)"
              strokeWidth=".6"
            />
          </pattern>
        </defs>
        <rect width="290" height="200" fill="url(#grid)" />
        <polygon
          points={points}
          fill="var(--color-primary-line)"
          stroke="var(--color-primary)"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />
        {ring.slice(0, -1).map((p, i) => (
          <circle
            key={i}
            cx={35 + ((p[0] - minX) / (maxX - minX || 1)) * 220}
            cy={155 - ((p[1] - minY) / (maxY - minY || 1)) * 110}
            r="3"
            fill="var(--color-primary)"
          />
        ))}
      </svg>
      <span className="map-caption">
        {project.input.synthetic
          ? "合成坐标 · 范围示意"
          : "输入坐标 · 范围示意"}
        <small>WGS84 / 非法定宗地边界</small>
      </span>
    </div>
  );
}

function ResearchVersionHistory({ project, selectedDirection, onEvidence, onSupplement, replayPacket }: { project: Project; selectedDirection: 'comprehensive' | 'rebuild' | null; onEvidence: (refs: string[], sourcePacket?: StrategyPacket) => void; onSupplement: () => void; replayPacket?:StrategyPacket|null }) {
  const { canWrite } = useWorkbenchAccess();
  const key = `${project.id}:${project.context_version}`;
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<{ key: string; status: 'loading' | 'ready' | 'failed'; data: ResearchRoundsResponse | null }>({ key: '', status: 'loading', data: null });
  useEffect(() => {
    if (!canWrite) return;
    const abort = new AbortController();
    setHistory({ key, status: 'loading', data: null });
    void api<ResearchRoundsResponse>(`/projects/${encodeURIComponent(project.id)}/research-rounds`, undefined, abort.signal).then(data => {
      if (!Array.isArray(data.rounds) || !Array.isArray(data.materials)) throw new Error('INVALID_ROUNDS');
      if (!abort.signal.aborted) setHistory({ key, status: 'ready', data: { ...data, rounds: data.rounds.filter(round => round.project_id === project.id) } });
    }).catch(() => { if (!abort.signal.aborted) setHistory({ key, status: 'failed', data: null }); });
    return () => abort.abort();
  }, [key, canWrite, retry]);
  if (isQiushiDemoProject(project.id)) return <section className="qiushi-replay-version"><h3>当前保存快照与关键缺项</h3><p>{replayPacket?.strategy?.headline || '正在读取已校验的保存方案'}</p><p>固定演示资料基线 v{project.context_version} · {replayPacket?.sources.length ?? project.input.sources.length} 份固定来源</p>{replayPacket?.strategy && <><h4>下一步需要补齐</h4><ul>{replayPacket.strategy.next_checks.map((check,index)=><li key={index}><strong>{check.title}</strong><p>{check.detail}</p>{!!check.evidence_refs.length&&<button className="text-button" onClick={()=>onEvidence(check.evidence_refs,replayPacket)}>查看本项依据 →</button>}</li>)}</ul></>}<p>在成果管理中查看和导出这份方案，进入实时研究可继续形成新一版研判。</p><a href={publicDecisionHref(QIUSHI_SOURCE_PROJECT_ID)}>进入实时研究 →</a></section>;
  if (!canWrite) return <p className="research-round-notice">当前公开成果浏览不展示项目内部研判轮次。</p>;
  if (history.key !== key || history.status === 'loading') return <p role="status">正在读取已保存的研判轮次与变化…</p>;
  if (history.status === 'failed' || !history.data) return <p role="alert">研判轮次暂不可读。<button className="secondary" onClick={() => setRetry(value => value + 1)}>重新读取</button></p>;
  return <DecisionComparison key={key} rounds={history.data.rounds} materials={history.data.materials} candidate={history.data.baseline_candidate} selectedDirection={selectedDirection} onEvidence={onEvidence} onSupplement={onSupplement}/>;
}

export default function App() {
  const access = useWorkbenchAccess();
  const [publicDecisions, setPublicDecisions] = useState<{ status: 'loading' | 'ready' | 'unavailable'; items: PublicStrategyIndexResponse['items'] }>({ status: 'loading', items: [] });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [globalView, setGlobalView] = useState<WorkspaceGlobalView>('map');
  const initialRoute = useRef(readWorkbenchLink(window.location?.search || ''));
  const [routeSection, setRouteSection] = useState<string | undefined>(initialRoute.current.section);
  const [routePane, setRoutePane] = useState<SchemePane>(initialRoute.current.pane || 'content');
  const [settingsOpen, setSettingsOpen] = useState(false), [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const scrollContainer = useRef<HTMLDivElement>(null), scrollPositions = useRef(new Map<string,number>());
  const restoringScroll = useRef<number | null>(null);
  const [mapFocus, setMapFocus] = useState(0), [mapSettings, setMapSettings] = useState(0);
  const [mapAnchor, setMapAnchor] = useState<ProjectInput['scope']['map_anchor']>();
  const [mapEvidence, setMapEvidence] = useState<MapScreenContext | null>(null);
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null);
  const replay = isQiushiDemoProject(project?.id);
  const canWrite = access.canWrite && !replay;
  const [tab, setTab] = useState("overview"),
    [packet, setPacket] = useState<DecisionPacket | null>(null);
  const [events, setEvents] = useState<RuntimeEvent[]>([]),
    [run, setRun] = useState<Run | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null),
    [experience, setExperience] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false),
    [projectName, setProjectName] = useState(""),
    [regionName, setRegionName] = useState(""),
    [geometryText, setGeometryText] = useState("");
  const [createError,setCreateError]=useState('');
  const creationDraftId=useRef<string|null>(null);
  useEffect(()=>{if(!createOpen){creationDraftId.current=null;setCreateError('')}},[createOpen]);
  const [followups, setFollowups] = useState<{ title: string }[]>([]);
  const [projectExtras, setProjectExtras] = useState({ loading: false, diffError: false, followupsError: false });
  const [businessProfile, setBusinessProfile] = useState<'neighborhood'|'general'>('neighborhood');
  const [loadingTarget, setLoadingTarget] = useState<string | null>(null);
  const [neighborhoodDrafts, setNeighborhoodDrafts] = useState<Record<string, NeighborhoodDraft>>({});
  const [completeDemoProject, setCompleteDemoProject] = useState<string | null>(() => {
    try { return localStorage.getItem('hzz-complete-demo-project'); } catch { return null; }
  });
  const demoSessionActive = !!project && !replay && project.id === completeDemoProject;
  const completeDemoActive = demoSessionActive && !['evidence','context'].includes(tab);
  const location = resolveProjectLocation(tab, routeSection);
  const knowledgeSection = ['cases','rules','costs'].includes(routeSection || '') ? routeSection as 'cases'|'rules'|'costs' : 'cases';
  const directionIdentity = project ? `${project.id}:${project.context_version}:${demoSessionActive}` : '';
  const [directionSelection, setDirectionSelection] = useState<StrategyDirectionSelection | null>(null);
  const [directionPacket, setDirectionPacket] = useState<{ identity: string; packet: StrategyPacket } | null>(null);
  const [materialRequest, setMaterialRequest] = useState(0);
  const strategySurface = useRef<{workspacePage:'assessment'|'scheme';section:string;pane:SchemePane}>({workspacePage:'assessment',section:'direction',pane:'content'});
  if (tab === 'assessment' || tab === 'scenarios') strategySurface.current = {workspacePage:tab === 'scenarios'?'scheme':'assessment',section:location.section,pane:routePane};
  const currentDirection = directionSelection?.identity === directionIdentity ? directionSelection.mode : null;
  const currentDirectionPath = currentDirection && directionPacket?.identity === directionIdentity ? directionPacket.packet.strategy?.paths.find(path => path.mode === currentDirection) : null;
  const [sourceFocus, setSourceFocus] = useState<{ projectId: string; contextVersion: number; refs: string[]; token: number } | null>(null);
  const [sourceTextFocus, setSourceTextFocus] = useState<{ projectId: string; contextVersion: number; sourceId: string; hit: RetrievalHit } | null>(null);
  const [sourceTextCheck, setSourceTextCheck] = useState<{ key: string; result: SourceHitFocusResult | null }>({ key: '', result: null });
  const [retrievalStrategy, setRetrievalStrategy] = useState<{ key: string; status: 'loading' | 'ready' | 'unavailable'; packet: StrategyPacket | null }>({ key: '', status: 'loading', packet: null });
  const [roundIndex, setRoundIndex] = useState<{key:string;data:ResearchRoundsResponse|null}>({key:'',data:null});
  const [evidenceDrawer, setEvidenceDrawer] = useState<{ projectId:string; packet:StrategyPacket|null; refs:ProjectEvidenceReference[] }|null>(null);
  const [decisionFocus, setDecisionFocus] = useState<{ projectId: string; contextVersion: number; location: RetrievalDecisionLocation | RetrievalFeatureLocation; token: number } | null>(null);
  const completedDecisionFocus = useRef<number | null>(null);
  const [askEvidenceRequest, setAskEvidenceRequest] = useState(0);
  const [evidenceLocation, setEvidenceLocation] = useState<{ projectId: string; contextVersion: number; documentId: string; version: string; locator: string; quote: string; token: number } | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [executionMode, setExecutionMode] = useState<"offline" | "live">(
    "offline",
  );
  const [evidencePacket, setEvidencePacket] = useState<{ projectId: string; packet: StrategyPacket } | null>(null);
  const currentStrategyPacket = directionPacket?.identity === directionIdentity ? directionPacket.packet : retrievalStrategy.key === `${project?.id || ''}:${project?.context_version ?? ''}` ? retrievalStrategy.packet : null;
  const researchRecords = roundIndex.key === `${project?.id || ''}:${project?.context_version ?? ''}` ? roundIndex.data : null;
  const latestSavedRound = researchRecords?.rounds.filter(round => round.status === 'completed' && round.result?.strategy).sort((a,b) => b.round_number-a.round_number)[0] || null;
  const overviewStrategy = currentStrategyPacket || latestSavedRound?.result || researchRecords?.baseline_candidate || null;
  const hasSavedNeighborhoodResult = completeDemoActive || [overviewStrategy, ...(researchRecords?.rounds.map(round => round.result) || [])].some(result =>
    result?.status === 'completed' && !!result.strategy && result.project_id === project?.id && result.synthetic === project?.input.synthetic);
  const availableProjectPages = project?.input.business_profile === 'neighborhood' && !hasSavedNeighborhoodResult
    ? ['overview', 'evidence', 'assessment'] as ProjectPage[] : PROJECT_PAGES.map(page => page.id);
  const navigationKey = `${project?.id || ''}:${globalView}:${tab}:${location.section}:${routePane}:${currentDirection || ''}:${completeDemoActive}`;
  function rememberPosition() { if (scrollContainer.current) scrollPositions.current.set(navigationKey, scrollContainer.current.scrollTop); }
  function navigateProject(page: ProjectPage | 'map' | 'knowledge', section?: string, pane?: string, scheme?: 'comprehensive'|'rebuild') {
    if (page === 'map') { setMapFocus(value => value + 1); navigateGlobal('map'); return; }
    if (page === 'knowledge') { setRouteSection(section || 'cases'); navigateGlobal('knowledge', section); return; }
    if (page === 'results' && section === 'runs') { setRunDetailsOpen(true); return; }
    rememberPosition();
    const normalized = section === 'baseline' ? 'current' : section === 'materials' ? 'files' : section;
    const view: WorkbenchView = page === 'results' && normalized === 'history' ? 'compare' : page === 'evidence' && normalized === 'context' ? 'context' : page;
    setTab(view); setRouteSection(normalized); setRoutePane((['content','funding','operations','sensitivity'].includes(pane || '') ? pane : 'content') as SchemePane);
    setDetailsOpen(true); setGlobalView('project');
    if (scheme && project) setDirectionSelection({ identity: directionIdentity, mode: scheme });
    if (project) writeWorkbenchLink(project.id, view, { section: normalized, pane: page === 'scenarios' ? (pane || 'content') as SchemePane : undefined, scheme: page === 'scenarios' ? scheme || currentDirection || undefined : undefined, baseline: page === 'scenarios' ? project.context_version : undefined, push: true });
  }
  function navigateGlobal(view: WorkspaceGlobalView, section?: string) {
    rememberPosition(); setGlobalView(view); setDetailsOpen(view === 'project');
    if (view === 'knowledge' || view === 'projects') setRouteSection(section || (view === 'knowledge'?'cases':'projects'));
    if (project) writeWorkbenchLink(project.id, view === 'project' ? tab as WorkbenchView : view, {section: view === 'knowledge' ? section || 'cases' : view==='projects'?section||'projects':undefined, push:true});
  }
  useEffect(() => {
    const node = scrollContainer.current; if (!node) return;
    const position = scrollPositions.current.get(navigationKey) || 0;
    let restoring = true;
    const frame = requestAnimationFrame(() => { node.scrollTop = position; restoring = false; });
    const remember = () => { if (!restoring) scrollPositions.current.set(navigationKey, node.scrollTop); };
    node.addEventListener('scroll',remember,{passive:true});
    return () => { cancelAnimationFrame(frame); node.removeEventListener('scroll',remember); };
  }, [navigationKey]);
  useEffect(() => {
    if (project?.input.business_profile !== 'neighborhood' || hasSavedNeighborhoodResult || retrievalStrategy.key !== `${project.id}:${project.context_version}` || retrievalStrategy.status === 'loading') return;
    if (!['scenarios', 'actions', 'results', 'compare'].includes(tab)) return;
    setTab('assessment'); setRouteSection('direction'); setRoutePane('content');
    writeWorkbenchLink(project.id, 'assessment', { section: 'direction' });
  }, [project?.id, project?.context_version, hasSavedNeighborhoodResult, retrievalStrategy.key, retrievalStrategy.status, tab]);
  const strategySources: Source[] = (evidencePacket && evidencePacket.projectId === project?.id ? evidencePacket.packet : currentStrategyPacket)?.sources.map(source => ({
    id: source.id, title: source.title, visibility: source.visibility || 'public', data_class: source.data_class || (project?.input.synthetic ? 'synthetic' : 'public'),
    synthetic: project?.input.synthetic || false, untrusted_text: source.text, ...(source.url ? { url: source.url } : {}),
    ...(source.published_at ? { published_at: source.published_at } : {}), locator: source.locator,
    ...(source.document_version ? { hash: source.document_version } : {}), content_status: source.document_id ? 'uploaded' : 'excerpt',
  })) || [];
  const displayedSources = [...new Map([...(packet?.sources || []), ...strategySources, ...(project?.input.sources || [])].map(source => [source.id, source])).values()];
  const requestedRefs = sourceFocus?.projectId === project?.id && sourceFocus?.contextVersion === project?.context_version ? sourceFocus?.refs || [] : [];
  const focusedSourceIds = displayedSources.filter(source => requestedRefs.some(ref => ref === source.id || ref === `${project?.id}:${source.id}`)).map(source => source.id);
  const focusedSourceKey = focusedSourceIds.join('\u0000');
  const focusedSource = sourceTextFocus && sourceTextFocus.projectId === project?.id && sourceTextFocus.contextVersion === project?.context_version ? displayedSources.find(source => source.id === sourceTextFocus.sourceId) : undefined;
  const sourceCheckKey = focusedSource && sourceTextFocus ? `${project?.id}:${project?.context_version}:${sourceTextFocus.hit.id}:${sourceFocus?.token}` : '';
  const sourceTextResolved = sourceTextCheck.key === sourceCheckKey ? sourceTextCheck.result : null;
  const retrievalKey = `${project?.id || ''}:${project?.context_version ?? ''}`;
  const decisionLinksState = retrievalStrategy.key === retrievalKey ? retrievalStrategy.status : 'loading';
  const brief = packet ? buildDecisionBrief(packet) : null;
  const packetSources = new Map((packet?.sources || []).map(source => [source.id, source] as const));
  const eventSource = useRef<EventSource | null>(null);
  const projectLoadVersion = useRef(0);
  const running = run?.status === "running";
  const stale =
    !!packet && !!project && packet.context_version !== project.context_version;
  function openEvidence(refs: string[] = [], sourcePacket?: StrategyPacket) {
    if (refs.length) {
      if (project) setEvidenceDrawer({projectId:project.id,packet:sourcePacket?.project_id === project.id ? sourcePacket : currentStrategyPacket,refs});
      return;
    }
    openMaterials();
  }
  function openMaterials(refs: string[] = [], sourcePacket?: StrategyPacket) {
    setEvidencePacket(sourcePacket && sourcePacket.project_id === project?.id ? { projectId: sourcePacket.project_id, packet: sourcePacket } : null);
    setEvidenceLocation(null);
    setSourceTextFocus(null); setDecisionFocus(null);
    if (project) setSourceFocus(previous => ({ projectId: project.id, contextVersion: project.context_version, refs: [...new Set(refs)], token: (previous?.token || 0) + 1 }));
    navigateProject('evidence','files');
  }
  function locateEvidence(hit: RetrievalHit) {
    if (!project) return;
    const quote=retrievalQuote(hit);
    if(!quote){setError('所选引用不在命中原文内，请重新定位原文。');return;}
    const referenceId = retrievalSourceIds(hit).find(id => displayedSources.some(source => id === source.id || id === `${project.id}:${source.id}`)) || hit.document_id || hit.source.id;
    setEvidenceDrawer({projectId:project.id,packet:currentStrategyPacket,refs:[{source_id:referenceId,quote,locator:hit.locator,version:hit.version}]});
    return;
  }
  useEffect(() => {
    let current = true;
    setSourceTextCheck({ key: '', result: null });
    if (focusedSource && sourceTextFocus) void sourceHitFocus(focusedSource, sourceTextFocus.hit).then(result => { if (current) setSourceTextCheck({ key: sourceCheckKey, result }); });
    return () => { current = false; };
  }, [focusedSource, sourceCheckKey]);
  useEffect(() => {
    if (tab !== 'evidence' || !focusedSourceIds.length) return;
    let focused: HTMLElement | null = null;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`project-source-${encodeURIComponent(focusedSourceIds[0])}`);
      const original = target?.querySelector('details');
      if (original) original.open = true;
      const quote = target?.querySelector<HTMLElement>('[data-retrieval-source-hit]');
      if (quote || target) { focused = (quote || target)!; focusRetrievalElement(focused); }
    });
    return () => { cancelAnimationFrame(frame); focused?.removeAttribute('data-retrieval-focused'); };
  }, [tab, project?.id, focusedSourceKey, sourceFocus?.token, sourceTextResolved?.status]);
  useEffect(() => { setSourceFocus(null); setSourceTextFocus(null); setEvidenceLocation(null); setDecisionFocus(null); setEvidencePacket(null); }, [retrievalKey]);
  useEffect(() => { setEvidenceDrawer(null); }, [project?.id]);
  useEffect(() => {
    setDirectionSelection(current => current?.identity === directionIdentity ? current : null);
    setDirectionPacket(current => current?.identity === directionIdentity ? current : null);
  }, [directionIdentity]);
  useEffect(() => {
    const back = () => { void (async()=>{
      rememberPosition(); const link=readWorkbenchLink(window.location.search);
      if (link.projectId && link.projectId!==project?.id) await loadProject(link.projectId);
      setTab(link.view && !['map','projects','knowledge'].includes(link.view)?link.view:'overview');setRouteSection(link.section);setRoutePane(link.pane||'content');
      setGlobalView(link.publicDirectory||link.view==='projects'?'projects':link.view==='knowledge'?'knowledge':link.view==='map'?'map':'project');setDetailsOpen(link.view!=='map');
      if (link.scheme && project?.id===link.projectId && (link.baseline===undefined||link.baseline===project.context_version)) setDirectionSelection({identity:directionIdentity,mode:link.scheme});
    })().catch(()=>setError('该历史页面暂时无法打开，请从项目空间重新选择。')); };
    window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);
  },[project?.id,project?.context_version,navigationKey]);
  useEffect(()=>{
    if(!settingsOpen&&!runDetailsOpen)return;
    const previous=document.activeElement as HTMLElement|null;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){setSettingsOpen(false);setRunDetailsOpen(false);}};
    window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);previous?.focus?.({preventScroll:true});};
  },[settingsOpen,runDetailsOpen]);
  useEffect(() => {
    const controller = new AbortController();
    setRetrievalStrategy({ key: retrievalKey, status: 'loading', packet: null });
    if (!project || project.input.business_profile !== 'neighborhood') { setRetrievalStrategy({ key: retrievalKey, status: 'ready', packet: null }); return; }
    const projectId = project.id, version = project.context_version;
    void Promise.all([api<StrategyPacket | null>(`/projects/${encodeURIComponent(projectId)}/renewal-strategy?demo=false`, undefined, controller.signal),
      canWrite ? api<ResearchRoundsResponse>(`/projects/${encodeURIComponent(projectId)}/research-rounds`,undefined,controller.signal).catch(()=>null) : Promise.resolve(null)])
      .then(([value,records]) => { if (!controller.signal.aborted) {
        const valid = records && Array.isArray(records.rounds) ? records : null;
        setRoundIndex({key:retrievalKey,data:valid});
        const latest = valid?.rounds.filter(round => round.project_id === projectId && round.context_version === version && round.status === 'completed' && round.result?.strategy).sort((a,b)=>b.round_number-a.round_number)[0]?.result;
        setRetrievalStrategy({ key: retrievalKey, status: 'ready', packet: latest || (value?.context_version === version ? value : null) });
      } })
      .catch(() => { if (!controller.signal.aborted) setRetrievalStrategy({ key: retrievalKey, status: 'unavailable', packet: null }); });
    return () => controller.abort();
  }, [retrievalKey,canWrite,directionPacket?.packet.input_hash]);
  function decisionLocations(hit: RetrievalHit) {
    if (!project) return [];
    return retrievalDecisionLocations(hit, project.id, currentStrategyPacket, packet).filter(location => !currentDirection || (!location.mode || location.mode === currentDirection) && !!currentDirectionText(location.text, currentDirection));
  }
  function featureLocations(question: string) { return retrievalFeatureLocations(question).filter(location => location.kind === 'investigations' || project?.input.business_profile === 'neighborhood'); }
  function navigateRetrievalDecision(location: RetrievalDecisionLocation | RetrievalFeatureLocation) {
    if (!project) return;
    setSourceFocus(null); setSourceTextFocus(null); setEvidenceLocation(null);
    setCompleteDemoProject(null);
    completedDecisionFocus.current = null;
    try { localStorage.removeItem('hzz-complete-demo-project'); } catch {}
    if (location.kind==='cost-library') { setDecisionFocus(null);navigateGlobal('knowledge','costs');return; }
    const view = ['investigation','followup','investigations'].includes(location.kind)?'actions':location.kind==='action'?'scenarios':'assessment';
    const section = view==='actions'?'current':view==='scenarios'?'detail':location.kind==='dimension'||location.kind==='assessment'?'current':'direction';
    const mapped = {...location,tab:view} as RetrievalDecisionLocation|RetrievalFeatureLocation;
    setDecisionFocus(previous => ({ projectId: project.id, contextVersion: project.context_version, location:mapped, token: (previous?.token || 0) + 1 }));
    navigateProject(view,section,view==='scenarios'?'content':undefined,'mode' in location ? location.mode : undefined);
  }
  useEffect(() => {
    if (!decisionFocus) { completedDecisionFocus.current=null; return; }
    if (completedDecisionFocus.current===decisionFocus.token || decisionFocus.projectId !== project?.id || decisionFocus.contextVersion !== project?.context_version || tab !== decisionFocus.location.tab) return;
    let frame = 0, focused: HTMLElement | null = null;
    const attempt = () => {
      const target = 'detail' in decisionFocus.location ? findRetrievalFeatureElement(document, decisionFocus.location) : findRetrievalDecisionElement(document, decisionFocus.location);
      if (!target) return;
      observer.disconnect(); clearTimeout(timeout); focused = target; focusRetrievalElement(target);
      if(target.hasAttribute('data-retrieval-awaiting-direction'))setNotice('请先在改造方向判断页明确选择研究方向，再查看对应方案或评价。');
      else { completedDecisionFocus.current=decisionFocus.token; setNotice(`已定位：${decisionFocus.location.label}`); }
    };
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(attempt); });
    const timeout = setTimeout(() => { observer.disconnect(); cancelAnimationFrame(frame); setNotice('已打开对应页面，该引用条目暂未读取，请重试定位。'); }, 10000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    attempt();
    return () => { observer.disconnect(); clearTimeout(timeout); cancelAnimationFrame(frame); focused?.removeAttribute('data-retrieval-focused'); };
  }, [project?.id, project?.context_version, tab, decisionFocus?.token, currentDirection]);
  async function loadProject(id: string, created?: Project) {
    const version = ++projectLoadVersion.current;
    const p = created || await api<Project>(`/projects/${encodeURIComponent(id)}`);
    if (version !== projectLoadVersion.current) return p;
    setProject(p);
    try { localStorage.setItem("hzz_project", id); } catch {}
    const latest = p.runs?.[0] || null;
    setRun(latest);
    setPacket(p.runs?.find((r) => r.decision)?.decision || null);
    setDiff(null);
    setFollowups([]);
    if (isQiushiDemoProject(p.id)) { setProjectExtras({ loading: false, diffError: false, followupsError: false }); return p; }
    setProjectExtras({ loading: true, diffError: false, followupsError: false });
    void Promise.allSettled([
      api<Diff>(`/projects/${encodeURIComponent(id)}/revision-diff`),
      api<{ title: string }[]>(`/projects/${encodeURIComponent(id)}/followups`),
    ]).then(([nextDiff, nextFollowups]) => {
      if (version !== projectLoadVersion.current) return;
      if (nextDiff.status === 'fulfilled') setDiff(nextDiff.value);
      if (nextFollowups.status === 'fulfilled') setFollowups(nextFollowups.value);
      setProjectExtras({ loading: false, diffError: nextDiff.status === 'rejected', followupsError: nextFollowups.status === 'rejected' });
      if (nextDiff.status === 'rejected' || nextFollowups.status === 'rejected') setError('项目已打开，部分版本资料或调查清单暂不可读。');
    });
    return p;
  }
  async function refreshProjects() {
    const list = await api<Project[]>("/projects");
    setProjects(list);
    return list;
  }
  useEffect(() => {
    let alive = true;
    async function start() {
      try {
        const session = await api<{ model_configured: boolean }>("/session");
        if (!alive) return;
        setModelAvailable(session.model_configured);
        setExecutionMode(session.model_configured ? "live" : "offline");
        const list = await refreshProjects();
        if (!alive) return;
        let published: PublicStrategyIndexResponse['items'] = [];
        try {
          const index = await api<PublicStrategyIndexResponse>('/projects/public-decisions');
          if (!alive) return;
          if (!Array.isArray(index.items)) throw new Error('公开方案目录格式无效');
          published = index.items;
          setPublicDecisions({ status: 'ready', items: published });
        } catch { if (alive) setPublicDecisions({ status: 'unavailable', items: [] }); }
        if (!alive) return;
        let storedProjectId: string | null = null;
        try { storedProjectId = localStorage.getItem('hzz_project'); } catch {}
        const initial = initialWorkbenchProject(list, published, { viewer: !canWrite, storedProjectId, search: window.location?.search || '' });
        if (initial.selected) {
          if (initial.showOverview) { setCompleteDemoProject(null); try { localStorage.removeItem('hzz-complete-demo-project'); } catch {} }
          await loadProject(initial.selected.id);
          if (!alive) return;
          const link = readWorkbenchLink(window.location?.search || '');
          if (link.publicDirectory || link.view === 'projects') { setGlobalView('projects'); setRouteSection(link.publicDirectory?'published':link.section); setDetailsOpen(false); }
          else if (link.view === 'knowledge') { setGlobalView('knowledge'); setDetailsOpen(false); }
          else if (initial.showOverview) { setTab(initial.view === 'map' ? 'overview' : initial.view); setDetailsOpen(true); setGlobalView('project'); setCompleteDemoProject(null); writeWorkbenchLink(initial.selected.id, initial.view, link); }
          if (link.scheme && (link.baseline === undefined || link.baseline === initial.selected.context_version)) setDirectionSelection({identity:`${initial.selected.id}:${initial.selected.context_version}:false`,mode:link.scheme});
          if (initial.unavailableProject) setNotice('分享链接中的项目当前不可读取，已打开其他可读项目，请核对来源项目。');
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "连接失败");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void start();
    return () => {
      alive = false;
      projectLoadVersion.current++;
    };
  }, []);
  async function openPublicDecision(projectId: string) {
    setLoadingTarget(projectId);
    try {
      const selected = await loadProject(projectId);
      setCompleteDemoProject(null); setTab('overview'); setRouteSection(undefined); setDetailsOpen(true); setGlobalView('project'); setMapFocus(value => value + 1);
      try { localStorage.removeItem('hzz-complete-demo-project'); } catch {}
      writeWorkbenchLink(selected.id, 'overview');
    } catch (error) { setError(error instanceof Error ? error.message : '公开方案暂时无法读取。'); }
    finally { setLoadingTarget(null); }
  }
  useEffect(() => {
    eventSource.current?.close();
    if (!run) {
      setEvents([]);
      return;
    }
    setEvents([]);
    let alive = true;
    const source = new EventSource(`/api/runs/${run.id}/events`);
    eventSource.current = source;
    source.addEventListener("progress", (e) => {
      if (!alive) return;
      const event = JSON.parse((e as MessageEvent).data) as RuntimeEvent;
      setEvents((prev) =>
        prev.some((v) => v.id === event.id) ? prev : [...prev, event],
      );
    });
    source.addEventListener("terminal", (e) => {
      if (!alive) return;
      source.close();
      const result = JSON.parse((e as MessageEvent).data);
      if (run.status === 'running' && result.status === "failed")
        setError("本次研判未完成。快照已保留，可重新执行；详情见运行记录。");
      if (project && run.status === 'running')
        void loadProject(project.id).catch((e) => setError(e.message));
    });
    source.onerror = () => {
      if (!alive || source.readyState === EventSource.CLOSED) return;
      setNotice("进度连接暂时中断，正在自动重连。");
    };
    return () => { alive = false; source.close(); };
  }, [run?.id, run?.status === "running"]);
  async function action(task: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  function openBlankProject(){
    if(busy)return;
    if(!access.canWrite){window.location.assign('/admin/login');return}
    creationDraftId.current=null;setCreateError('');setMapAnchor(undefined);setMapEvidence(null);setProjectName('');setRegionName('');setGeometryText('');setCreateOpen(true);
  }
  async function uploadMaterial(file: File, metadata?: MaterialUploadMetadata) {
    if (!project || busy || !canWrite) return;
    const projectId = project.id;
    await action(async () => {
      const form = new FormData();
      // Multipart filename headers may use a different charset than UTF-8 fields.
      form.append("original_file_name", file.name);
      form.append("file", file);
      form.append("synthetic", String(project.input.synthetic));
      if (metadata) {
        form.append("material_category", metadata.material_category);
        if (metadata.source_date) form.append("source_date", metadata.source_date);
      }
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
        method: "POST", credentials: "same-origin",
        headers: { "X-Requested-With": "haizhizi" }, body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "材料上传未完成。");
      await loadProject(projectId);
      setNotice(result.parser_result?.status === "ocr_required"
        ? "原文件已保存，扫描页尚需 OCR；未把空文本当作已解析证据。"
        : "材料已保存为本项目内部资料，可在补充研判中纳入分析。");
    });
  }
  async function startRun(p: Project, mode: "automatic" | "enterprise", knowledgeQuery?: KnowledgeQuery) {
    if (!canWrite) return;
    const created = await api<{ id: string; revision: number; status: string }>(
      `/projects/${p.id}/runs`,
      {
        mode,
        execution_mode: executionMode,
        idempotency_key: randomUUID(),
        ...(knowledgeQuery ? { knowledge_query: knowledgeQuery } : {}),
      },
    );
    setRun({
      ...created,
      context_version: p.context_version,
      decision: null,
      error_code: null,
    });
    setTab("overview");
  }
  async function createFixture(fixture = "01_auto") {
    if (!access.canWrite) return;
    const p = await api<Project>("/projects", {
      fixture,
      name:
        fixture === "01_auto" ? "滨河厂区 · 合成示范" : `工程用例 · ${fixture}`,
    });
    await refreshProjects();
    await loadProject(p.id);
    setCreateOpen(false);
    setTab("overview");
    setDetailsOpen(true);
  }
  const legacyStages = [
    {
      id: "overview",
      label: "研判总览",
      detail: "路径与关键前提",
      done: !!packet,
    },
    {
      id: "evidence",
      label: "逻辑与证据",
      detail: `${displayedSources.length} 份项目来源`,
      done: !!displayedSources.length,
    },
    {
      id: "context",
      label: "项目经验",
      detail: `经验版本 v${project?.context_version || 0}`,
      done: !!project?.context_version,
    },
    {
      id: "compare",
      label: "决策对比",
      detail: packet ? `研判版本 v${packet.revision}` : "等待首次研判",
      done: !!diff?.available,
    },
    {
      id: "actions",
      label: "下一步调查",
      detail: `${followups.length} 项已加入清单`,
      done: followups.length > 0,
    },
  ];
  const stages = PROJECT_PAGES.map(page => ({id:page.id,label:page.label,detail:'',done:false}));
  const metrics = packet?.metrics || [];
  const vacancy = metrics.find((m) => m.key === "vacancy_ratio"),
    gfa = metrics.find((m) => m.key === "gfa_m2");
  const rail = (
    <>
      <div className="rail-title">
        <IconLayersIntersect size={17} />
        <h2>证据与边界</h2>
      </div>
      {project ? (
        <>
          <RegionView
            project={
              packet?.scope
                ? {
                    ...project,
                    input: { ...project.input, scope: packet.scope },
                  }
                : project
            }
          />
          <div className="rail-section">
            <div className="kicker">研究对象</div>
            <h3>{project.name}</h3>
            <p>
              {brief?.summary || "比较参与路径、实施对象与下一步。"}
            </p>
            <dl>
              <div>
                <dt>资料时点</dt>
                <dd>{project.input.as_of}</dd>
              </div>

              <div>
                <dt>当前模式</dt>
                <dd>
                  {project.input.mode === "enterprise"
                    ? "企业增强"
                    : "自动初筛"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="rail-section">
            <div className="section-head">
              <h3>研究进度</h3>
              <span className={running ? "running-dot" : "muted-dot"} />
            </div>
            <p className="project-run-status" role="status">{running ? (events.at(-1)?.message || "正在启动研究") : packet ? "本轮研判已完成" : "选择对象后开始研究"}</p>
            <details className="run-history"><summary>执行记录</summary>
            {events.length ? (
              <ol className="event-list">
                {events.slice(-8).map((event) => (
                  <li key={event.id}>
                    <span className={`event-dot ${event.status}`} />
                    <div>
                      <strong>
                        {roleLabel[event.stage] || event.stage}
                        <small>
                          {event.status === "reused"
                            ? "复用"
                            : event.status === "completed"
                              ? "完成"
                              : event.status === "failed"
                                ? "失败"
                                : "执行中"}
                        </small>
                      </strong>
                      <p>{event.message}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">
                暂无执行记录。
              </p>
            )}</details>
          </div>
        </>
      ) : (
        <div className="rail-section">
          <p>创建项目后，可以查看输入来源、研究边界和运行进度。</p>
          <div className="principle">
            <IconShieldCheck size={25} />
            <h3>从具体项目开始</h3>
            <p>选择具体对象，形成参与路径与行动清单。</p>
          </div>
        </div>
      )}

    </>
  );
  const modeSelector = replay ? <span className="qiushi-replay-mode">已保存方案回放</span> : (<select
          className="mode-select"
          aria-label="执行方式"
          value={completeDemoActive ? 'demo' : executionMode}
          disabled={busy || running || completeDemoActive}
          onChange={(e) =>
            setExecutionMode(e.target.value as "offline" | "live")
          }
        >
          {completeDemoActive && <option value="demo">模拟数据 · 规则与公式计算</option>}
          <option value="live" disabled={!modelAvailable}>
            真实模型研判
          </option>
          <option value="offline">离线工程验证</option>
        </select>);
  return (
    <WorkspaceFrame
      globalView={globalView}
      onGlobalView={view => navigateGlobal(view)}
      activeProjectPage={location.page}
      onProjectPage={page => navigateProject(page)}
      availableProjectPages={availableProjectPages}
      scrollContainerRef={scrollContainer}
      globalContent={globalView === 'projects' ? <GlobalProjects activeSection={routeSection==='published'?'published':'projects'} onSectionChange={section=>navigateGlobal('projects',section)} projects={projects} publishedPlans={publicDecisions.items} onCreate={openBlankProject} canCreate={access.canWrite} onProject={id => void openPublicDecision(id)} onOpenPublished={openPublicDecision} loading={loading} error={error}/> : globalView === 'knowledge' ? <GlobalKnowledge activeSection={knowledgeSection} onSectionChange={section => navigateGlobal('knowledge',section)} onProjectSpace={() => navigateGlobal('projects')}>{knowledgeSection === 'costs' ? <ConstructionCostLibrary/> : <GlobalKnowledgeCatalog kind={knowledgeSection === 'rules' ? 'rule' : 'case'} onOpenProject={id => void action(async()=>{await loadProject(id);setTab('context');setRouteSection('context');setGlobalView('project');setDetailsOpen(true);writeWorkbenchLink(id,'context');})}/>}</GlobalKnowledge> : null}
      project={project}
      projects={projects}
      stages={stages}
      tab={tab}
      onTab={value => navigateProject(resolveProjectLocation(value).page,resolveProjectLocation(value).section)}
      onProject={(id) =>
        void action(async () => {
          setLoadingTarget(id);
          try {
            const selected = await loadProject(id);
            setTab(selected.input.purpose === 'case_library_archive' ? 'context' : 'overview');
            setMapFocus(v => v + 1);
            setDetailsOpen(true);
            setGlobalView('project'); setRouteSection(undefined);
            writeWorkbenchLink(selected.id, selected.input.purpose === 'case_library_archive' ? 'context' : 'overview');
          } finally { setLoadingTarget(null); }
        })
      }
      onCreate={openBlankProject}
      mapView={<MapWorkspace ready={!loading && globalView === 'map'} interactionBlocked={detailsOpen || loading || !!loadingTarget} project={project} focusProject={mapFocus} settingsRequest={mapSettings}
        onAskEvidence={() => setAskEvidenceRequest(value => value + 1)}
        onEvidence={refs => { openEvidence(refs); setDetailsOpen(true); }}
      onOpenProject={id => { void (async () => { if (id && id !== project?.id) { setLoadingTarget(id); try { await loadProject(id) } finally { setLoadingTarget(null) } } setTab('overview'); setRouteSection(undefined); setDetailsOpen(true); setGlobalView('project'); if (id || project?.id) writeWorkbenchLink(id || project!.id, 'overview'); })().catch(e => setError(e.message)); }}
        onCreateFromPlace={(place, context) => {
          if(busy)return;
          creationDraftId.current=null;setCreateError('');
          const clean=context?publicMapContext(context):null
          const publicName=clean?.target.label||clean?.address||place.address||(place.poi_id?place.name:'')
          setMapAnchor(toProjectAnchor({...place,name:publicName||'地图选点'}));setMapEvidence(clean)
          setProjectName(publicName?`${publicName} · 片区研究`.slice(0,120):'地图选点研究')
          setRegionName([...new Set([clean?.city||place.city,publicName||place.name||'地图选点'].filter(Boolean))].join(' ').slice(0,120))
          setGeometryText('');setCreateOpen(true)
        }} />}
      detailsOpen={detailsOpen}
      bootLoading={loading || !!loadingTarget}
      onMap={() => navigateGlobal('map')}
      onSettings={() => setSettingsOpen(true)}
      error={error}
      onDismissError={() => setError('')}
      rail={rail}
      modeControl={<span className="workspace-provenance">{replay ? '已保存方案回放' : project?.input.synthetic || completeDemoActive ? '模拟资料' : '项目资料'} · v{project?.context_version || 0}<button className="text-button" onClick={()=>setRunDetailsOpen(true)}>{replay?'回放记录':'运行详情'}</button></span>}
    >
      <WorkbenchAccessContext.Provider value={replay ? { ...access, canWrite: false } : access}>
      {replay && <aside className="qiushi-demo-replay" aria-label="求是村演示回放"><div><strong>求是村演示回放 · 已校验方案与固定资料</strong><p>查看已保存的实际模型方案、六维判断与原文依据；参数推演保存在本机情景中。</p></div><a href={publicDecisionHref(QIUSHI_SOURCE_PROJECT_ID)}>进入实时研究 →</a></aside>}
      {error && (
        <div className="feedback error" role="alert">
          <IconAlertTriangle size={18} />
          <span>{error}</span>
          <button aria-label="关闭错误" onClick={() => setError("")}>
            <IconX size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="feedback notice" role="status">
          <IconCheck size={18} />
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <IconX size={16} />
          </button>
        </div>
      )}
      {loading ? null : !project ? (
        <section className="welcome">
          <div className="kicker">PRE-CONSTRUCTION INTELLIGENCE</div>
          <h1>
            让片区资料
            <br />
            指向下一步行动<span>。</span>
          </h1>
          <p>
            从建筑存量、实施前提到企业适配。
            <br />
            在共同证据下比较路径，明确什么值得继续调查。
          </p>
          <div className="welcome-actions">
            <button
              className="primary"
              disabled={busy || !canWrite}
              onClick={() => void action(() => createFixture())}
            >
              <IconPlayerPlay size={17} />
              打开合成示范
            </button>
            <button className="secondary" disabled={!canWrite} onClick={openBlankProject}>
              <IconPlus size={17} />
              新建真实项目
            </button>
          </div>
          <div className="welcome-steps">
            <div>
              <span>01</span>
              <h3>界定研究对象</h3>
              <p>保存范围与可用资料</p>
            </div>
            <div>
              <span>02</span>
              <h3>比较实施路径</h3>
              <p>检查前提、反证与缺项</p>
            </div>
            <div>
              <span>03</span>
              <h3>让经验改变判断</h3>
              <p>查看局部重评与版本差异</p>
            </div>
          </div>
        </section>
      ) : (
        <ProjectDecisionGuidance project={project} page={location.page} direction={currentDirection} packetHash={overviewStrategy?.input_hash} onNavigate={target=>navigateProject(target.page,target.section,target.pane)}>
          {!['overview','assessment','scenarios'].includes(location.page) && <header className="workspace-page-heading"><span>{project.name} · 资料 v{project.context_version}</span><h1>{PROJECT_PAGES.find(page=>page.id===location.page)?.label}</h1></header>}
          {(project.input.synthetic || completeDemoActive) && <p className="workspace-data-badge">模拟资料 · {completeDemoActive ? '杭州样本社区演示情景' : project.input.scope.name}</p>}
          {['evidence','actions','results'].includes(location.page) && <nav className="workspace-section-nav" aria-label="页面工作区">{(location.page==='evidence'?[['files','资料与证据'],['profile','对象档案'],['context','项目经验与约束']]:location.page==='actions'?[['current','当前调查'],['history','历史记录']]:[['reports','成果管理'],['history','版本变化']]).map(([section,label])=><button key={section} aria-current={location.section===section?'page':undefined} onClick={()=>navigateProject(location.page,section)}>{label}</button>)}</nav>}
          {tab === 'overview' && <ProjectOverview project={project} currentStrategyPacket={overviewStrategy} latestSavedRound={latestSavedRound} currentDirection={currentDirection} stale={!!overviewStrategy && overviewStrategy.context_version!==project.context_version} failed={run?.status==='failed'||researchRecords?.rounds.at(-1)?.status==='failed'} loading={retrievalStrategy.status==='loading'} onNavigate={navigateProject} onEvidence={openEvidence}/>}
          {project.input.business_profile === 'neighborhood' && <div hidden={tab !== 'assessment' && tab !== 'scenarios'}><StrategyOverview key={`strategy-${project.id}-${completeDemoActive}`} project={project} demoActive={completeDemoActive} packet={packet} onEvidence={openEvidence} onInvestigate={() => navigateProject('actions','current')} publishedPlans={publicDecisions.items} onOpenPublishedPlan={openPublicDecision} directionSelection={directionSelection} onDirectionSelect={mode => { setDirectionSelection({ identity: directionIdentity, mode }); }} onStrategyResult={next => setDirectionPacket(next ? { identity: directionIdentity, packet: next } : null)} onUploadMaterial={uploadMaterial} materialBusy={busy} materialRequest={materialRequest} workspacePage={strategySurface.current.workspacePage} section={strategySurface.current.section} pane={strategySurface.current.pane} schemeDirection={currentDirection} onNavigate={target=>navigateProject(target.view as ProjectPage|'knowledge',target.section,target.pane,target.scheme)} /></div>}
          {tab === 'overview' && completeDemoActive && project.input.business_profile !== 'neighborhood' && <CompleteCommunityDemo key={`complete-demo-${project.id}`} project={project} />}
          {tab === "assessment" && !(["neighborhood"].includes(project.input.business_profile || "")) && !completeDemoActive && (
            <section className="legacy-assessment-workspace"><h2>工程研判与路径计算</h2>
              {run?.status === "failed" && (
                <div className="feedback notice">
                  <span>
                    上次运行未完成（{run.error_code}），已完成的工件可复用。
                  </span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const resumed = await api<{
                          id: string;
                          revision: number;
                          status: string;
                        }>(`/runs/${run.id}/resume`, {});
                        setRun({ ...run, ...resumed });
                        const source = eventSource.current;
                        source?.close();
                        setRun(null);
                        setTimeout(() => setRun({ ...run, ...resumed }), 0);
                      })
                    }
                  >
                    继续未完成研判
                  </button>
                </div>
              )}
              {running && (
                <button
                  className="text-button"
                  onClick={() =>
                    void action(async () => {
                      await api(`/runs/${run.id}/cancel`, {});
                      setNotice("已请求停止，当前快照和完成工件会保留。");
                    })
                  }
                >
                  停止本次研判
                </button>
              )}
              {packet && (
                <div className="result-provenance">
                  当前结果 v{packet.revision} ·{" "}
                  {packet.knowledge_agent
                    ? `命中后 Agent 研判 · ${packet.model || '模型标识未返回'} · ${packet.model_calls?.length || 0} 次调用`
                    : packet.execution_mode === "live"
                    ? `真实模型 ${packet.model || "标识未返回"} · ${packet.model_calls?.length || 0} 次调用`
                    : "离线工程检查（无模型推理）"}
                </div>
              )}
              {packet?.knowledge_agent && packet.knowledge && <Suspense fallback={<p role="status">正在读取建议与信源…</p>}><KnowledgeAgentReport value={packet.knowledge_agent} trace={packet.knowledge} sources={packet.sources} onEvidence={openEvidence} /></Suspense>}
              {packet?.knowledge && <details className="knowledge-run-trace"><summary>案例与规则命中依据 · {packet.knowledge.case_hits.length} 个案例 / {packet.knowledge.rule_hits.length} 条规则</summary>
                <p>{packet.knowledge.route === 'agent_fallback' ? packet.knowledge.fallback_status === 'offline_only' ? '本次两库均无适用命中，已执行离线工程检查；Agent 保底未启动。' : '本次两库均无适用命中，使用 Agent 保底生成候选建议。' : packet.knowledge.agent_status === 'executed' ? '命中记录已交Agent分析迁移条件和建议；下列内容是引用依据，最终行动仍接受业务条件检查。' : '下列是命中资料和条件核查记录，尚未由Agent完成本次研判。'}</p>
                {[...packet.knowledge.rule_hits, ...packet.knowledge.case_hits].map(hit => <article key={hit.card_id}><strong>{hit.measure_name}</strong><p>{hit.recommendation}</p>
                  <small>{[...hit.similar_conditions, ...hit.reuse_premises, ...hit.important_differences].join('；')}</small>
                  <button className="claim-source" onClick={() => openEvidence(hit.evidence_refs)}>查看原文与条件依据</button>
                </article>)}
                {packet.knowledge.reasons.map((reason, index) => <p key={index}>{reason}</p>)}
              </details>}
              {project.input.business_profile === 'neighborhood' && <NeighborhoodPanel key={project.id} project={project.input} dashboard={packet?.decision_support?.dashboard}
                assessedAdvice={!stale && packet?.knowledge_agent ? packet.neighborhood_action : undefined}
                draft={neighborhoodDrafts[project.id] || createNeighborhoodDraft()}
                onDraftChange={update => setNeighborhoodDrafts(current => ({ ...current, [project.id]: update(current[project.id] || createNeighborhoodDraft()) }))}
                onEvidence={openEvidence} />}
              {project.input.business_profile === 'neighborhood' && <CommunityOperationsPanel key={`operations-${project.id}`} project={project} />}
              {project.input.business_profile === 'neighborhood' && <ConstructionCostLibrary key={`construction-costs-${project.id}`} projectId={project.id} />}
              <section className="summary-panel">
                <details className="project-metrics-details"><summary>研究分流依据</summary><DecisionRoute value={packet?.decision_support} profile={project.input.business_profile === 'neighborhood' ? 'neighborhood' : 'balanced'} details /></details>
                <div className="summary-heading">
                  <div>
                    <div className="kicker">DECISION BRIEF</div>
                    <h2>
                      {running
                        ? "正在整理证据与检查路径"
                        : packet
                          ? "实施路径"
                          : "研究这处空间"}
                    </h2>
                  </div>
                  <span className="version-tag">
                    {packet ? `v${packet.revision}` : "待启动"}
                  </span>
                </div>
                {running && <div className="summary-research-wait">
                  <span className="summary-wait-art" aria-hidden="true"><WaitingMotif variant="research" stageKey={events.at(-1)?.stage} /></span>
                  <div><strong>本轮研判正在进行</strong><p>{events.at(-1)?.message || "正在启动研究"}</p></div>
                </div>}
                <p>
                  {brief?.summary ||
                    (project.input.business_profile === 'neighborhood'
                      ? "围绕居民需求、公共服务、居住工程、实施协同、长效维护和资金交付，整理本小区的依据与调查任务。"
                      : "使用当前资料检查建筑存量、实施前提与企业条件。形成可比较的实施路径。")}
                </p>
                {packet?.decision_support && <details><summary>判断操作依据</summary><DecisionRoute value={packet.decision_support} profile={project.input.business_profile === 'neighborhood' ? 'neighborhood' : 'balanced'} details /></details>}
                <div className="summary-bottom">
                  <span>
                    <span className="status-dot" />
                    {running
                      ? "研判执行中"
                      : packet
                        ? "研判结果"
                        : "资料已就绪 · 可运行离线检查"}
                  </span>
                  <button
                    className="primary"
                    disabled={busy || running || !canWrite}
                    onClick={() =>
                      void action(() =>
                        startRun(
                          project,
                          project.context_version ||
                            project.input.mode === "enterprise"
                            ? "enterprise"
                            : "automatic",
                        ),
                      )
                    }
                  >
                    {running ? (
                      <IconRefresh className="spin" size={17} />
                    ) : (
                      <IconPlayerPlay size={17} />
                    )}{" "}
                    {running ? "正在研判…" : packet ? "重新研判" : "开始初筛"}
                    <IconArrowRight size={17} />
                  </button>
                </div>
              </section>
              <details className="project-metrics-details"><summary>项目概况</summary><section className="metrics" aria-label="当前指标">
                <div>
                  <span>建筑总面积</span>
                  <strong>
                    {gfa?.value == null ? "待核实" : gfa.value.toLocaleString()}
                    <small>{gfa?.value == null ? "" : "m²"}</small>
                  </strong>
                  <p>
                    {gfa?.status === "conflict"
                      ? "来源冲突，保留未知"
                      : gfa?.value != null
                        ? "依据当前建筑清单"
                        : "等待可用建筑清单"}
                  </p>
                </div>
                <div>
                  <span>建筑空置比例</span>
                  <strong>
                    {vacancy?.value == null
                      ? "待核实"
                      : `${(vacancy.value * 100).toFixed(0)}%`}
                  </strong>

                </div>
              </section></details>
              <div className="section-head main-section-head">
                <div>
                  <span className="kicker">PATHWAYS</span>
                  <h2>实施路径</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => setTab("context")}
                >
                  加入企业经验 <IconArrowUpRight size={15} />
                </button>
              </div>
              {brief ? (
                <>
                  <div className="pathways">
                    {brief.paths.map((path, index) => (
                      <article className={`pathway ${path.status}`} key={path.id}>
                        <div className="pathway-top">
                          <span className="pathway-number">0{index + 1}</span>
                          <span className={`badge ${path.status}`}>{stateLabel[path.status]}</span>
                        </div>
                        <h3>{path.title}</h3>
                        <div className="pathway-description">
                          {path.status === 'blocked' ? <strong>现有组织条件阻断这一路径</strong> : <>
                            <strong>可研究的操作</strong>
                            <ol>{path.actions.map(action => <li key={action}>{action}</li>)}</ol>
                          </>}
                        </div>
                        <div className="pathway-detail">
                          <span>这一路径要先核实</span>
                          <ul>{path.conditions.map(condition => <li key={condition}>{condition}</li>)}</ul>
                          {packet?.scenarios.find(s => s.id === path.id)?.blockers.map(blocker =>
                            <p className="rule-impact" key={blocker}><IconLayersIntersect size={14}/>{blocker}</p>)}
                          {path.organizationNotes.map(note =>
                            <p className="rule-impact" key={note}><IconLayersIntersect size={14}/>{note}</p>)}
                        </div>
                        <button className="pathway-footer" onClick={() => openEvidence(path.sourceRefs)}>
                          <span>{path.sourceRefs.length} 个来源可复核</span><IconChevronRight size={15}/>
                        </button>
                      </article>
                    ))}
                  </div>
                  {brief.investigation && <article className="investigation-plan">
                    <div><span className="kicker">FIRST INVESTIGATION</span><h3>{brief.investigation.title}</h3></div>
                    <ol>{brief.investigation.actions.map(action => <li key={action}>{action}</li>)}</ol>
                    {brief.investigation.conditions.length > 0 && <p>本轮要确认：{brief.investigation.conditions.join('；')}</p>}
                  </article>}
                </>
              ) : (
                <div className="empty-inline">
                  <IconLayersIntersect size={28} />
                  <div>
                    <h3>路径将依据本次输入生成</h3>
                    <p>点击“开始初筛”，查看不同路径及各自的调查重点。</p>
                  </div>
                </div>
              )}
              {brief && packet?.comparison && (
                <section className="content-panel model-comparison">
                  <div className="kicker">EVIDENCE-BOUND COMPARISON</div>
                  <h2>依据与条件比较</h2>
                  <p className="comparison-intro">{brief.comparisonScope}</p>
                  <div className="synthesis-paths">{brief.paths.map(path =>
                    <article className="synthesis-path" key={path.id}>
                      <h3>{path.title}</h3>
                      {path.themes.map(theme => <section className="synthesis-theme" key={theme.label}>
                        <h4>{theme.label}</h4>
                        {theme.judgments.map(judgment => <p key={judgment}>{judgment}</p>)}
                        {theme.findings.map(finding => <details key={finding.id}>
                          <summary>展开相关调查发现</summary><p>{finding.claim}</p>
                        </details>)}
                        {theme.unknowns.length > 0 && <p className="synthesis-gaps">决定此处判断的缺项：{theme.unknowns.join('；')}</p>}
                        {theme.sourceRefs.length > 0 && <div className="synthesis-sources">来源：{theme.sourceRefs.slice(0, 3).map(id => {
                          const source = packetSources.get(id);
                          if (!source) return <span key={id}>{id}</span>;
                          const label = <>{source.title}{source.content_status === 'metadata_only' ? '（仅索引）' : ''}</>;
                          return source.url && /^https?:\/\//i.test(source.url)
                            ? <a key={id} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>{label}</a>
                            : <span key={id}>{label}</span>;
                        })}</div>}
                      </section>)}
                    </article>)}</div>
                  {!!packet.unresolved_disagreements?.length && (
                    <details className="disagreement">
                      <summary>
                        保留的分歧与未解条件（
                        {packet.unresolved_disagreements.length}）
                      </summary>
                      <ul>
                        {packet.unresolved_disagreements.map((v, i) => (
                          <li key={i}>{v}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}
              <section className="next-strip">
                <div className="next-icon">
                  <IconFileText size={23} />
                </div>
                <div>
                  <span className="kicker">NEXT BEST QUESTION</span>
                  <h3>{brief?.nextActions[0]?.title || "先核对最能改变路径的项目资料"}</h3>
                  <p>
                    {brief?.nextActions[0]?.why ||
                      "确认调查对象与原文后再选择实施动作。"}
                  </p>
                </div>
                <button
                  className="round-button"
                  aria-label="查看下一步调查"
                  onClick={() => setTab("actions")}
                >
                  <IconArrowRight size={19} />
                </button>
              </section>
              {packet && (
                <div className="report-bar">
                  <span>每个结果保留来源、缺项和版本，便于复核。</span>
                  <a
                    className="text-button"
                    href={`/api/runs/${packet.run_id}/report`}
                  >
                    <IconDownload size={16} />
                    导出研判报告
                  </a>
                </div>
              )}
            </section>
          )}
          {tab === "context" && (
            <section className="content-panel">
              <div className="kicker">ENTERPRISE CONTEXT</div>
              <h2>{project.input.purpose === 'case_library_archive' ? '案例与规则资料库' : '项目经验与本项目意见'}</h2>
              <p className="intro">
                {project.input.purpose === 'case_library_archive' ? '按单项举措保存真实来源、方法、实施记录和适用边界，复核后供具体项目检索。' : '记录本项目的事实、组织条件、偏好和线索。更新后复用未变化证据，只重评受影响的部分。'}
              </p>
              {!replay && <ExperienceLibrary key={project.id} projectId={project.id} revision={project.context_version} synthetic={project.input.synthetic} asOf={project.input.as_of} currentProject={project.input} onProjectUpdated={() => loadProject(project.id).then(()=>{})} onOpenMaterials={() => openEvidence()}
                onKnowledgeRun={project.input.purpose === 'case_library_archive' ? undefined : query => { if (!busy && !running) void action(() => startRun(project, 'enterprise', query)); }} />}
              <div hidden={project.input.purpose === 'case_library_archive'}>
              {!replay && <>
              <label className="field-label" htmlFor="experience">
                本项目意见（不作为历史实施结果）
              </label>
              <textarea
                id="experience"
                className="experience-input"
                placeholder={sampleExperience}
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                maxLength={20000}
              />
              <div className="form-footer">
                <button
                  className="text-button"
                  onClick={() => setExperience(sampleExperience)}
                  disabled={!project.input.synthetic}
                >
                  填入合成经验样例
                </button>
                <button
                  className="primary"
                    disabled={busy || running || !experience.trim() || !canWrite}
                  onClick={() =>
                    void action(async () => {
                      const updated = await api<Project>(
                        `/projects/${project.id}/context-updates`,
                        {
                          text: experience,
                          expected_version: project.context_version,
                        },
                      );
                      setProject(updated);
                      setExperience("");
                      await startRun(updated, "enterprise");
                    })
                  }
                >
                  <IconSparkles size={17} />
                  保存经验并局部重评
                </button>
              </div>
              <div className="note-line">
                已配置模型时，合成经验使用模型进行结构化分类。真实内部原话默认本地处理，未经配置许可不外发；所有规则仅限本项目。
              </div>
              </>}
              <h3 className="subheading">
                已纳入的项目经验{" "}
                <span className="count">
                  {
                    project.input.context_rules.filter(
                      (r) => r.active !== false,
                    ).length
                  }
                </span>
              </h3>
              <div className="rules-list">
                {project.input.context_rules
                  .filter((r) => r.active !== false)
                  .map((rule) => (
                    <article className="rule-row" key={rule.id}>
                      <span className="rule-kind">
                        {
                          {
                            organizational_constraint: "组织条件",
                            preference: "偏好",
                            capability_lead: "能力线索",
                            unknown: "待核事项",
                            fact_candidate: "事实候选",
                            heuristic: "经验启发",
                          }[rule.kind]
                        }
                      </span>
                      <div>
                        <strong>{rule.original_text || rule.note}</strong>
                        <p>{rule.note}</p>
                        <small>
                          仅本项目 · 来源 {rule.source_id.slice(0, 18)}
                        </small>
                      </div>
                      {canWrite && <button
                        className="text-button"
                        disabled={busy || running}
                        onClick={() =>
                          void action(async () => {
                            await api(
                              `/projects/${project.id}/context-revoke`,
                              {
                                rule_id: rule.id,
                                expected_version: project.context_version,
                              },
                            );
                            await loadProject(project.id);
                            setNotice(
                              "规则已撤销。重新研判后生效，历史版本保留。",
                            );
                          })
                        }
                      >
                        撤销
                      </button>}
                    </article>
                  ))}
              </div>
              {!project.input.context_rules.length && (
                <p className="empty-text">
                  {replay ? '本演示的判断标准见改造研判中的判定条件，原始资料可随时查阅。' : '还没有项目经验。你可以直接用自然语言补充。'}
                </p>
              )}
              </div>
            </section>
          )}
          {tab === 'evidence' && location.section === 'profile' && <section className="content-panel project-object-profile"><h2>研究对象档案</h2><div className="project-object-grid"><RegionView project={project}/><dl><dt>研究对象</dt><dd>{project.input.scope.name}</dd><dt>项目 ID</dt><dd>{project.id}</dd><dt>资料基线</dt><dd>v{project.context_version} · {project.input.as_of}</dd><dt>范围状态</dt><dd>{project.input.scope.geometry?'已有范围坐标':'范围尚未登记'} · {project.input.scope.legal_parcel_confirmed?'已确认宗地范围':'研究范围'}</dd></dl></div><h3>本对象已登记事实</h3>{project.input.facts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>项目</th><th>登记值</th><th>来源</th></tr></thead><tbody>{project.input.facts.map(fact=><tr key={fact.id}><td>{factLabel[fact.kind]||fact.kind}</td><td>{show(fact.value)}</td><td><button className="text-button" onClick={()=>openEvidence([fact.source_id])}>查看原文</button></td></tr>)}</tbody></table></div>:<p>对象材料保存在资料页；当前未录入已确认事实。</p>}<button className="secondary" onClick={()=>navigateProject('evidence','files')}>维护资料与证据</button></section>}
          {tab === "evidence" && location.section !== 'profile' && (
            <section className="content-panel">
              <div className="section-head">
                <div>
                  <div className="kicker">EVIDENCE LIBRARY</div>
                  <h2>资料与证据</h2>
                </div>
              </div>
              <p className="intro">
                维护本项目的原始资料、内部调查与来源记录。判断依据可在各工作页就地打开。
              </p>
              {!replay && <InternalMaterialIntake compact onUpload={uploadMaterial} disabled={busy || !canWrite} synthetic={project.input.synthetic}/>}
              <section className="project-material-library"><h3>检索与原始资料 · {displayedSources.length} 份来源</h3>
              <RagEvidenceSearch key={`rag-search-${project.id}`} projectId={project.id} revision={project.context_version} onEvidence={openEvidence} onLocateHit={locateEvidence} decisionLocations={decisionLocations} onNavigateDecision={navigateRetrievalDecision} decisionLinksState={decisionLinksState} featureLocations={featureLocations} onNavigateFeature={navigateRetrievalDecision} />
              <ImportedDataExplorer
                projectId={project.id}
                projectName={project.name}
                focusLocation={evidenceLocation?.projectId === project.id && evidenceLocation.contextVersion === project.context_version ? evidenceLocation : undefined}
                revision={project.context_version}
                sources={project.input.sources}
                researchSources={packet?.sources || []}
                facts={project.input.facts}
                profile={project.input.business_profile === 'neighborhood' ? 'neighborhood' : 'balanced'}
                asOf={project.input.as_of}
                onEvidence={openEvidence}
              />
              <div className="source-list">
                {!!requestedRefs.length && <div className="source-focus-note" role="status">
                  <span>{focusedSourceIds.length ? `已定位 ${focusedSourceIds.length} 份相关依据，首份原文已展开。` : '当前版本没有找到所引来源，请核对研判版本与资料记录。'}</span>
                  {sourceTextFocus && <span>{sourceTextResolved?.status === 'matched' ? `已高亮命中原文 · ${sourceTextFocus.hit.locator}` : sourceTextResolved?.status === 'version-mismatch' ? '检索与当前来源版本不同，未高亮其他版本的正文。' : sourceTextResolved?.status === 'version-unverified' ? '已打开来源，当前版本尚不能核验，未高亮其他正文。' : sourceTextResolved?.status === 'quote-mismatch' ? '已打开对应来源，当前正文未找到连续一致的命中片段。' : '正在核验命中原文版本…'}</span>}
                  <button className="secondary" onClick={() => { setSourceFocus(null); setSourceTextFocus(null); }}>取消定位</button>
                </div>}
                {displayedSources.map((source) => (
                  <article className={`source-row${focusedSourceIds.includes(source.id) ? ' is-focused' : ''}`} id={`project-source-${encodeURIComponent(source.id)}`} tabIndex={-1} key={source.id}>
                    <span className="file-icon">
                      <IconFileText size={22} />
                    </span>
                    <div>
                      <h3>
                        {source.url && /^https?:\/\//.test(source.url) ? (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title} ↗
                          </a>
                        ) : (
                          source.title
                        )}
                      </h3>
                      {source.content_status && (
                        <small className="muted">
                          {
                            {
                              full_text: "已获取原文",
                              excerpt: "仅有摘要",
                              metadata_only: "只有标题，正文待核",
                              uploaded: "本地上传",
                            }[source.content_status]
                          }
                        </small>
                      )}
                      <p>
                        {source.id} <span>·</span>{" "}
                        {source.visibility === "internal"
                          ? "项目内部"
                          : "公开可见"}
                      </p>
                      {source.parse_status === "ocr_required" && (
                        <p className="muted">
                          扫描材料待 OCR，当前没有可用文本证据。
                        </p>
                      )}
                      {source.untrusted_text && (
                        <details>
                          <summary>查看材料原文</summary>
                          <pre>{source.id === focusedSource?.id && sourceTextResolved?.status === 'matched' ? <>{sourceTextResolved.before}<mark tabIndex={-1} data-retrieval-source-hit="true">{sourceTextResolved.quote}</mark>{sourceTextResolved.after}</> : source.untrusted_text}</pre>
                        </details>
                      )}
                    </div>
                    <span className="source-tag">
                      {source.synthetic
                        ? "合成"
                        : source.data_class === "public"
                          ? "公开"
                          : "内部"}
                    </span>
                  </article>
                ))}
              </div>
              <h3 className="subheading">当前事实清单</h3>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>事实</th>
                      <th>原始值</th>
                      <th>来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.input.facts.map((fact) => (
                      <tr key={fact.id}>
                        <td>{factLabel[fact.kind] || fact.kind}</td>
                        <td>
                          {typeof fact.value === "object"
                            ? JSON.stringify(fact.value)
                            : show(fact.value)}
                        </td>
                        <td>{fact.source_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {packet && (
                <>
                  <h3 className="subheading">反证与未解问题</h3>
                  {packet.reviews.map((review) => (
                    <article className="review-row" key={review.id}>
                      <IconAlertTriangle size={18} />
                      <div>
                        <strong>{review.issue}</strong>
                        <p>{review.recommendation}</p>
                      </div>
                    </article>
                  ))}
                </>
              )}
              </section>
            </section>
          )}
          {tab === 'results' && <ProjectResultsPage project={project} packet={overviewStrategy} rounds={researchRecords?.rounds} legacyPacket={packet} onNavigate={navigateProject} onRunDetails={()=>setRunDetailsOpen(true)}/>}
          {tab === 'compare' && completeDemoActive && <DemoPlanVersions key={`demo-versions-${project.id}`} project={project} onExplore={() => setTab('overview')} />}
          {tab === "compare" && !completeDemoActive && (
            <section className="content-panel">
              <div className="kicker">REVISION HISTORY</div>
              <h2>版本变化</h2>
              <p className="intro">
                {project.input.business_profile === 'neighborhood' ? '首版建议 → 补齐关键资料 → 新一版决策。查看选择、举措与效果预期怎样改善。' : '比较最近两个已完成版本。旧报告绑定当时的资料快照，不被后续经验覆盖。'}
              </p>
              {project.input.business_profile === 'neighborhood' && <ResearchVersionHistory project={project} selectedDirection={currentDirection} replayPacket={overviewStrategy} onEvidence={openEvidence} onSupplement={() => { setMaterialRequest(value => value + 1); setTab('overview'); writeWorkbenchLink(project.id, 'overview'); }}/>}
              {!replay && <details className="strategy-historical-investigations legacy-run-history" open={project.input.business_profile !== 'neighborhood'}><summary>早期运行版本记录</summary>
              {projectExtras.loading ? <p role="status">正在读取版本变化…</p> : projectExtras.diffError ? <p role="status">版本变化暂不可读。<button className="secondary" onClick={() => void action(async () => { await loadProject(project.id); })}>重试</button></p> : diff?.available ? (
                <>
                  <div className="revision-summary">
                    <span>
                      v{diff.from_revision} <IconArrowRight size={18} /> v
                      {diff.to_revision}
                    </span>
                    <strong>{diff.changes.length} 处路径字段变化</strong>
                    <small>
                      {(diff.reused || [])
                        .map((r) => roleLabel[r] || r)
                        .join("、") || "无"}{" "}
                      工件复用
                    </small>
                  </div>
                  {diff.changes.length ? (
                    diff.changes.map((change, i) => (
                      <article className="diff-row" key={i}>
                        <h3>
                          {change.title}{" "}
                          <small>
                            {{
                              prerequisites: "前置条件",
                              blockers: "阻断项",
                              enterprise_fit: "企业适配",
                              preference_notes: "偏好",
                              actions: "动作",
                              status: "状态",
                            }[change.field] || change.field}
                          </small>
                        </h3>
                        <div className="diff-values">
                          <div>
                            <span>原版本</span>
                            <p>{show(change.before)}</p>
                          </div>
                          <div>
                            <span>当前版本</span>
                            <p>{show(change.after)}</p>
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty-inline">
                      本次复评未改变路径判断；运行记录和快照版本仍被保留。
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-inline">
                  <IconLayersIntersect size={28} />
                  <div>
                    <h3>需要两个已完成版本</h3>
                    <p>此处保留早期运行记录；当前研判版本与补充资料带来的变化见上方决策对比。</p>
                  </div>
                </div>
              )}
              </details>}
            </section>
          )}
          {tab === 'actions' && project.input.business_profile === 'neighborhood' && <ProjectTasksPage project={project} packet={overviewStrategy} rounds={researchRecords?.rounds} direction={currentDirection} section={location.section==='history'?'history':'current'} onEvidence={openEvidence} onSupplement={()=>navigateProject('evidence','files')}/>}
          {tab === "actions" && !(["neighborhood"].includes(project.input.business_profile || "")) && !completeDemoActive && (
            <details className="strategy-historical-investigations" open={project.input.business_profile !== 'neighborhood'}><summary>历史调查建议与已保存清单</summary><section className="content-panel">
              <div className="kicker">NEXT ACTIONS</div>
              <h2>优先调查，最可能改变判断的事</h2>
              <p className="intro">
                调查清单在本地保存；加入清单不会自动对外发函、报批或安排现场工作。
              </p>
              {projectExtras.loading && <p role="status">正在读取已保存的调查清单…</p>}
              {projectExtras.followupsError && <p role="status">调查清单暂不可读。<button className="secondary" onClick={() => void action(async () => { await loadProject(project.id); })}>重试</button></p>}
              {packet ? (
                brief?.nextActions.map((item) => (
                  <article className="followup-row" key={item.id || item.title}>
                    <span className={`priority p${item.priority}`}>
                      P{item.priority}
                    </span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.why}</p>
                      {'evidence_refs' in item && Array.isArray(item.evidence_refs) && item.evidence_refs.length > 0 && <button className="claim-source" onClick={() => openEvidence(item.evidence_refs as string[])}>查看调查建议的信源</button>}
                    </div>
                    <button
                      className="secondary"
                      disabled={
                        busy || projectExtras.loading || projectExtras.followupsError || !item.id || followups.some((f) => f.title === item.title)
                      }
                      onClick={() =>
                        void action(async () => {
                          if (!item.id) return;
                          await api(`/projects/${project.id}/followups`, {
                            run_id: packet.run_id,
                            followup_id: item.id,
                          });
                          setFollowups(
                            await api(`/projects/${project.id}/followups`),
                          );
                          setNotice("调查项已加入本地清单。");
                        })
                      }
                    >
                      {followups.some((f) => f.title === item.title) ? (
                        <>
                          <IconCheck size={16} />
                          已加入
                        </>
                      ) : (
                        "加入清单"
                      )}
                    </button>
                  </article>
                ))
              ) : (
                <p className="empty-text">完成首次研判后显示调查建议。</p>
              )}
            </section></details>
          )}
</ProjectDecisionGuidance>
      )}
      {!loading && !loadingTarget && !createOpen && createPortal(<FloatingEvidenceSearch
        projectId={project?.id} revision={project?.context_version} projectName={project?.name} pageContext={PROJECT_PAGES.find(page=>page.id===location.page)?.label} projects={projects}
        openRequest={askEvidenceRequest} onEvidence={openEvidence} onLocateHit={locateEvidence}
        decisionLocations={decisionLocations} onNavigateDecision={navigateRetrievalDecision} decisionLinksState={decisionLinksState}
        featureLocations={featureLocations} onNavigateFeature={navigateRetrievalDecision}
        onOpenMaterials={() => openEvidence()}
        onSelectProject={id => action(async () => { await loadProject(id); })}
      />, document.body)}
      {project && <ProjectEvidenceDrawer open={evidenceDrawer?.projectId===project.id} project={project} packet={evidenceDrawer?.packet} refs={evidenceDrawer?.refs||[]} onClose={()=>setEvidenceDrawer(null)} onOpenMaterials={id=>{const saved=evidenceDrawer?.packet;setEvidenceDrawer(null);openMaterials(id?[id]:[],saved||undefined);}}/>}
      {(settingsOpen || runDetailsOpen) && createPortal(<div className="workspace-utility-backdrop" onClick={()=>{setSettingsOpen(false);setRunDetailsOpen(false);}}><aside className="workspace-utility-drawer" role="dialog" aria-modal="true" aria-label={settingsOpen?'设置':'运行详情'} onClick={event=>event.stopPropagation()}><header><h2>{settingsOpen?'设置':'运行详情'}</h2><button autoFocus aria-label="关闭详情" onClick={()=>{setSettingsOpen(false);setRunDetailsOpen(false);}}>×</button></header>{settingsOpen?<>
        <section><h3>计算与运行</h3><label>执行方式{modeSelector}</label>{!replay&&<p>模型服务：{modelAvailable?'已配置':'尚未配置'}</p>}<button className="secondary" onClick={()=>{setSettingsOpen(false);navigateGlobal('map');setMapSettings(value=>value+1);}}>地图连接设置</button></section>
        {!replay&&project?.input.business_profile==='neighborhood'&&<section><h3>演示情景</h3><p>演示输入单独标记，用于展示完整参数下的方案和运营测算。</p><button className="secondary" onClick={()=>{const next=demoSessionActive?null:project.id;setCompleteDemoProject(next);setDirectionSelection(null);setSettingsOpen(false);setTab('scenarios');setRouteSection('compare');setGlobalView('project');setDetailsOpen(true);try{if(next)localStorage.setItem('hzz-complete-demo-project',next);else localStorage.removeItem('hzz-complete-demo-project');}catch{}}}>{demoSessionActive?'返回项目资料':'打开完整模拟情景'}</button></section>}
      </>:<><section><h3>{project?.name||'当前项目'}</h3><p>资料基线 v{project?.context_version||0}</p>{run?.status==='failed'&&<p role="alert">本轮运行未完成：{run.error_code||'请查看已保存阶段'}</p>}{overviewStrategy?.error&&<p role="alert">{overviewStrategy.error}</p>}<p>{running?'研究进行中':overviewStrategy?.status==='completed'?'已有完整保存成果':'当前尚无完整保存成果'}</p>{overviewStrategy?.model_calls.map((call,index)=><article key={index}><strong>{call.stage} · {call.returned_model||call.requested_model}</strong><p>耗时 {(call.duration_ms/1000).toFixed(1)} 秒 · 输入 {call.input_tokens} / 输出 {call.output_tokens} tokens</p></article>)}</section><section><h3>已保存运行与阶段</h3>{rail}</section></>}</aside></div>,document.body)}
      {createOpen && createPortal(
        <div className="modal-backdrop" onClick={() => {if(!busy)setCreateOpen(false)}}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-head">
              <h2 id="create-title">新建项目空间</h2>
              <button
                className="icon-button"
                aria-label="关闭新建窗口"
                disabled={busy}
                onClick={() => setCreateOpen(false)}
              >
                <IconX size={21} />
              </button>
            </div>
            <p>真实项目从空证据开始，缺项会如实保留。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if(busy)return;
                setCreateError('');
                if(!regionName.trim()){setCreateError('请填写研究小区或片区名称。');return}
                void action(async () => {
                  try {
                  let providedGeometry:unknown;
                  if(geometryText.trim()){
                    try{const value=JSON.parse(geometryText);providedGeometry=value?.type==='Feature'?value.geometry:value}
                    catch{throw new Error('范围 JSON 格式不正确，请检查括号和坐标，或先清空范围后创建。')}
                  }
                  await api('/session');
                  const geometry = geometryText.trim()
                    ? providedGeometry as ProjectInput['scope']['geometry']
                    : mapEvidence?.target.geometry
                      ? (await api<{geometry:NonNullable<ProjectInput['scope']['geometry']>}>('/maps/geometry/wgs84',{geometry:mapEvidence.target.geometry})).geometry
                      : null;
                  const input: ProjectInput = {
                    schema_version: "2.0",
                    project_id: creationDraftId.current || (creationDraftId.current=`P-${randomUUID()}`),
                    synthetic: false,
                    purpose: "preconstruction_research",
                    business_profile: businessProfile,
                    mode: "automatic",
                    role: "planner",
                    as_of: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date()),
                    scope: {
                      name: regionName.trim(),
                      geometry,
                      coordinate_encoding: "WGS84",
                      legal_parcel_confirmed: false,
                      ...(mapAnchor ? { map_anchor: mapAnchor } : {}),
                      ...(geometry?{boundary_source:geometryText.trim()?'user:provided-geometry':mapEvidence?.target.boundary_source||'map:selected-boundary'}:{}),
                    },
                    facts: [],
                    sources: mapEvidence && mapAnchor ? [{ id: mapEvidence.id, title: '高德区位初筛资料快照', data_class: 'public', visibility: 'public', synthetic: false,
                      retrieved_at: mapEvidence.created_at, content_status: 'excerpt', locator: `map-screening:${mapEvidence.id}`,
                      url: `https://uri.amap.com/marker?position=${mapAnchor.longitude},${mapAnchor.latitude}&coordinate=gaode`,
                      untrusted_text: JSON.stringify({target:mapEvidence.target,address:mapEvidence.address,groups:mapEvidence.groups}) }, ...handoffPublicSources(mapEvidence)] : [],
                    context_rules: [],
                    candidate_ids: businessProfile==='neighborhood'?['retain_and_reuse','defer_and_investigate']:[
                      "retain_and_reuse",
                      "selective_rebuild",
                      "defer_and_investigate",
                    ],
                    events: [],
                  };
                  try{validateProjectCreationInput(input)}catch(error){throw new Error(error instanceof ContractError?contractErrorMessage(error):error instanceof Error?error.message:'项目输入检查未完成。')}
                  const p = await api<Project>("/projects", {
                    input,
                    name: projectName.trim() || regionName.trim(),
                  });
                  setProjects(current=>[p,...current.filter(row=>row.id!==p.id)]);
                  await loadProject(p.id,p);
                  setCreateOpen(false);
                  setTab("evidence"); setRouteSection("files");
                  setDetailsOpen(true); setGlobalView("project");
                  setMapAnchor(undefined);
                  setMapEvidence(null);
                  void refreshProjects().catch(()=>setNotice('项目已创建，项目列表暂未刷新，可稍后重新打开项目空间。'));
                  }catch(error){setCreateError(error instanceof Error?error.message:'项目创建未完成，请重试。');throw error}
                });
              }}
            >
              <label className="field-label" htmlFor="project-name">
                项目名称
              </label>
              <input
                id="project-name"
                autoFocus
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                maxLength={120}
                placeholder="例如：杭州某老旧小区综合整治提升"
              />
              <label className="field-label" htmlFor="business-profile">业务方向</label>
              <select id="business-profile" value={businessProfile} onChange={e=>setBusinessProfile(e.target.value as typeof businessProfile)}><option value="neighborhood">老旧小区综合整治提升</option><option value="general">其他存量空间研究</option></select>
              <label className="field-label" htmlFor="region-name">研究小区或片区名称</label>
              <input
                id="region-name"
                required
                onInvalid={e=>{e.preventDefault();setCreateError('请填写研究小区或片区名称。')}}
                value={regionName}
                onChange={(e) => setRegionName(e.target.value)}
                maxLength={120}
                placeholder="城市 / 片区 / 建筑对象"
              />
              <details className="geometry-details">
                <summary>补充 GeoJSON Polygon（可选）</summary>
                <textarea
                  aria-label="GeoJSON 范围"
                  value={geometryText}
                  onChange={(e) => setGeometryText(e.target.value)}
                  placeholder={'{"type":"Polygon","coordinates":[[[...]]]}'}
                />
              </details>
              <div className="note-line">
                AI 生成与搜索可能存在错误
              </div>
              {mapAnchor && <div className="note-line">已关联地图位置：{mapAnchor.name}。{mapEvidence?.target.geometry?'所选边界将作为项目范围。':mapEvidence?'将同时带入本次区位初筛资料。':''}<button type="button" className="text-button" onClick={() => { setMapAnchor(undefined); setMapEvidence(null) }}>解除关联</button></div>}
              {createError&&<div className="project-create-error" role="alert">{createError}</div>}
              <button
                className="primary full-width"
                disabled={busy}
                type="submit"
              >
                {busy?'正在创建项目…':'创建真实项目'} <IconArrowRight size={17} />
              </button>
            </form>
            <div className="modal-divider">或运行工程样例</div>
            <div className="sample-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void action(() => createFixture())}
              >
                标准初筛样例
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void action(() => createFixture("04_conflict"))}
              >
                面积冲突样例
              </button>
            </div>
          </section>
        </div>, document.body
      )}
      </WorkbenchAccessContext.Provider>
    </WorkspaceFrame>
  );
}
