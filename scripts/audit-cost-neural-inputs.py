"""Read-only admission audit of a procurement workbook for the supplied PSO-BP task.

Run with openpyxl installed; no training, imputation or source verification is inferred.
"""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from openpyxl import load_workbook


def audit(workbook_path: Path):
    workbook = load_workbook(workbook_path, data_only=True, read_only=True)
    sheet = workbook['历史工程']
    values = iter(sheet.values)
    headers = list(next(values))
    rows = [dict(zip(headers, row)) for row in values if row and row[0] is not None]
    workbook.close()
    present = lambda field: sum(row.get(field) is not None and str(row[field]).strip() != '' for row in rows)
    amounts = ['合同金额_元', '正式中标金额_元', '控制价_元', '建安估算概算_元', '项目总投资或概算_元', '竣工结算金额_元']
    available = {field: present(field) for field in amounts + ['建筑面积_㎡', '合同期限_天', '招标或中标工期_天', '建设年代原文', '金额公告URL', '同口径单方_元每㎡']}
    positive = lambda row, field: isinstance(row.get(field), (int, float)) and row[field] > 0
    labels = [row for row in rows if positive(row, '竣工结算金额_元') and positive(row, '建筑面积_㎡')]
    feature_contract = [
        {'key':'X1','name':'改造内容','unit':'元/㎡','definition':'分部分项招标控制实体费用/建筑面积','available':'尚无分部分项实体费用字段；控制价总额不能直接代替'},
        {'key':'X2','name':'改造深度','unit':'指数','definition':'六类改造子系统覆盖度按估算指标权重汇总','available':'有改造内容文本，缺少各子系统可核实覆盖度与当地权重'},
        {'key':'X3','name':'施工条件','unit':'指数','definition':'道路最小宽度与临时堆放面积组合','available':'没有道路最小宽度、临时堆放面积及理论临时面积字段'},
        {'key':'X4','name':'使用年限','unit':'年','definition':'预测基准年减建设年份','available':f'建设年代原文{present("建设年代原文")}条，尚需明确年份及基准时点'},
        {'key':'X5','name':'建筑面积','unit':'㎡','definition':'与造价分子同工程范围的建筑面积','available':f'建筑面积{present("建筑面积_㎡")}条；需逐条核实分子分母范围'},
        {'key':'X6','name':'其他费用','unit':'元/㎡','definition':'同一工程其他费用/建筑面积','available':'缺少同范围的其他费用字段'},
        {'key':'X7','name':'工期','unit':'天','definition':'预测时点可取得的约定工期','available':f'招标或中标工期{present("招标或中标工期_天")}条，合同期限{present("合同期限_天")}条；分别保留来源'},
    ]
    return {
        'audit_date':'2026-10-14','source_file_name':workbook_path.name,
        'source_sha256':hashlib.sha256(workbook_path.read_bytes()).hexdigest(),
        'sheet':'历史工程','data_rows':len(rows),'header_count':len(headers),
        'regions':dict(Counter(row['省级地区'] for row in rows)),
        'project_or_notice_ids':len({row['项目或报建编号'] for row in rows if row.get('项目或报建编号')}),
        'column_presence':available,'contract_modes':dict(Counter(row['发包模式'] for row in rows if positive(row,'合同金额_元'))),
        'paper':{'doi':'10.13991/j.cnki.jem.2026.03.022','target':'EPC竣工单方成本，元/㎡','inputs':feature_contract},
        'positive_settlement_and_building_area_rows':len(labels),
        'training_admission':'blocked_missing_labels_and_features',
        'admission_reasons':['竣工结算标签缺失','分部分项费用、覆盖度、施工条件和其他费用未齐','价格阶段、工程范围、面积、价格年须逐项核对','论文未提供完整原始训练表、网络权重与归一化器'],
        'verification_scope':'工作簿只读字段统计；本次没有逐条重新核验148条公告。表内已核验字样不等于本次验证。',
        'source_preserved':True,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('workbook',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    result = audit(args.workbook)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'rows':result['data_rows'],'regions':result['regions'],'labels':result['positive_settlement_and_building_area_rows'],'admission':result['training_admission'],'sha256':result['source_sha256']},ensure_ascii=False))
