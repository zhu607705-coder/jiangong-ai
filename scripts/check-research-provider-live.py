"""Bounded provider protocol probes on the deployed server; never open a project model run."""
import argparse, json, pathlib, shlex, subprocess
p=argparse.ArgumentParser();p.add_argument('--known-hosts',required=True);p.add_argument('--receipt',required=True);args=p.parse_args()
native=r'''
const {config}=await import('./apps/host/config.ts');
const {collectSelectedEvidence}=await import('./services/capabilities/research.ts');
const {requestDecisionBatches}=await import('./services/capabilities/decision-model.ts');
const started=Date.now();
const evidence=await collectSelectedEvidence({name:'杭州 建工新村',city:'杭州市',purpose:'只读部署接口检查',asOf:'2026-10-17',intelligence:false,forceDiscovery:true,budget:{newEvidence:1,refresh:0}},AbortSignal.timeout(45000),undefined,undefined,['杭州 建工新村 雨棚 预算 交易公告']);
const search={provider:evidence.trace.acquisition?.provider,source_count:evidence.sources.filter(source=>source.untrusted_text).length,elapsed_ms:Date.now()-started,attempts:evidence.web_calls?.map(({operation,outcome,billing_state,duration_ms})=>({operation,outcome,billing_state,duration_ms})),intelligence_writes:false};
let decision={status:'blocked_external'};
if(config.decisionConfigured){const at=Date.now(),questions=Object.fromEntries(Array.from({length:38},(_,i)=>['q'+i,{type:'score',instructions:'这是隔离协议检查：给三个顺序等级中间项较高概率，不涉及真实项目事实或效果标签。',criteria:['低','中','高']}]));try{const result=await requestDecisionBatches({scope:'isolated protocol only',synthetic:true},questions,AbortSignal.timeout(55000));decision={status:Object.keys(result.answers).length===38?'completed':'partial',elapsed_ms:Date.now()-at,valid_answers:Object.keys(result.answers).length,batches:result.batches,calibration_status:result.calibration_status};}catch(error){decision={status:'blocked_external',error:error instanceof Error&&/^DECISION_[A-Z_\d]+$/.test(error.message)?error.message:'PROVIDER_UNAVAILABLE'};}}
console.log(JSON.stringify({search,decision,project_writes:0,scope:'Public provider and synthetic typed-batch protocol probes only; no business-quality labels.'}));
'''
remote=r'''
import pathlib,subprocess,json,urllib.request,http.cookiejar,datetime
base=pathlib.Path('/home/zhuhangcheng/apps/haizhizi');release=(base/'current').resolve(strict=True)
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with client.open('https://laneanew.cn'+path,timeout=20) as response:return json.load(response)
get('/api/session');before=get('/api/projects');ready=get('/api/ready')
pid=subprocess.check_output(['systemctl','--user','show','haizhizi-host.service','-p','MainPID','--value'],text=True).strip()
node=(pathlib.Path('/proc')/pid/'exe').resolve(strict=True);assert node.name=='node','Expected the deployed Node runtime'
result=subprocess.run([str(node),'--env-file='+str(base/'shared/server.env'),'--import','tsx','--input-type=module','-e',__NATIVE__],cwd=release,text=True,capture_output=True,timeout=110)
assert result.returncode==0,'Provider probe process failed; inspect server logs without exposing environment'
data=json.loads(result.stdout.strip().splitlines()[-1]);data.update(checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),release=ready,projects_unchanged=before==get('/api/projects'))
assert data['projects_unchanged'],'Project metadata changed during protocol probe'
print(json.dumps(data,ensure_ascii=False))
'''.replace('__NATIVE__',repr(native))
options=['-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(pathlib.Path(args.known_hosts).resolve())]
result=subprocess.run(['ssh',*options,'zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(remote)],capture_output=True,text=True,timeout=125)
if result.returncode:print(result.stderr);raise SystemExit(result.returncode)
data=json.loads(result.stdout);output=pathlib.Path(args.receipt);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(data,ensure_ascii=False))
