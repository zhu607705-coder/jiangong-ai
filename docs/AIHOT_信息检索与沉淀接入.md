# AIHOT 建工适配：信息检索与沉淀

## 本次实现与验证范围

目标基线 `e7219a96d2f88ce3b1f7af5c767e7d5e9d105684`；AIHOT 上游 `589f79eff09470b31ba8a7f1d9eb62d36ff2be6c`。

这不是另部署一套新闻站。当前高德地图、Express 宿主、PGlite/PG 连接、DSH 运行时、Source 契约和 Python 检索入口保留。新增独立的公开情报表、任务处理器和资料检索界面，接入现有研究链。没有把价格或 IRR 改成项目主线。

隔离环境已执行全仓库 TypeScript 检查及 Vite 生产构建、372 项 Vitest 检查（20 个文件，含真实 PGlite/Express 接口测试）、桌面框选浏览器 13 项断言和检索面板 8 项断言。模型与外部信源边界使用明确测试替身，不冒充真实供应商联调。本地缺少部分 Python 地理依赖，新增 Python 分区回归交由本 PR CI 执行；后续状态以具体提交的 CI 为准。没有读取本机密钥、启动收费抓取、实际模型推理或权重训练。详见 `../research/test_results/aihot-core.json`。

## 实际入口和数据路径

```text
项目与数据 → 资料检索 → 检索 / 信源 / 校准
                     ↓ /api/intelligence/*
现有宿主 Store.db → IntelRepository（intel_* 表）
                     ↓ 宿主内有界持久任务
Channel → DSH Web → 既有原文抽取/官方记录适配 → 文档版本
                     ↓ 显式分类或获启用的后台分类
DSH ToolRuntime → Qwen 预筛/事件关系判准 + DSH 结构化/独立评分两次
                     ↓
按城市/类别/关键词检索 → 事件合并显示 → 加入项目原文
                     ↓
collectSelectedEvidence → 优先查沉淀资料/已有 BM25 → 缺口外搜
                     ↓
原有 Source / PublicRecord → 原有六维研究和 DecisionPacket
                     ↓
公开研究原文再次沉淀（排除内部资料、合成材料和循环回灌）
```

注册入口是 `apps/host/server.ts`，经现有 session/CSRF 中间件后注册 `apps/host/intelligence.ts`。UI 在既有 `DataSourcesPanel.tsx` 中以第二个页签展开，不新增首页巨型聊天框、不更换底图、不在拖图/悬停时分类。查询按钮只读已存储内容。任务可取消，失败在任务状态中保留。

新 Channel 是长期信源，现有 Source 仍然是一份材料。`Material` 保存原文与版本；模型摘要/标签在单独 Analysis 中。加入项目只加入原始 Source 快照，不生成 Fact，不改变组织规则，不启动模型，不覆盖运行中快照或旧报告。项目输入哈希冲突会拒绝过期加入操作。

## 信源适配与启用

支持 RSS/Atom、网页栏目选择器、JSON 字段映射、复用现有搜索的站点定向发现和认证外部 intake。四个预置入口来自现有 `PUBLIC_SOURCES`：土地市场、四库一平台、国家统计局、政府采购。它们是 **默认关闭的目录模板**，不是声称已获得访问授权或全国数据覆盖的连接器。没有捏造 RSS 地址，也没有复制上游 AI 行业的18个演示源。

在“信源”中先保存配置，再点“采集原文”。来源没有 RSS 时可选网页列表或站内定向发现；政府门户动态接口、验证码和登录不会被绕过。站点结构变化、获取失败、PDF需要原有文件解析链均留为失败/缺口。读取配置使用严格白名单，不接受任意脚本、请求头或凭据。采集前检查公网地址、限制源域名，采集通道禁止重定向；网络层仍复用 DSH。

每次任务冻结信源配置，最多提取100条列表候选、抓取10篇详情，单任务180秒上限。PGlite只有原宿主持有，不能另起worker打开同一数据库目录。宿主内单消费者负责持久队列；这不是新建第二套Agent控制器。只有宿主运行时，周期采集才执行。

