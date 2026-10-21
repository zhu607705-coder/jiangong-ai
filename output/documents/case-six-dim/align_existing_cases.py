import json
from pathlib import Path

TASK = Path('D:/建工ai/output/documents/case-six-dim')
SOURCE = Path('D:/建工ai/docs/老旧小区改造案例拆分与六维数据说明.tex')
library = json.loads((TASK / 'current-case-library.json').read_text(encoding='utf-8'))
cards = [card for record in library['records'] for card in record['cards']]
assert len(cards) == 23 and len({c['id'] for c in cards}) == 23

rules = r'''\section{已有规则卡怎样参与专家判断}

\subsection{逐张规则卡对应到案例和措施}

现有公开资料库已经保存四张规则卡。下面按原卡解释其内容和求是村的使用位置，R1至R4是本文的讲述编号。教师复核时，在这些已有条目上确认适用场景、必要条件、比较因素和参数，并保存对应原文位置。

\begin{longtable}{@{}L{12mm}L{37mm}L{64mm}L{40mm}@{}}
\toprule
\textbf{规则} & \textbf{原卡与依据} & \textbf{怎样转为判断条件} & \textbf{案例与决定}\\
\midrule
\endfirsthead
\toprule
\textbf{规则} & \textbf{原卡与依据} & \textbf{怎样转为判断条件} & \textbf{案例与决定}\\
\midrule
\endhead
R1 & C21居民自愿；政策原文。 & 明确具体事项的参与主体、需求、受益和影响，保存协商过程与方案回应；教师确认调查和协商的组织尺度。 & C03托管协商、C13服务对象、翠苑沟通；D3、D6、D7、D9。\\
R2 & C22基础类；政策中的改造内容。 & 把供水、道路及相关基础设施问题对应到措施；结合检测、工程位置与接口选择处理方式。教师确认轻重缓急和专业前置条件。 & C14四幢供水、C01泵房、C17道路；D4、D5、D8、D9。\\
R3 & C19长效管理；建管衔接原文。 & 设施措施同时确定接收、服务责任、维护费用、故障与交接。教师确认维护条件怎样影响方案选择。 & C03托管、C07费用、C13服务；D2、D4、D7、D10。\\
R4 & C16 AIPA；论文矩阵与关联全文。 & 从居民需求与满意度因素研究优先顺序，确定本地调查项、群体差异和比较方法。教师确认因素、采集方法及分析参数。 & C13邻里服务、C17道路、C20绿化；D6、D7、D8及措施排序。\\
\bottomrule
\end{longtable}

\textbf{R1的具体使用。}电梯托管卡C03记载多方协商，居民参与卡C21保存政策中的参与原则。两条记录对照后，求是村调查可按单元或具体服务事项登记参与者、意见、费用和方案回应，形成D3的协商与设计比较。\cite{trust,policy}

\textbf{R2的具体使用。}供水卡C14已有楼幢与户数，C01关联特殊泵房条件；基础类卡C22提供措施分类入口。教师把供水安全可靠、设施现状和工程适用条件落实到具体对象，形成D4与D5的不同调查路径。\cite{water,policy}

\textbf{R3的具体使用。}托管卡C03保存管理决定，C07保存费用与协议描述，长效管理卡C19给出建管衔接依据。三者共同转成管理主体、服务内容、运行费用及责任交接的规则字段，形成D2和D10。\cite{trust,policy}

\textbf{R4的具体使用。}C16已保存AIPA方法入口。读取关联论文后，教师选择求是村的具体调查属性，将居民对出行、设施和服务的评价与现状共同用于措施排序，形成D6、D7的研究安排。\cite{paper}

\subsection{程序检查与教师补充的专业判准}

程序另执行三组检查：G1核对对象、来源、时间与阶段；G2检查方案的工程安全、实施权利与保护条件；G3核对工程量、单位、费用、资金状态和计算。进入专项调查前，现有程序核对居民需求、工程评审、服务缺口、实施协同、资金、维护以及规则七项确认，保存触发条件和证据。

教师可在四张规则入口上补充连续出行路径、服务覆盖、专业工程条件和分期接口等具体判准。例如，沿户门至服务入口记录路线断点；用开放时段、到达和容量判断服务调整；以泵房图和专业意见比较供水路径。每项专业判准连接对应案例、检查方法和参数。

项目行动分为开展专项调查、补齐指定资料和暂缓指定方案。规则卡负责说明适用条件，程序执行确认与计算，Agent解释多维条件怎样共同改变措施选择。

'''

text = SOURCE.read_text(encoding='utf-8')
start = text.index(r'\section{专家规则怎样形成并参与判断}')
end = text.index(r'\section{案例匹配与 Agent 怎样配合}', start)
text = text[:start] + rules + text[end:]

updates = {
    'R2对象与阶段一致；R9按条件匹配经验。': 'G1对象与阶段检查；案例C14、C23提供范围与对象入口。',
    'R6建设维护共同安排；R7费用对应具体事项。': 'R3长效管理（C19）；G3费用检查；案例C03、C07。',
    'R1专业条件先行；R3居民差异；R6后续维护。': 'R1居民参与（C21）、R3长效管理（C19）；G2专业条件；案例C03、C07。',
    'R2阶段一致；R6接管与维护；R8施工接口。': 'R2基础类（C22）、R3长效管理（C19）；G1阶段；案例C12、C14。',
    'R1专业条件先行；R2对象差异；R9迁移条件。': 'R2基础类（C22）；G1对象差异、G2专业条件；案例C01与对应供水原文。',
    'R3居民差异；R4连续出行；R1工程与空间条件。': 'R1居民参与（C21）、R4调查排序（C16）；连续路径专业判准；案例C13、C17、C20。',
    'R5存量服务优先比较；R3群体差异；R6持续运行。': 'R1居民参与、R3长效管理、R4调查排序；案例C13邻里中心及关联原文。',
    'R1专业条件；R3群体影响；R4连续路径；R8工程接口。': 'R2基础设施、R4调查排序；G2专业检查；案例C17道路、C20绿化及C13服务到达。',
    'R8接口决定分期；R2阶段一致；R9条件匹配。': 'R2基础类、R1居民参与；G1阶段；案例C17、C18、C20及C23共同工程背景。',
    'R6建管衔接；R7措施与投入对应；R3居民负担。': 'R3长效管理（C19）；G3投入与资金计算；案例C07费用、C03维护决定。',
    'R1专业条件先行；R3居民差异；R6后续维护': 'R1居民参与；R3长效管理；G2专业条件',
}
for old, new in updates.items():
    if old.endswith('后续维护'):
        continue
    assert old in text, old
    text = text.replace(old, new)

