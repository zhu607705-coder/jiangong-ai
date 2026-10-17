# 老旧小区改造前期研判辅助 Agent
## v2：老旧小区改造的复用优先工程方案

> 当前方向更新（2026-10-10）：按用户新需求，首版面向老旧小区改造的前期策划、工程实施与社区协同人员，聚焦**老旧小区综合整治提升**。以杭州翠苑一区真实公开历史案例验证“片区初筛—改造定位验证—方案调整—经验复用—专项调查”流程。当前业务六维为居民需求、公共服务、居住工程、实施协同、长效维护、资金交付，作为业务观察维度，不是官方评分标准；三类行动建议须遵循硬约束优先、关键缺项先补充的判定。当前产品口径、经验卡字段、静态测算与验证边界见[老旧小区改造产品与验证方案](老旧小区改造_产品与验证方案.md)。本文下方保留 2026-09-27 原设计作为历史溯源；旧六维、泛化开发路径与本次定位冲突时，以新方案和 `../agent/mission.md` 为准。既有 CRE/DSH 架构、复用与权限约束继续适用。现有工程状态仍以 `engineering.md` 和 `../agent/state.json` 的实测记录为准，产品设计不能被当作已实现功能或企业效果。

状态：产品与接口设计建议；源文件已定点核验；除文末列出的局部代码与夹具检查外，未完成整体系统安装、迁移或联网联调。
依据：用户提供的《海之子杯申报书框架_片区价值研判Agent.docx》及本次官方仓库/文档核验。更新日期：2026-09-27。

> 执行状态更新（2026-09-28）：本文保留原设计依据；当前可运行代码、真实API联调、测试与边界见 `engineering.md`、`../agent/state.json` 和 `../research/test_results/verification.json`。原文中的“未完成”是设计包交付时的历史状态，不是当前工程状态。

## 0. 本次改动

主链从“地块画像→售价/IRR”改为“岗位目标→区域与建筑事实→关键决策问题→可实施路径→反证检查→企业适配→下一步行动”。价格、成本和现金流仅是资源约束中的一个工具族。保留原申报书的项目背景、应用场景、技术方案、创新点、价值贡献和实施保障六部分。

工程路径改为：**以 CRE 工作台代码为应用壳，以 DeepSeek Harness 为唯一运行时，直接移植研究项目中有用的函数和模块，补上本项目特有的语义与接口。**不再自研一套通用 Agent 调度器、会话系统、解析后台和报告框架。

“唯一运行时”允许多个专业子 Agent，限制的是相互争夺任务状态的多个控制系统，不是专业分工。

## 1. 产品对象与决策范围

### 1.1 用户矩阵

| 用户 | 当前要作出的决定 | 首屏必须显示 | 不应强塞给用户 |
|---|---|---|---|
| 建投/城投投资拓展经理（主用户） | 是否值得进入专项尽调；企业以何种方式参与 | 机会、阻断项、2–3条实施路径、所需内部资源、下一步调查 | 通篇技术日志或只有一个投资评分 |
| 前期策划/规划研究人员 | 保留、改造、新建、分期各自适用什么条件 | 建筑与功能约束、需求证据、案例可迁移条件、空间容量区间 | 把规划知识问答当作项目论证 |
| 企业决策管理者 | 是否配置研究预算、启动协作或暂缓 | 一页决策摘要、关键分歧、条件变化、待确认事项 | 模型代替投委会授权或伪精确收益预测 |

岗位配置是决定问题和展示详略的模板，不是给同一事实制造不同真相。访问权限另行控制。

### 1.2 建造前决策六维度

1. **实施前提**：边界、地块/建筑对象、权属与使用约束、已知审批前置条件。研究范围不等于开发权利。
2. **建筑存量与改造适配**：用途、建筑规模、占用、空置、是否具备结构检测/消防/测绘资料、潜在改造冲突。图像只支持可观察特征，不能远程签发安全结论。
3. **功能与需求匹配**：就业/居住/服务需求、现有供给、使用人群、运营组织；不得将“轨道站点多”直接等价于某产品必然成功。
4. **实施组织与节奏**：分期、腾退、公共设施与市政先行项、场地接口、需要哪类合作方。
5. **企业适配**：可用建设与运营能力、既有项目经验、资源占用、可接受边界、合作模式。
6. **资源与风险**：可获得数据支持的容量、成本/工期区间、资金占用；未知项可能改变哪些路径。

输出不是“这个地区值多少钱”，而是“对于这类企业和岗位，当前哪些行动有依据、什么条件成立才能继续、最有价值的下一项调查是什么”。不替代规划许可、工程勘察/检测或正式投资审批。

## 2. 两个模式，一个核心

