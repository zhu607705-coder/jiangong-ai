"""Generate only the requested public-data guidance card; preserve projects/research rounds."""
import pathlib,subprocess,shlex,json
code=r'''
import urllib.request,http.cookiejar,json,datetime,time
c=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with c.open('https://laneanew.cn'+path,timeout=20) as r:return json.load(r)
get('/api/session');root='/api/projects/P-0e40c5dd-dc9a-4d12-9f54-a8c952be87de';project=get(root);rounds=get(root+'/research-rounds');packet=get(root+'/renewal-strategy')
endpoint=root+'/investigation-advice';before=get(endpoint)
request=urllib.request.Request('https://laneanew.cn'+endpoint,data=json.dumps({'expected_context_version':project['context_version'],'expected_strategy_hash':packet['input_hash'],'direction':None,'refresh':False}).encode(),headers={'Content-Type':'application/json','X-Requested-With':'haizhizi','Origin':'https://laneanew.cn'})
with c.open(request,timeout=75) as r:result=json.load(r)
cached=get(endpoint);assert cached and cached['reused'] is True
assert cached['created_at']==result['created_at'] and cached['model_calls']==result['model_calls']
assert result['policy']=='investigation-advice-v1' and 1<=len(result['steps'])<=3
assert result['model_calls'] and all(step['task_id'].startswith(packet['input_hash']) for step in result['steps'])
assert project==get(root) and rounds==get(root+'/research-rounds')
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'before_cached':bool(before),'result':result,'cache_read_reused':True,'project_metadata_unchanged':True,'research_history_unchanged':True,'full_project_research_started':False,'readiness':get('/api/ready')},ensure_ascii=False))
'''
r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=D:/建工ai/.cache/haizhizi-known-hosts','zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(code)],capture_output=True,encoding='utf8',timeout=105)
if r.returncode:raise RuntimeError(r.stderr)
value=json.loads(r.stdout);pathlib.Path('research/test_results/investigation-advice-server-20261017.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(value,ensure_ascii=False))
