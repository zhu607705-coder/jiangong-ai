import csv
import json
from pathlib import Path

ROOT = Path('D:/建工ai')
TARGET = ROOT/'docs/老旧小区改造案例拆分与六维数据说明.tex'
imports = json.loads((ROOT/'data/imports/teacher-criteria-20261012.json').read_text(encoding='utf-8'))
catalog = json.loads((ROOT/'data/templates/renewal-mode-catalog.json').read_text(encoding='utf-8'))
economic = json.loads((ROOT/'output/renewal-mode-demo.json').read_text(encoding='utf-8'))
aging = json.loads((ROOT/'output/aging-coverage-demo.json').read_text(encoding='utf-8'))
core = imports['normalized']['core_data_fields']
assert len(core)==46 and len(imports['normalized']['selected_rules'])==27

def esc(text):
    return str(text).replace('&',r'\&').replace('%',r'\%').replace('_',r'\_').replace('#',r'\#')

groups = [
 ('前置模式判定',['B01','B04','B09','D02','D03'],'逐栋适修性、权属与保护、规划容量、居民协商、面积用途和过渡安排。','生成保留、加固、改扩建、局部拆建、整体重建与服务组合。','公开＋访谈；鉴定、许可及分户权利待采','官方目录、获准原件解析、测绘、规划与产权方访谈','MODE-G01至G04'),
 ('居民需求',['B05','B06','B07','B08','S01','S02','S03','S05','S11','S13'],'常住及老年人数、行动困难、现住与目标客群、预算、需求和意见。','确定服务对象、居民分摊与支付匹配，选择适老改善顺序。','公开＋问卷＋访谈；实际住户预算缺项','脱敏台账、分群问卷、访谈；历史人口按原范围引用','R007；ECON-AFFORD'),
 ('公共服务',['D06','S04','S08','S10','S12','S16'],'设施位置、对象、开放与容量、价格、连续可达、实际使用和覆盖。','比较已有中心、共享设施、路线与时段调整及服务植入。','公开＋问卷＋访谈；使用记录待采','目录与合同解析、服务路线、台账和去重使用调查','R008至R013；R007'),
 ('居住工程',['B02','B03','D01','D02','D03','D04','D05','D07'],'楼栋、设施、鉴定、道路管网、厨卫与电梯、可改和拆建范围。','按栋生成措施，区分供水、加梯、成套化、修缮及拆建接口。','公开＋访谈；专业原件待取得','图纸、检测、公示和验收解析；现场点位核查','R001至R007；R014至R024'),
 ('实施协同',['B01','B09','S13','S14'],'主体、权利、协商、安置、施工扰动、过渡期及分期衔接。','区分自主组织、代理建设和工程方式，形成责任与安置表。','问卷＋访谈＋公开；法定记录待采','按事项台账、协议原件、各主体访谈','MODE-G04；R021至R024'),
 ('长效维护',['S15','S16'],'接收方、运维服务、合同、年度支出、维护覆盖与交接。','核谁维护、谁收费、经营净额能覆盖多少持续支出。','公开＋访谈；经营与维保合同待采','合同条款抽取、费用和工单核对、运营方访谈','MODE-G06；ECON-MAINTENANCE'),
 ('资金交付',['B10','C01','C02','C03','C04','S11'],'建设、安置、运维、出资、补助、借款本息、到位与结算。','比较年度现金缺口、居民负担和融资时序，确定方案包。','公开＋访谈；本项目报价与出资待采','工程量与报价、资金原件和支付计划解析','R025至R027；ECON-COST/FUNDING'),
 ('市场收益',['M01','M02','M03','M04','M05','M06','M07','M08','M09'],'同类交易与挂牌、租金、吸纳、面积用途、经营权、费用与客群预算。','计算可实现销售、出租、服务现金；单列业主资产变化与公共效果。','公开＋问卷＋访谈；真实租约及处分权待采','同口径市场样本、租约和运营合同、预算问卷','ECON-REALIZABLE/NPV；MODE-G05'),
]
registry=[]
byid={r['field_id']:r for r in core}
for domain,ids,description,usage,channels,method,rules in groups:
    for field_id in ids:
        row=byid[field_id]
        registry.append({'namespace_id':row['namespace_id'],'original_id':field_id,'analysis_domain':domain,
          'field_name':row['field_name'],'source_value':row['source_value'],'unit':row['unit'],
          'source_time':row['source_time'],'source_scope':row['source_scope'],'source_class':row['source_class'],
          'source_category':channels,'collection_method':method,'proposed_rule_mapping':rules,
          'source_rule_refs':row['rule_reference_refs'],'provenance':row['provenance']})
