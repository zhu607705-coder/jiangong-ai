"""Install an existing Tencent WSA service key from a private local file, without logging it."""
import argparse,json,pathlib,re,subprocess

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--key-file',required=True)
parser.add_argument('--known-hosts',default='D:/建工ai/.cache/haizhizi-known-hosts')
args=parser.parse_args()
key_path=pathlib.Path(args.key_file).resolve(strict=True)
root=pathlib.Path(__file__).resolve().parents[1]
common=pathlib.Path(subprocess.check_output(['git','rev-parse','--path-format=absolute','--git-common-dir'],cwd=root,text=True).strip()).parent
if key_path.is_relative_to(root) or key_path.is_relative_to(common):parser.error('Keep the key outside this repository and its main workspace.')
key=key_path.read_text(encoding='utf-8-sig').strip()
if not re.fullmatch(r'[A-Za-z0-9_.\-]{16,500}',key):parser.error('Expected one service API Key, not a JSON credential file or shell command.')
remote=r'''
from pathlib import Path
import json,os,datetime
key=__KEY__
p=Path('/home/zhuhangcheng/apps/haizhizi/shared/server.env')
assert p.is_file() and not p.is_symlink()
before=p.read_bytes()
backup=p.parent/'credential-backups'/('server.env.before-wsa-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
backup.parent.mkdir(mode=0o700,exist_ok=True)
fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as f:f.write(before)
values={'TENCENTCLOUD_WSA_APIKEY':key,'RESEARCH_WEB_PROVIDER':'tencent_wsa','TENCENT_WSA_MONTHLY_LIMIT':'2000'}
lines=[];seen=set()
for line in before.decode().splitlines():
 name=line.split('=',1)[0].strip()
 if name in values:
  if name not in seen:lines.append(name+'='+values[name]);seen.add(name)
 else:lines.append(line)
lines += [k+'='+v for k,v in values.items() if k not in seen]
temp=p.with_name('server.env.wsa-'+str(os.getpid()))
fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w',encoding='utf-8') as f:f.write('\n'.join(lines)+'\n')
os.replace(temp,p)
assert (p.stat().st_mode&0o777)==0o600
print(json.dumps({'configured':True,'provider':'tencent_wsa','monthly_limit':2000,'key_stored_in_server_env':True,'mode':'0600','restart_performed':False}))
'''.replace('__KEY__',json.dumps(key))
ssh=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(pathlib.Path(args.known_hosts).resolve()),'zhuhangcheng@10.70.223.113','python3 -']
r=subprocess.run(ssh,input=remote.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if r.returncode:raise SystemExit('Server configuration failed. Secret input and remote stderr were not printed.')
print(r.stdout.decode().strip())