| 项目 | 自动初筛版 | 企业增强版 |
|---|---|---|
| 用户输入 | 地图圈选/地块号/可解析地名；使用已保存岗位默认值 | 相同区域，另上传内部文件或直接描述经验 |
| 自动执行 | 数据发现、解析、统一、调查、案例对标、方案与反证、报告 | 前述能力 + Context Compiler + 企业适配重评 |
| 缺失信息 | 自动补查；仍缺失则输出条件化结果/调查清单 | 优先在有权限的企业资料中找；保留冲突和适用范围 |
| 人工操作 | 不逐条审字段；可选择处理少量高影响例外 | 项目内意见默认项目范围；升级全企业规则须权限确认 |
| 结果 | 区域体检、关键问题、候选路径、尚不能确认的事项 | 新旧结论对照：哪个内部事实/偏好改变了哪条判断 |
| 宣称边界 | 不假装知道企业能力 | 仅对实际获得并获准使用的资料生效 |

城市不写死为杭州。`RegionPack`包含城市/辖区、支持的数据源、可用图层、指标定义与时效、语言及单位配置。可以先选择一处资料可取得的区域做演示；对未覆盖城市，系统明确降级，不宣称已具备全国一致的数据覆盖。

## 3. 总体架构及技术选择

```text
用户：地图/岗位默认值/上传资料/自然语言经验
                        │
        CRE React 工作台（移植交互与报告组件）
                        │  HTTP + SSE
        Node/TypeScript 应用宿主（业务命令、权限、版本）
                        │
        DeepSeek Harness（会话、工具、子 Agent、恢复）
          │             │                  │
     研究工具族      专业子 Agent       方案/反证/比较流程
          └─────────────┼──────────────────┘
                        │ typed JSON / capability bridge
              Python FastAPI 能力服务
      表格检索 | 文档解析 | GIS | 案例 | 参数化测算
                        │
 PostgreSQL + PostGIS + pgvector / 原始文件卷 / 版本化工件
```

### 3.1 四层职责，对应原申报书

| 层 | 实现 | 所有权 | 不承担 |
|---|---|---|---|
| 交互层 | CRE dashboard 组件改造成片区研究工作台，增补地图和对比视图 | 未提交草稿、展示状态 | 模型调用密钥、权威数值计算 |
| 决策执行层 | DSH + 本项目 workflow/roles/skills；应用层管理业务对象 | 运行会话归 DSH；业务版本归应用服务 | 另建第二套 Agent 调度器 |
| 专业能力层 | 迁移的 STORM/RETQA/HIRE/GeoAgent 代码及通用库 | 返回结构化结果，不私自发布最终决策 | 拷贝每个仓库的全部 runtime |
| 数据与上下文层 | 来源、指标、案例、规则、方案、审查、工件 | PostgreSQL为业务记录；文件卷为原始内容；DSH会话为执行记录 | 把所有内部内容复制给所有子Agent |

### 3.2 默认栈及取舍

- **应用壳**：fork/移植 CRE 的 React/TypeScript dashboard、解析服务接口、schema校验、报告渲染和相关测试。删除美式收购流程的业务阈值与预设结论。[S3]
- **运行时**：DeepSeek Harness，默认挂载官方模型、web与subagent能力；禁止业务分析会话拥有任意shell、写文件、读全部私有目录权限。[S1]
- **主模型**：DeepSeek-V4.1-Flash-1017（2026-10-17核对官方目录），官方当前 API 名为 `deepseek-flash`；模型名配置化，记录每次运行实际返回的模型标识，不把漂移别名当不变快照。[S2]
- **搜索**：复用DSH `dsh-web`挂载独立官方`/v1/tools/search`与`/v1/tools/fetch`；默认Search请求正文并复用，正文缺失再Fetch，原HTTP解析保留为兼容回退。旧`dsh-web-search-deepseek`仅用于允许的临时故障回退。搜索配置与聊天配置分别检查。[S1][S2]
- **Python桥**：FastAPI + Pydantic；TS通过生成的JSON/OpenAPI客户端调用。保留科学计算和原有Python模块，不将其翻译为TS重写。
- **存储**：PostgreSQL/PostGIS/pgvector，一套业务库；原始文件使用BlobStore接口和本地持久卷。私有资料的过滤发生在召回前，缓存键含scope/ACL/版本。
- **检索**：RETQA已有表格/槽位处理 + `rank_bm25`/jieba + 向量召回；语料小先保持可解释的过滤、排序、合并。检索代码只有一个公共入口。
- **GIS**：GeoAgent元数据/工具组织代码 + PostGIS/Shapely/pyproj；不手写面积/投影算法；路网可达性必须有路网数据才能开启。
- **解析**：首先复用CRE解析服务已有实现；新格式在同一ParserPort注册插件。增加Docling等解析器前先检查现有支持、依赖许可和体积，禁止同一格式同时维护两个默认解析链。
- **文档与报告**：复用CRE工件渲染/导出，不让报告模块再次搜索或计算。
- **开发工具**：Codex或Grok Build执行实现任务，不与DSH并列成为业务生产控制器。[S9][S10]

