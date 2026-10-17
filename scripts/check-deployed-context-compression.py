"""Read-only production replay of a saved round through the deployed pure compiler."""
import pathlib,subprocess,shlex,json
code=r'''
import pathlib,subprocess,urllib.request,http.cookiejar,json,hashlib,datetime
c=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with c.open('https://laneanew.cn'+path,timeout=20) as r:return json.load(r)
get('/api/session')
path='/api/projects/P-d397c757-5df1-4c59-a397-13cb95f763eb/research-rounds'
before=get(path);packet=next(r['result'] for r in before['rounds'] if r['id']=='ROUND-08e572b5-78d2-4b71-b3bb-697a439058b4')
release=pathlib.Path('/home/zhuhangcheng/apps/haizhizi/current').resolve()
pid=subprocess.check_output(['systemctl','--user','show','haizhizi-host.service','-p','MainPID','--value'],text=True).strip()
node=pathlib.Path('/proc/'+pid+'/exe').resolve();assert node.name=='node'
js="""import {compileRenewalResearchContext} from './runtime/workflows/renewal-research.ts';const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const p=JSON.parse(Buffer.concat(chunks).toString('utf8')),w=p.workflow,reads=w.tasks.flatMap(t=>t.retrieval?.read_windows||[]).map(r=>({...r,text:p.sources.find(s=>s.id===r.source_id).text.slice(r.start_char,r.end_char)}));const result=compileRenewalResearchContext(p.sources,w.notes,w.plan,w.tasks,reads);console.log(JSON.stringify({before:result.expanded,after:result.context.length,audit:result.audit,quotes:w.notes.reduce((n,s)=>n+s.observations.length,0)}));"""
process=subprocess.run([str(node),'--import','tsx','--input-type=module','-e',js],cwd=release,input=json.dumps(packet,ensure_ascii=False),capture_output=True,text=True,timeout=40)
assert process.returncode==0,process.stderr
result=json.loads(process.stdout);assert result['before']==35432 and result['after']==26514,result;assert result['audit']['retention_ratio']==1 and result['quotes']==12
assert before==get(path),'Research history changed during read-only replay'
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ready':get('/api/ready'),'deployed_replay':result,'research_history_unchanged':True,'existing_project_runs':0,'provider_calls':0,'production_writes':0},ensure_ascii=False))
'''
command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=D:/建工ai/.cache/haizhizi-known-hosts','zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(code)]
r=subprocess.run(command,capture_output=True,encoding='utf8',timeout=75)
if r.returncode:raise RuntimeError(r.stderr)
receipt=json.loads(r.stdout);path=pathlib.Path('research/test_results/context-compression-deployed-replay-20261017.json');path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(receipt,ensure_ascii=False))