(ROOT/'data/templates/renewal-research-register.json').write_text(json.dumps({'version':'1.0','authority':'user_workbooks','domains':8,'rows':registry},ensure_ascii=False,indent=2),encoding='utf-8')
with (ROOT/'data/templates/renewal-research-register.csv').open('w',encoding='utf-8-sig',newline='') as handle:
    writer=csv.DictWriter(handle,fieldnames=['namespace_id','original_id','analysis_domain','field_name','unit','source_time','source_scope','source_class','source_category','collection_method','proposed_rule_mapping'])
    writer.writeheader()
    writer.writerows({k:r[k] for k in writer.fieldnames} for r in registry)

front = r'''\section{改造模式前置与经济可持续性}

模式判定采用七个可组合的物理家族，另行登记组织、资金、工程交付和运营方式。自主更新是组织与出资机制，EPC是交付方式；它们可与保留修缮、局部拆建或整体重建共同出现。比较单位为同范围、同目标且包含工程、安置、经营与维护的方案包。\cite{renewal2025,hzmode}

\begin{longtable}{@{}L{16mm}L{44mm}L{99mm}@{}}
\toprule
\textbf{模式} & \textbf{物理方式} & \textbf{候选条件与可组合措施}\\\midrule\endfirsthead
\toprule\textbf{模式} & \textbf{物理方式} & \textbf{候选条件与可组合措施}\\\midrule\endhead
'''
for row in catalog['physical_methods']:
    front+=esc(row['id'])+' & '+esc(row['name'])+' & '+esc(row['candidate_condition'])+'；'+esc('、'.join(row['components'][:4]))+r'。\\'+'\n'
front+=r'''\bottomrule\end{longtable}

方案生成先识别逐栋鉴定与适修性、保护和权属、规划与面积用途、居民意愿及安置。通过这些条件后，对可组合措施比较资金、市场、支付能力、维护和居民效果。缺项影响对应方式；其他具有明确条件的方案继续研究。

研究框架采用\textbf{前置模式判定＋原六维＋市场收益维度}。市场收益同时记录售价、租金、客群、可支付预算、可处置面积和收益归属，使方案比较既回答投入，也回答收入与长期维护如何衔接。

\subsection{按收款人和受益人建立四本账}

\begin{itemize}
\item 成本账：工程、过渡安置、设计检测、迁改、运维和交付。
\item 现金收入账：具有对应使用与处分或收费权利的对外销售、出租和服务收入，保存收款主体、时点及价格口径。
\item 资金安排账：居民、产权单位及财政出资，贷款和还本息；分别核对计划与已落实时序。
\item 资产与公共效益账：业主住房价值变化、便利改善、设施覆盖和使用效果，保存受益对象及评价方法。
\end{itemize}

新增面积分成原住户回迁、自选扩面、安置及保障住房、公共服务和获准市场处置。每类记录面积、用途、权属及收款主体。浙工新村的居民扩面付款与产权人二手售房分别登记；上海案例的厨卫改善面积与增量房源政策也按用途分列。\cite{zhegongdata,shmix}

'''