本次不选LangChain作为新的顶层编排框架，原因是职责与DSH重复，不是“名字旧所以不能用”。RETQA等代码已有相关导入：迁移纯函数时剥离无关依赖；某个有效子模块确需第三方依赖时，可以隔离使用，不能为了去掉名称把同功能全部重写。

## 4. 代码迁移清单（不是论文介绍）

表中“已核”表示读取过代码/目录/官方说明，不表示已安装联调。`target`是本项目拟定入口，不是伪称上游已有的函数。

| 上游 | 直接迁入/包装对象 | target与运行时职责 | 必须改动 | 状态 |
|---|---|---|---|---|
| DeepSeek Harness | packages/web与packages/subagent包、会话/工具机制 | `runtime/dsh`；搜索、委派、工具执行、恢复 | 领域插件、权限与输出schema；不fork第二套核心 | 包文档、子Agent接口和MIT已核 |
| CRE | dashboard/src/components、dashboard/server/parser-service.ts、scripts/lib/schema-validator.js、workpaper-renderer.js及测试 | `apps/workspace`、`ingest`、`reports` | 收购stage→片区决策stage；去预设verdict；换单一DSH runtime | parser源码及README/EVAL-PLAN已核 |
| HIRE/ReCoQA | HIRE_Agent/DatabaseUtils.py；ICL notebook中确实有用的模板/调用单元 | `capabilities/structured_query`；结构化查询 | 删除明文凭据；只读DB角色、参数/AST与超时、结构化错误；无需再次实现通用Planner | DatabaseUtils.py源码已核 |
| RETQA | SLUTQA/utils.py的槽位转换、表格检索与提示模板 | `capabilities/table_retrieval`；企业表格和公开表格问答 | 移除Notebook/训练导入；企业标签映射修正；统一检索协议 | 一个槽位函数已局部迁移并自测；其余待实施 |
| GeoAgent | geoagent/core/decorators.py与registry.py的元数据/筛选；确需的工具函数 | `capabilities/spatial`、`runtime/tool_bridge` | 替换Strands工具注册边界，保留元数据和GIS能力；不启动其顶层Agent | decorators源码、registry入口已核 |
| STORM | knowledge_curation.py与storm_dataclass.py | `research/curation`；多视角问题与信息归并 | 接统一SearchPort、限制轮次；去百科写作流程；有用DSPy代码可保留隔离 | 精确模块/类定位已核，完整迁移测试待实施 |
| Search-o1 | scripts/prompts.py、run_search_o1.py内可抽取的检索触发/文档消化逻辑 | `research/gap_policy`；按缺口补查与消化 | 接DSH搜索；不复制本地推理服务；实际抽取符号须读完整依赖后写入manifest | 仓库入口已核，函数级迁移待实施 |
| CityBench | global_utils.py的load_map及citysim相关地图/路由适配代码 | `capabilities/citydata`；城市对象/路由工具 | 原函数牵涉Mongo/路由服务；已有数据库或路由库可直接满足时不为了挂名复制基础设施 | load_map入口及依赖已核；有数据/需求再启用 |
| PlanBench | QAGenSuite/数据转换工作流 | `ingest/planning_materials`；由企业材料产生候选问答/反例与知识卡 | 题库不是现行法规；不把教材直接混成授权生产语料；不可声称尚未核到的函数已迁移 | 目录级候选，函数级待核 |
| LLM-Geo | 按实际需要核查可复用任务图/空间执行辅助代码 | `research/spatial_tasks`；有限空间任务模板 | GPL不是禁止使用；实际分发方案须满足许可或另取授权；不默认进程隔离就免除义务 | 条件候选，不阻断主流程 |
| BacktestBench | AutoBacktest内可复用的查询/执行/校验辅助代码 | `capabilities/scenario_execution` | 本次根目录未见明确LICENSE，不等于确定不可用；先查子目录/许可/作者授权；不迁股票逻辑 | 许可与函数核验待完成，未冒称已授权 |

不要求每个仓库都必须贡献运行时代码。评测数据仍然可以做评测；真正防止重复造轮子的是复用实现，不是把目录全部挂到产品上。每次移植记录 `upstream_repo/ref/path/blob/license/target/patch_reason/tests`。已许可代码保留原著作权与许可，未确认许可项目暂不并入对外分发包；后补普通引用不能替代必要授权。

### 4.1 已交付的小型迁移样例

