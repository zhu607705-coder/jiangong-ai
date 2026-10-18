"""Same bounded live questions before/after; no project facts or saved decisions are written."""
import argparse,pathlib,subprocess,shlex,json
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--keyword-only',action='store_true');p.add_argument('--repeat',action='store_true');args=p.parse_args()
code=r'''
import urllib.request,http.cookiejar,json,time,datetime
c=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with c.open('https://laneanew.cn'+path,timeout=20) as r:return json.load(r)
get('/api/session');root='/api/projects/P-0529974d-63fe-4ae8-804d-e5efb049f60a';before=get(root);rounds=get(root+'/research-rounds')
questions=['75幢1单元加装电梯预计要花多少钱？','二次供水改造涉及哪些楼栋，哪栋没纳入？','社区食堂的用餐人数和运营费用有记录吗？']
if __REPEAT__:questions.append(questions[0])
rows=[]
for question in questions:
 start=time.monotonic();events=[];first=None;result=None
 use_ai=not __KEYWORD__ and question==questions[0]
 request=urllib.request.Request('https://laneanew.cn'+root+'/knowledge/retrieve',data=json.dumps({'question':question,'use_ai':use_ai,'limit':5}).encode(),headers={'Content-Type':'application/json','X-Requested-With':'haizhizi','Accept':'application/x-ndjson','Origin':'https://laneanew.cn'})
 with c.open(request,timeout=115) as response:
  if 'ndjson' in response.headers.get('Content-Type',''):
   for line in response:
    event=json.loads(line);events.append(event['type'])
    if event['type']=='originals' and first is None:first=round((time.monotonic()-start)*1000,1)
    if event['type']=='complete':result=event['result']
  else:result=json.load(response);first=round((time.monotonic()-start)*1000,1)
 assert result is not None
 rows.append({'question':question,'use_ai':use_ai,'first_originals_ms':first,'complete_ms':round((time.monotonic()-start)*1000,1),'hits':[{'title':h['file_name'],'source_id':h['source']['id'],'locator':h['locator']} for h in result['hits']],'model_calls':result.get('assistance',{}).get('calls',0),'timing':result.get('timing'),'cache':result.get('cache'),'events':events,'assistance_status':result.get('assistance',{}).get('status'),'answer':result.get('assistance',{}).get('answer',[]),'warnings':result.get('assistance',{}).get('warnings',[])})
assert before==get(root) and rounds==get(root+'/research-rounds')
print(json.dumps({'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':rows,'project_metadata_unchanged':True,'research_rounds_unchanged':True,'full_research_started':False,'readiness':get('/api/ready')},ensure_ascii=False))
'''.replace('__KEYWORD__',repr(args.keyword_only)).replace('__REPEAT__',repr(args.repeat))
r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=D:/建工ai/.cache/haizhizi-known-hosts','zhuhangcheng@10.70.223.113','python3 -c '+shlex.quote(code)],capture_output=True,encoding='utf8',timeout=155)
if r.returncode:raise RuntimeError(r.stderr)
value=json.loads(r.stdout);path=pathlib.Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(value,ensure_ascii=False))
