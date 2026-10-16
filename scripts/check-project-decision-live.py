"""Read project guidance, optionally refresh only that Decision request, preserving project/round hashes."""
import argparse,json,pathlib,subprocess,shlex
parser=argparse.ArgumentParser()
parser.add_argument('--project-id',required=True)
parser.add_argument('--known-hosts',required=True)
parser.add_argument('--receipt',required=True)
parser.add_argument('--refresh',action='store_true')
args=parser.parse_args()
assert args.project_id.startswith('P-') and len(args.project_id)<100
code=r'''
import urllib.request,http.cookiejar,json,hashlib,datetime
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with client.open('https://laneanew.cn'+path,timeout=15) as response:return json.load(response)
digest=lambda value:hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
get('/api/session')
root='/api/projects/'+__PROJECT__
project=get(root);rounds=get(root+'/research-rounds')
if __REFRESH__:
 request=urllib.request.Request('https://laneanew.cn'+root+'/decision-guidance',data=json.dumps({'expected_context_version':project['context_version'],'direction':None,'preference':'balanced','refresh':True}).encode(),headers={'Content-Type':'application/json','X-Requested-With':'haizhizi','Origin':'https://laneanew.cn'})
 with client.open(request,timeout=40) as response:result=json.load(response)
else:result=get(root+'/decision-guidance?direction=unselected&preference=balanced')
assert result and result['status'] in ['completed','partial'],result and result.get('error')
assert len(result['stages'])==6 and result['request_id']
assert result['strategy_hash'] and result['measures'] and result['materials']
assert digest(project)==digest(get(root))
assert digest(rounds)==digest(get(root+'/research-rounds'))
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':get('/api/ready'),'result':result,'refreshed':__REFRESH__,'project_unchanged':True,'research_rounds_unchanged':True,'scope':'One project Decision guidance request; no full research rerun.'},ensure_ascii=False))
'''.replace('__PROJECT__',repr(args.project_id)).replace('__REFRESH__',repr(args.refresh))
command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(pathlib.Path(args.known_hosts).resolve()),'zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(code)]
response=subprocess.run(command,capture_output=True,encoding='utf8',timeout=60)
if response.returncode:
 print(response.stderr);raise SystemExit(response.returncode)
receipt=json.loads(response.stdout);p=pathlib.Path(args.receipt);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
result=receipt['result']
print(json.dumps({'status':result['status'],'duration_ms':result['duration_ms'],'stages':len(result['stages']),'measures':len(result['measures']),'materials':len(result['materials']),'project_unchanged':True,'research_rounds_unchanged':True}))