`ported/retqa_slots.py`直接以已读取的RETQA `restore_keywords_from_query`为基础，移除无关依赖，新增输入验证，并将上游enterprise字段误标为“城市”的映射修正为“企业”。保留原MIT版权和完整LICENSE。它证明局部迁移方式可执行，**不代表完整RETQA/HIRE/DSH已被集成**。

### 4.2 特别移除的演示逻辑

CRE的EVAL-PLAN明确区分fixture演示路径与live agent路径，并指出演示路径包含预设verdict。[S3] 应复用其界面、解析、工件结构与测试组织，不得把`expectedVerdict`注入生产上下文或当作“模型已经判断正确”。合成数据中的预期答案也只能由测试端读取。

## 5. 共用功能只实现一次

| 主项目入口 | 底层复用 | 所有调用者 | 输出 |
|---|---|---|---|
| `sources.fetch_parse` | DSH fetch + CRE ParserPort | 资料、研究、反证 | DocumentArtifact/字段定位 |
| `facts.normalize` | 原解析器字段+单位/时间/地理统一库 | 资料、案例、经验编译 | FactBundle/ConflictSet |
| `retrieval.query` | RETQA/BM25/向量检索，统一权限过滤 | 所有专业Agent | EvidenceMatches |
| `research.collect` | STORM curation + Search-o1局部策略 + DSH web | 专业研究、补证 | EvidenceBundle |
| `spatial.profile` | GeoAgent工具组织 + PostGIS等 | 建筑Agent、方案引擎 | SpatialMetricBundle |
| `context.compile` | 结构化模型输出 + schema/规则校验 | 企业上传、经验输入 | ContextPackPatch |
| `scenarios.evaluate` | 通用空间/容量/数值库 | 所有候选方案 | Feasibility/ResourceResult |
| `review.check` | 共用schema校验+来源核验+反证Agent | 工作流末端和增量重跑 | ReviewPacket |
| `reports.render` | CRE工件渲染 | 自动版/企业版 | DecisionPacket/Report |

上述名称是本项目设计接口。每个Agent不再各写一个Search、PDF parser或LLM客户端。跨语言边界只出现能力调用；同语言内部使用函数/类接口，不把每个函数微服务化。

## 6. 运行流程：各模块如何通信

```text
入口 → ScopeResolver → EvidenceNeedPlan
                   ↘ 企业材料/经验 → ContextCompiler
                                 ↓
                         ProjectSnapshot v1
                                 ↓
       ┌─────────────────────────┼──────────────────────────┐
       ↓                         ↓                          ↓
 建筑与实施前提Agent        需求与运营Agent             案例与企业适配Agent
       └─────────────────────────┼──────────────────────────┘
                                 ↓
                     Findings + Conflict + Gap
                                 ↓
                 高影响缺口定向补查（有限循环）
                                 ↓
                候选路径生成 → 统一参数化工具检查
                                 ↓
                  反证Agent：证据与可实施性挑战
                                 ↓
             比较器：先硬约束，再条件与偏好；允许并列/待核
                                 ↓
                 决策包：结论、条件、依据、下一步行动
                                 ↓
          企业context更新 → 依赖失效定位 → 受影响步骤重跑
```

### 6.1 每一步要求

| 节点 | 输入 | 执行要求 | 输出 | 下一节点 |
|---|---|---|---|---|
| ScopeResolver | 地名/Polygon/编号、role、模式 | 定位对象；先检测RegionPack覆盖；研究范围/地块/建筑区分 | ScopeSnapshot、缺失对象 | NeedPlanner |
| NeedPlanner | 用户岗位+项目阶段+当前资料 | 生成与决策相关的资料需求；不是全城信息抓取 | EvidenceNeedPlan | Research |
| Research | evidence needs、权限、as_of | 统一搜索/抓取/解析/检索；缓存去重 | EvidenceBundle | SnapshotAssembler |
| ContextCompiler | 内部文档/经验原话、用户权限 | 识别事实、组织约束、启发式、偏好、待验证线索 | ContextPackPatch | SnapshotAssembler |
| SnapshotAssembler | 上述工件 | 对齐对象/时间/单位；冲突不覆盖；固定版本 | ProjectSnapshot | Specialist Fan-out |
| 建筑/实施Agent | 有权限的相关快照 | 研究现状、改造限制、先行事项与未知；调用GIS | FindingsPacket | Gap/Scenario |
| 需求/运营Agent | 人群、供给、运营材料 | 提出需求解释与反向证据，不以POI数量代替需求 | FindingsPacket | Gap/Scenario |
| 案例/企业Agent | 可比案例、企业能力、规则 | 给出可比维度、差异、适用条件；无企业资料则不评价企业能力 | Case/CapabilityPacket | Scenario |
| GapPolicy | Findings、必需字段 | 按“可能改变路径”的重要性补查；达预算停止 | UpdatedSnapshot/Unknowns | Scenario |
| ScenarioBuilder | 同一快照、企业Context | 形成不同实施路径；保留暂缓/不建设基线 | ScenarioSet | Tools/Review |
| ToolEvaluator | 方案参数、数据口径 | 空间、容量、分期、资源检查；缺输入只缺相应指标 | Calculation/ConstraintResult | Review |
| Critic | 方案与引用、共同快照 | 检查支持是否足够、反例、假设冲突；不可改写作者事实 | ReviewPacket | Comparator |
| Comparator | 合规结果、Evidence/Reviews、用户目标 | 不做多数投票；筛出阻断，比较条件、资源与偏好；不强行唯一最优 | DecisionPacket | Workspace |
| ContextUpdate | 新经验/文档/边界变动 | 依赖图失效，不全链盲重算；旧报告标记旧版本 | ImpactSet + new revision | 相应节点 |