可选环境配置（均不提交密钥）：

```dotenv
INTELLIGENCE_COLLECTION_ENABLED=false
INTELLIGENCE_MODEL_ENABLED=false
INTELLIGENCE_DAILY_MODEL_CALLS=40
INTELLIGENCE_SELECTION_THRESHOLD=65
# 可选：同一已配置提供方支持的另一实际模型；不等于独立厂商
# INTELLIGENCE_REVIEW_MODEL=...
```

前两个开关只控制自动周期任务。用户点击“采集并分类”或“分类与评分”是一次显式模型使用。普通检索、查看原文、资料沉淀均不调模型。未配置模型时返回 blocked_external，不生成模拟分数。native_search 复用现有原生搜索，可能使用该服务额度；本地资料检索不需要搜索额度。

每次模型调用先保存回执，已完成的相同输入/提示词/模型/评分槽位复用；双次评分使用不同槽位，不把缓存结果算成第二票。响应丢失/重启中断的付费请求标记 ambiguous，需要核对，不能自动重复付款。每日调用数限制覆盖分类/评分/关系判断。该预算是调用数上限，不是已验证的货币成本保证。

## 算法移植与建工修改

`vendor/aihot/algorithms.ts` 实际导入上游事件候选/关系决策、标题摘要表示、字符bigram相似度、JSON路径与模板逻辑，并适配双评分合并和来源组时间衰减。精确上游路径/blob、目标hash和调用边在 `research/aihot.upstream.lock.json`；MIT全文在 `licenses/AIHOT-LICENSE.txt`。

预筛保留 PASS/BLOCK/UNKNOWN。缺正文不调评分模型。分类用规划、土地、招采、建设、运营、市场、企业、风险，映射既有六维。项目编号、城市必须有原文引句；模型不生成地图坐标。城市级材料保持城市级，不冒充宗地/建筑事实。

事件召回只提供候选，不能凭相似度合并。不同城市或明确项目编号不合并；同一次行为与同项目后续分开。自动合并需具体对象编号、相同日期与动作；其他合并需要配置不同模型复核。后续只挂到根事件，人工改正不被自动覆盖。范围与指向仍需真实样本校准。

双次0–100分只表示阅读/调查优先级，不表示投资收益或许可可靠性。默认65分为未校准起点；两次差值超过20进入待核。相同模型两次判断不能证明独立事实确认。评分结果不进入事实计算。UI默认显示类别、原文和处理状态，不展示综合投资分。

来源组热度按每组最新的已核发布时间衰减；重复抓取不增加票数。建工默认168小时窗口、72小时半衰期，是待校准配置而非上游AI热点的48/24小时。来源组不同不保证报道证据独立；转载链需要人工归组。热度不是可靠性，不触发项目自动批准。

当前网页检索是 PostgreSQL 中文分词/字二元组倒排索引与事件分组，研究召回复用现有jieba/BM25/RETQA/STORM能力；**没有伪称接入向量数据库、向量召回、学习型reranker或全国语义检索**。SQL 先按词项匹配和城市过滤，再按全文相关性取400份候选，接口返回truncated；研究候选进一步进入原有BM25。原文修订观察采用追加日志，A→B→A回退不会误读历史。更大规模的向量检索仍需单独验证。

## 时间、更新和证据

相同URL与正文版本幂等入库，原始版本保留。保存规范化原文、正文hash、已有raw_hash和结构化记录；不声称本PR已保存所有原始HTML字节。未知发布日期保持未知。历史研究只取当时已观察且已核发布日期可用的版本，不能让今天补采的未来知识混入历史快照。

沉淀原文按同一Source协议重新进入研究。已有已核、近期且命中对应目录域名的证据可减少相应站点重复搜索；未覆盖部分仍外搜，一般发现查询保留。无法读取沉淀层时回退原研究流程。已有租金/成本/产权空缺不由情报分数填充。`signal_only`渠道只做线索，不能自动作为项目证据。

## 人工反馈、评测与后续训练

