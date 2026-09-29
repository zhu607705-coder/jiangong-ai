# 建工 AI 技术文档：系统架构、核心算法与接口

从用户提供的《海之子杯_AI原生执行包_v2.zip》实际构建，当前源码包含本地地图工作台、项目研判与公开资料检索。原 ZIP 保持不变；本文件描述**已实现的接口和约束**，运行状态以 `agent/state.json`、`agent/intelligence-state.json` 及相应测试记录为准。真实企业成效和训练效果尚无样本可验收。

## 当前系统架构（2026-09-29）

```mermaid
flowchart LR
    UI[React 工作台\n高德地图 / 选中浮卡 / 资料检索] -->|同源会话 HTTP / SSE| HOST[Express 本地主机\n鉴权、项目、地图、资料任务]
    HOST --> DB[(PGlite / 可配置 PostgreSQL\n项目、版本、来源、分析、回执)]
    HOST -->|受限任务与结构化输出| DSH[DeepSeek Harness\nLiveSession / 子会话]
    DSH --> DS[DeepSeek 模型与原生搜索]
    DSH -->|受限预筛 / 关系判断| QWEN[Qwen decision-model-preview]
    HOST -->|X-Capability-Token| PY[FastAPI 专业能力\n解析、空间、检索、结构化查询]
    HOST -->|高德服务代理| AMAP[高德 JS API / POI / 地图数据]
    HOST -->|手动采集或显式任务| PUBLIC[公开来源\n官方站点等]
```

`apps/workspace/src` 负责地图与检索交互，不保存模型密钥；`apps/host/server.ts` 是本机统一入口和数据库所有者。`packages/contracts/schema.json` 是项目输入的唯一业务契约源，生成 TypeScript/Pydantic 类型；`packages/intelligence` 负责公开资料版本、检索、模型流水线、事件归并和人工复核；`runtime/intelligence/judge.ts` 在已有 DSH 会话内执行模型阶段；`services/capabilities/app.py` 提供受令牌保护的解析、检索和空间计算。高德安全密钥与模型密钥只在本机配置，不进入浏览器或 Git。

部署契约是**单操作员本地工作台**：仅接受配置的 loopback Host/Origin；`GET /api/session` 发放 `HttpOnly`、`SameSite=strict` 会话 cookie；后续 `/api` 与高德代理请求验证 cookie，写请求还验证 `X-Requested-With: haizhizi`。这不是已验收的多租户身份系统。项目、来源和上下文在数据库中按版本保存；公开正文与合成样例分别标注，未核实的地块、面积和收益不由模型补全。

### 核心算法与边界

| 模块 | 当前做法 | 结果约束 |
|---|---|---|
| 地图选区与坐标 | 点选先给浮卡；拖框至少 8 像素，单次范围经纬宽高各不超过 0.06 度。高德显示坐标为 GCJ-02，选区交由 Python 空间能力转换/校验为 WGS84 Polygon。 | 用户框选是调查范围，不冒充法定宗地边界；合成位置不叠加真实片区。 |
| 地图初筛与标色 | 从 POI、建筑/道路/水系、已有项目来源构成快照；按实施条件、空间适配、使用需求、供给、运营组织、资源安排六维和主题规则出可解释颜色。显式点击后才运行进一步分析。 | 颜色是初筛线索，不是收益预测或批准；来源不足时显示未知与资料缺口。 |
| 公开资料采集 | `rss`、`web_list`、`json_list`、`native_search`、`external` 通道均做域名白名单、URL/长度校验；默认关闭定时采集与自动模型分析。来源 URL、内容哈希、观测时间和版本分别保存。 | 重复观测不制造新版本；站点结构变化显示失败/部分成功，不能记为零条成功。 |
| 检索与时点 | `Intl.Segmenter` 中文分词加长词二元字，标题权重 A、正文权重 D 写入 PostgreSQL `tsvector`；SQL 用 `ts_rank_cd` 召回，再按词面匹配、日期和稳定 ID 排序。`as_of` 按历史观测版本查询。项目研究入口另复用 Python 既有 BM25 检索。 | 网页资料搜索是词法检索，不声称向量语义搜索；返回 `truncated`，避免把有限候选误当全量。 |
| 模型判断 | 有正文才进入预筛 `PASS/BLOCK/UNKNOWN`；Qwen 路由可承担预筛及关系判断，DeepSeek DSH 子会话做结构化提取和两次独立 0–100 阅读价值评分。阈值默认 65，即两分和至少 130；分歧大于 20 或预筛 `UNKNOWN` 转人工复核。 | 分数代表“值得继续阅读”，不是投资回报率；阈值未通过人工标注集校准，不以此自动批准项目。 |
| 原文绑定与事件 | 模型结构化 JSON 先通过 DSH 可表达 schema，再由本地完整 JSON Schema 和原文核对。`locator_quote` 必须逐字出现在标题或正文；项目编号、城市须在该引文内。候选事件先做词面有界召回，再核对象编号、发生日期、动作和关系判断；招标与中标是后续阶段。 | 虚构引文/身份进入 `needs_review` 且不评分；同主题不能自动当同一次事件。 |
| 调用回执 | 回执键由阶段、对象版本、输入和模型规范化哈希组成，状态为 `started/completed/ambiguous`。每日本地调用上限可配置。 | 已完成阶段可复用；中断或结果不确定的付费调用不自动重试。 |
| 人工评价与语料 | 人工 review 绑定文档内容版本、来源家族、reviewer、用途和时点；检索/选择/聚类评价与导出分开，`development/holdout/train` 的同源家族不得交叉。 | `local_sft` 需要显式许可与训练 split；目前无经批准训练样本，未开始权重训练。 |