### 6.2 子Agent治理，不做群聊

同一时间只启动当前决策需要的专业角色；默认3个并行研究角色，单个候选进入反证审查，裁决由独立比较角色完成。数量与预算都是配置，不是创新指标。

DSH承担spawn、工具隔离、输出schema、取消与恢复。本项目只声明persona、allowed_tools、输入工件、输出schema和stop条件。深度默认1：业务子Agent不能无限生成孙Agent。评审者不允许向来源库写事实，报告者不允许再搜资料。

建议初始限制：最多2轮缺口补查、3个候选路径、1轮针对性修订；额度用尽时形成待核结论。快速模式先用已有快照产出初筛卡，再补充可见进度的深研结果。任何“秒级/显著提效”须由真实运行测量，不预填。

### 6.3 比较与评分

先使用可核查硬约束剔除不满足前提的方案；数据缺失标为unknown而非判定通过。再用定义清楚的准则比较功能适配、实施组织、企业能力、资源风险。每个维度同时返回结论、证据、反证、缺项和可改变结论的条件。

可以展示维度评分，但锚点、权重及用户来源必须明确；不把模型打出的85分当成功概率。允许并列和“信息不足以区分”。交换方案顺序重复判定检查位置偏差；同模型的多个Agent不等于独立专家共识；必要时以异构模型复核作为单独对照，不以多模型投票取代验证。

## 7. 接口和状态契约

### 7.1 核心对象

- `UserProfile`：role、岗位目标、展示偏好；与ACL独立。
- `ProjectSnapshot`：scope_ref、as_of、corpus_snapshot、fact/metric/case refs、context_version；不可变。
- `Fact`：value、unit、对象范围、时间范围、source/locator、data_class；支持unknown。
- `ExperienceRule`：kind、predicate、适用范围、条件/例外、来源、authority、版本。
- `Finding`：claim、support/opposition refs、unknowns、impacted_decisions。
- `Scenario`：动作组合、建筑/地块引用、假设、前置条件、分期、资源；不是一段描述文字。
- `Review`：问题类型、对应claim/assumption、严重性、证据、修正建议。
- `DecisionPacket`：各路径状态、比较矩阵、未解决分歧、下一步调查、版本。

### 7.2 子任务消息示例（接口设计，不是DSH原生配置）

```json
{
  "schema_version": "2.0",
  "task_id": "T-BUILDING-01",
  "run_id": "R-DEMO-01",
  "role": "building_feasibility",
  "question": "在现有资料范围内，哪些保留与改造路径值得进一步调查？",
  "snapshot_ref": "PS-01:v1",
  "context_ref": "CTX-01:v2",
  "allowed_tools": ["retrieval.query", "spatial.profile", "research.collect"],
  "scope": {"project_id": "SYN-001", "visibility": ["public", "project_internal"]},
  "output_schema": "FindingPacket.v2",
  "budget": {"max_tool_calls": 6, "max_gap_rounds": 1}
}
```

服务器按授权签发scope；LLM不能自增权限。适配层将上面的业务任务映射到DSH的实际SubagentStartRequest，不伪称该JSON可直接给DSH加载。

所有结果用`status = success | partial | empty | blocked | failed`，携带工件引用、warnings、missing_fields与版本。工具载荷按类型区分，禁止所有内容塞`Any`后交给下游猜。

### 7.3 业务API

```text
POST /api/projects
POST /api/projects/{id}/runs               # mode=automatic/enterprise
GET  /api/runs/{id}/events                 # SSE
POST /api/projects/{id}/documents
POST /api/projects/{id}/context-proposals
POST /api/projects/{id}/context-updates    # 项目内授权修改
GET  /api/runs/{id}/decision-packet
GET  /api/projects/{id}/revision-diff
POST /api/projects/{id}/followups          # 研究请求，不自动发函/报批
```

### 7.4 数据所有权与增量更新