先积累具体原文版本，在详情中独立标注是否值得保留、类别和原因。UI不会自动将模型类别预填成人工金标准。默认写development；详情可明确选择holdout/train，并填写同源家族与具体版本的训练使用许可。按同项目、同事件、同URL修订和相同正文分组，跨集合冲突拒绝。译文、长改写和不同URL同源资料需要核对者填写共同family_id。

评测给出查准/查全/F1、处理覆盖率与错误数、类别Macro-F1；只有development做阈值扫描，holdout不扫阈值。另提供检索Recall/MRR/nDCG与事件pairwise/B³计算函数及测试，这些函数不是已经获得真实检索/聚簇成绩的声明。

导出local_eval为可检查JSONL，gold与模型输入分开。导出local_sft要求人工核对、train集合、明确的该版本使用许可记录；不导出未知入选标签、不把holdout混入训练。获准行附带标准messages，缺许可留在blocked列表。此PR建立的是数据/校准接口，**没有执行模型权重训练，也没有真实企业效果结论**。现有`packages/corpus`问答/许可流程不被替换，新的标签用于情报筛选任务，不冒充原有SFT答案。

## 操作和复核

```bash
# 使用已运行的本地主机；不创建第二个数据库实例
node --import tsx scripts/intelligence.ts status
node --import tsx scripts/intelligence.ts search "厂房 改造"
node --import tsx scripts/intelligence.ts evaluate
node --import tsx scripts/intelligence.ts export
# 静态来源与运行时引用审计，不等于实际执行/效果验证
node --import tsx scripts/upstream-aihot-audit.ts
# 原有CI会收集新增Vitest测试并编译宿主与前端
npm test
npm run build
```

新增PGlite测试覆盖入库、版本、历史读取、人工归组、付费回执与任务取消。合并前应查看此次PR的真实测试结果，并在有权限的本机进行至少一个真实栏目采集、真实模型分类、地图资料检索、加入项目与研究回读。没有完成这些，不应把草稿PR标为企业验收通过。

## DSH / Qwen 与上游模型替换

`runtime/intelligence/judge.ts` 只使用现有 LiveSession。Qwen启用时，预筛和事件关系通过 `runReadCapability()` → `services/capabilities/intelligence-decision.ts` → 原有受限 SystemOne 传输接口处理；结构化和双次阅读优先级评分由 DSH 执行。Qwen失败显式保留，不能悄悄伪装成另一个提供方结果。未启用Qwen时DSH承担这些步骤，界面显示路由状态。

未引入上游新闻站的Jina、SocialData、公众号付费端点或新的Jev服务。现有库没有发现Jev运行依赖，不能把“没有引入”写成“删除了已存在的Jev”。密钥沿用宿主配置。原项目的Qwen六维决策仍处理来源事实，不读取新闻热度作为事实可靠性。

## 一键标色与桌面区域选择

修复可复现的代码故障：可选的已存项目边界中有一个非法形状或超出分区接口限制时，不再使整轮422失败。显式用户选区仍执行严格拓扑校验。坏边界计数、分区服务失败和源接口失败给出不同安全诊断；部分区域失败保留其他有效结果。没有取得用户本机故障日志，不能认定已证明其唯一根因。

键鼠路径：R或“框选区域”进入俯视框选，左键拖框，Enter确认，Esc取消。确认只读取范围事实，不启动模型；后续标色使用已固定多边形，不随地图拖动变化。已选范围仍通过原有GCJ-02→WGS84接口传入项目。可以清除选区恢复视野筛选。本轮不新做手机端适配，已有移动行为不主动删除。

## 复核命令

```bash
npm test
npm run build
node --import tsx scripts/upstream-aihot-audit.ts
.venv/bin/python -m pytest tests/test_map_region_intake.py -q
HZZ_UI_AREA=1 node tests/browser/map-workspace.mjs
node tests/browser/intelligence.mjs
```

浏览器截图和测试输入均明确为合成回归资料。企业判断效果、真实信源适配成功率和筛选阈值效果仍须有代表性的人工样本与获准端点检验；这不是合并后自动获得的能力。
