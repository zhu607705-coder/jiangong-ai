"""Read back one already requested fast screen; never starts a research run."""
import argparse, datetime, json, pathlib, shlex, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--context-id', required=True)
parser.add_argument('--known-hosts', required=True)
parser.add_argument('--receipt', required=True)
args = parser.parse_args()
assert args.context_id.startswith('MAPCTX-') and len(args.context_id) < 100
code = r'''
import urllib.request,http.cookiejar,json,datetime
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with client.open('https://laneanew.cn'+path,timeout=15) as response:return json.load(response)
get('/api/session')
ready=get('/api/ready')
a=get('/api/maps/screening/analysis/'+__CONTEXT__+'?profile=neighborhood')
d=a['decision_support'];p=d['provisional_dashboard'];c=a['completion']
assert a['status']=='completed' and d['status']=='completed'
assert c['evidence']=='missing' and c['version']=='current'
assert len(p['dimensions'])==6 and all(row['value'] is not None for row in p['dimensions'])
assert all('情景假设' in row['basis'] and '补查重点' in row['basis'] for row in p['dimensions'])
assert len({row['value'] for row in p['dimensions']})>1
assert not a['model_calls'] and not a.get('research',{}).get('queries')
assert d['action']!='compare'
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release_commit':ready['release_commit'],'context_id':a['context_id'],'created_at':a['created_at'],'status':a['status'],'decision_request_id':d['request_id'],'decision_duration_ms':d['duration_ms'],'decision_input_tokens':d['input_tokens'],'scores':p['dimensions'],'research_routing':d.get('research_routing'),'completion':c,'action':d['action'],'deepseek_calls':len(a['model_calls']),'external_searches':0,'readback_only':True,'scope':'One explicit public-map conditional screening; not a full project rerun or measured decision accuracy.'},ensure_ascii=False))
'''.replace('__CONTEXT__',repr(args.context_id))
ssh=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(pathlib.Path(args.known_hosts).resolve()),'zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(code)]
response=subprocess.run(ssh,capture_output=True,encoding='utf8',timeout=50)
if response.returncode:
    print(response.stderr);raise SystemExit(response.returncode)
result=json.loads(response.stdout)
path=pathlib.Path(args.receipt);path.parent.mkdir(parents=True,exist_ok=True)
path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({key:result[key] for key in ['decision_duration_ms','deepseek_calls','external_searches','status']}))