DSH session记执行过程；PostgreSQL中Project/Context/Decision版本记业务事实；同一事实只由其服务更新，子Agent写入候选结果不覆盖来源。通过run_id/session_id关联两者。应用层可以记录业务阶段，但不再复制DSH内部的运行队列。

| 改动 | 必须失效 | 默认复用 |
|---|---|---|
| 改区域范围 | 地理查询、材料适用范围、案例、全部下游结论 | 未变化原始文档blob |
| 新建筑检测/腾退资料 | 建筑发现、相关前置条件、方案、审查/比较 | 无关人口/市场材料 |
| 新企业“本项目不整体拆除”约束 | 企业适配、候选动作、反证、决策/报告 | 已有空间与公开材料 |
| 调整岗位展示详略 | 输出读模型 | 分析/计算全部复用 |
| 新外部文件取代旧文件 | 依赖该来源的结论与规则 | 其他来源 |

## 8. 企业Context编译与自动化

原话示例（虚构）：

> “我们做过厂房更新，本项目先别整体拆掉；有一栋还在出租；最好能分期，但结构到底能不能改我也不确定。”

编译结果不能是一段通用摘要，而是：

| 内容 | 类型 | 处理 |
|---|---|---|
| 做过厂房更新 | 经验线索/能力证据候选 | 寻找对应内部项目材料，不自动推出所有改造均擅长 |
| 本项目不整体拆 | 项目组织约束 | 作用域project；确认发言人具备本项目配置权限 |
| 一栋仍出租 | 事实候选 | 关联具体建筑与租期；找材料，不猜是哪栋 |
| 最好分期 | 偏好 | 影响排序和方案设计，不变成法规 |
| 结构能否改不确定 | unknown/尽调项 | 不让模型按经验填可行 |

流水线：上传/输入→格式识别→解析→对象与单位对齐→语义分类→作用域/来源验证→项目Context版本→触发局部重评。

正常可校验字段自动入库；低风险缺项自动补查；重要未解冲突形成一个合并的例外卡片。**自动化并不要求把每个未知都变成数字。**系统可以不停机地输出部分有用结果。

内部材料只发往企业允许的模型端点；没有获批端点时不将内部正文偷偷送给公共API，可先本地解析/入库并限制增强分析。项目配置发布与最终投资决定是不同权限动作。禁止将上传文本中的“请忽略规则”当系统指令。

## 9. 数据准备：可以合成，但必须知道测什么

### 9.1 三种材料并存

| 类型 | 作用 | 禁止混淆 |
|---|---|---|
| 真实公开快照 | 验证来源获取、解析、真实局部结论 | 不冒充企业内部资料 |
| 显式合成数据 | 验证格式、工作流、规则触发、极端情况 | 不当真实官方文件、真实成交或实际企业结论 |
| 公开数据扰动/半合成 | 用真实结构和合理关系覆盖难点 | 逐字段记录哪些来自原始数据、哪些为生成 |

首先定义schema，再写生成器；例如建筑面积/空置面积关系、分期月份、用途枚举由规则生成，文本用于模拟格式差异。模型可润色叙事，但已知数值和gold由独立逻辑固定。允许生成没有唯一最优路径的任务，gold是必须识别的约束/矛盾/不可做出的结论，而不必指定唯一方案。

### 9.2 本交付包的夹具

10份显式合成JSON：自动版、企业增强、缺字段、冲突资料、文档提示注入，以及各自的候选顺序反转版本。虚构企业、虚构项目；几何仅用于输入契约，不对应真实宗地。`expected.json`独立存放，不给业务Agent读取。

本地已执行16项检查：槽位函数迁移行为、enterprise映射修正、长度/标签异常；JSON结构、来源引用、合成标签、几何闭合、面积比例、作用域、候选顺序配对与gold分离。**未执行模型研判、真实搜索、权限服务或端到端Agent安全测试。**攻击样例的存在不等于系统已经防住攻击。

### 9.3 必须补齐的系统自测

- 契约：同schema不同格式输入保持语义；原始值、单位转换和来源一致。
- 规则：加“本项目不整体拆除”后对应路径变更，未受影响证据复用；同规则不污染其他项目。
- 语义：经验/偏好不会被升级为外部硬约束；缺结构检测不能输出确定安全结论。
- 检索：租期、建筑编号、指标口径等关系型事实不被错误拼接。
- 裁决：候选顺序变化不改变硬约束结果；弱证据不因多数Agent重复而变强。
- 恢复：工具重复完成不重复发布；父任务恢复后能读取子工件版本。
- 安全：私有材料不被公共搜索、外部日志或跨项目缓存泄漏。
- 效用：有企业样本后才测真实采纳、专家纠错、调查遗漏和总用户耗时。

