"""Frozen one-off campus artifact cleanup procedure for 2026-10-21; not scheduled or imported by the application."""
from pathlib import Path
import os,sys,json,hashlib,subprocess,datetime,re,shutil,stat,fcntl,urllib.request,http.cookiejar,tarfile,time

BASE=Path('/home/zhuhangcheng/apps/haizhizi')
assert BASE.resolve()==BASE
STORE=BASE/'shared/cleanup-receipts';STORE.mkdir(mode=0o700,exist_ok=True)
PLAN=STORE/'20261021-plan.json';RECEIPT=STORE/'20261021-result.json'
CURRENT=(BASE/'current').resolve(strict=True)
lock=open(BASE/'shared/ui-publication.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def fingerprint(p):
 h=hashlib.sha256()
 def add(q):
  s=q.lstat();h.update(json.dumps([str(q.relative_to(p.parent)),s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,os.readlink(q) if q.is_symlink() else None],ensure_ascii=False).encode())
 add(p)
 if p.is_dir() and not p.is_symlink():
  for folder,dirs,files in os.walk(p,followlinks=False):
   dirs.sort();files.sort()
   for n in sorted(dirs+files):add(Path(folder)/n)
 return h.hexdigest()
def size(p):return int(subprocess.check_output(['du','-s','-B1','--',str(p)]).split()[0])
def owner(p):
 try:
  parts=Path(p).resolve().relative_to(BASE/'releases').parts
  return str(BASE/'releases'/parts[0]) if parts else None
 except (ValueError,OSError):return None
def runtime_protected():
 result={str((BASE/'current').resolve())}
 for p in BASE.iterdir():
  if p.is_symlink() and owner(p):result.add(owner(p))
 for name in ['node_modules','.venv']:
  p=CURRENT/name
  if p.exists() and owner(p):result.add(owner(p))
 for proc in Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:
   if proc.stat().st_uid!=os.getuid():continue
   entries=[proc/'cwd',proc/'exe',*list((proc/'fd').iterdir())]
   for p in entries:
    try:
     v=os.readlink(p)
     if v.startswith(str(BASE/'releases')) and owner(v):result.add(owner(v))
    except OSError:pass
  except OSError:pass
 for folder in [Path.home()/'.config/systemd/user',Path('/etc/nginx/sites-enabled')]:
  if not folder.exists():continue
  for p in folder.rglob('*'):
   if not p.is_file() or p.suffix not in ('.service','.conf',''):continue
   try:
    for m in re.finditer(re.escape(str(BASE/'releases'))+r'/[^\s;"\x27]+',p.read_text()):
     if owner(m.group(0)):result.add(owner(m.group(0)))
   except (OSError,UnicodeError):pass
 return result
env_path=BASE/'shared/server.env'
env={l.split('=',1)[0]:l.split('=',1)[1].strip().strip('"').strip("'") for l in env_path.read_text().splitlines() if '=' in l and not l.lstrip().startswith('#')}
DATA=Path(env['DATA_DIR']).resolve()
def service_state():
 client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def get(p):
  with client.open('https://laneanew.cn'+p,timeout=15) as r:return json.load(r)
 get('/api/session');ready=get('/api/ready');projects=get('/api/projects')
 assert ready['status']=='ok',ready['status']
 return {'ready':ready['status'],'project_ids':sorted(p['id'] for p in projects),'host_pid':subprocess.check_output(['systemctl','--user','show','haizhizi-host.service','-p','MainPID','--value'],text=True).strip(),'capability_active':subprocess.check_output(['systemctl','--user','is-active','haizhizi-capabilities.service'],text=True).strip()}
def validate(p,kind,protected):
 assert p.is_absolute() and p.resolve(strict=True)==p and not p.is_symlink(),str(p)
 assert p.is_relative_to(BASE) and p!=BASE and not p.is_relative_to(DATA) and not DATA.is_relative_to(p),str(p)
 assert str(p) not in protected
 if kind=='old_release':
  assert p.parent==BASE/'releases' and re.fullmatch(r'[a-f0-9]{40}-[\w.-]+',p.name)
  for rel in ['.env','server.env','data/local','data/uploads','data/private','uploads']:
   q=p/rel;assert not q.exists() or q.is_symlink(),str(q)
 elif kind=='old_ui_backup':assert p.parent==CURRENT/'apps/workspace' and re.fullmatch(r'\.dist-blue-[a-f0-9]{40}-\d{8}T\d{6}Z',p.name)
 elif kind=='deployment_archive':assert p.parent==BASE/'shared' and re.fullmatch(r'(blue-ui|research-recovery|mode-lifecycle|advisory-plan|format-compat-runtime|sidebar-rag|experience-learning)-[a-f0-9]{40}\.tar\.gz',p.name)
 elif kind=='incoming_archive':assert p.parent==BASE/'shared/incoming' and p.name in ['server-admin-source.tgz','server-public-source.tgz','server-admin-ui.tgz','server-public-ui.tgz','server-report-update.tgz']
 elif kind=='bytecode_cache':assert p==BASE/'shared/__pycache__'
 else:raise AssertionError(kind)
 if p.is_dir():
  for folder,dirs,files in os.walk(p,followlinks=False):
   for n in dirs:
    q=Path(folder)/n
    assert q.is_symlink() or not os.path.ismount(q),str(q)
 if kind in ('deployment_archive','incoming_archive'):
  assert time.time()-p.stat().st_mtime>1800
  with tarfile.open(p,'r:*') as archive:
   for m in archive:
    parts=Path(m.name).parts
    assert not any(x in ('.env','server.env','PG_VERSION') for x in parts) and not m.name.endswith(('.pem','.key')),p.name
 return p

mode=sys.argv[1]
if mode=='plan':
 # A final dependency directory can exist while aliases through an old release break.
 # Normalize aliases separately before cleanup, or retain their intermediate releases.
 for name in ['node_modules','.venv']:
  alias=CURRENT/name
  assert alias.is_symlink() and alias.exists() and os.readlink(alias)==str(alias.resolve(strict=True)),'Normalize live dependency alias before planning: '+name
 protected=runtime_protected();releases=[p for p in (BASE/'releases').iterdir() if p.is_dir() and not p.is_symlink()]
 old=sorted([p for p in releases if str(p) not in protected],key=lambda p:p.stat().st_mtime_ns,reverse=True)
 rollback=None # Current source is in GitHub; preserve live dependencies, UI snapshots and all existing backend/config backups.
 if rollback:protected.add(str(rollback))
 ui=sorted((p for p in (CURRENT/'apps/workspace').glob('.dist-blue-*') if p.is_dir() and not p.is_symlink()),key=lambda p:p.stat().st_mtime_ns,reverse=True)
 keep_ui={str(p) for p in ui[:2]};protected|=keep_ui
 candidates=[(p,'old_release') for p in releases if str(p) not in protected]+[(p,'old_ui_backup') for p in ui if str(p) not in protected]
 groups={}
 for p in (BASE/'shared').glob('*.tar.gz'):
  m=re.fullmatch(r'(blue-ui|research-recovery|mode-lifecycle|advisory-plan|format-compat-runtime|sidebar-rag|experience-learning)-[a-f0-9]{40}\.tar\.gz',p.name)
  if m:groups.setdefault(m.group(1),[]).append(p)
 for values in groups.values():candidates += [(p,'deployment_archive') for p in sorted(values,key=lambda p:p.stat().st_mtime_ns,reverse=True)[2:]]
 for name in ['server-admin-source.tgz','server-public-source.tgz','server-admin-ui.tgz','server-public-ui.tgz','server-report-update.tgz']:
  p=BASE/'shared/incoming'/name
  if p.is_file():candidates.append((p,'incoming_archive'))
 if (BASE/'shared/__pycache__').is_dir():candidates.append((BASE/'shared/__pycache__','bytecode_cache'))
 entries=[];skipped=[]
 for p,kind in candidates:
  try:validate(p,kind,protected);entries.append({'path':str(p),'kind':kind,'allocated_bytes':size(p),'fingerprint':fingerprint(p)})
  except (AssertionError,OSError,tarfile.TarError) as e:skipped.append({'path':str(p),'reason':'validation_kept'})
 previous_deleted=[]
 if PLAN.exists():
  prior=json.loads(PLAN.read_text());missing=[e for e in prior['entries'] if not Path(e['path']).exists()]
  assert prior['entries'][:len(missing)]==missing,'Unexpected missing targets'
  previous_deleted=prior.get('previous_deleted',[])+[{k:v for k,v in e.items() if k!='fingerprint'} for e in missing]
  archive=STORE/('20261021-plan-history-'+digest(PLAN)[:12]+'.json');shutil.copy2(PLAN,archive);archive.chmod(0o600)
 before=service_state()
 plan={'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorization':'User explicitly selected only old release packages and temporary files;preserve website/database/keys','current':str(CURRENT),'data':str(DATA),'protected':sorted(protected),'rollback_release':str(rollback) if rollback else None,'env_sha':digest(env_path),'active_index_sha':digest(CURRENT/'apps/workspace/dist/index.html'),'active_assets_fingerprint':fingerprint(CURRENT/'apps/workspace/dist'),'before':before,'previous_deleted':previous_deleted,'entries':entries,'skipped':skipped}
 PLAN.write_text(json.dumps(plan,indent=2)+'\n');PLAN.chmod(0o600)
 print(json.dumps({'planned':len(entries),'previously_deleted':len(previous_deleted),'bytes':sum(x['allocated_bytes'] for x in entries),'by_kind':{k:sum(e['kind']==k for e in entries) for k in sorted({e['kind'] for e in entries})},'protected':plan['protected'],'skipped':skipped,'project_count':len(before['project_ids']),'plan_sha256':digest(PLAN)}))
elif mode=='apply':
 assert digest(PLAN)==sys.argv[2],'Plan changed'
 p=json.loads(PLAN.read_text());assert p['current']==str(CURRENT)
 assert digest(env_path)==p['env_sha'] and digest(CURRENT/'apps/workspace/dist/index.html')==p['active_index_sha']
 assert fingerprint(CURRENT/'apps/workspace/dist')==p['active_assets_fingerprint']
 assert service_state()['host_pid']==p['before']['host_pid']
 protected=set(p['protected'])|runtime_protected()
 # Validate every target before deleting any; the list cannot expand at apply time.
 for e in p['entries']:
  q=validate(Path(e['path']),e['kind'],protected);assert fingerprint(q)==e['fingerprint'],'Target changed: '+str(q)
 assert getattr(shutil.rmtree,'avoids_symlink_attacks',False)
 before_free=shutil.disk_usage(BASE).free;deleted=list(p.get('previous_deleted',[]));progress=STORE/'20261021-progress.json'
 progress.write_text(json.dumps({'plan_sha256':digest(PLAN),'free_bytes_before_resumed_phase':before_free,'deleted':deleted}));progress.chmod(0o600)
 for e in p['entries']:
  assert (BASE/'current').resolve()==CURRENT
  q=validate(Path(e['path']),e['kind'],protected)
  assert fingerprint(q)==e['fingerprint'],'Target changed: '+str(q)
  if q.is_dir():shutil.rmtree(q)
  else:q.unlink()
  deleted.append({k:v for k,v in e.items() if k!='fingerprint'});progress.write_text(json.dumps({'plan_sha256':digest(PLAN),'free_bytes_before_resumed_phase':before_free,'deleted':deleted}))
 after=service_state()
 assert digest(env_path)==p['env_sha'] and stat.S_IMODE(env_path.stat().st_mode)==0o600
 assert digest(CURRENT/'apps/workspace/dist/index.html')==p['active_index_sha'] and fingerprint(CURRENT/'apps/workspace/dist')==p['active_assets_fingerprint']
 assert after['host_pid']==p['before']['host_pid'] and set(p['before']['project_ids'])<=set(after['project_ids'])
 assert all(Path(x).exists() for x in p['protected']) and DATA.is_dir()
 assert all((CURRENT/name).exists() for name in ['node_modules','.venv']) and (CURRENT/'.venv/bin/python').is_file()
 report={'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorized_scope':p['authorization'],'deleted':deleted,'deleted_count':len(deleted),'allocated_bytes_removed':sum(x['allocated_bytes'] for x in deleted),'free_bytes_increase_resumed_phase':shutil.disk_usage(BASE).free-before_free,'previously_deleted_count':len(p.get('previous_deleted',[])),'initial_guard_pause':'Dangling links changed os.walk directory/file grouping;fixed ordering;alloriginalguardsretained','kept_releases':[str(x) for x in (BASE/'releases').iterdir()],'kept_ui_backups':sorted(str(x) for x in (CURRENT/'apps/workspace').glob('.dist-blue-*')),'current_unchanged':True,'active_frontend_files_unchanged':True,'env_content_and_mode_unchanged':True,'host_pid_unchanged':True,'host_restarted':False,'database_directory_untouched':True,'credentials_and_certificates_outside_cleanup_targets':True,'before_project_count':len(p['before']['project_ids']),'after_project_count':len(after['project_ids']),'ready_status':after['ready'],'capability_active':after['capability_active'],'skipped':p['skipped']}
 RECEIPT.write_text(json.dumps(report,indent=2)+'\n');RECEIPT.chmod(0o600)
 print(json.dumps(report))
elif mode=='finalize':
 assert digest(PLAN)==sys.argv[2],'Plan changed'
 p=json.loads(PLAN.read_text());progress=json.loads((STORE/'20261021-progress.json').read_text())
 assert progress['plan_sha256']==sys.argv[2] and p['current']==str(CURRENT)
 deleted=progress['deleted'];done={e['path'] for e in deleted}
 remaining=[e for e in p['entries'] if Path(e['path']).exists()]
 assert all(e['kind']=='bytecode_cache' for e in remaining),'Unexpected remaining targets'
 assert all(not Path(e['path']).exists() for e in deleted)
 assert {e['path'] for e in p['entries'] if not Path(e['path']).exists()}==done-{e['path'] for e in p.get('previous_deleted',[])}
 after=service_state()
 assert digest(env_path)==p['env_sha'] and stat.S_IMODE(env_path.stat().st_mode)==0o600
 assert digest(CURRENT/'apps/workspace/dist/index.html')==p['active_index_sha'] and fingerprint(CURRENT/'apps/workspace/dist')==p['active_assets_fingerprint']
 assert (BASE/'current').resolve()==CURRENT and after['host_pid']==p['before']['host_pid'] and set(p['before']['project_ids'])<=set(after['project_ids'])
 assert all(Path(x).exists() for x in p['protected']) and DATA.is_dir()
 assert all((CURRENT/name).exists() for name in ['node_modules','.venv']) and (CURRENT/'.venv/bin/python').is_file()
 report={'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorized_scope':p['authorization'],'deleted':deleted,'deleted_count':len(deleted),'allocated_bytes_removed':sum(x['allocated_bytes'] for x in deleted),'free_bytes_increase_resumed_phase':shutil.disk_usage(BASE).free-progress['free_bytes_before_resumed_phase'],'previously_deleted_count':len(p.get('previous_deleted',[])),'initial_guard_pause':'Dangling links changed traversal grouping;verified regression and fixed ordering;frozen path guards retained','kept_releases':[str(x) for x in (BASE/'releases').iterdir()],'kept_ui_backups':sorted(str(x) for x in (CURRENT/'apps/workspace').glob('.dist-blue-*')),'current_unchanged':True,'active_frontend_files_unchanged':True,'env_content_and_mode_unchanged':True,'host_pid_unchanged':True,'host_restarted':False,'database_directory_untouched':True,'credentials_and_certificates_outside_cleanup_targets':True,'before_project_count':len(p['before']['project_ids']),'after_project_count':len(after['project_ids']),'ready_status':after['ready'],'capability_active':after['capability_active'],'skipped':p['skipped']+[{'path':e['path'],'reason':'root-owned certificate-tool bytecode retained;no permission changes','remaining_bytes':size(Path(e['path']))} for e in remaining]}
 RECEIPT.write_text(json.dumps(report,indent=2)+'\n');RECEIPT.chmod(0o600)
 print(json.dumps(report))
else:raise AssertionError('Unknown mode')
