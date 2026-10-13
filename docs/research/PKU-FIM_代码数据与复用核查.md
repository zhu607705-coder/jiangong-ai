# PKU-FIM：代码、数据与复用核查

核查日期：2026-10-13。论文 DOI：`10.1038/s41893-026-01886-9`，题名为 *Human mobility dynamics for cost-effective flood emergency resource allocation*。

## 原仓库与固定版本

[论文官方页面](https://www.nature.com/articles/s41893-026-01886-9)参考文献72直接指向 [WeiLyu59/PKU-FIM](https://github.com/WeiLyu59/PKU-FIM)。本次以该引用确认作者仓库，固定到提交 [`76aaccbb1f24f0cd133c7907d532119beb79c84e`](https://github.com/WeiLyu59/PKU-FIM/tree/76aaccbb1f24f0cd133c7907d532119beb79c84e)，提交时间为2026-05-21。README仍使用早期题名和`WeiLyu59/ABM`克隆地址，核查与后续取用统一以固定的PKU-FIM地址为准。

[LICENSE.txt](https://github.com/WeiLyu59/PKU-FIM/blob/76aaccbb1f24f0cd133c7907d532119beb79c84e/LICENSE.txt)全文为GNU GPL第二版（1991年6月），本次已读取18092字节并记录SHA-256。仓库页面标记GPL-2.0。直接复制、修改和发布代码应结合该许可安排；本项目可先带引用独立实现供需及经济比较算法，并保留与原方法的对应关系。原始外部数据分别按其来源条件取用。

## 实际公开内容

固定提交的[完整文件树](https://api.github.com/repos/WeiLyu59/PKU-FIM/git/trees/ab3c818de4c41715a9e4d2200334be0466c579ac?recursive=1)含529个文件，其中61个Python脚本，主要是数据准备、后处理、空间分析、成本效益和绘图。公开文件包括：

| 内容 | 实际位置与格式 | 可用于本项目的工作 |
|---|---|---|
| 21城百年一遇情景流入 | `Datasets/1-km inflow mobility datasets during 1-in-100-year rainfall events`，21份CSV，含杭州 | 按对象与情景组织需求结果，观察供需评价结构 |
| 21城应急资源供需结果 | `Datasets/1-km resolution map for the demand-supply relationship for emergency resources`，21份CSV | 对照缺口、余量、平衡等结果字段 |
| 对应网格几何 | `Datasets/SHP`，21组SHP及配套文件 | 将网格ID与空间对象关联 |
| 模型演示输入 | [model_input.csv](https://github.com/WeiLyu59/PKU-FIM/blob/76aaccbb1f24f0cd133c7907d532119beb79c84e/Input%20for%20demo/model_input.csv) | 已核表头：FID、Tid、Hazard、Con_pop、CBRA、County |
| 演示运行参数 | [inputParam.csv](https://github.com/WeiLyu59/PKU-FIM/blob/76aaccbb1f24f0cd133c7907d532119beb79c84e/Input%20for%20demo/inputParam.csv) | generation、pop_discount、pop_ratio、rows、cols、localRatio、cap、searchParams |

文件树中未见论文PDF、补充方法文件、依赖锁定文件及核心ABM源文件。`Multilayers`仅出现为`Code/2_DataAnalysis/__pycache__/Multilayers.cpython-39.pyc`。README的运行说明对应补充算法1—9，核心环境与个体决策实现需要向作者核对。公开演示输入与模拟结果可以作为结构参考；校准观测和授权范围另行建立数据台账。

## 可以复用的代码块与输入契约

三个已读脚本均是`__main__`内的过程式计算，尚无可直接导入的公开函数。适配时将计算块封装成参数明确的本地函数。

| 源码位置 | 已实现的计算 | 本项目适配输入与输出 |
|---|---|---|
| [5_match_stats.py，61—115行](https://github.com/WeiLyu59/PKU-FIM/blob/76aaccbb1f24f0cd133c7907d532119beb79c84e/Code/2_DataAnalysis/5_match_stats.py#L61) | 根据预测需求和设施容量形成差额及缺口/余量/平衡分类 | 输入同对象、同服务期需求和已核容量；输出服务缺口、覆盖范围与受影响需求。养老托育的容量、共享边界和容差由本地资料与导师规则给出 |
| [12_CBA_byCity(CI).py，75—103行](https://github.com/WeiLyu59/PKU-FIM/blob/76aaccbb1f24f0cd133c7907d532119beb79c84e/Code/2_DataAnalysis/12_CBA_byCity%28CI%29.py#L75) | 按需求缺口分位选择改造范围，计算设施数量、建设、维护、保险及若干效益 | 输入候选措施、工程量、分主体成本、合法经营收入、公共效果；输出措施规模、成本和现金流、公共效益与实施顺序情景 |
| [1_CalAccuracy(Inflow).py，57—130行](https://github.com/WeiLyu59/PKU-FIM/blob/76aaccbb1f24f0cd133c7907d532119beb79c84e/Code/2_DataAnalysis/1_CalAccuracy%28Inflow%29.py#L57) | 将模型输出与观测标签比较，形成准确率及混淆矩阵 | 输入有授权、范围时点一致的观测与预测；输出需求预测误差和分群结果，适用于后续验证适老需求与服务响应 |

成本效益脚本中的收益包括损失避免、医疗援助和碳效益。迁移到老旧小区时，经营现金流、财政节支、居民效益和公共效果分别报告。本地租金、支付意愿、出租率、设施规模和维护责任对应新的参数来源。

## 复现前需要处理的具体项

1. **确认核心ABM入口。** README描述避险、安全区吸引与同伴跟随规则；固定树未见核心环境实现，需核对作者完整源码与补充算法的版本对应。
2. **核对CBA循环。** `12_CBA_byCity(CI).py`第41行设1000次，第66行建立循环，但第71行在首次bootstrap抽样后退出；第111行CSV写出注释。当前提交执行的是这段有限计算，完整置信区间流程需恢复循环、固定随机种子并核对统计量。
3. **准备校准资料。** `1_CalAccuracy(Inflow).py`第30、36、42、72、95行依赖校准`model_input.csv`、参数、环境pickle、`Inflow_truth`和npy输出。演示表头没有`Inflow_truth`。个体移动与设施需求的校准应使用获准观测，并保留观测和模型结果的不同来源。
4. **把固定常数改为版本化规则。** `5_match_stats.py`第40、73、78行使用容量500/50000和差额容差50；CBA脚本第20—39行固定设施及经济参数。适老更新使用本地设施能力、收费与工程成本；单位、折现期、汇率和重复计费在经济模型中逐项校核。
5. **替换环境路径与依赖。** 以上脚本含`D:/LW/ABM`路径。README列Python2.7/3.8/3.9及ArcPy，校准脚本另需SciPy。采用参数化路径、固定版本和明确的GIS替代流程后，再进行受控运行核对。

本次产物记录在`research/literature/s41893-026-01886-9/code-data-intake.json`，含固定提交、文件树、每份已读文件的URL/hash、输入字段、复用代码位置与后续校准需求。仅做公开资源静态读取，未执行外部代码、加载pickle、安装包、获取手机信令或运行模型。