details = [
    ('背景、提议及泵房位置因素', '居住工程；D4、D5'),
    ('背景、费用提议及因素', '协同、维护、资金；D2、D3、D10'),
    ('决策问题、背景、实际决定、反馈', '协同、维护、需求；D2、D3、D10'),
    ('背景片段，关联同文维护描述', '长效维护；D2'),
    ('背景片段，关联同文电梯描述', '居住工程、维护；D2'),
    ('三方治理背景', '实施协同；D2、D3'),
    ('托管费用、协议、管理细则条件', '资金、维护；D2、D10'),
    ('背景及区位因素', '居住工程；D1、D4'),
    ('背景、加压说明及区位因素', '居住工程、需求；D4'),
    ('背景及区位因素', '居住工程；D1、D4'),
    ('背景片段，关联同文工程说明', '实施协同；D4'),
    ('踏勘、外审提议及区位因素', '协同、工程；D4、D5'),
    ('启用背景、公共服务描述', '需求、公共服务；D6、D7'),
    ('29、30、31、48幢及252户因素', '对象、居住工程；D1、D4'),
    ('背景及区位因素', '居住工程；D1、D4'),
    ('决策依据：AIPA方法入口', '规则R4；D6、D7及排序'),
    ('道路实施字段与共同工程背景', '工程、协同；D6、D8、D9'),
    ('外墙实施字段与共同工程背景', '工程、资金；D1、D9、D10'),
    ('提议字段：长效管理政策原文', '规则R3；D2、D4、D7、D10'),
    ('绿化实施字段与共同工程背景', '服务、工程、维护；D6、D8'),
    ('提议字段：居民参与政策原文', '规则R1；D3、D6、D7、D9'),
    ('提议字段：基础类政策原文', '规则R2；D4、D5、D8、D9'),
    ('实施字段：54栋住宅、8幢公建', '工程范围；D1、D9'),
]
assert cards[13]['id'].startswith('EXP-8fb43037')
assert cards[15]['id'].startswith('EXP-2c88cc20')
assert cards[18]['id'].startswith('EXP-6baff473')
assert cards[20]['id'].startswith('EXP-c48118fa')
assert cards[21]['id'].startswith('EXP-e1688c4c')

def escape(value):
    for a,b in [('\\',r'\textbackslash{}'),('&',r'\&'),('%',r'\%'),('_',r'\_'),('#',r'\#')]:
        value = value.replace(a,b)
    return value

appendix = [r'\section{现有23条记录逐项对照}',
    'C编号对应本次读取的原卡，短ID取原卡唯一编号的首段。已有字段列依据当前保存内容填写；六维和D编号是本文的讲述对应。各条记录的完整ID保存在LaTeX源文件的表格注释中。',
    r'{\small',
    r'\begin{longtable}{@{}L{29mm}L{36mm}L{56mm}L{32mm}@{}}',
    r'\toprule',
    r'\textbf{编号与短ID} & \textbf{原卡题名} & \textbf{已有字段与材料位置} & \textbf{对应用途}\\',
    r'\midrule',r'\endfirsthead',r'\toprule',
    r'\textbf{编号与短ID} & \textbf{原卡题名} & \textbf{已有字段与材料位置} & \textbf{对应用途}\\',
    r'\midrule',r'\endhead']
index = []
for n,(card,(detail,target)) in enumerate(zip(cards,details),1):
    label = f'C{n:02d}'
    short = '-'.join(card['id'].split('-')[:2])
    title = card['title']
    if n == 7:
        title = '托管费用、协议与管理细则（原卡长题名）'
    if n == 16:
        title = '居民满意度论文 AIPA（原卡英文题名）'
    appendix.append('% '+label+' full_id='+card['id']+' original_title='+card['title'])
    appendix.append(r'\hypertarget{'+card['id']+'}{'+label+r'}\newline\texttt{'+short+'} & '+escape(title)+' & '+escape(detail)+' & '+escape(target)+r'\\')
    index.append({'label':label,'id':card['id'],'title':card['title'],'status':card['status'],
        'existing_fields':[f['key'] for f in card['fields'] if f['value']],
        'narrative_mapping':detail,'dimensions_and_decisions':target})
appendix.extend([r'\bottomrule',r'\end{longtable}',r'}',''])
appendix_path = SOURCE.parent / '现有案例逐项对照.tex'
appendix_path.write_text('\n'.join(appendix),encoding='utf-8')
text = text.replace(r'\begin{thebibliography}{9}', r'\input{现有案例逐项对照.tex}'+'\n\n'+r'\begin{thebibliography}{9}')
SOURCE.write_text(text,encoding='utf-8')
(TASK / 'case-card-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding='utf-8')
print('Aligned 23 saved records, four existing rule cards and D1-D10 decisions')