data_section = r'''\section{用户数据表与逐行采集规则}

本轮以用户提供的三份表为字段和规则依据：46项核心指标、27条筛选规则、76项默认缺省扩展字段和15项专家待补。全部原编号、原值、年份、空间口径、原说明及单元格定位保留。案例卡C01、数据字段C01和模式M01使用不同命名空间，正文分别写“案例”“数据”“模式”。

核心表S02至S16的15项演示值保持原来的模拟标签；B、D、M、C中的空项保留空值。规范条目沿用用户筛选；专家意见在E01至E15上补充。已有经验规则R1至R4与用户规范规则R001至R027分别引用。

\begin{landscape}
\small
\begin{longtable}{@{}L{21mm}L{56mm}L{50mm}L{37mm}L{48mm}L{24mm}@{}}
\toprule
\textbf{维度与原ID} & \textbf{数据内容} & \textbf{对应判断} & \textbf{来源与缺项} & \textbf{采集方式} & \textbf{规则对应}\\\midrule\endfirsthead
\toprule\textbf{维度与原ID} & \textbf{数据内容} & \textbf{对应判断} & \textbf{来源与缺项} & \textbf{采集方式} & \textbf{规则对应}\\\midrule\endhead
'''
for domain,ids,description,usage,channels,method,rules in groups:
    data_section+=esc(domain)+'\n'+r'\newline '+esc('、'.join(ids[:3]))+('等' if len(ids)>3 else '')+' & '+esc(description)+' & '+esc(usage)+' & '+esc(channels)+' & '+esc(method)+' & '+esc(rules)+r'\\'+'\n'
data_section+=r'''\bottomrule\end{longtable}
\normalsize
\end{landscape}

\subsection{默认缺省字段按报告需要补填}

76项扩展字段默认值为缺省，初次运行以核心指标和已有材料组织报告。扩展字段覆盖道路排水、无障碍、公共服务、设计消防及加梯产权，按原表关联到具体规则。

当报告采用某条规则，且该扩展字段会改变所建议的措施或理由时，生成补填任务。任务保存字段ID、规则ID、影响哪项建议、向谁查询、怎样采集、原表位置和补齐后重算什么。补齐只更新相关规则与方案版本，其余任务继续运行。

例如，报告提出连续无障碍路线并引用R007，便按需调阅其相关路径与断点字段；道路评级引用R001时，请求对应病害台账。选择性收益缺项时，基线先不计这部分加成；若某项收入已经承担资金平衡或运维覆盖任务，则将它列为该方案的关键补充项。

\subsection{内部文件与互联网调查怎样相互补充}

内部文件解析保留楼栋清册、分群人口、设施合同、费用和使用台账；问卷和访谈补充支付上限、出行困难与服务体验；互联网调查补充政策、项目进度和市场样本。每项观测保存对象、时间、统计分母、来源、原文位置及版本。

老年人数采用同一研究范围的脱敏人口汇总；覆盖率采用目标群体和去重服务对象；应用情况同时保存使用人数、访问次数、设施容量和观察月份。已保存的历史社区人口与当前小区台账分别记录，供背景、参数参考和实际核算各自使用。

'''