### HTTP 接口说明

下表为 `apps/host/server.ts`、`apps/host/map-screening.ts` 和 `apps/host/intelligence.ts` 的现行路由。响应均为 JSON，标记“流”的路由按 SSE 或 NDJSON 返回；写接口须携带上述会话及请求标识。参数表列出关键字段，完整字段以路由的 Zod 校验和 `packages/contracts/schema.json` 为准。

| 方法与路径 | 主要输入 | 主要输出/行为 |
|---|---|---|
| `GET /health`；`GET /api/session`；`GET /api/ready` | 无 | 宿主活性；本地会话与配置；数据库、Python 能力是否就绪。`configured` 不代表实时调用已成功。 |
| `GET /api/projects`；`POST /api/projects`；`GET /api/projects/:id` | `input` 或限定 fixture、`name`；项目 ID | 项目列表、新建项目（201）、项目及运行列表。 |
| `POST /api/projects/:id/runs`；`GET /api/runs/:id` | `mode`、`execution_mode`、`idempotency_key`；运行 ID | 冻结输入并异步运行（202）；查询状态。重复幂等键不重复发布。 |
| `GET /api/runs/:id/events`（SSE）；`GET /api/runs/:id/trace` | 运行 ID、事件游标 | 进度重放、模型调用追踪。 |
| `POST /api/runs/:id/cancel`；`POST /api/runs/:id/resume` | 运行 ID | 请求取消或按保存的会话/阶段恢复。 |
| `GET /api/runs/:id/decision-packet`；`GET /api/runs/:id/report` | 已完成运行 ID | 结构化决策包或 Markdown 报告；未完成时返回冲突。 |
| `POST /api/projects/:id/context-proposals`；`/context-updates`；`/context-revoke` | 提议、版本及变更 | 编译、版本锁更新或撤销组织上下文。 |
| `POST /api/projects/:id/documents`；`GET /api/projects/:id/documents`；`POST/GET /api/projects/:id/followups` | 文件或调查项 | 解析入库、文档列表、后续核查任务。 |
| `GET /api/maps/data`；`GET /api/maps/screening/profiles` | 无 | 数据目录、初筛画像及主题配置。 |
| `POST /api/maps/geometry/wgs84` | `{geometry}` | 拓扑校验并返回 WGS84 Geometry。 |
| `POST /api/maps/screening/context` | `{target}` | 有来源的选区快照 `context_id`；需要高德配置。 |
| `POST /api/maps/screening/analysis`；`GET /api/maps/screening/analysis/:id` | `context_id`、`profile`；分析 ID | 按快照研判（可 NDJSON 流式）或读取已保存分析。 |
| `POST /api/maps/screening/scan`（NDJSON） | `bounds`、`profile`、`theme`、可选 `geometry` | 有界逐区扫描和标色进度；单次仅允许一个活动扫描。 |
| `GET /api/intelligence/status`；`GET /api/intelligence/search` | 查询 `q/city/category/as_of/limit/offset` | 通道、任务、预算状态；按事件分组的来源摘要、数量与截断状态。 |
| `POST /api/intelligence/channels`；`POST /api/intelligence/channels/:id/collect` | 通道配置；`{model:boolean}` | 保存默认禁用的通道；显式排队采集任务（202）。 |
| `POST /api/intelligence/sync`；`POST /api/intelligence/intake` | 游标；公开 `source` 和可选通道 ID | 将既有公开项目来源同步入库；录入来源及内容版本。 |
| `GET /api/intelligence/items/:id`；`POST /api/intelligence/items/:id/analyze` | 可选 `version`；分析需 64 位版本哈希 | 版本、引文、来源、分析；显式排队模型分析（202）。 |
| `POST /api/intelligence/jobs/:id/cancel`；`GET /api/intelligence/projects` | 任务 ID | 请求取消；可关联的非合成项目及当前输入哈希。 |
| `POST /api/intelligence/items/:id/attach` | `version`、`project_id`、`expected_input_hash` | 乐观锁将真实公开来源加入项目，不自动生成 Fact/Rule。 |
| `POST /api/intelligence/events/link`；`POST /api/intelligence/reviews` | 两个文档版本与关系；人工标签、家族、split、用途 | 人工关系绑定；保存与具体内容版本关联的人工复核。 |
| `GET /api/intelligence/evaluation`；`POST /api/intelligence/dataset/export` | `split`；`purpose=local_eval/local_sft` | 评价指标或受权限/家族切分约束的数据集导出。 |

