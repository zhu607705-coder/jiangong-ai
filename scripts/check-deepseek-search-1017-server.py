"""Use deployed Node and server-only credentials; never echo environment values."""
import pathlib,subprocess,json,shlex
remote=r'''
import pathlib,subprocess,json,urllib.request,http.cookiejar,datetime
base=pathlib.Path('/home/zhuhangcheng/apps/haizhizi');release=(base/'current').resolve(strict=True)
c=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with c.open('https://laneanew.cn'+path,timeout=20) as r:return json.load(r)
get('/api/session');before=get('/api/projects');ready=get('/api/ready')
histories={p['id']:get('/api/projects/'+p['id']+'/research-rounds') for p in before if p.get('input',{}).get('business_profile')=='neighborhood'}
assert not any(r.get('status')=='running' for state in histories.values() for r in state.get('rounds',[])),'Wait for user-approved research to finish before probing shared resources'
pid=subprocess.check_output(['systemctl','--user','show','haizhizi-host.service','-p','MainPID','--value'],text=True).strip();node=pathlib.Path('/proc/'+pid+'/exe').resolve();assert node.name=='node'
result=subprocess.run([str(node),'--env-file='+str(base/'shared/server.env'),'--import','tsx','--input-type=module','-e',__NATIVE__],cwd=release,capture_output=True,text=True,timeout=105)
assert result.returncode==0,result.stderr[-1600:]
data=json.loads(result.stdout.strip().splitlines()[-1]);assert before==get('/api/projects')
for project,history in histories.items():assert history==get('/api/projects/'+project+'/research-rounds')
data.update(readiness=ready,projects=len(before),project_metadata_unchanged=True,research_histories_unchanged=True)
print(json.dumps(data,ensure_ascii=False))
'''.replace('__NATIVE__',repr(pathlib.Path('scripts/probe-deepseek-search-1017.mjs').read_text(encoding='utf8').replace("'../", "'./")))
r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=D:/建工ai/.cache/haizhizi-known-hosts','zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(remote)],capture_output=True,encoding='utf8',timeout=130)
if r.returncode:raise RuntimeError(r.stderr)
data=json.loads(r.stdout);path=pathlib.Path('research/test_results/deepseek-search-1017-server.json');path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(data,ensure_ascii=False))