economic_section = r'''\section{市场收益与措施效果的可计算模型}

\subsection{现金收入与经营净现值}

经济原型按任意模式ID和组件列表输入，按现金主体分别计算。量价、出租率和服务合同构成收入：
\[
R_t=A_{\mathrm{sale},t}p_t+A_{\mathrm{rent},t}\rho_t\,12u_t+R_{\mathrm{service},t}.
\]
其中面积对应有权实现的销售或出租范围，$p_t$为销售单价，$u_t$为月租单价，$\rho_t$为出租率。工程、安置与维护费用记为$C_t$。融资前经营净现值为
\[
NPV=\sum_{t=0}^{T}\frac{R_t-C_t}{(1+r)^t}.
\]
程序另计算静态收支、保本价格、目标人群月度及一次性支付匹配。资金安排按出资、借款与还本息的时间计算累计余额，最低余额形成峰值资金缺口。可研参考大纲将市场、商业模式、现金流、融资及可持续性分别组织，为本模型提供工作结构。\cite{ndrcfinance}

\subsection{适老设施覆盖与使用情景}

设施模型将群体人数、楼栋条件、连续路线、采用率和服务容量作为参数。按匿名人员ID去重，区分可达人数、使用人数和重复访问次数：
\[
\text{潜在覆盖率}=\frac{\text{可达目标人数}}{\text{目标总人数}},\qquad
\text{使用人群覆盖率}=\frac{\text{去重使用人数}}{\text{目标总人数}}.
\]
可达者采用率以可达人数为分母，容量使用率以同月份可用服务次数为分母。改善某条路线、增加可达设施或服务容量后，模型重新计算各群体的使用与覆盖。结果记为情景预测，输入保留来源与假设。

用户表数据S12给出40\%至70\%的覆盖目标，S16给出75\%至85\%的可达目标。模型将这些作为目标条件，与参数产生的结果对照，进一步研究达到目标所需的设施与服务组合。

\subsection{两组演示与一个缺项分支}

经济示例采用五年、5\%折现率的演示假设：
\begin{center}\small
\begin{tabular}{lrrl}\toprule
\textbf{模式组合} & \textbf{经营NPV 元} & \textbf{峰值缺口 元} & \textbf{计算状态}\\\midrule
保留整治＋服务运营 & 56,392.31 & 0 & 可开展专项调查\\
部分保留＋局部拆建＋经营 & -285,683.11 & 1,000,000 & 展示调整因素\\
整体拆建，权利与价格缺项 & 空值 & 空值 & 补关键资料\\\bottomrule
\end{tabular}\end{center}

第一方案的保本月租为115.18元/平方米/月。程序保留出资、贷款、收入和业主资产效益的独立账，展示哪些参数使收益或资金缺口变化。这组示例的数据标签均为演示假设。

适老示例采用演示住区1000人、老年占比33\%、目标群体330人；按同一随机序列比较基线与改善，结果如下：
\begin{center}\small
'''+aging['result_table_latex']+r'''
\end{center}

中采用情景下，去重使用人数由72人增加到213人，增加141人；使用人群覆盖率提高42.73个百分点，月访问量由336次增加到1372次。这是给定人口、路线、设施和采用参数后的预测结果，后续用台账和实际使用记录校准。

演示另保留关键权利、价格或容量字段空值，输出\textbf{“先补充关键资料再判断”}，并显示影响的指标和补填任务。默认缺省的非核心字段只影响其对应规则，其他有完整输入的事项继续运行。

\subsection{有数据与有模型分别怎样推进}

先交付可运行的计算方法、字段体系和措施情景；得到真实人口、合同、问卷与市场样本后替换相应参数。可量化部分输出人数、覆盖、现金和预算结果；共享服务、出行便利及保护价值采用明确的对象、机制和调查指标说明。专家确认必要条件与比较偏好，Agent据此组织最终理由和候选方案。

'''

new_decisions = r'''\decision{D11}{核对目标客群与可实现收入}
\field{决定}{分别登记原住户改善、租住家庭和服务运营者的预算，按资产及合同识别销售、出租和服务现金。}
\field{原因与依据}{用户核心数据M01至M09已包含市场字段；浙工新村提供居民扩面与产权人交易的分主体对标。\cite{zhegongdata}}
\field{采用规则}{ECON-REALIZABLE、ECON-AFFORD及MODE-G03、G05；用户规范资金规则R025至R027按适用条件调用。}
\field{下一步与更新}{补租约、经营权、量价、空置、支付和报价，分别计算经营、筹资和资产效果，保留条件机会及关键缺项。}

\decision{D12}{以模型推算适老覆盖并安排复查}
\field{决定}{把数据S01至S16中的需求、服务目标和群体条件转为人口、路线、容量和采用参数，比较不同措施的覆盖效果。}
\field{原因与依据}{R007关注连续衔接，用户S12和S16已给出覆盖与可达目标；相关经验来自电梯与邻里中心原文。\cite{trust,neighbor}}
\field{采用规则}{R007、R017、R018及对应专家补充E03、E05；预测指标采用去重人数和同月份容量分母。}
\field{下一步与更新}{按需取得扩展参数与脱敏使用记录，将目标、假设和观测分列，重算覆盖及每新增受益对象的投入。}

'''

