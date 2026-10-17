import pathlib,subprocess,shlex,json,time
native=pathlib.Path('scripts/test-online-renewal-effect.mjs').read_text(encoding='utf8')
# Replace only known module/fixture references, keeping the actual production workflow.
for relative in ['apps/host/config.ts','packages/contracts/validate.ts','packages/decision/structured-route.ts','services/map-screening/renewal-strategy.ts','packages/intelligence/research-bridge.ts']:
 native=native.replace("'../"+relative+"'","'./"+relative+"'")
native=native.replace("new URL('../fixtures/inputs/01_auto.json',import.meta.url)","'./fixtures/inputs/01_auto.json'")
remote=r'''
import pathlib,subprocess,json,urllib.request,http.cookiejar
base=pathlib.Path('/home/zhuhangcheng/apps/haizhizi');release=(base/'current').resolve(strict=True)
c=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with c.open('https://laneanew.cn'+path,timeout=20) as r:return json.load(r)
get('/api/session');projects=get('/api/projects');histories={p['id']:get('/api/projects/'+p['id']+'/research-rounds') for p in projects if p.get('input',{}).get('business_profile')=='neighborhood'}
pid=subprocess.check_output(['systemctl','--user','show','haizhizi-host.service','-p','MainPID','--value'],text=True).strip();node=pathlib.Path('/proc/'+pid+'/exe').resolve();assert node.name=='node'
p=subprocess.Popen([str(node),'--env-file='+str(base/'shared/server.env'),'--import','tsx','--input-type=module','-e',__NATIVE__],cwd=release,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
for line in p.stdout:
 value=json.loads(line)
 if value.get('kind')=='complete':
  assert projects==get('/api/projects')
  for project,history in histories.items():assert history==get('/api/projects/'+project+'/research-rounds')
  value['production_projects_unchanged']=True;value['research_histories_unchanged']=True;value['release']=get('/api/ready')
 print(json.dumps(value,ensure_ascii=False),flush=True)
assert p.wait(timeout=15)==0,p.stderr.read()[-2000:]
'''.replace('__NATIVE__',repr(native))
command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=D:/建工ai/.cache/haizhizi-known-hosts','zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(remote)]
p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8')
out=pathlib.Path('research/test_results/online-renewal-effect-20261017.json');out.parent.mkdir(parents=True,exist_ok=True)
last=0;stage=None
for line in p.stdout:
 value=json.loads(line)
 if value['kind']=='complete':out.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(value['summary'],ensure_ascii=False),flush=True)
 elif (value.get('phase') or value['stage'])!=stage or time.monotonic()-last>18:
  print(json.dumps(value,ensure_ascii=False),flush=True);stage=value.get('phase') or value['stage'];last=time.monotonic()
if p.wait(timeout=15):raise RuntimeError(p.stderr.read()[-2000:])