对照建议：单Agent同工具预算 vs 专业并行；无经验包 vs 经验包；无反证 vs 反证；全链重跑 vs 依赖重跑。限制相同数据、工具、token/时间预算，不能让复杂组获得更多资料后宣称“编排本身胜出”。

### 9.4 向导师索要的最小资料包

优先获取脱敏后的：一次项目进入/未进入下一阶段的原始判断材料；当时可见的建筑/用地/使用资料；内部明确约束与协作方式；专家修改痕迹与理由；最终选择及后续结果（与当时输入分开）。少量能串起“材料→判断→修改→决定”的完整案例，优于大量没有时间和对象关系的PDF。数据拿不到时继续做工程验收，但不写“已验证企业投资决策提升”。

## 10. AI-native执行计划：任务DAG，不按人月排期

一次总任务可以连续执行多个可验收节点。上下文不靠某个聊天窗口永久完整，而靠`AGENTS.md`、contract、任务状态、git与工件恢复。暂停/压缩上下文不等于项目失忆；拒绝把“工具未开通/测试被跳过”记成完成。

```text
T00 读取任务与上游
  → T01 锁定许可/模块与上游测试
  → T02 Contracts + 数据模型
       ├→ T03 CRE壳与DSH宿主
       ├→ T04 研究/表格/GIS代码迁移
       ├→ T05 Context编译与资料管道
       └→ T06 合成夹具与测试边界
  → T07 三角色研究 + 候选 + 反证 + 比较
  → T08 两版界面与增量更新
  → T09 离线端到端/故障恢复/隔离
  → T10 真实来源与API smoke
  → T11 交付打包/复现/申报口径校对
```

| 任务 | 交付物 | 验收条件 |
|---|---|---|
| T00 | mission、已知/未知、文件索引 | 不把旧价格MVP当本轮需求 |
| T01 | upstream.lock、NOTICE、迁移清单、baseline log | 精确文件/许可/实际调用链；无可用代码不伪称已复用 |
| T02 | JSON Schema、TS/Pydantic生成类型、迁移 | 一个schema源；跨语言样例往返一致 |
| T03 | CRE UI基线、DSH provider/plugin bridge | 单一运行时；不运行内置Codex和DSH两套顶层控制 |
| T04 | vendored/ported + patch + tests | 共享工具调用实际迁入代码；无复制旧密钥/危险默认值 |
| T05 | ParserPort、Context Compiler、作用域规则 | 原话/文档转结构；权限/生效范围明确 |
| T06 | generator、独立gold、测试规范 | fake来源标签明确，不向Agent注入答案 |
| T07 | roles、workflow、judge rubric | 工件可串联，能够输出条件化结论与反证 |
| T08 | 自动与企业模式、revision diff | 关键经验改变相应路径；不把全部变化退化成调售价 |
| T09 | 集成/恢复/权限/故障日志 | 步骤失败被定位；安全控制不以降级绕过 |
| T10 | live smoke log、真实材料小案例 | 无API密钥标记blocked/skipped，不能伪造成功截图 |
| T11 | lockfile、启动命令、Demo、研究报告、申报稿 | 清晰区分已完成、待验证、产品设计 |

子编码Agent只领取有定义的节点：输入refs、可写目录、禁止修改目录、必须测试、返回artifact refs。合并由主编码Agent完成。避免多个Agent同时重写schema或改同一注册表。任务细表见`agent/tasks.json`。

## 11. 仓库与复用边界

```text
apps/workspace/              # CRE UI选择性迁移
apps/host/                   # TypeScript应用宿主与权限/业务命令
runtime/dsh/                 # DSH集成，不复制一套通用loop
runtime/roles/               # specialist、critic、comparator定义
runtime/workflows/           # 本项目有限工作流
services/capabilities/       # FastAPI桥接Python
packages/contracts/         # canonical schema唯一源
packages/context/           # 经验/内部材料编译
packages/decision/          # 本项目路径/约束/影响图
vendor/                     # 获得许可的原文件、补丁、上游标识
fixtures/inputs/             # 合成输入；不含gold
fixtures/expected/           # 仅测试端可读
research/                   # benchmark与未进入产品的参考材料
agent/                      # AGENTS、任务DAG、状态与交接
```

禁止`decision`直接import上游私有类；由capability adapter转换。禁止UI持有模型API key。禁止将benchmark预期答案、运行日志中的内部材料发送给全部Agent。使用库解决通用功能；自有代码只承接岗位目标、Context语义、决策图、比较规则和接口胶合。

## 12. 申报书怎样突出技术难点

不要写“用了LangChain/多个Agent，所以先进”。可写：