case_summary = r'''\subsection{新对标案例怎样改变求是村的比较}

浙工新村将原址重建、自选扩面、地下停车和服务配套组合，住宅548套、原面积及扩面收费分别登记；2024年预算5.3亿元、居民自筹4.7亿元与2026年回顾5.6亿元、4.9亿元保留为不同版本。研究重点是居民支付、垫资和质量运行复盘，产权人交易与项目收入按收款人核算。\cite{zhegongdata,zhegongfollow}

上海三例分别提供整体重建、保护修缮成套化和一幢房屋内的混合更新。曹杨八村75至76号组合贴扩建、内部分隔及原址改建，76户、建筑面积2266至3072平方米，匡算2901万元；按改后面积摊算约9443元/平方米，费用构成与杭州报价分别登记。\cite{shmix} 曹杨一村提供保护与厨卫改善，彭一小区提供差异化回搬与产权安排。独立案例报告保存各自方案、优势、决策、缺项和出处。

求是村以已保存的运行与服务资料为基线，前置比较“保留整治＋适老路线＋服务运营”的组合，同时对局部改扩建、分栋拆建及整体更新分别列明所需鉴定、权属、规划和居民资料。市场调查补量价与客群，财务核算补收款主体和经营权，按资料决定哪些候选方式进入下一阶段。

'''

expert = r'''\section{向教师集中确认的五组问题}

原表E01至E15保持待补，优先围绕以下五组问题取得可填写的答案：
\begin{enumerate}
\item 模式与工程：不同鉴定、保护及规划条件下，哪些保留、加固、改扩建或拆建组合可继续研究，何时需要专项论证。
\item 人群与服务：老年及行动受限群体怎样分组，服务边界、共享设施、可达和覆盖分母怎样确定；给出需求参数与采集方法。
\item 市场与经济：选哪些同类价格和租金，如何确认面积处分及经营权；怎样划定各方费用、支付预算、运维自平衡与公共投入。
\item 方案排序：在必要条件明确后，安全、适老、民生、环境、负担和收益怎样比较，哪些权重或门槛由专业判断确认。
\item 缺省与回填：哪些扩展字段通常保留缺省，何种报告结论使它成为必要；明确核实方、采集方式及回填后重算目标。
\end{enumerate}

提供的说明文档模板用于组织作品简介、目标用户、核心功能、技术方案、架构和演示。本轮研究及原型分别对应模式筛选、知识沉淀、收益成本计算、覆盖情景及按需补填，后续可按模板把实际界面和运行记录补入案例展示。

'''

