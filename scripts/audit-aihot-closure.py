"""Campus API evidence: archive public originals, verify one native analysis; preserve projects."""
import argparse, json, pathlib, shlex, subprocess
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--archive',action='store_true');p.add_argument('--analyze-one',action='store_true');p.add_argument('--disk-snapshot',action='store_true');p.add_argument('--verify-disk',action='store_true');args=p.parse_args()
code=r'''
import urllib.request,urllib.parse,http.cookiejar,json,time,datetime,pathlib,hashlib,re
c=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
last_request=0
def api(path,body=None):
 global last_request
 time.sleep(max(0,0.36-(time.monotonic()-last_request)));last_request=time.monotonic()
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
disk=None
if __DISK__:
 campaign_before=api('/intelligence/campaign')
 snapshot_jobs=[]
 if __SNAPSHOT__:
  job=api('/intelligence/campaign/snapshot',{});deadline=time.monotonic()+240
  while time.monotonic()<deadline:
   state=api('/intelligence/status');snapshot_jobs=[j for j in state['jobs'] if j['kind']=='corpus_snapshot' and j['created_at']>=job['created_at']]
   if snapshot_jobs and all(j['status']=='completed' for j in snapshot_jobs) and not snapshot_jobs[0].get('result',{}).get('has_more',True):break
   if any(j['status'] in ('failed','cancelled','blocked_external') for j in snapshot_jobs):raise RuntimeError('Disk snapshot did not finish: '+json.dumps(snapshot_jobs))
   time.sleep(2)
  else:raise TimeoutError('Disk snapshot remains queued; inspect existing jobs')
 root=pathlib.Path('/home/zhuhangcheng/apps/haizhizi/shared/data/corpus-public')
 docs=list((root/'documents').glob('ID-*/*/source.json'));chunks=0;readback=[]
 for path in docs:
  manifest=json.loads(path.read_text());body=(path.parent/'original.md').read_bytes();text=body.decode('utf8');lines=re.split(r'\r?\n',text)
  assert hashlib.sha256(body).hexdigest()==manifest['body_sha256']
  rows=[json.loads(line) for line in (path.parent/'chunks.jsonl').read_text().splitlines() if line]
  for row in rows:
   line=lines[int(row['locator'].split(':')[1])-1]
   original=line.encode('utf-16-le')[row['start']*2:row['end']*2].decode('utf-16-le',errors='surrogatepass')
   assert original==row['text'],str(path)+':'+row['locator']+':'+str((row['start'],row['end']))
  assert len(rows)==manifest['chunks'];chunks+=len(rows)
  if len(readback)<3:readback.append({'id':manifest['id'],'version':manifest['version'],'title':manifest['title'],'url':manifest['url'],'chunks':len(rows),'body_sha256':manifest['body_sha256']})
 campaign_after=api('/intelligence/campaign')
 assert campaign_after['usage']==campaign_before['usage'],'Archiving must not call paid search'
 assert campaign_after['archive']['versions']==len(docs)
 disk={'root':str(root),'versions':len(docs),'documents':len({path.parent.parent.name for path in docs}),'chunks':chunks,'sample':readback,'campaign':campaign_after,'paid_search_calls_added':0,'snapshot_jobs':snapshot_jobs}
after=api('/intelligence/status')
assert projects==api('/projects'),'Project inputs changed'
assert rounds=={p['id']:api('/projects/'+p['id']+'/research-rounds') for p in projects if p['id'] in rounds},'Research history changed'
compact=lambda s:{k:s.get(k) for k in ['database','knowledge','model_auto_enabled','collection_enabled','daily_model_budget']}
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'before':compact(before),'after':compact(after),'archive_jobs':archive_jobs,'sample_search':found,'native':native,'disk':disk,'project_metadata_unchanged':True,'research_history_unchanged':True,'full_research_started':False},ensure_ascii=False))
'''.replace('__ARCHIVE__',repr(args.archive)).replace('__ANALYZE__',repr(args.analyze_one)).replace('__DISK__',repr(args.disk_snapshot or args.verify_disk)).replace('__SNAPSHOT__',repr(args.disk_snapshot))
r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=D:/建工ai/.cache/haizhizi-known-hosts','zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(code)],capture_output=True,encoding='utf8',timeout=470)
if r.returncode:raise RuntimeError(r.stderr)
v=json.loads(r.stdout);path=pathlib.Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'before':v['before'],'after':v['after'],'archive_batches':len(v['archive_jobs']),'native_status':v['native']['job']['status'] if v['native'] else None,'disk_versions':v['disk']['versions'] if v['disk'] else None,'disk_chunks':v['disk']['chunks'] if v['disk'] else None,'projects_unchanged':True},ensure_ascii=False))
