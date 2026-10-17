"""Read the deployed canonical result twice; never start research or change project data."""
import argparse, json, pathlib, shlex, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--known-hosts', required=True)
parser.add_argument('--receipt', required=True)
parser.add_argument('--project-id', default='P-0e40c5dd-dc9a-4d12-9f54-a8c952be87de')
args = parser.parse_args()
assert args.project_id.startswith('P-') and len(args.project_id) < 100
code = r'''
import urllib.request,http.cookiejar,json,hashlib,datetime
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with client.open('https://laneanew.cn'+path,timeout=30) as response:return json.load(response)
digest=lambda value:hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
get('/api/session')
path='/api/projects/'+__PROJECT__
before=get(path); rounds=get(path+'/research-rounds')
first=get(path+'/renewal-strategy?demo=false'); second=get(path+'/renewal-strategy?demo=false')
assert first and first['status']=='completed' and first['project_id']==before['id']
assert first['input_hash']==second['input_hash']
assert first['context_version']==before['context_version']
assert first['current_context']['policy']=='project-context-v1'
conflicts=[s for s in first['sources'] if s.get('object_binding',{}).get('relation')=='different_object']
assert all(s['role']=='reference' for s in conflicts)
guidance=get(path+'/decision-guidance?direction=unselected&preference=balanced')
assert guidance is None or guidance['strategy_hash']==first['input_hash']
assert digest(before)==digest(get(path))
assert digest(rounds)==digest(get(path+'/research-rounds'))
index=get('/api/projects/public-decisions')['items']
entry=next((row for row in index if row['project_id']==before['id']),None)
assert entry and entry['input_hash']==first['input_hash']
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':get('/api/ready'),
 'project_id':before['id'],'registered_city':before['input']['scope'].get('city'),
 'registered_address':before['input']['scope'].get('map_anchor',{}).get('address'),
 'effective_city':next((s.get('object_binding',{}).get('city') for s in first['sources'] if s.get('object_binding',{}).get('city')),None),'context_version':before['context_version'],
 'current_context':first['current_context'],'selected_input_hash':first['input_hash'],'source_count':len(first['sources']),
 'explicit_object_conflicts':len(conflicts),'public_index_same_result':True,'decision_cache_current':guidance is not None,
 'projects_unchanged':True,'rounds_unchanged':True,'model_calls_triggered':0},ensure_ascii=False))
'''.replace('__PROJECT__', repr(args.project_id))
command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes',
           '-o', 'UserKnownHostsFile='+str(pathlib.Path(args.known_hosts).resolve()),
           'zhuhangcheng@10.70.223.113', 'python3 -c '+shlex.quote(code)]
result = subprocess.run(command, capture_output=True, encoding='utf8', timeout=180)
if result.returncode:
    print(result.stderr)
    raise SystemExit(result.returncode)
receipt = json.loads(result.stdout)
path = pathlib.Path(args.receipt)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(receipt,ensure_ascii=False))