text=TARGET.read_text(encoding='utf-8')
text=text.replace(r'\usepackage{fancyhdr}',r'\usepackage{fancyhdr}'+'\n'+r'\usepackage{pdflscape}')
text=text.replace('六维数据与研判决策说明','模式选择 市场收益与研判决策说明')
text=text.replace(r'\section{材料如何拆分并沉淀}',front+r'\section{材料如何拆分并沉淀}',1)
start=text.index(r'\section{六维数据怎样支持举措选择}')
end=text.index(r'\section{已有规则卡怎样参与专家判断}',start)
text=text[:start]+data_section+text[end:]
text=text.replace(r'\section{案例匹配与 Agent 怎样配合}',economic_section+r'\section{案例匹配与 Agent 怎样配合}',1)
text=text.replace(r'\decision{D1}',r'''\decision{D0}{先生成并比较改造方式组合}
\field{决定}{按逐栋状态、权属保护、规划容量、意愿安置和收益用途形成候选方式，允许保留、改扩建、拆建及运营组件组合。}
\field{原因与依据}{杭州正式意见支持综合整治与部分或全部拆改结合，上海实际项目展示成套化与局部混合方式。\cite{hzmode,shmix}}
\field{采用规则}{MODE-G01至G07及用户规范R014至R024的相关条件；原R001至R027保留其范围、性质和核验状态。}
\field{下一步与更新}{每种方式单列必要条件、经济与覆盖结果；补齐对应关键资料后重算该方式与其他候选。}

\decision{D1}''',1)
text=text.replace('以下十项决定构成该次调用示例的完整清单。','以下十三项决定构成该次调用示例的完整清单，包含前置模式、原十项举措以及市场与覆盖判断。')
text=text.replace(r'\section{方案比较与最终交付}',new_decisions+r'\section{方案比较与最终交付}',1)
text=text.replace(r'\subsection{资金表与版本记录}',case_summary+r'\subsection{资金表与版本记录}',1)
text=text.replace('十项带理由和规则的措施决定','十三项带理由和规则的模式及措施决定')
start=text.index(r'\section{希望教师帮助确认的内容}')
end=text.index(r'\section{现有23条记录逐项对照}',start)
text=text[:start]+expert+text[end:]
refs=r'''\bibitem{renewal2025} 中共中央办公厅、国务院办公厅. 关于持续推进城市更新行动的意见. 2025年5月2日. \href{https://www.mee.gov.cn/zcwj/zyygwj/202505/t20250516_1119546.shtml}{官方全文}.
\bibitem{hzmode} 杭州市人民政府办公厅. 全面推进城镇老旧小区改造工作的实施意见. 杭政办函〔2022〕10号，2022年2月14日. \href{https://zfgb.hangzhou.gov.cn/10/105220253/t117220253054/518761.shtml}{杭州公报全文}.
\bibitem{ndrcfinance} 国家发展改革委. 企业投资项目可行性研究报告编写参考大纲 2023年版. 第六部分. \href{https://www.ndrc.gov.cn/xxgk/zcfb/ghxwj/202304/P020230407401908613786.pdf}{官方PDF}.
\bibitem{zhegongdata} 杭州政协网转载杭州日报. 浙工新村自主更新预算报道. 2024年1月19日. \href{https://www.hzzx.gov.cn/cshz/content/2024-01/19/content_8677402.htm}{原文链接}.
\bibitem{zhegongfollow} 上观新闻. 浙工新村自主更新回访. 2026年8月19日. \href{https://www.jfdaily.com/wx/detail.do?id=1162310}{回访原文}.
\bibitem{shmix} 上海市普陀区发展改革委. 曹杨八村75至76号旧住房成套改造项目批复. 2025年. \href{https://www.shpt.gov.cn/zhengwu/xmjyssp-fgwzdgz/2025/42/194395.html}{批复全文}.
'''
text=text.replace(r'\begin{thebibliography}{9}',r'\begin{thebibliography}{99}')
text=text.replace(r'\end{thebibliography}',refs+r'\end{thebibliography}')
TARGET.write_text(text,encoding='utf-8')
market={'scope':'求是村公开挂牌租金样本','captured_at':'2026-10-12','data_class':'reference','observation_type':'asking_rent','source_url':'https://m.xflapp.com/zufang/neighbor-house-list/hz-7502420061791174656.html','samples':[
 {'rooms':'2室1厅','area_m2':60,'asking_rent_yuan_month':4000,'locator':'页面第3套（网页L10）','lease_signed_rent':None},
 {'rooms':'2室2厅','area_m2':60.25,'asking_rent_yuan_month':4200,'locator':'页面第6套（网页L16）','lease_signed_rent':None},
 {'rooms':'2室1厅','area_m2':66,'asking_rent_yuan_month':3800,'locator':'页面第8套（网页L20）','lease_signed_rent':None}]}
(ROOT/'data/public_cases/qiushi-market-snapshot-20261012.json').write_text(json.dumps(market,ensure_ascii=False,indent=2),encoding='utf-8')
print('Updated authoritative LaTeX: 7 composable physical families, 8 data domains, 13 decisions, two models, user criteria and source/method/rule columns')
