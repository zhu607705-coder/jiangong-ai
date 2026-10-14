"""Bounded CPU PSO/BP demonstration; workbook and synthetic evidence remain separate."""
import os
os.environ['OPENBLAS_NUM_THREADS']='2'; os.environ['OMP_NUM_THREADS']='2'; os.environ['MKL_NUM_THREADS']='2'
import argparse
import ctypes
import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np
from cost_neural_model import fit_network, predict_network

ROOT=Path(__file__).resolve().parents[1]
RUN=ROOT/'research/training/cost-neural-prototype'
SEED=20261014

def sha(path): return 'sha256:'+hashlib.sha256(path.read_bytes()).hexdigest()
def save(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 temporary=path.with_suffix('.tmp')
 temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8'); temporary.replace(path)
def event(kind,**data):
 with (RUN/'ledger.jsonl').open('a',encoding='utf-8') as stream: stream.write(json.dumps({'event':kind,'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),**data},ensure_ascii=False,allow_nan=False)+'\n')
def metrics(y,prediction):
 if not np.isfinite(prediction).all() or np.any(prediction<=0): raise ValueError('Nonfinite or nonpositive prediction')
 error=prediction-y
 return {'n':len(y),'mae':float(np.mean(np.abs(error))),'rmse':float(np.sqrt(np.mean(error**2))),'mape':float(np.mean(np.abs(error)/y)*100),'r2':None if np.sum((y-y.mean())**2)==0 else float(1-np.sum(error**2)/np.sum((y-y.mean())**2))}
def rss_mib():
 if os.name!='nt':
  import resource
  return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
 class Counters(ctypes.Structure):
  _fields_=[('cb',ctypes.c_ulong),('PageFaultCount',ctypes.c_ulong),('PeakWorkingSetSize',ctypes.c_size_t),('WorkingSetSize',ctypes.c_size_t),('QuotaPeakPagedPoolUsage',ctypes.c_size_t),('QuotaPagedPoolUsage',ctypes.c_size_t),('QuotaPeakNonPagedPoolUsage',ctypes.c_size_t),('QuotaNonPagedPoolUsage',ctypes.c_size_t),('PagefileUsage',ctypes.c_size_t),('PeakPagefileUsage',ctypes.c_size_t)]
 counters=Counters(); counters.cb=ctypes.sizeof(counters)
 kernel=ctypes.WinDLL('kernel32',use_last_error=True); api=ctypes.WinDLL('psapi',use_last_error=True)
 kernel.GetCurrentProcess.restype=ctypes.c_void_p
 api.GetProcessMemoryInfo.argtypes=[ctypes.c_void_p,ctypes.POINTER(Counters),ctypes.c_ulong]
 api.GetProcessMemoryInfo.restype=ctypes.c_int
 handle=kernel.GetCurrentProcess()
 if not api.GetProcessMemoryInfo(handle,ctypes.byref(counters),counters.cb): raise ctypes.WinError(ctypes.get_last_error())
 return counters.PeakWorkingSetSize/1024**2

def train_dataset(name,dataset,deadline):
 roles={role:[row for row in dataset['rows'] if row['role']==role] for role in ['train','development','replacement_gate','locked_final_audit']}
 all_groups=[row['group'] for row in dataset['rows']]
 if len(set(all_groups))!=len(all_groups): raise ValueError('Project groups overlap')
 x=np.array([row['x'] for row in roles['train']]); y=np.array([row['y'] for row in roles['train']])
 dx=np.array([row['x'] for row in roles['development']]); dy=np.array([row['y'] for row in roles['development']])
 median={'kind':'median','value':float(np.median(y))}
 # Ridge baseline and all scalers see fitting rows only.
 mean=x.mean(axis=0); std=np.maximum(x.std(axis=0),1e-8)
 design=np.column_stack([np.ones(len(x)),(x-mean)/std]); penalty=np.eye(design.shape[1]); penalty[0,0]=0
 coefficients=np.linalg.solve(design.T@design+penalty,design.T@np.log(y))
 ridge={'kind':'ridge','mean':mean.tolist(),'std':std.tolist(),'coefficients':coefficients.tolist()}
 bp=fit_network(x,y,[10,5],.01,.001,500,SEED,deadline=deadline)
 best_model=None; best_value=float('inf'); best_parameters=None
 rng=np.random.default_rng(SEED); lower=np.array([6,-3,-5.]); upper=np.array([16,math.log10(.04),-2.])
 positions=rng.uniform(lower,upper,size=(5,3)); positions[0]=[10,-2,-3]
 velocities=np.zeros_like(positions); personal=positions.copy(); scores=np.full(5,np.inf); leader=positions[0].copy()
 trials=[]
 for generation in range(5):
  for particle in range(5):
   width=int(round(positions[particle,0])); rate=float(10**positions[particle,1]); l2=float(10**positions[particle,2])
   model=fit_network(x,y,[width,max(3,width//2)],rate,l2,500,SEED,deadline=deadline)
   prediction=predict_network(model,dx); score=float(np.mean((np.log(prediction)-np.log(dy))**2))
   trial={'dataset':name,'generation':generation,'particle':particle,'hidden':[width,max(3,width//2)],'learning_rate':rate,'l2':l2,'development_log_mse':score}
   trials.append(trial); event('trial',**trial)
   if score<scores[particle]: scores[particle]=score;personal[particle]=positions[particle].copy()
   if score<best_value: best_value=score;leader=positions[particle].copy();best_model=model;best_parameters=trial
  inertia=.9-.5*generation/4
  velocities=inertia*velocities+1.7*rng.random(positions.shape)*(personal-positions)+1.5*rng.random(positions.shape)*(leader-positions)
  positions=np.clip(positions+velocities,lower,upper)
  save(RUN/'cycle-state.json',{'status':'running','dataset':name,'generation':generation,'best_development_log_mse':best_value,'pid':os.getpid()})
  if rss_mib()>512: raise MemoryError('512 MiB RAM budget exceeded')
 models={'median':median,'ridge':ridge,'bp':bp,'pso_bp':best_model}
 def predict(model,features):
  if model.get('kind')=='median': return np.full(len(features),model['value'])
  if model.get('kind')=='ridge': return np.exp(np.column_stack([np.ones(len(features)),(features-mean)/std])@coefficients)
  return predict_network(model,features)
 reports={}; paired=[]
 for role,rows in roles.items():
  features=np.array([row['x'] for row in rows]); target=np.array([row['y'] for row in rows])
  predictions={key:predict(model,features) for key,model in models.items()}
  reports[role]={key:metrics(target,value) for key,value in predictions.items()}
  if role=='locked_final_audit':
   paired=[{'id':row['id'],'group':row['group'],'province':row['province'],'scope':row['scope'],'observed':row['y'],'predicted':float(predictions['pso_bp'][i]),'baseline':float(predictions['median'][i])} for i,row in enumerate(rows)]
 # Confirm persisted JSON weights reproduce exactly, including untouched audit rows.
 save(RUN/f'{name}-pso-bp-model.json',best_model)
 reloaded=json.loads((RUN/f'{name}-pso-bp-model.json').read_text(encoding='utf-8'))
 audit_x=np.array([row['x'] for row in roles['locked_final_audit']])
 np.testing.assert_array_equal(predict_network(reloaded,audit_x),predict_network(best_model,audit_x))
 default=[field['default'] for field in dataset['fields']] if name=='synthetic' else dataset['rows'][0]['x']
 predictions_default=float(predict_network(reloaded,[default])[0])
 bounds=[{'min':float(x[:,i].min()),'max':float(x[:,i].max())} for i in range(x.shape[1])]
 return {'kind':dataset['kind'],'target':dataset['target'],'note':dataset['note'],'model':reloaded,'baseline':median,'best_parameters':best_parameters,'split_counts':{role:len(rows) for role,rows in roles.items()},'metrics':reports,'audit_predictions':paired,'default_inputs':default,'default_prediction':predictions_default,'fields':dataset.get('fields',[]),'feature_names':dataset.get('feature_names',[]),'training_bounds':bounds,'trials':len(trials),'artifact_reload_exact':True,'scope_categories_seen_in_training':sorted({row['scope'] for row in roles['train']}),'holdout_use':'one evaluation after development selection; no feedback used for search','promotion':'trial_keep_only_no_production_use'}

def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--manifest',type=Path,required=True); args=parser.parse_args()
 manifest=json.loads(args.manifest.read_text(encoding='utf-8'))
 if manifest['status']!='preflighted' or manifest['promotion']['deploy_allowed']: raise ValueError('Validated preflight contract with no deployment required')
 if manifest['candidate']['code_fingerprints']['training_script']!=sha(Path(__file__)) or manifest['candidate']['code_fingerprints']['bp_core']!=sha(ROOT/'scripts/cost_neural_model.py'): raise ValueError('Training source changed after preflight')
 started=time.monotonic(); deadline=started+manifest['budget']['wall_time_minutes']*60
 lease=RUN/'lease.json'
 if lease.exists(): raise RuntimeError('Existing cost trial lease must be reconciled before launch')
 save(lease,{'pid':os.getpid(),'owner':'root/cost-neural-prototype','started_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'cpu_threads':2,'gpu_used':False})
 event('start',manifest_sha256=sha(args.manifest),pid=os.getpid(),device='CPU',threads=2)
 try:
  result={}
  for name in ['synthetic','workbook']:
   path=RUN/f'{name}-dataset.json'
   if sha(path)!=manifest['dataset_fingerprints'][name]: raise ValueError('Dataset changed after preflight')
   result[name]=train_dataset(name,json.loads(path.read_text(encoding='utf-8')),deadline)
  receipt={'schema_version':'cost-neural-prototype/1','seed':SEED,'backend':'NumPy CPU float64, two threads','optimizer':'Adam BP with outer PSO; not MATLAB trainlm reproduction','wall_seconds':time.monotonic()-started,'peak_rss_mib':rss_mib(),'datasets':result,'source_workbook_sha256':json.loads((RUN/'workbook-dataset.json').read_text(encoding='utf-8'))['source_sha256'],'deployment_allowed':False,'generated_at':'2026-10-14'}
  save(RUN/'results.json',receipt)
  save(ROOT/'data/templates/cost-neural-prototype.json',receipt)
  save(RUN/'cycle-state.json',{'status':'reported','result':'trial_keep','artifact':'data/templates/cost-neural-prototype.json','cpu_wall_seconds':receipt['wall_seconds'],'peak_rss_mib':receipt['peak_rss_mib']})
  event('finish',status='reported',wall_seconds=receipt['wall_seconds'],peak_rss_mib=receipt['peak_rss_mib'],promotion='trial_keep')
  print(json.dumps({name:record['metrics']['locked_final_audit'] for name,record in result.items()},ensure_ascii=False))
 except Exception as error:
  event('failure',error_type=type(error).__name__,message=str(error));save(RUN/'cycle-state.json',{'status':'failed','error_type':type(error).__name__,'message':str(error)})
  raise
 finally: lease.unlink(missing_ok=True)

if __name__=='__main__': main()
