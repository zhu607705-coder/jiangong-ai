param([Parameter(Mandatory=$true)][string]$Commit,[switch]$Execute,[string]$ReceiptPath='research/test_results/blue-theme-deployment-20261016.json',[string]$BuildPath='.cache/blue-workbench-release')
$ErrorActionPreference='Stop'
if($Commit-notmatch'^[a-f0-9]{40}$'){throw 'Expected full commit SHA'}
if(-not$Execute){Write-Output 'Prepared; pass -Execute for the authorized UI-only deployment.';return}
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$buildRoot=Join-Path $taskRoot $BuildPath
if((git -C $buildRoot rev-parse HEAD).Trim()-ne$Commit){throw 'Isolated build commit mismatch'}
git -C $buildRoot diff --quiet $Commit -- apps packages runtime services package.json package-lock.json
if($LASTEXITCODE-ne0){throw 'Isolated build sources changed'}
$dist=Join-Path $buildRoot 'apps/workspace/dist'
foreach($entry in Get-ChildItem -LiteralPath $dist -Recurse -Force){
 if($entry.Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'UI archive may not contain links'}
 if($entry.Name-match'^\.env'-or$entry.Name-ieq'server.env'){throw 'Environment file in UI archive'}
}
$archive=Join-Path $taskRoot ".cache/blue-ui-$Commit.tar.gz"
tar -czf $archive -C $dist .
if($LASTEXITCODE-ne0){throw 'UI archive failed'}
$archiveHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
$indexHash=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dist 'index.html')).Hash.ToLowerInvariant()
$knownHosts=Join-Path $taskRoot '.cache/haizhizi-known-hosts'
$sshOptions=@('-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o',"UserKnownHostsFile=$knownHosts")
$target='zhuhangcheng@10.70.223.113'
$uiStateCode=@'
import pathlib,hashlib,json
base=pathlib.Path('/home/zhuhangcheng/apps/haizhizi')
release=(base/'current').resolve(strict=True)
index=release/'apps/workspace/dist/index.html'
digest=hashlib.sha256(index.read_bytes()).hexdigest()
for receipt in sorted((base/'shared').glob('blue-theme-deployment-*.json'),key=lambda p:p.stat().st_mtime,reverse=True):
 data=json.loads(receipt.read_text())
 if data.get('index_sha256')==digest:
  print(json.dumps({'commit':data['commit'],'index_sha256':digest}));break
else:raise RuntimeError('Current server UI has no matching deployment receipt')
'@
$uiStateInfo=[Diagnostics.ProcessStartInfo]::new('ssh')
foreach($argument in ($sshOptions+@($target,'python3 -'))){$uiStateInfo.ArgumentList.Add($argument)}
$uiStateInfo.UseShellExecute=$false;$uiStateInfo.RedirectStandardInput=$true;$uiStateInfo.RedirectStandardOutput=$true
$uiStateInfo.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
$uiStateProcess=[Diagnostics.Process]::Start($uiStateInfo)
$uiStateProcess.StandardInput.Write($uiStateCode.Replace([string][char]13,'')+[string][char]10);$uiStateProcess.StandardInput.Close()
$uiStateOutput=$uiStateProcess.StandardOutput.ReadToEnd();$uiStateProcess.WaitForExit()
if($uiStateProcess.ExitCode-ne0){throw 'Cannot identify the currently deployed UI'}
$observedUI=$uiStateOutput.Trim()|ConvertFrom-Json
if($observedUI.commit-notmatch'^[a-f0-9]{40}$'-or$observedUI.index_sha256-notmatch'^[a-f0-9]{64}$'){throw 'Invalid deployed UI identity'}
git -C $buildRoot merge-base --is-ancestor $observedUI.commit $Commit
$includesDeployedUI=$LASTEXITCODE-eq0
if(-not$includesDeployedUI){
 git -C $buildRoot diff --quiet $observedUI.commit $Commit -- apps/workspace packages package.json package-lock.json
 if($LASTEXITCODE-ne0){throw "Candidate would replace a newer independent UI. Merge deployed commit $($observedUI.commit) before publishing."}
}

