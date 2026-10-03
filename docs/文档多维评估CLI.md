# Qwen 文档多维评估 CLI

用现有 Qwen `decision-model-preview` 逐份评估用户明确指定的文件，同一份文件的多个维度合并调用。默认量表衡量老旧小区项目材料的支撑程度：居民需求、公共服务、居住工程、实施协同、长效维护、资金交付。文件范围和维度可改，不限于翠苑案例。多份文件分别评价；本版不把不同文件的事实自动合并成项目结论。

项目内 Skill 为 `.agents/skills/qwen-document-evaluation/SKILL.md`。它适配自 [TypeSafe 官方 Skill](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md)，保留独立的类型化判断及代码组合方法，模型调用改用现有 Qwen。原文、MIT 许可、锁定版本与修改记录随 Skill 保存；没有新增 TypeSafe/Jev SDK 或 Key。

## 命令与输入

从仓库根目录执行，使用 Node 24 和现有依赖：

```bash
npm run documents:evaluate -- --help
npm run --silent documents:evaluate -- --print-rubric > /tmp/my-rubric.json
npm run documents:evaluate -- --rubric /tmp/my-rubric.json --dry-run --out data/local/document-review 调研报告.md 会议纪要.docx
npm run documents:evaluate -- --rubric /tmp/my-rubric.json --out data/local/document-review 调研报告.md 会议纪要.docx
```

正式命令将指定材料正文发送给本机配置的 Qwen API；`--dry-run` 仅本地解析并检查量表和输入预算。终端不打印正文或 Key。凭据由 `.env` 中的 `QWEN_DECISION_API_KEY`、`QWEN_DECISION_ENDPOINT`、`QWEN_DECISION_MODEL` 读取；沿用项目现有端点校验与模型配置，不能把 TypeSafe 的地址或 Jev 别名替换进去。示例输出放在 Git 忽略的 `data/local`，用户材料和模型结果不自动进入仓库。

支持 TXT、Markdown、CSV、PDF、DOCX、XLSX；最多 20 份、每份 10 MB。文本与 CSV 复用 `apps/host/ingest.ts` 的 `parseMaterial`；二进制文件在临时目录内复用 `services/capabilities/parsers.py` 的 `parse_document`，通过已有 Python 环境处理，退出后删除临时副本。PDF 没有可提取正文时报告待 OCR；PDF 前 50 页、Excel 行预览等既有解析上限在结果中明确标注。模型只取得保存的解析范围，不能把它当全文。超过模型请求预算的材料报错，不静默截断后宣称全文已评。

`--print-rubric` 导出当前默认 JSON，按它的结构编辑维度名称、问题、五级情境描述和权重，用 `--rubric` 传入。最多 8 个维度，维度 ID 唯一，权重为正数；每级必须有实际描述。阈值是工程配置，需要真实材料校准，不是官方业务标准。

## 系统结构与接口

```text
指定文件 + 量表 JSON
  → 既有本地 ParserPort（哈希、正文、定位、解析范围）
  → 每份文件构造 state + 全部维度 questions
  → 既有 DSH LiveSession / runReadCapability
  → requestDecisionQuestions → Qwen /systemone
  → 类型、概率、期望分一致性检查
  → 缺项处理、覆盖率与已评维均值计算
  → results.json + summary.md
```

CLI 入口：`scripts/evaluate-documents.ts`。评估模块：`packages/document-evaluation`。传输层：`services/capabilities/decision-model.ts`。这是现有运行时和专业能力的一条受限调用路径，不启动第二套应用服务、任务系统或解析器。单次请求最多 24 问题、160 KB，请求 12 秒、响应 100 KB；CLI 每维两个问题，因此最多 16 个独立问题同批发送。请求失败不会改用其他模型或伪装成成功。

Qwen 请求为 `{ model, state, questions }`，Bearer Key 仅由共享传输层读取。state 内含指定材料与来源标识；材料中的命令、建议或“忽略规则”文字都属于待评数据。量表指令由程序单独构造。每维包括内容是否出现的 Noul，以及按该维度量表评估的 Score；两者独立执行，程序收到所有答案后再组合。

## 核心算法与结果

Noul 返回 `p(yes)`，没有单独 confidence。Score 返回等级概率、概率加权等级和 confidence。五级量表使用下标 0–4，原始分应符合 `Σ level × probability(level)`，概率和应为 1；分布、confidence、类型或数值不符即报错。输出分数保留 0–4 原始等级；需要 0–1 的展示时可由调用方除以 4。材料未涉及或判断不确定的维度保留 `null` 与状态，不按零分参与平均。

设有效维度集合为 A、全部维度为 D、权重为 w，输出分别计算：

- 加权覆盖率：`Σ(i∈A) w_i / Σ(i∈D) w_i`。
- 已评维均值：`Σ(i∈A) w_i × score_i / Σ(i∈A) w_i`；没有有效维度时为 `null`。

覆盖率反映有多少维度可用于本次结果，均值仅描述这些已评维度。材料支撑分数不是项目投资价值、工程安全结论或审批依据。未知条件及否决性条件不能被其他维度分数抵消。

`results.json` 保存批次状态、使用的量表和逐文件结果；每份包括源文件/解析文本指纹、解析器、材料级原文定位、解析范围、量表与请求指纹、模型、request ID、输入 token、耗时、各维度判断及汇总。`summary.md` 以表格展示结果和复核项。定位用于找回整份被评材料，尚不是逐维得分经核验的引用链；Qwen 不生成解释或凭空补写引文。

资料缺项、模型不确定或有限提取导致的 `partial` 不等同执行失败：若没有解析或调用错误，命令退出 0；有任一文件解析或调用失败时退出 1，并保留逐文件错误。退出状态和文件状态区分解析失败、空文本、待 OCR、请求失败、无效响应以及完成或部分结果。成功保存报告不能替代实际模型调用验收。默认输出目录受 Git 忽略，但用户显式选择其他路径时仍应按资料权限管理。

## 验证边界

契约测试使用模拟接口，检验多问题单次调用、量表拒绝、未知项、分布和期望分、失败处理、解析定位、dry-run 不联网。真实调用记录另存本地；真实端点成功仅说明调用与结果格式成立。没有企业标注样本及专业量表复核前，不报告文档评估准确率或投资决策质量。

本次验证记录见 `research/test_results/document-evaluation-cli.json`：17 项新 CLI 检查通过，另有 426 项既有 JS 与 70 项 Python 回归、生产构建及浏览器检查。对已整理的公开历史材料短摘录实际调用两次：默认六维返回缺项/不确定；自定义来源与适用边界量表完成两个维度的返回与校验。这里只确认端点与程序流程，不将样例分数当准确性评价。
