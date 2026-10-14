"""Freeze an explicitly synthetic seven-input dataset and a declared-price workbook experiment."""
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
RUN=ROOT/'research/training/cost-neural-prototype'
SEED=20261014
FIELDS=[
 {'id':'entity_unit','label':'分部分项实体费用单价','unit':'元/㎡','min':250,'max':1800,'step':10,'default':900},
 {'id':'depth','label':'改造系统覆盖率','unit':'%','min':20,'max':100,'step':1,'default':75},
 {'id':'condition','label':'施工条件指数','unit':'指数','min':30,'max':100,'step':1,'default':70},
 {'id':'age','label':'使用年限','unit':'年','min':15,'max':50,'step':1,'default':30},
 {'id':'area','label':'建筑面积','unit':'㎡','min':1000,'max':60000,'step':500,'default':18000},
 {'id':'other_unit','label':'其他费用单价','unit':'元/㎡','min':15,'max':150,'step':5,'default':50},
 {'id':'days','label':'工期','unit':'天','min':30,'max':360,'step':5,'default':120},
]
SCOPE=['roof_and_related_facilities','exterior_wall_finishes','sanitary_facilities_upgrade','comprehensive_renovation','unknown']

def save(name,data):
 path=RUN/name; path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 return hashlib.sha256(path.read_bytes()).hexdigest()

def prepare():
 rng=np.random.default_rng(SEED)
 synthetic=[]
 for index in range(480):
  x=[float(rng.uniform(field['min'],field['max'])) for field in FIELDS]
  entity,depth,condition,age,area,other,days=x
  multiplier=1+.05+.10*depth/100+.15*(100-condition)/100+.003*(age-30)+.06*np.sqrt(1000/area)+.025*np.sqrt(days/120)
  noise=float(rng.normal(0,.08*(entity+other)))
  y=max(50,entity*multiplier+other+noise)
  synthetic.append({'id':f'SYN-{index+1:04d}','group':f'SYN-{index+1:04d}','x':x,'y':float(y),'data_kind':'synthetic','province':'模拟','scope':'epc_example'})
 # Every target is generated before the role split. Noise includes unobserved variation.
 roles=['train']*300+['development']*60+['replacement_gate']*60+['locked_final_audit']*60
 for row,role in zip(synthetic,roles): row['role']=role
 audit=json.loads((ROOT/'data/imports/cost-training-feasibility-20261014.json').read_text(encoding='utf-8'))
 raw=audit['cohorts']['winning_bid|construction|building_floor_area']['samples']
 local=[row for row in raw if row['province']=='上海']; external=[row for row in raw if row['province']=='广东']
 rng=np.random.default_rng(SEED); order=rng.permutation(len(local))
 assigned={local[int(i)]['case_id']:('train' if position<20 else 'development' if position<24 else 'replacement_gate') for position,i in enumerate(order)}
 workbook=[]
 for row in local+external:
  area=row['building_floor_area_m2']
  workbook.append({'id':row['case_id'],'group':row['project_group'],'x':[float(np.log(area))]+[int(row['scope_category']==scope) for scope in SCOPE],
   'y':row['target_yuan_per_building_m2'],'role':assigned.get(row['case_id'],'locked_final_audit'),'data_kind':'workbook_unverified',
   'province':row['province'],'scope':row['scope_category'],'building_area':area,'price_year':row['price_year'],'excel_row':row['excel_row'],
   'project_name':row['project_name'],'amount_url':row['amount_url'],'scale_url':row['scale_url'],'scope_match':row['scope_match_statement']})
 assert len(workbook)==37 and len({row['group'] for row in workbook})==37
 datasets={
  'synthetic':{'kind':'synthetic','target':'合成EPC单方成本示例','fields':FIELDS,'rows':synthetic,'target_formula':'entity * (1+.05+.10*depth/100+.15*(100-condition)/100+.003*(age-30)+.06*sqrt(1000/area)+.025*sqrt(days/120)) + other + N(0,.08*(entity+other))，最低50元/㎡','note':'生成假设，用于训练与预测工作流展示；不是实际结算。'},
  'workbook':{'kind':'workbook_unverified','target':'施工中标金额按受益建筑面积摊算','feature_names':['log_building_area']+SCOPE,'rows':workbook,
    'source_sha256':audit['sources']['sha256']['workbook'],'note':'工作簿公告线索；本次未重新逐条核验37条原公告。工程范围类别进入特征，未知保留unknown；工期、户数、楼栋大面积缺失或时点不明，未入模。上海训练/开发，广东仅外部检验；价格年、地区与工程范围差异共同存在，浙江有效性尚无验证。'}
 }
 fingerprints={name:save(f'{name}-dataset.json',data) for name,data in datasets.items()}
 surfaces={role:[{'id':f'{name}/{role}','fingerprint':'sha256:'+hashlib.sha256(json.dumps([row for row in data['rows'] if row['role']==role],sort_keys=True,ensure_ascii=False).encode()).hexdigest()} for name,data in datasets.items()] for role in ['train','development','replacement_gate','locked_final_audit']}
 save('data-contract.json',{'seed':SEED,'dataset_fingerprints':fingerprints,'surfaces':surfaces,'split_counts':{name:{role:sum(row['role']==role for row in data['rows']) for role in surfaces} for name,data in datasets.items()},'selection':'development only','external_feedback_used_for_search':False,'production_promotion':False})
 print(json.dumps({'datasets':fingerprints,'splits':{name:{role:sum(row['role']==role for row in data['rows']) for role in surfaces} for name,data in datasets.items()}},ensure_ascii=False))

if __name__=='__main__': prepare()