$remoteArchive="/home/zhuhangcheng/apps/haizhizi/shared/blue-ui-$Commit.tar.gz"
& scp -q @sshOptions $archive "$($target):$remoteArchive"
if($LASTEXITCODE-ne0){throw 'UI upload failed'}
$remote=@'
import pathlib,hashlib,json,datetime,ctypes,os,tarfile,shutil,subprocess,urllib.request
base=pathlib.Path('/home/zhuhangcheng/apps/haizhizi')
release=(base/'current').resolve(strict=True)
assert release.is_relative_to(base/'releases')
dist=release/'apps/workspace/dist'
assert dist.is_dir() and not dist.is_symlink() and dist.resolve().is_relative_to(release)
archive=pathlib.Path('__ARCHIVE__')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(archive)=='__ARCHIVE_HASH__'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
candidate=dist.parent/('.dist-blue-__COMMIT__-'+stamp)
assert not candidate.exists() and candidate.parent.resolve()==dist.parent.resolve()
files=['apps/host/server.ts','packages/retrofit/strategy.ts','runtime/dsh/live-session.ts','runtime/dsh/json-format-repair.ts','runtime/workflows/renewal-research.ts','runtime/agents/renewal/AGENTS.md']
fingerprint=lambda:{name:sha(release/name) if (release/name).is_file() else None for name in files}
backend_before=fingerprint()
pid=lambda:subprocess.check_output(['systemctl','--user','show','haizhizi-host.service','--property=MainPID','--value'],text=True).strip()
pid_before=pid()
nginx=pathlib.Path('/etc/nginx/sites-available/haizhizi.conf')
nginx_before=sha(nginx)
old_index_sha=sha(dist/'index.html')
assert old_index_sha=='__EXPECTED_INDEX_HASH__','UI changed after source preflight; stop before swapping'
shutil.copytree(dist,candidate)
with tarfile.open(archive,'r:gz') as bundle:
 members=bundle.getmembers()
 assert sum(member.size for member in members)<100_000_000
 for member in members:
  p=pathlib.PurePosixPath(member.name)
  assert not p.is_absolute() and '..' not in p.parts and (member.isfile() or member.isdir())
  assert not any(part.startswith('.env') or part=='server.env' for part in p.parts)
 bundle.extractall(candidate,filter='data')
assert sha(candidate/'index.html')=='__INDEX_HASH__'
libc=ctypes.CDLL(None,use_errno=True)
exchange=libc.renameat2
exchange.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
exchange.restype=ctypes.c_int
def swap():
 if exchange(-100,os.fsencode(dist),-100,os.fsencode(candidate),2)!=0:
  number=ctypes.get_errno();raise OSError(number,os.strerror(number))
assert (base/'current').resolve()==release and fingerprint()==backend_before
client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
swapped=False
try:
 assert sha(dist/'index.html')==old_index_sha,'Another UI was published during archive preparation'
 swap();swapped=True
 assert sha(dist/'index.html')=='__INDEX_HASH__' and sha(candidate/'index.html')==old_index_sha
 with client.open('http://127.0.0.1:4310/health',timeout=10) as response:assert json.load(response)['status']=='ok'
 request=urllib.request.Request('http://10.70.223.113/',headers={'Host':'10.70.223.113'})
 with client.open(request,timeout=10) as response:served=response.read()
 assert hashlib.sha256(served).hexdigest()=='__INDEX_HASH__'
 assert fingerprint()==backend_before and pid()==pid_before and sha(nginx)==nginx_before
 assert (base/'current').resolve()==release
 receipt={'status':'ui_only_deployed','commit':'__COMMIT__','release':str(release),'backup_dist':str(candidate),
 'archive_sha256':'__ARCHIVE_HASH__','index_sha256':'__INDEX_HASH__','old_index_sha256':old_index_sha,
 'backend_files_before':backend_before,'backend_files_after':fingerprint(),'host_pid_before':pid_before,'host_pid_after':pid(),
 'nginx_sha256':nginx_before,'backend_unchanged':True,'host_restarted':False,'database_operations':0,'provider_calls':0,
 'old_assets_retained':True,'atomic_exchange':True,'baseline_index_guarded':True,'previous_ui_commit':'__PREVIOUS_UI_COMMIT__','checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 (base/'shared'/'blue-theme-deployment-__COMMIT__.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps(receipt))
except:
 if swapped and (base/'current').resolve()==release and sha(dist/'index.html')=='__INDEX_HASH__':swap()
 raise
'@
$remote=$remote.Replace('__COMMIT__',$Commit).Replace('__ARCHIVE__',$remoteArchive).Replace('__ARCHIVE_HASH__',$archiveHash).Replace('__INDEX_HASH__',$indexHash).Replace('__EXPECTED_INDEX_HASH__',$observedUI.index_sha256).Replace('__PREVIOUS_UI_COMMIT__',$observedUI.commit)
$info=[Diagnostics.ProcessStartInfo]::new('ssh')
foreach($argument in ($sshOptions+@($target,'python3 -'))){$info.ArgumentList.Add($argument)}
$info.UseShellExecute=$false;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true
$info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
$process=[Diagnostics.Process]::Start($info)
$process.StandardInput.Write($remote.Replace([string][char]13,'')+[string][char]10);$process.StandardInput.Close()
$stdout=$process.StandardOutput.ReadToEnd();$process.WaitForExit()
if($process.ExitCode-ne0){throw 'UI-only deploy did not pass. Inspect remote state before retry.'}
[IO.File]::WriteAllText((Join-Path $taskRoot $ReceiptPath),$stdout.Trim()+[string][char]10,[Text.UTF8Encoding]::new($false))
$stdout.Trim()
