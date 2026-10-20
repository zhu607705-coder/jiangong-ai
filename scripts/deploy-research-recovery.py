"""Deploy this scoped host patch with immutable source and remote drift checks."""
import argparse, datetime, hashlib, io, json, pathlib, shlex, subprocess, tarfile

parser=argparse.ArgumentParser()
parser.add_argument('--commit',required=True)
parser.add_argument('--base',default='cfb4e4523ac58f4392fdd73aa15043354c6c813b')
parser.add_argument('--known-hosts',required=True)
parser.add_argument('--receipt',default='research/test_results/research-recovery-runtime-deployment-20261016.json')
args=parser.parse_args()
root=pathlib.Path.cwd()
def git(*parts):return subprocess.check_output(['git',*parts],cwd=root)
commit=git('rev-parse',args.commit).decode().strip()
base=git('rev-parse',args.base).decode().strip()
names=git('diff','--name-only',base,commit,'--','apps/host','packages','runtime','services','data/public_cases/renewal-case-cards-20261017.json').decode().splitlines()
names=[name for name in names if name.endswith(('.ts','.json','.py')) or name == 'runtime/agents/renewal/AGENTS.md']
assert names and all('..' not in pathlib.PurePosixPath(name).parts for name in names)
sha=lambda content:hashlib.sha256(content.replace(b'\r\n',b'\n')).hexdigest()
manifest={}
archive=root/'.cache'/('research-recovery-'+commit+'.tar.gz');archive.parent.mkdir(exist_ok=True)
with tarfile.open(archive,'w:gz') as bundle:
    for name in names:
        current=subprocess.run(['git','show',commit+':'+name],capture_output=True)
        data=current.stdout if current.returncode==0 else None
        old=subprocess.run(['git','show',base+':'+name],capture_output=True)
        assert data is not None or old.returncode==0,'Missing source at both revisions: '+name
        manifest[name]={'before':sha(old.stdout) if old.returncode==0 else None,'after':sha(data) if data is not None else None}
        if data is not None:
            item=tarfile.TarInfo(name);item.size=len(data);item.mode=0o644;bundle.addfile(item,io.BytesIO(data))
ssh=['-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(pathlib.Path(args.known_hosts).resolve())]
target='zhuhangcheng@10.70.223.113'
remote_archive='/home/zhuhangcheng/apps/haizhizi/shared/'+archive.name
subprocess.run(['scp','-q',*ssh,str(archive),target+':'+remote_archive],check=True)
code=r'''
import pathlib,hashlib,json,datetime,tarfile,shutil,subprocess,urllib.request,http.cookiejar,time,os
manifest=__MANIFEST__
commit=__COMMIT__
archive=pathlib.Path(__ARCHIVE__)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==__ARCHIVE_SHA__
base=pathlib.Path('/home/zhuhangcheng/apps/haizhizi')
release=(base/'current').resolve(strict=True)
assert release.is_relative_to(base/'releases')
sha=lambda data:hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
 with client.open('https://laneanew.cn'+path,timeout=15) as response:return json.load(response)
get('/api/session')
before_projects=get('/api/projects')
def round_state(projects):
 result={}
 for project in projects:
  if project.get('input',{}).get('business_profile')=='neighborhood':result[project['id']]=get('/api/projects/'+project['id']+'/research-rounds')
 return result
before_rounds=round_state(before_projects)
assert not any(round.get('status')=='running' for state in before_rounds.values() for round in state.get('rounds',[])),'An approved research round is active; wait for it before deployment'
paths={}
for name,hashes in manifest.items():
 path=release/name
 assert path.resolve().is_relative_to(release)
 actual=sha(path.read_bytes()) if path.is_file() else None
 assert actual==hashes['before'],'Server source changed: '+name
 paths[name]=path
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=base/'shared/research-recovery-backups'/stamp
backup.mkdir(parents=True,mode=0o700)
env=pathlib.Path.home()/'.config/systemd/user/haizhizi-host.service.d/release.conf'
env_before=env.read_bytes() if env.exists() else None
if env_before is not None:(backup/'release.conf').write_bytes(env_before)
for name,path in paths.items():
 if path.exists():
  destination=backup/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,destination)
installed=[]
try:
 with tarfile.open(archive) as bundle:
  members=bundle.getmembers()
  written={name for name in paths if manifest[name]['after'] is not None}
  assert len(members)==len(written) and {m.name for m in members}==written
  for item in members:
   assert item.isfile()
   data=bundle.extractfile(item).read();assert sha(data)==manifest[item.name]['after']
   path=paths[item.name];path.parent.mkdir(parents=True,exist_ok=True)
   temporary=path.with_name(path.name+'.research-new');temporary.write_bytes(data);temporary.chmod(0o644);os.replace(temporary,path);installed.append(item.name)
  for name,path in paths.items():
   if manifest[name]['after'] is None:
    path.unlink();installed.append(name)
 env.parent.mkdir(parents=True,exist_ok=True);env.write_text('[Service]\nEnvironment=HZZ_RELEASE_COMMIT='+commit+'\n');env.chmod(0o644)
 subprocess.run(['systemctl','--user','daemon-reload'],check=True)
 subprocess.run(['systemctl','--user','restart','haizhizi-host.service'],check=True)
 ready=None
 for attempt in range(30):
  try:
   get('/api/session');ready=get('/api/ready')
   if ready.get('protocol_version')=='research-recovery-v1' and ready.get('release_commit')==commit:break
  except Exception:pass
  time.sleep(1)
 assert ready and ready.get('release_commit')==commit and ready.get('capabilities') is True,'Host readiness failed'
 after_projects=get('/api/projects')
 assert before_projects==after_projects,'Project metadata changed during deployment'
 after_rounds=round_state(after_projects)
 assert before_rounds==after_rounds,'Research history changed during deployment'
 result={'deployed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commit':commit,'release':str(release),'backup':str(backup),'runtime_files':manifest,'readiness':ready,'projects_count':len(after_projects),'project_metadata_unchanged':True,'research_history_unchanged':True,'model_research_triggered_by_deployer':False,'rollback':False}
 (base/'shared'/('research-recovery-runtime-'+commit+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(result,ensure_ascii=False))
except Exception:
 for name in installed:
  destination=paths[name];original=backup/name
  if original.exists():shutil.copy2(original,destination)
  elif destination.exists():destination.unlink()
 if env_before is None:env.unlink(missing_ok=True)
 else:env.write_bytes(env_before)
 subprocess.run(['systemctl','--user','daemon-reload'],check=True)
 subprocess.run(['systemctl','--user','restart','haizhizi-host.service'],check=True)
 raise
'''
# Substitutions contain code paths and hashes only. No environment or credential values are read.
for key,value in {'__MANIFEST__':repr(manifest),'__COMMIT__':repr(commit),'__ARCHIVE__':repr(remote_archive),'__ARCHIVE_SHA__':repr(hashlib.sha256(archive.read_bytes()).hexdigest())}.items():code=code.replace(key,value)
response=subprocess.run(['ssh',*ssh,target,'python3 -c '+shlex.quote(code)],capture_output=True,text=True,timeout=100)
if response.returncode:
    print(response.stderr);raise SystemExit(response.returncode)
result=json.loads(response.stdout)
receipt=root/args.receipt
receipt.parent.mkdir(parents=True,exist_ok=True)
receipt.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'commit':commit,'files':len(names),'projects':result['projects_count'],'protocol':result['readiness']['protocol_version'],'backup':result['backup']}))
