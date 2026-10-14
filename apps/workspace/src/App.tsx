import { lazy, Suspense, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
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
  IconUpload,
  IconX,
  IconAlertTriangle,
} from "@tabler/icons-react";
import WorkspaceFrame from "./components/WorkspaceFrame";
import MapWorkspace from "./maps/MapWorkspace";
import { toProjectAnchor } from "./maps/amap-client";
import type { MapScreenContext, KnowledgeQuery } from '../../host/generated/contracts';
import { DecisionRoute } from './components/DecisionRoute';
import { WaitingMotif } from './components/WaitingScene';
import ImportedDataExplorer from './imports/ImportedDataExplorer';
import RagEvidenceSearch from './imports/RagEvidenceSearch';
import FloatingEvidenceSearch from './imports/FloatingEvidenceSearch';
import type { RetrievalHit } from '../../../packages/experience/retrieval';
import NeighborhoodPanel, { createNeighborhoodDraft, type NeighborhoodDraft } from './components/NeighborhoodPanel';
import CommunityOperationsPanel from './components/CommunityOperationsPanel';
import CompleteCommunityDemo from './components/CompleteCommunityDemo';
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
              stroke="#dce6e4"
              strokeWidth=".6"
            />
          </pattern>
        </defs>
        <rect width="290" height="200" fill="url(#grid)" />
        <polygon
          points={points}
          fill="#cde1dc"
          stroke="#347666"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />
        {ring.slice(0, -1).map((p, i) => (
          <circle
            key={i}
            cx={35 + ((p[0] - minX) / (maxX - minX || 1)) * 220}
            cy={155 - ((p[1] - minY) / (maxY - minY || 1)) * 110}
            r="3"
            fill="#347666"
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

export default function App() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mapFocus, setMapFocus] = useState(0), [mapSettings, setMapSettings] = useState(0);
  const [mapAnchor, setMapAnchor] = useState<ProjectInput['scope']['map_anchor']>();
  const [mapEvidence, setMapEvidence] = useState<MapScreenContext | null>(null);
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null);
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
  const [followups, setFollowups] = useState<{ title: string }[]>([]);
  const [projectExtras, setProjectExtras] = useState({ loading: false, diffError: false, followupsError: false });
  const [businessProfile, setBusinessProfile] = useState<'neighborhood'|'general'>('neighborhood');
  const [loadingTarget, setLoadingTarget] = useState<string | null>(null);
  const [neighborhoodDrafts, setNeighborhoodDrafts] = useState<Record<string, NeighborhoodDraft>>({});
  const [completeDemoProject, setCompleteDemoProject] = useState<string | null>(() => {
    try { return localStorage.getItem('hzz-complete-demo-project'); } catch { return null; }
  });
  const demoSessionActive = !!project && project.id === completeDemoProject;
  const completeDemoActive = demoSessionActive && ['overview', 'compare', 'actions'].includes(tab);
  const [sourceFocus, setSourceFocus] = useState<{ projectId: string; refs: string[] } | null>(null);
  const [askEvidenceRequest, setAskEvidenceRequest] = useState(0);
  const [evidenceLocation, setEvidenceLocation] = useState<{ projectId: string; documentId: string; version: string; locator: string; quote: string; token: number } | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [executionMode, setExecutionMode] = useState<"offline" | "live">(
    "offline",
  );
  const displayedSources = [...new Map([...(project?.input.sources || []), ...(packet?.sources || [])].map(source => [source.id, source])).values()];
  const requestedRefs = sourceFocus?.projectId === project?.id ? sourceFocus?.refs || [] : [];
  const focusedSourceIds = displayedSources.filter(source => requestedRefs.some(ref => ref === source.id || ref === `${project?.id}:${source.id}`)).map(source => source.id);
  const focusedSourceKey = focusedSourceIds.join('\u0000');
  const brief = packet ? buildDecisionBrief(packet) : null;
  const packetSources = new Map((packet?.sources || []).map(source => [source.id, source] as const));
  const eventSource = useRef<EventSource | null>(null);
  const projectLoadVersion = useRef(0);
  const running = run?.status === "running";
  const stale =
    !!packet && !!project && packet.context_version !== project.context_version;
  function openEvidence(refs: string[] = []) {
    setEvidenceLocation(null);
    if (project) setSourceFocus({ projectId: project.id, refs: [...new Set(refs)] });
    setTab('evidence');
    setDetailsOpen(true);
  }
  function locateEvidence(hit: RetrievalHit) {
    if (!project) return;
    setSourceFocus(null);
    setEvidenceLocation(previous => ({ projectId: project.id, documentId: hit.document_id,
      version: hit.version, locator: hit.locator, quote: hit.text, token: (previous?.token || 0) + 1 }));
    setTab('evidence');
    setDetailsOpen(true);
  }
  useEffect(() => {
    if (tab !== 'evidence' || !focusedSourceIds.length) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`project-source-${encodeURIComponent(focusedSourceIds[0])}`);
      const original = target?.querySelector('details');
      if (original) original.open = true;
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, project?.id, focusedSourceKey]);
  async function loadProject(id: string) {
    const version = ++projectLoadVersion.current;
    const p = await api<Project>(`/projects/${encodeURIComponent(id)}`);
    if (version !== projectLoadVersion.current) return p;
    setProject(p);
    localStorage.setItem("hzz_project", id);
    const latest = p.runs?.[0] || null;
    setRun(latest);
    setPacket(p.runs?.find((r) => r.decision)?.decision || null);
    setDiff(null);
    setFollowups([]);
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
        setLoading(false);
        const list = await refreshProjects();
        if (!alive) return;
        const selected =
          list.find((p) => p.id === localStorage.getItem("hzz_project")) ||
          list.find((p) => !p.input.synthetic) || list[0];
        if (selected) await loadProject(selected.id);
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
  async function startRun(p: Project, mode: "automatic" | "enterprise", knowledgeQuery?: KnowledgeQuery) {
    const created = await api<{ id: string; revision: number; status: string }>(
      `/projects/${p.id}/runs`,
      {
        mode,
        execution_mode: executionMode,
        idempotency_key: crypto.randomUUID(),
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
  const stages = [
    {
      id: "overview",
      label: "研判总览",
      detail: "路径与关键前提",
      done: !!packet,
    },
    {
      id: "evidence",
      label: "资料与证据",
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
      label: "版本与变化",
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
  return (
    <WorkspaceFrame
      project={project}
      projects={projects}
      stages={stages}
      tab={tab}
      onTab={setTab}
      onProject={(id) =>
        void action(async () => {
          setLoadingTarget(id);
          try {
            const selected = await loadProject(id);
            setTab(selected.input.purpose === 'case_library_archive' ? 'context' : 'overview');
            setMapFocus(v => v + 1);
            setDetailsOpen(true);
          } finally { setLoadingTarget(null); }
        })
      }
      onCreate={() => { setMapAnchor(undefined); setMapEvidence(null); setProjectName(''); setRegionName(''); setGeometryText(''); setCreateOpen(true); }}
      mapView={<MapWorkspace ready={!loading} interactionBlocked={detailsOpen || loading || !!loadingTarget} project={project} focusProject={mapFocus} settingsRequest={mapSettings}
        onAskEvidence={() => setAskEvidenceRequest(value => value + 1)}
        onEvidence={refs => { openEvidence(refs); setDetailsOpen(true); }}
        onOpenProject={id => { void (async () => { if (id && id !== project?.id) { setLoadingTarget(id); try { await loadProject(id) } finally { setLoadingTarget(null) } } setTab('overview'); setDetailsOpen(true); })().catch(e => setError(e.message)); }}
        onCreateFromPlace={(place, context) => {
          const clean=context?publicMapContext(context):null
          const publicName=clean?.target.label||clean?.address||place.address||(place.poi_id?place.name:'')
          setMapAnchor(toProjectAnchor({...place,name:publicName||'地图选点'}));setMapEvidence(clean)
          setProjectName(publicName?`${publicName} · 片区研究`.slice(0,120):'地图选点研究')
          setRegionName([...new Set([clean?.city||place.city,publicName].filter(Boolean))].join(' ').slice(0,120))
          setGeometryText('');setCreateOpen(true)
        }} />}
      detailsOpen={detailsOpen}
      bootLoading={loading || !!loadingTarget}
      onMap={() => setDetailsOpen(false)}
      onSettings={() => { setDetailsOpen(false); setMapSettings(v => v + 1); }}
      error={error}
      onDismissError={() => setError('')}
      rail={rail}
      modeControl={
        <select
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
        </select>
      }
    >
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
              disabled={busy}
              onClick={() => void action(() => createFixture())}
            >
              <IconPlayerPlay size={17} />
              打开合成示范
            </button>
            <button className="secondary" onClick={() => setCreateOpen(true)}>
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
        <>
          <div className={`page-heading${completeDemoActive ? " is-complete-demo" : ""}`}>
            <div>
              <div className="eyebrow">
                <span className="project-type">
                  {completeDemoActive ? '完整模拟演示' : project.input.purpose === 'case_library_archive' ? '案例与规则归档' : project.input.synthetic ? "显式合成示范" : "真实项目资料"}
                </span>
                <span>项目空间 / {project.id.slice(0, 10)}</span>
              </div>
              <h1>{completeDemoActive ? `杭州样本社区 · ${tab === 'compare' ? '版本变化' : tab === 'actions' ? '下一步调查' : '运营推演'}` : project.name}</h1>
              <p>
                {project.input.purpose === 'case_library_archive' ? '公开材料归档' : '改造需求与前期策划'} <span>·</span>{" "}
                {project.input.purpose === 'case_library_archive' ? '举措拆分、规则提取与原文复核' : project.input.business_profile === 'neighborhood' ? '老旧小区改造 · 居民需求、实施条件与长效维护' : '以建筑、实施和企业条件为研判主线'}
              </p>
            </div>
            <button className="secondary" onClick={() => setCreateOpen(true)}>
              <IconPlus size={16} />
              新建项目
            </button>
          </div>
          {project.input.synthetic && (
            <div className="scope-note">
              <IconShieldCheck size={17} />
              <span>
                本项目和材料均为合成样例，用于验证工程流程，不对应真实宗地或企业。
              </span>
            </div>
          )}
          {stale && (
            <div className="feedback notice">
              <IconRefresh size={17} />
              <span>
                项目资料已变化，当前展示 v{packet?.revision}{" "}
                的历史结果。重新研判后生成新版本。
              </span>
            </div>
          )}
          {project.input.business_profile === 'neighborhood' && <div className="full-demo-mode-toolbar">
            <p>{completeDemoActive ? '全量模拟：六维现况、改造方案、月度运营和模拟台账均有完整数值与推算依据；支持版本对比与下一步调查。' : demoSessionActive ? '当前查看真实项目的材料与证据。模拟方案、版本对比和调查演示可通过顶部标签返回。' : '可查看真实项目资料，或打开全量模拟数据，演示政府工作人员掌握完整资料后的报表。'}</p>
            <button className="secondary" type="button" onClick={() => {
              const next = demoSessionActive ? null : project.id;
              setCompleteDemoProject(next); setTab('overview');
              try { if (next) localStorage.setItem('hzz-complete-demo-project', next); else localStorage.removeItem('hzz-complete-demo-project'); } catch {}
            }}>{demoSessionActive ? '返回真实项目资料' : '打开完整数据模拟演示'}</button>
          </div>}
          {tab === 'overview' && completeDemoActive && <CompleteCommunityDemo key={`complete-demo-${project.id}`} project={project} />}
          {tab === "overview" && !completeDemoActive && (
            <>
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
                    disabled={busy || running}
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
            </>
          )}
          {tab === "context" && (
            <section className="content-panel">
              <div className="kicker">ENTERPRISE CONTEXT</div>
              <h2>{project.input.purpose === 'case_library_archive' ? '案例与规则资料库' : '项目经验与本项目意见'}</h2>
              <p className="intro">
                {project.input.purpose === 'case_library_archive' ? '按单项举措保存真实来源、方法、实施记录和适用边界，复核后供具体项目检索。' : '记录本项目的事实、组织条件、偏好和线索。更新后复用未变化证据，只重评受影响的部分。'}
              </p>
              <ExperienceLibrary key={project.id} projectId={project.id} revision={project.context_version} synthetic={project.input.synthetic} asOf={project.input.as_of} currentProject={project.input} onProjectUpdated={() => loadProject(project.id).then(()=>{})} onOpenMaterials={() => openEvidence()}
                onKnowledgeRun={project.input.purpose === 'case_library_archive' ? undefined : query => { if (!busy && !running) void action(() => startRun(project, 'enterprise', query)); }} />
              <div hidden={project.input.purpose === 'case_library_archive'}>
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
                  disabled={busy || running || !experience.trim()}
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
                      <button
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
                      </button>
                    </article>
                  ))}
              </div>
              {!project.input.context_rules.length && (
                <p className="empty-text">
                  还没有项目经验。你可以直接用自然语言补充。
                </p>
              )}
              </div>
            </section>
          )}
          {tab === "evidence" && (
            <section className="content-panel">
              <div className="section-head">
                <div>
                  <div className="kicker">EVIDENCE LIBRARY</div>
                  <h2>资料与证据</h2>
                </div>
                <label
                  className={`secondary upload-button ${busy ? "disabled" : ""}`}
                >
                  <IconUpload size={16} />
                  上传材料
                  <input
                    type="file"
                    accept=".md,.txt,.csv,.pdf,.docx,.xlsx"
                    disabled={busy || project.input.synthetic}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void action(async () => {
                        const form = new FormData();
                        // Multipart filename headers may use a different charset than UTF-8 fields.
                        form.append("original_file_name", file.name);
                        form.append("file", file);
                        const response = await fetch(
                          `/api/projects/${project.id}/documents`,
                          {
                            method: "POST",
                            headers: { "X-Requested-With": "haizhizi" },
                            body: form,
                          },
                        );
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.detail);
                        await loadProject(project.id);
                        setNotice(
                          result.parser_result?.status === "ocr_required"
                            ? "原文件已保存，扫描页尚需 OCR；未把空文本当作已解析证据。"
                            : "材料已在本地解析保存，尚未将正文自动认定为事实或组织约束。",
                        );
                      });
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <p className="intro">
                保留原始来源、资料类别与访问范围。当前上传支持
                TXT、Markdown、CSV、PDF、Word、Excel（≤ 10
                MB）。真实材料使用独立真实项目。
              </p>
              <RagEvidenceSearch key={`rag-search-${project.id}`} projectId={project.id} onEvidence={openEvidence} onLocateHit={locateEvidence} />
              <ImportedDataExplorer
                projectId={project.id}
                projectName={project.name}
                focusLocation={evidenceLocation?.projectId === project.id ? evidenceLocation : undefined}
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
                  <button className="secondary" onClick={() => setSourceFocus(null)}>取消定位</button>
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
                          <pre>{source.untrusted_text}</pre>
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
          )}
          {tab === 'compare' && completeDemoActive && <DemoPlanVersions key={`demo-versions-${project.id}`} project={project} onExplore={() => setTab('overview')} />}
          {tab === "compare" && !completeDemoActive && (
            <section className="content-panel">
              <div className="kicker">REVISION HISTORY</div>
              <h2>看见判断为什么改变</h2>
              <p className="intro">
                比较最近两个已完成版本。旧报告绑定当时的资料快照，不被后续经验覆盖。
              </p>
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
                    <p>完成初筛后添加一条企业经验，即可查看判断变化。</p>
                  </div>
                </div>
              )}
            </section>
          )}
          {tab === 'actions' && completeDemoActive && <DemoInvestigationPanel key={`demo-investigations-${project.id}`} project={project} />}
          {tab === "actions" && !completeDemoActive && (
            <section className="content-panel">
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
            </section>
          )}
        </>
      )}
      {!loading && !loadingTarget && !createOpen && createPortal(<FloatingEvidenceSearch
        projectId={project?.id} projectName={project?.name} projects={projects}
        openRequest={askEvidenceRequest} onEvidence={openEvidence} onLocateHit={locateEvidence}
        onOpenMaterials={() => openEvidence()}
        onSelectProject={id => action(async () => { await loadProject(id); })}
      />, document.body)}
      {createOpen && createPortal(
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
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
                onClick={() => setCreateOpen(false)}
              >
                <IconX size={21} />
              </button>
            </div>
            <p>真实项目从空证据开始，缺项会如实保留。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const geometry = geometryText.trim()
                    ? JSON.parse(geometryText)
                    : mapEvidence?.target.geometry
                      ? (await api<{geometry:NonNullable<ProjectInput['scope']['geometry']>}>('/maps/geometry/wgs84',{geometry:mapEvidence.target.geometry})).geometry
                      : null;
                  const input: ProjectInput = {
                    schema_version: "2.0",
                    project_id: `P-${crypto.randomUUID()}`,
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
                  const p = await api<Project>("/projects", {
                    input,
                    name: projectName.trim() || regionName.trim(),
                  });
                  await refreshProjects();
                  await loadProject(p.id);
                  setCreateOpen(false);
                  setTab("evidence");
                  setDetailsOpen(true);
                  setMapAnchor(undefined);
                  setMapEvidence(null);
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
              <button
                className="primary full-width"
                disabled={busy}
                type="submit"
              >
                创建真实项目 <IconArrowRight size={17} />
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
    </WorkspaceFrame>
  );
}