1. **从资料相关到行动可用**：将地理/建筑/运营证据按同一项目对象和时点组织，直接约束候选实施路径。
2. **非结构化经验的可执行编译**：把口头经验和内部材料转成有条件、有作用域、可撤销的判断依据，而非把整份文档塞进prompt。
3. **候选路径与反证共同生成**：研究角色提出解释，验证角色追查薄弱前提，比较器在同证据口径下呈现分歧，避免报告“单向自证”。
4. **数据不足仍能完成有边界的研判**：输出条件化路径与最高价值的下一项调查，降低用户操作门槛而不伪造完整数据。
5. **经验变动的局部重评**：重跑受影响的判断与方案，保留未变化工件，支持追问“为什么改了”。

申报书可以说明拟采用快速多模态模型，降低材料整理和初步问题识别等待；具体模型名、endpoint、依赖版本留在工程报告。没有项目实测前不写“秒级完整研判”“替代专家”“准确率提高X%”。

## 13. 当前交付与未完成事项

已完成：新方案与申报稿；真实源文件定点核验；RETQA槽位函数局部迁移、许可证保留、7项行为测试；10份合成夹具生成和9项完整性检查。

未完成：DSH/CRE/其他仓库整合安装，模型与搜索API调用，真实企业资料接入，Agent对抗评审/权限防护/空间计算/端到端性能测试。上面的执行任务负责实现这些事项；这份包不是伪装成成品的软件仓库。

## 14. 核验来源索引

[S0] 用户提供：《海之子杯申报书框架_片区价值研判Agent.docx》，2026-09-27本轮上传。原稿中的工期、人力、赛程和评审分数未作为已核实外部事实。

[S1] DeepSeek Harness：`https://github.com/deepseek-ai/deepseek-harness`；核验ref `477b4f420553e8a52c2fbccc464d7561b239c443`。重点：`LICENSE`、`docs/subsystems/subagent.md`、`packages/web/web-search-deepseek/README.md`。搜索实现使用结构化原生返回块，每次消耗模型调用；其文件默认旧model名称不能覆盖最新官方API文档。

[S2] DeepSeek官方模型与价格目录（2026-10-17核对）：`https://api-docs.deepseek.com/zh-cn/quick_start/pricing/`；搜索与抓取：`https://api-docs.deepseek.com/zh-cn/guides/search/`。当前Flash目录版本为DeepSeek-V4.1-Flash-1017，推荐调用名`deepseek-flash`。目录标识、每次响应model和实际项目效果分别记录。

[S3] CRE：`https://github.com/ahacker-1/cre-acquisition-orchestrator`；索引ref `a1cdd7f680a4dcf2f5e70a8380d6eb5eaccda878`；核读parser blob `7b5d00b9f4a47c380aa1557e125cebddd2a7435c`，README、EVAL-PLAN。工作区/UI与演示逻辑复用必须区分。

[S4] HIRE：`https://github.com/Husky-989/ReCoQA`；`HIRE_Agent/DatabaseUtils.py` blob `e66526255e42d0cce4fbe3c5009d2e1375db6570`。

[S5] RETQA：`https://github.com/jensenw1/RETQA`；`SLUTQA/utils.py` blob `96dcfee379282dda59a67b2523f447b3765637f0`；MIT LICENSE blob `8169936349fbf9d29ac7eb21a8ac7a60e680d19c`。本包只含一个选择性迁移函数，保留原版权。

[S6] GeoAgent：`https://github.com/opengeos/GeoAgent`，ref `b08ba5366bfc729506af34bf8d543e7b3cd706d7`；decorators.py源码使用Strands，部分旧docs仍写LangChain，以实际文件为准。

[S7] STORM：`https://github.com/stanford-oval/storm`；ref `fb951af7744dab086e34962e9bc6fe878e145f83`；精确定位knowledge_curation.py/StormKnowledgeCurationModule和storm_dataclass.py/StormInformationTable。

[S8] Search-o1：`https://github.com/RUC-NLPIR/Search-o1`；CityBench：`https://github.com/tsinghua-fib-lab/CityBench`（global_utils.py入口核验ref `37f3b0bc63fcfb259ee366cb43f098f3da5f6ad1`）；PlanBench：`https://github.com/tsinghua-fib-lab/PlanBench`；BacktestBench：`https://github.com/jensenw1/BacktestBench`。后三者不是未经核验就能替代当地真实工程资料。

[S9] Grok Build官方开源说明（2026-07-15）：`https://x.ai/news/grok-build-open-source`。用户所称Group Build可能指该项目，未将此对应当成确定事实。

[S10] OpenAI官方Codex subagents与Ultra说明：`https://developers.openai.com/codex/agent-configuration/subagents`；`https://developers.openai.com/codex/models`。Ultra是产品模式，不是已核实的独立开源模型。

用户提到“千问内置APP的模型”尚不能唯一识别。Qwen相关页面可作为进一步核查入口，但本次不据此承诺某个未确认型号或App能力可以通过API直接调用。
