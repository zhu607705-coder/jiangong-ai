# 科学方法图件责任表

| 图 | 回答的问题 | 数值来源 | 生成脚本 | 样本与重复 | 必须保持 | 输出与用途 |
|---|---|---|---|---|---|---|
| 运营科学核算 | 月汇总怎样高估服务量，容量怎样限制保本 | research/test_results/scientific-methods-results.json | scripts/render-scientific-methods-figure.py | 2个演示时段；71个确定性需求点，无随机抽样 | 分时服务70、合计上限100、保本500、容量520；人工演示标签 | operations-scientific-checks.pdf / svg / png；技术报告科学方法章节 |

图型采用分组柱图与有单位坐标的折线。两个时间点不足以估计密度，未采用热力或密度图。论文嵌入后检查字号、标注、坐标与图注；审核结果记录于报告QA。

## 社区分析复合图责任表

图件：`community-analysis-figure.pdf`；数据全部为完整社区演示的构造数据。正式重采样次数为0，生成与汇总均为确定性规则，无随机种子。三个需求情景是预算假设，未绘制概率密度或置信区间。

| 面板 | 回答的问题 | 权威数据 | 样本与编码 | 必须保持的量 | 生成与输出 | 报告位置 |
|---|---|---|---|---|---|---|
| a | 六维条件覆盖怎样改变 | `data/templates/complete-community-demo-v1.json` | 6维，前后配对点图 | 同一分母、1–5刻度、原分值 | 下述脚本及PDF | 完整数据模拟章节 |
| b | 需求变化怎样影响服务量 | `research/test_results/complete-community-demo-calculations.json` | 3个固定情景，柱图与容量线 | 1304/1630/1956人次，容量2044 | 同上 | 同上 |
| c | 三种情景现金结余怎样改变 | 同上 | 3个固定情景，柱图 | 1035/2294/3553元/月，政府直付不进入运营账 | 同上 | 同上 |
| d | 逐日服务与月度汇总怎样对应 | `data/templates/complete-community-demo-v1.json` | 30天、1568条记录，原始日汇总线与点 | 人次合计1568，月度去重286人，未累加每日去重 | 同上 | 同上 |

生成脚本：`scripts/render-community-analysis-figure.py`。主题：`packages/retrofit/analysis-palette.json`，用于报告矢量图。沿用既有科学方法图的Matplotlib字体与矢量导出机制，并参考用户微网购电 `code/paper_figures.py` 的多面板、原始记录和独立单位呈现；Nature Figure提供深蓝、青、紫、红、灰的渲染规范。此图不更改模拟数据或评价公式；网页根据后续用户意见改为产品配色、连续滑块推演和可恢复的方案对照。

网页首屏为可调整的运营推演，名册、六维、容量、资金与台账可按需展开，不显示论文式面板编号。改色前截图保留在 `output/playwright/analysis-motion/analysis-overview.png` 和 `daily-ledger.png`。最终截图、色彩对比度、导出读回、报告渲染与自动测试记录在 `research/test_results/analysis-motion-verification.json`。
