"""Edit the reviewed project explanation in place; keep the original design."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import shutil
from io import BytesIO

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from PIL import Image, ImageDraw, ImageFont


def revise(path: Path, evidence: Path, backup_dir: Path):
    before_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f'{before_hash[:12]}.docx'
    if not backup.exists():
        shutil.copy2(path, backup)
    doc = Document(path)
    nodes = list(doc._element.body)
    # Reject another structure instead of applying indexes to a different revision.
    def text(el):
        return ''.join(x.text or '' for x in el.iter(qn('w:t')))
    assert len(nodes) == 121 and text(nodes[31]) == '1.4 价值体现', 'Unexpected input revision'

    def put(index, value):
        el = nodes[index]
        old = el.find(qn('w:r'))
        props = copy.deepcopy(old.find(qn('w:rPr'))) if old is not None and old.find(qn('w:rPr')) is not None else None
        for child in list(el):
            if child.tag != qn('w:pPr'):
                el.remove(child)
        run = OxmlElement('w:r')
        if props is not None:
            run.append(props)
        item = OxmlElement('w:t'); item.text = value; run.append(item); el.append(run)

    def para(value, style=None, before=None):
        p = doc.add_paragraph(value, style=style)
        p.paragraph_format.space_after = Pt(6)
        if before is not None:
            before.addprevious(p._p)
        return p

    updates = {
        7: '辅助判断一个片区要不要更新、采用什么模式、值不值得投入，以及投入后产生哪些财务与社会收益。工作台将真实公开资料、历史工程和专业条件组织成可回查的依据，比较改造范围、建设资金、服务覆盖与长期维护，为政府和项目团队形成可讨论、可复核的决策方案。',
        17: '版本：v0.4    决策主线更新：2026年10月15日',
        22: '老旧住区更新的首要问题是决策：这个片区是否需要更新，综合整治与原拆原建各适用于哪些对象，投入到什么范围更合算，财务与社会收益由谁获得。工作台先给出总体研判和依据，再展开现况、模式比较、投资及收益，最后安排调查和运营推演。资料不足时明确影响判断的关键缺项，形成取得资料后可以更新的方案。',
        30: '街道拟启动老旧小区更新时，工作人员导入现有资料，先查看更新必要性和模式初判，再比较保留整治、局部拆建与整体重建的工程范围、资金缺口和受益群体。方案表分别列出建设投资、经营现金流与财政投入，以及居民覆盖、设施使用、无障碍和长期维护等公共效果，供社区协商、专业论证及上级审核使用。',
        32: '工作台把分散资料转成可核对的决策依据，使项目团队能够说明“为什么更新、先更新哪里、花多少钱、谁受益”。政府可比较不同范围的财政投入和公共服务改善；实施与运营主体可查看资金来源、现金收支和维护责任；居民的出行、安全和服务需求则落实到具体对象与举措。价值评价已按效率、依据准确性和决策质量设计，并取得求是村原文检索的单例量级。',
        39: '模式判定前置于六维评价。先核对结构适修性、权属规划、居民协商与安置、资金和长期维护，再以居民需求、公共服务、居住工程、实施协同、长效维护、资金交付六维比较现况与方案目标。目标变化与实际观测分别保存；缺少的工程或运营资料转为明确的调查任务。',
        42: '用户主流程：选择片区 → 查看更新必要性与总体方案 → 展开改造模式和现况依据 → 比较投资、财务收益与社会收益 → 调整偏好并查看方案差异 → 安排调查及专业核查 → 最后查看运营推演。原文检索和精准跳转贯穿各环节。',
        48: '方案总览与可交互比较',
        49: '项目展开后，DeepSeek Flash 先概括总体方案及主要举措；用户再查看综合整治与原拆原建的适用条件、支持原文和下一步取证点，切换现况与改后目标的六维对照。建设投资按工程范围计算，财务收支与社会效果分项比较；社区运营推演安排在最后一个子页面。',
        50: '版本比较保留参数、关键举措、核算结果和保存时间；调查页逐项说明对象、采集方法、字段和完成条件。因素政策保存权重与适用范围，可据专业复核调整比较偏好；现阶段需求、排班和补贴已支持连续交互，统一的多目标权重审批面板按同一版本规则接入。权重变化不改变原文事实，也不抵消已确认的安全、权属和保护约束。',
        59: '模型负责解释、程序负责判定。DeepSeek 与 Qwen 复用 DeepSeekHarness 理解资料、关联经验、提出方案并解释支持与反对依据；程序检查来源版本、逐字引文、对象时点、金额单位和必要条件。证据缺失或冲突时，系统给出待核事项，拒绝将模型偏好写成确定性工程结论；已确认的否决条件不能被综合高分抵消。',
        61: '附录A 神经网络造价预测探索',
        62: '该探索检验神经网络在现有数据上的适用性，供后续工程造价研究参考。论文实验属于王宝龙等人的广东研究，本项目另行执行了37条施工中标记录的探索试验与480条七指标合成示例。双隐藏层BP由Adam训练，外层PSO搜索节点数、学习率和正则参数；同一锁定测试集同时比较中位数、岭回归、BP和PSO-BP。',
        63: '公告试验使用建筑面积与工程范围类别，在上海样本训练、广东9条记录独立测试，预测目标为施工中标单方价格。PSO-BP外部测试MAPE为128.77%、R²为−1.6555，现阶段不承担浙江项目预算取值。合成示例锁定测试60条，MAPE为6.28%、R²为0.9452，用于验证按已知机制生成数据后的训练与前向推理流程。主要决策仍采用分阶段同口径造价库与原件参考区间。',
        70: '方案比较围绕同一片区、同一目标和同一价格时点展开。程序分别汇总建设工程、设计检测、安置过渡与长期维护；财务账记录经营收入、购买服务、补贴和费用，公共效益记录居民覆盖、服务使用、便利改善及未满足需求。供审批讨论的对照表保留方案范围、资金主体、主要受益者、关键约束和下一步核查。',
        71: '造价分阶段同口径库与参考区间',
        72: '造价资料分别保存估算、预算、招标控制价、中标价、合同价和结算价，并区分施工、EPC及专项工程。按地区、价格年、金额阶段、工程范围和面积口径筛选，输出同组样本的区间、中位数及原件。例如广州2024年鸿中楼与青年苑两份施工合同按同范围建筑面积折算为308.85和317.78元/平方米，构成该参考组的范围；杭州方案另核工程量与本地价格。神经网络的原理和探索结果见附录A。',
        75: '先核对适用于当前方案的安全、权属权限、保护和专业要求，再比较成本、可支付性与公共效果。历史案例解释可参考因素，专业复核确定权重及适用范围。证据不足时保留条件判断并生成调查任务；权重仅用于可行候选间的偏好比较，不能将未知事实改为满足。',
        76: '评价方案与已取得的自测结果',
        79: '求是村单例自测使用两份已归档公开原文、两个固定问题，核对工程楼幢、户数范围、排除原因和两类工程阶段共五项信息。三处目标片段均进入前五条检索结果，五项均可回查出处；两次本地接口响应合计0.049秒。完整操作计时与条件见附录B。该量级衡量原文定位响应，人工配对评测按表中方法继续开展。',
        84: '前置模式研判连接现况、方案投资与收益比较，所用依据能够回到材料与原文。方案变化保留参数与解释；未解决的条件直接进入调查任务。运营推演用于末端比较投入后的服务能力和持续经营。',
        86: '一是把结论约束落实到程序。模型负责解释、程序负责判定：文本生成不能绕过来源、必要条件和金额检查，证据不足时不给出确定性模式结论。每项建议同时呈现适用对象、支持原文、反对条件及待核事项，使结论可以复核和修订。',
        87: '二是围绕同一决策比较不同更新路径。先判断综合整治、局部拆建或整体重建的适用范围，再按同口径比较投资、资金缺口和长期维护。财政支出、运营收入与居民资产变化分别记账，公共服务收益另列，防止把某一主体的收入当作政府回款。',
        88: '三是把跨文本材料组织成举措证据链。同一工程的供水、电梯、适老通行等事项分别建档，每项举措对照提议、决定、实施和结果。相同提取复用已有记录，不同楼幢、时点和冲突材料保持独立身份，便于解释为何采用或排除某项措施。',
        89: '四是把政策偏好和待核条件分开。专业人员可在因素政策中调整比较权重，运营参数可交互推演，版本中保留变化及结果。安全、权属等硬约束始终单列；最可能改变模式或收益判断的资料被转成有对象、取得方式和完成标准的调查任务。',
        90: '五是让资料积累持续改善决策。Markdown与JSON保留原文、表格、定位、哈希和审核状态；历史工程按阶段与口径积累，真实实施资料回来后更新参数及适用范围，运行版本保留当时依据，支持事后比较原先判断与实际结果。',
        93: '已形成可本地运行的更新辅助决策原型：先展示模式与总体方案，再按原文证据、六维现况、方案投资及收益展开，支持版本比较和下一步调查。已完成浙沪粤历史工程资料导入、官方公告原件归档、求是村举措定位、跨文本经验整理、Markdown／JSON导出及分主体建设和运营核算。',
        96: '真实调研已形成可回查的工程与案例资料，项目判断继续随逐栋鉴定、权属规划、居民协商、资金及运行记录更新。当前原文检索采用BM25排序与来源定位，方案概括由DeepSeek组织；检索后自动问答与统一多目标权重审批面板仍需接入。',
        97: '竞赛周期内难以取得完整住户、逐月经营和竣工档案，因此另设独立模拟社区演示资料齐备时的方案比较与运营报表。数据由人口、空间容量、排班、收费及成本规则计算，建设费用参照带出处的合同量级；所有模拟标识随界面和导出保留，构造概述见附录C。',
        100: '当前提供现场本机演示与受控服务器环境。本机启动后访问http://127.0.0.1:5173；服务器通过获授权的SSH隧道访问http://127.0.0.1:15173。不提供评委通过公网直接访问的入口，代码仓库见封面链接。',
        101: '地图、模型与搜索API需自行配置，或由团队在演示环境预先配置；密钥保存在服务端。已有本机环境可双击“启动工作台.cmd”，新环境按README安装依赖。服务器部署与隧道命令见仓库docs/服务器部署说明.md。',
        102: '演示路径：① 进入求是村，先看总体方案与模式判断；② 展开综合整治和原拆原建的条件、现况及目标；③ 到资料与证据定位原文，查看分阶段同口径造价参考；④ 比较资金投入、财务收支、公共服务收益和版本变化；⑤ 核对下一步调查；⑥ 最后用独立模拟演示运营参数变化与报表。',
        103: '建议演示问题：① 求是村当前适合整治还是拆建，哪些条件会改变判断？② 供水四幢252户属于什么工程范围和报道阶段？③ 某一方案由谁出资、谁取得收入、谁获得公共服务？④ 在不同投入范围或偏好下，方案怎样变化，下一步先查什么？',
        112: '用户提问后可定位对应原文，并对照同一举措在其他报道及研究材料中的不同阶段。对当前更新模式的判断，重点取证逐栋鉴定、权属规划、居民协商、资金和维护安排；供水四幢继续核对施工、验收与接管档案，留博楼单列泵房及后续技术路径。资料变化后更新受影响的方案版本。',
    }
    for index, value in updates.items():
        put(index, value)

    # Move the existing evaluation section to value, keeping its original table design.
    table = next(t for t in doc.tables if t._tbl is nodes[77])
    rows = [
        ('验证对象', '评价方法与状态'),
        ('工作效率', '同资料包、同问题、同答案标准开展人工配对计时；记录正确项、遗漏项及操作次序。'),
        ('原文检索', '单例目标片段Recall@5为3/3；进一步用独立标注问题集检查对象、阶段及时点。'),
        ('引用与知识复用', '评价引用准确率、适用条件匹配与专家修订量；重复转载不增加独立证据数。'),
        ('研判与调查', '评价关键待核项召回、错误推进率与专家修改量；按项目隔离评价材料。'),
        ('计算与工作流', '复算资金和运营台账；记录问题到原文定位、版本比较及调查导出的完成情况。'),
    ]
    for row, values in zip(table.rows, rows):
        for cell, value in zip(row.cells, values):
            cell.text = value
    for i in [76,79,77]:
        nodes[33].addprevious(nodes[i])

    # Real evidence is presented immediately before technical implementation.
    para('已有调研与资料基础', style='Heading 3', before=nodes[45])
    para('团队围绕浙江、上海、广东公共资源交易及地方公开网站整理历史工程，并核对求是村供水、加梯、邻里中心与浙工新村、上海更新案例。补全数据库已导入1277条工程记录，其中浙江1181、上海50、广东46；合同金额字段1146条，竣工结算字段0条。另有27份独立归档的官方原件对应20条价格阶段记录，保留原件、出处与核对信息。两层资料分别登记采集和核验状态，按需逐项回查。', before=nodes[45])

    # Main function table becomes decision-first, without introducing unimplemented controls.
    function_table = next(t for t in doc.tables if t._tbl is nodes[36])
    replacements = {
        1: ('模式与方案总览','选择片区并读取现况、条件与案例。','更新必要性、模式候选、总体举措及下一步取证点。'),
        4: ('现况与改后目标','按六维核对依据、需求与实施条件。','现况、目标变化及支持原文。'),
        5: ('投资与收益比较','筛选同口径造价并核对建设、安置和长期支出。','工程参考区间、资金缺口、财务及社会收益。'),
        6: ('末端运营推演','在独立演示中调整需求、排班与补贴。','服务量、覆盖与利用、运营结余及财政投入。'),
    }
    for i, values in replacements.items():
        for cell, value in zip(function_table.rows[i].cells, values): cell.text=value
    completed = next(t for t in doc.tables if t._tbl is nodes[94])
    completed_values = [
        ('已形成的成果','对应产物与用途'),
        ('真实资料建设','1277条历史工程导入；官方原件27份、价格阶段记录20条；求是村与对标案例可回查。'),
        ('模式及总体方案','模式前置、双路径比较、现况和目标、依据与决策逐项对应。'),
        ('资料检索与经验','原文定位、跨文本举措、Markdown／JSON导出、经验与因素政策。'),
        ('投资与后续调查','分主体核算、版本比较、调查任务；运营完整演示作为辅助。'),
    ]
    for row, values in zip(completed.rows,completed_values):
        for cell,value in zip(row.cells,values):cell.text=value

    # Neural detail is retained at the end as an appendix rather than a headline feature.
    for i in [61,62,63]: doc._element.body.insert(len(doc._element.body)-1,nodes[i])
    para('广东论文的算法设置可作为首轮搜索配置；已训练权重与归一化器并未在PDF中完整提供。工程指数系数按浙江本地依据复核，新增结算与施工条件经审核后重新训练，并保留中位数、岭回归等基线比较。模型、数据划分、随机种子与误差保存在research/training/cost-neural-prototype。')
    para('附录B 求是村单例操作自测',style='Heading 2')
    para('2026年10月15日，自测固定两份已归档公开原文及两个问题，核对五项事实和阶段。两条路径均使用这些原文：逐份查看；工作台定向检索。Codex执行浏览器自动操作，已熟悉答案，采集、解析和服务启动不计入。')
    small=doc.add_table(rows=1,cols=3)
    for c,v in zip(small.rows[0].cells,['测量项','结果','口径']):c.text=v
    values=[('逐份查看路径','8.851秒','五项均完成核对；自动操作'),('工作台检索路径','39.389秒','含一次筛选条件纠正；五项均完成'),('本地检索服务','29.777＋19.498毫秒','两个接口响应；合计49.275毫秒'),('目标片段与信息核对','3/3片段；5/5信息','前五结果找到预先标注的目标原文')]
    for vals in values:
        for c,v in zip(small.add_row().cells,vals):c.text=v
    para('本次记录给出真实响应量级和可追溯结果。两条浏览器路径受操作次序、答案熟悉程度及一次筛选纠正影响，不据此计算人工节时率。后续由团队成员采用同资料包配对计时，平衡操作次序，同时记录正确率与遗漏率。详细记录：research/test_results/decision-value-selftest-20261015.json。')
    para('附录C 模拟数据构造概述',style='Heading 2')
    para('模拟社区设600户、1500人及45000平方米，用人口与名册规则构造需求，以空间席位、开放排班和人员容量约束服务量，再按收费、固定及变动成本计算收支。建设预算取同口径合同量级设定，安置等参数按情景单列。模拟服务台账按场次与居民编号生成，可复算人次和去重人数；真实数据到来后替换对应输入。演示数据始终保留模拟身份，用于展示完整工作流。')

    # Update the retained architecture image to match the decision-first narrative.
    canvas=Image.new('RGB',(1800,1030),'white'); draw=ImageDraw.Draw(canvas)
    heading=ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc',35)
    body=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',29)
    def box(x,y,w,h,title,lines):
        draw.rounded_rectangle((x,y,x+w,y+h),12,fill='#F7F8FA',outline='#567277',width=3)
        draw.text((x+24,y+18),title,font=heading,fill='#162E32')
        for j,line in enumerate(lines):draw.text((x+24,y+77+43*j),line,font=body,fill='#253D41')
    def arrow(x1,y1,x2,y2):
        draw.line((x1,y1,x2,y2),fill='#567277',width=4)
        draw.polygon([(x2,y2),(x2-10,y2-19),(x2+10,y2-19)],fill='#567277')
    box(50,25,1700,170,'决策目标',['要不要更新   采用什么模式   值不值得投   财务与社会收益是什么'])
    box(50,265,520,230,'真实资料与历史工程',['公开原件 对象 阶段与时点','同口径造价库与参考区间','跨文本举措与案例规则'])
    box(640,265,520,230,'模型解释与方案比较',['理解问题 关联案例与反证','综合整治与原拆原建','六维现况与目标变化'])
    box(1230,265,520,230,'程序判定与确定性计算',['来源 引文 必要条件检查','建设 安置 财务与财政分账','证据不足保留条件判断'])
    box(280,580,1240,185,'总体方案与投入收益对照',['范围与关键举措   资金缺口   财务收支   公共服务效果','偏好调整保留版本   安全与权属硬约束独立生效'])
    box(50,850,760,150,'下一步调查与更新',['核对对象 取得方式 完成条件 → 修订方案'])
    box(940,850,810,150,'末端运营演示',['真实输入持续回流   模拟仅展示完整流程'])
    arrow(900,195,900,265);arrow(900,495,900,580);arrow(430,765,430,850);arrow(1345,765,1345,850)
    image_bytes=BytesIO();canvas.save(image_bytes,format='PNG')
    blips=nodes[82].xpath('.//a:blip')
    if blips:doc.part.related_parts[blips[0].get(qn('r:embed'))]._blob=image_bytes.getvalue()

    # Replace fragile empty hard-break paragraphs with heading-based pagination.
    for p in doc.paragraphs:
        for br in list(p._p.iter(qn('w:br'))):
            if br.get(qn('w:type'))=='page':br.getparent().remove(br)
        if p.text in ['1 背景与场景','附录A 神经网络造价预测探索']:
            p.paragraph_format.page_break_before=True
        if p.style.name.startswith('Heading'):
            for r in p.runs:r.font.color.rgb=RGBColor(0,0,0)
    past_cover=False
    for p in list(doc.paragraphs):
        if p.text=='1 背景与场景':past_cover=True
        if past_cover and not p.text.strip() and not p._p.xpath('.//w:drawing'):
            p._p.getparent().remove(p._p)

    # Keep the existing design, but enforce readable table geometry on new/rewritten cells.
    for table in doc.tables:
        for row_i,row in enumerate(table.rows):
            for cell in row.cells:
                cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
                tcPr=cell._tc.get_or_add_tcPr()
                borders=tcPr.find(qn('w:tcBorders'))
                if borders is None: borders=OxmlElement('w:tcBorders');tcPr.append(borders)
                for edge in ['top','left','bottom','right','insideH','insideV']:
                    node=borders.find(qn('w:'+edge))
                    if node is None:node=OxmlElement('w:'+edge);borders.append(node)
                    node.set(qn('w:val'),'single');node.set(qn('w:sz'),'4');node.set(qn('w:color'),'D9D9D9')
                for p in cell.paragraphs:
                    p.paragraph_format.keep_with_next=False
                    for run in p.runs:
                        if run.font.size is None:run.font.size=Pt(10.5)
            row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
        table.rows[0]._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
        for cell in table.rows[0].cells:
            for p in cell.paragraphs:p.paragraph_format.keep_with_next=True
        for cell in table.rows[0].cells:
            shade=cell._tc.get_or_add_tcPr().find(qn('w:shd'))
            if shade is None:shade=OxmlElement('w:shd');cell._tc.get_or_add_tcPr().append(shade)
            shade.set(qn('w:fill'),'E8EDF1')
            for p in cell.paragraphs:
                for r in p.runs:r.font.color.rgb=RGBColor(0,0,0);r.bold=True
    for style in doc.styles:
        if style.type==1 and (style.name.startswith('Heading') or style.name in ['Title','Subtitle']):
            style.font.color.rgb=RGBColor(0,0,0)
            for color in style.element.iter(qn('w:color')):
                color.attrib.clear();color.set(qn('w:val'),'000000')
    doc.save(path)
    receipt={'path':str(path),'before_sha256':before_hash,'after_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'backup':str(backup),'changed_original_nodes':sorted(updates),'evidence':str(evidence),'structure':'decision-first main; evaluation in 1.4; neural/simulation methods in appendices'}
    (backup_dir/'revision.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False,indent=2))


if __name__=='__main__':
    cli=argparse.ArgumentParser();cli.add_argument('document',type=Path);cli.add_argument('--evidence',type=Path,default=Path('research/test_results/decision-value-selftest-20261015.json'));cli.add_argument('--backup-dir',type=Path,default=Path('.cache/decision-report-edit'));args=cli.parse_args()
    revise(args.document,args.evidence,args.backup_dir)