Python 内部服务由宿主调用，`POST /parsers/parse` 接收受控文件路径/文档 ID；`POST /capabilities/{name}` 支持 `analyze`、`spatial.profile`、`retrieval.query`、`structured.query`、`research.gaps`；`POST /spatial/validate-geometry`、`/spatial/selected-geometry`、`/spatial/regions` 处理空间几何。除 `/health` 外均须 `X-Capability-Token`；浏览器不直接调用这些内部接口。

示例：本地网页先 `GET /api/intelligence/search?q=浙江大学&limit=20`，从 `items[].representative` 读取标题/来源/时间；点击条目再 `GET /api/intelligence/items/:id?version=...`，只有用户明确请求分析才 `POST /api/intelligence/items/:id/analyze`。分析异步返回任务 ID，任务状态由 `/api/intelligence/status` 查看；`needs_review` 是条目的 `analysis.status`。地图交互同样先选中显示线索，再显式触发研判。

### 构建、测试与实际数据范围

从仓库根目录运行 `bash scripts/start.sh` 启动本机工作台，`npm run verify` 检查契约生成、JavaScript/Python、HTTP 回归和生产构建。模型、高德和抓取配置来自本地忽略的 `.env` 与 `data/local`，不要写入仓库。DSH 依赖在本次升级为官方 [`0.2.0-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1)；本地完整 schema 约束保留在 DSH 可表达子集之外验证。

2026-09-29 的实际资料联调从中国政府采购网手动采集 8 份浙江大学相关公开原文入本机 PGlite，网页搜索、详情和原始链接已在真实浏览器读回；这些本机数据不随 Git 提交。DSH 升级合并后，对其中一份公告显式运行完整本机流水线：Qwen 预筛 `PASS`、DeepSeek 归类为招采、两次阅读优先级为 78/82，任务完成且网页详情显示“招采 · 已分类”；引文未支持的城市保留为空。它们包括已过投标截止日期的历史公告，因此页面展示应明确阶段与有效期，不能解读为仍在报名的商机。完整证据见 `research/test_results/dsh-rc1-intelligence.json`；公开资料样本不是企业项目效果验证。

## v0.2 基线实现与验收记录

以下保留早期实现节点的验证口径；当前资料检索、DSH 版本和接口以文首的现行说明及状态文件为准。

### 实际调用链

React 工作台 → TypeScript 宿主（项目、权限、版本、SSE）→ DeepSeek Harness（真实模型、受限专业任务、候选、反证、比较）→ 统一 Python 能力与公开研究入口 → PostgreSQL 业务记录和 DSH 执行记录 → 可追溯决策包。

真实模式挂载官方 DeepSeek provider，使用实际原生搜索响应和匿名原文获取；记录 requested/returned model、调用时长、token 和 session_id。格式错误可有界重试，但不替换成 fixture 响应。离线适配器是明确标注的独立工程测试模式。

三个专业角色分别研究建筑/实施、需求/运营、案例/企业适配。它们没有 shell、任意文件读取、自由外发或继续委派工具。候选、反证和比较使用相互隔离的 DSH 子会话；相同模型的角色分工不等于独立专家共识，也不采用投票。

### 验证过的业务行为

- 真实初筛与真实企业增强可以生成结构化发现、动作、反证、比较矩阵和调查清单。
- “不整体拆除”是经项目配置人提出的组织约束；“最好分期”是偏好。不能因前者不是法规而降成不生效线索，也不能把后者升成外部强制规定。
- 局部拆改不会被误判成整体拆除。模型不能用路径名称掩盖 `whole_demolition` 动作。
- 引用必须闭合于获准快照。已存在 Fact/Rule 的引用可以解析到其来源；捏造引用被拒绝。比较器只能引用实际生成的候选，不能从更大的候选池另添路径。
- 缺结构、权属、建筑面积或需求时保留未知。模型填写的数值不能覆盖工具计算的指标；不同建筑记录不跨对象拼接。
- 组织条件更新按输入依赖局部重评；旧快照、旧报告和已完成工件保留。JSONB 键重排不改变规范化内容哈希。
- 重复请求不重复发布；SSE 支持游标重放；Context 更新有乐观版本锁；失败后可从原快照恢复 DSH 父会话并读取已完成阶段工件。

### 数据、权限与来源

应用的唯一业务契约源为 `packages/contracts/schema.json`，生成 TypeScript/Pydantic。原包 `contracts/task-envelope.schema.json` 是保留的设计示意，不是 DSH 原生配置，未形成第二套消息调度系统。

来源和事实保留 data_class、visibility、引用、对象/时间/单位及 unknown。检索在权限过滤之后执行。模型只取得该项目和该角色需要的快照；真实内部正文默认不出本机，需明确配置获准端点才能启用内部模型分析。项目原话配置与正式工程/投资批准分开。

TXT/MD/CSV 走 CRE 通用解析；PDF/Excel 使用 CRE 选择性移植的提取与表格定位，DOCX 通过同一 ParserPort 注册 python-docx。扫描 PDF 明确返回 `ocr_required`。表格行作为来源绑定记录保存，不直接编造成已核实项目总量。

公开研究使用两轮有界查询、政府域名来源和 DSH 安全 HTTP 获取；原文被截断、被拒绝或缺失会保留状态。RegionPack 不声明全国一致覆盖；同名地名不自动选择，不将地点坐标当宗地边界。当前地名服务为非商业研究配置，署名 GeoNames / Open-Meteo。

### 复用事实

| 上游 | 实际迁移/调用 | 范围 |
|---|---|---|
| CRE / Apache-2.0 | 工作台结构、通用 CSV/文本、PDF 页文本、Excel 行定位、报告表格 | 选择性复用；未启用收购控制器和固定结论 |
| DeepSeek Harness / MIT | AgentLoop、Subagent、结构化输出、JSONL、恢复、模型/搜索/HTTP/代理入口 | 唯一业务 AI 运行时 |
| HIRE / MIT | cursor → columns/rows 接口；参数化、只读、作用域及执行预算 | 冻结快照中的结构化查询 |
| RETQA / MIT | 槽位函数与企业标签修正 | 已提供城市字段/显式槽位的转换；不冒称完整 RETQA |
| GeoAgent / MIT | 元数据类和访问函数 | GIS 工具元信息；计算由 Shapely/pyproj 完成 |
| STORM / MIT | URL/片段归并 | 权限过滤后的检索归并，不把重复来源当多份证据 |
| Search-o1 / MIT | 标记提取与有界文档摘要模板 | 接统一研究与检索入口，未复制其本地推理服务 |

精确 ref/blob/target/hash/修改/测试在 `research/upstream.lock.json`。CityBench、PlanBench、LLM-Geo、BacktestBench 是有数据或需求后才采用的条件候选，本次没有为挂名而复制。

### 实测与恢复

实测覆盖契约、源函数、字段缺失/冲突、候选顺序、约束语义、权限过滤、SQL 只读/预算、文档格式、幂等、SSE、重启恢复及浏览器流程。真实模型测试还覆盖冻结结果交接、字段引用闭合、候选范围限制、原生 API 错误与从失败节点恢复。

真实杭州案例保留 5 条检索来源：4 篇正文、1 条元数据。未提供真实建筑清单，所以总面积、空置面积和比例仍未知。实际原文和返回模型都可从日志、快照和引用核查，不能解读成完成真实项目勘察或企业效果评测。

提示注入实测使用独立合成内部标记。该标记未进入 DSH 模型输入；逐子会话核查只授予对应分析工具及 `structured_output`。这是一个实际攻击样例和结构性权限边界的证据，不是对所有提示注入的无限保证。

默认存储是已经实测的 PGlite 嵌入式 PostgreSQL。外部 PostgreSQL/PostGIS/pgvector、生产多租户身份系统、企业私有端点与真实企业样本需在相应部署条件下另行验收；本次没有偷偷替换成“已通过”。

### 语料准备

`packages/corpus/schema.ts` 定义采集、人工标注和用途凭证的本地结构；业务 `Source` 继续校验主 Canonical Schema。`scripts/corpus.ts` 可以重建语料、从已完成本机运行归集公开来源、导入显式来源包、查询原文、导出经核对样本。HTML 解析和 BM25 检索复用已有公共实现，没有新增搜索服务或训练调度器。

正文按稳定来源哈希保存，分块保留 Unicode 字符位置；同 URL、同项目家族、规范化重复和字符近重复在划分前归组。原模型会话与回归 gold 不进入语料正文，既有开发来源不伪装成最终测试集。监督样本必须具有当前内容版本对应的人工标签、原文引用及本地训练用途凭证；错误时使当前导出指针失效，旧版本保留。生成文件、标注与用途记录都留在 `data/local/corpus`。

第一批来源目录、待标注入口和质检见 `data/local/corpus/语料台账.md`；操作和后续案例收集重点见 `data/corpus/README.md`。新增测试针对源内容篡改、同源泄漏、旧标签、缺少用途记录、引用伪造、凭据和回归数据隔离，不把结构校验误称为标签正确性或行业模型效果。

### 地图入口与地点选择

主界面以高德 JS API 2.0 地图为中心。官方 loader 管理 SDK 加载，原生图层显示道路、楼块、景观与地点标注；本应用只叠加自己的卫星图层，不用 `setLayers()` 重建高德内部图层。地图选中只打开简要浮卡，明确点击后才取 POI 完整详情或逆地理编码；项目研究面板继续复用原有研判功能，关闭面板保持地图视角。

Canonical Schema 增加可选 `Scope.map_anchor`，明确记录高德 GCJ-02 点位；`Scope.geometry` 仍是 WGS84，显示时通过高德官方 `convertFrom` 转换，不手写坐标偏移或把点位扩成研究边界。合成项目的虚构坐标不会叠加到现实城市。

地图设置和 `/_AMapService` 共享本地会话、Host/Origin 与写入保护。服务端固定上游高德域名、限定服务路径、覆盖客户端 key/jscode，并限制超时和响应长度。JSAPI 请求保留 `s=rsv3`、`platform=JS` 等原生参数；经校验的 JSONP 回调显式使用 JavaScript MIME，保持 `nosniff`。安全密钥不返回浏览器，原生 JS Key 按官方 SDK 方式使用。

Windows 挂载盘上的 Vite 开启有界文件轮询，避免 Windows 编辑后 WSL 未收到通知而继续服务旧代码。相关实测单独记录在 `research/test_results/map.json`，不把 Linux 软件显卡的 2D 降级记作 3D 成功。

### 申报口径

可写：“已形成可运行工作台，接通真实模型、原生检索、受限专业任务、候选/反证/比较、企业经验版本化与局部重评，并完成相应工程和样例测试。”

不能写：“已完成全国数据覆盖”“已验证企业投资效果提升”“能够自动签发结构安全或投资批准”“多个同模型角色形成独立专家共识”。正式业务验证仍需获准企业案例和专家复核，后续结果不能倒灌到当时输入。

### 2026-09-28 地图初筛与真实项目证据

首次选中现在直接汇集四类高德记录，并按坐标/城市关联当前项目与已完成研究的公开来源；城市背景不转成地块事实，合成项目不参与真实片区统计。用户显式触发初判后，复用 DSH LiveSession 对同一快照形成引用可查的分析。内部事实、原文、规则与项目名不会进入公共快照转交路径。

新增五个单指标标色专题、固定图例、九格进度和取消、范围变更提示及数据目录。接口、来源精度、缓存、完整性阈值、交互参考和实测时间见 `docs/地图初筛与数据关联.md`。当前校验入口是 `research/test_results/screening.json`，旧版地图记录只代表其对应版本。

GitHub 新建为私有 `zhu607705-coder/jiangong-ai`；项目数据库、内部材料、密钥、DSH 会话与原始浏览器日志留在本机。源码保留用于复现的公开快照和显式合成回归工件。HTTP 回归使用当前 Node 进程路径，干净克隆不要求包含本机 `.tools` 目录。
