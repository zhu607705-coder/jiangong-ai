"""Campus API evidence: archive public originals, verify one native analysis; preserve projects."""
import argparse, json, pathlib, shlex, subprocess
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--archive',action='store_true');p.add_argument('--analyze-one',action='store_true');args=p.parse_args()
code=r'''
import urllib.request,urllib.parse,http.cookiejar,json,time,datetime
c=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def api(path,body=None):
 req=urllib.request.Request('https://laneanew.cn/api'+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Requested-With':'haizhizi','Origin':'https://laneanew.cn'})
 with c.open(req,timeout=40) as r:return json.load(r)
api('/session');projects=api('/projects')
rounds={p['id']:api('/projects/'+p['id']+'/research-rounds') for p in projects if p.get('input',{}).get('business_profile')=='neighborhood'}
before=api('/intelligence/status');archive_jobs=[];native=None
if __ARCHIVE__:
 job=api('/intelligence/archive',{'analyze_limit':0});deadline=time.monotonic()+240
 while time.monotonic()<deadline:
  status=api('/intelligence/status');archive_jobs=[j for j in status['jobs'] if j['kind']=='archive' and j['created_at']>=job['created_at']]
  if archive_jobs and all(j['status']=='completed' for j in archive_jobs) and not archive_jobs[0].get('result',{}).get('has_more',True):break
  if any(j['status'] in ('failed','cancelled','blocked_external') for j in archive_jobs):raise RuntimeError('Archive job did not finish')
  time.sleep(2)
 else:raise TimeoutError('Archive still running; inspect jobs before retry')
found=api('/intelligence/search?'+urllib.parse.urlencode({'q':'75幢1单元','limit':40}))
if __ANALYZE__:
 sample=next((e['representative'] for e in found['items'] if '官方附件' in e['representative']['title']),None)
 if not sample:raise RuntimeError('No public source sample found')
 job=api('/intelligence/items/'+sample['id']+'/analyze',{'version':sample['version']});deadline=time.monotonic()+180
 while time.monotonic()<deadline:
  state=api('/intelligence/status');current=next((j for j in state['jobs'] if j['id']==job['id']),None)
  if current and current['status'] not in ('queued','running'):break
  time.sleep(2)
 detail=api('/intelligence/items/'+sample['id']+'?version='+sample['version'])
 native={'job':current,'item':detail}
after=api('/intelligence/status')
assert projects==api('/projects'),'Project inputs changed'
assert rounds=={p['id']:api('/projects/'+p['id']+'/research-rounds') for p in projects if p['id'] in rounds},'Research history changed'
compact=lambda s:{k:s.get(k) for k in ['database','knowledge','model_auto_enabled','collection_enabled','daily_model_budget']}
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'before':compact(before),'after':compact(after),'archive_jobs':archive_jobs,'sample_search':found,'native':native,'project_metadata_unchanged':True,'research_history_unchanged':True,'full_research_started':False},ensure_ascii=False))
'''.replace('__ARCHIVE__',repr(args.archive)).replace('__ANALYZE__',repr(args.analyze_one))
r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=D:/建工ai/.cache/haizhizi-known-hosts','zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(code)],capture_output=True,encoding='utf8',timeout=470)
if r.returncode:raise RuntimeError(r.stderr)
v=json.loads(r.stdout);path=pathlib.Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'before':v['before'],'after':v['after'],'archive_batches':len(v['archive_jobs']),'native_status':v['native']['job']['status'] if v['native'] else None,'projects_unchanged':True},ensure_ascii=False))
