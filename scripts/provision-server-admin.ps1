param(
  [switch]$Rotate,
  [string]$RemoteHost = '10.70.223.113',
  [string]$RemoteUser = 'zhuhangcheng',
  [string]$KnownHostsFile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/haizhizi-known-hosts'),
  [string]$CredentialFile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/server-admin-credentials.txt')
)
$ErrorActionPreference = 'Stop'
if ($RemoteHost -ne '10.70.223.113' -or $RemoteUser -ne 'zhuhangcheng') { throw 'This provisioning script is scoped to the approved server account.' }
if (-not (Test-Path -LiteralPath $KnownHostsFile)) { throw 'The verified SSH known_hosts file is required.' }
$fingerprints = & ssh-keygen -lf $KnownHostsFile
if ($LASTEXITCODE -ne 0 -or -not ($fingerprints -match [regex]::Escape('SHA256:cSL1ZahVyJgkLnPl0aLtu3AIs9/wvvJDP+GdiAA/1mk'))) { throw 'SSH host fingerprint mismatch.' }
$expectedCredentialPath = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/server-admin-credentials.txt'))
if ([IO.Path]::GetFullPath($CredentialFile) -ne $expectedCredentialPath) { throw 'Credentials must stay in the Git-ignored local .cache path.' }
$null = & git -C (Split-Path -Parent $PSScriptRoot) check-ignore -- $CredentialFile
if ($LASTEXITCODE -ne 0) { throw 'The credential file is not Git-ignored.' }
$createdCredentialFile = -not (Test-Path -LiteralPath $CredentialFile)
if ($createdCredentialFile) { $null = New-Item -ItemType File -Path $CredentialFile }
# Secure the empty/new file before receiving or writing any password.
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$security = [Security.AccessControl.FileSecurity]::new()
$security.SetOwner($currentSid)
$security.SetAccessRuleProtection($true, $false)
$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($currentSid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $CredentialFile -AclObject $security
$actualAcl = Get-Acl -LiteralPath $CredentialFile
$accessRules = @($actualAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if (-not $actualAcl.AreAccessRulesProtected -or $accessRules.Count -ne 1 -or $accessRules[0].IdentityReference.Value -ne $currentSid.Value -or $accessRules[0].IsInherited) { throw 'Credential ACL verification failed.' }
$remoteScript = @'
set -euo pipefail
umask 077
ROTATE_ADMIN='__ROTATE__' python3 - <<'PY'
import hashlib,json,os,pathlib,secrets
path=pathlib.Path.home()/'apps'/'haizhizi'/'shared'/'server.env'
before=path.read_bytes()
text=before.decode('utf-8')
existing={}
for line in text.splitlines():
    if '=' in line and not line.startswith('#'):
        key,value=line.split('=',1)
        existing[key]=value
rotate=os.environ['ROTATE_ADMIN']=='1'
if not rotate and (existing.get('ADMIN_USERNAME') or existing.get('ADMIN_PASSWORD_HASH')):
    raise SystemExit('ADMIN_ALREADY_CONFIGURED_USE_EXPLICIT_ROTATE')
password=secrets.token_urlsafe(24)
salt=secrets.token_bytes(16)
derived=hashlib.scrypt(password.encode('utf-8'),salt=salt,n=16384,r=8,p=1,dklen=64,maxmem=64*1024*1024)
encoded=f'scrypt${salt.hex()}${derived.hex()}'
kept=''.join(line for line in text.splitlines(keepends=True) if not line.startswith(('ADMIN_USERNAME=','ADMIN_PASSWORD_HASH=')))
if kept and not kept.endswith(('\n','\r')): kept+='\n'
updated=kept+'ADMIN_USERNAME=zhuhangcheng\nADMIN_PASSWORD_HASH='+encoded+'\n'
if path.read_bytes()!=before: raise SystemExit('ENV_CHANGED_RETRY_REQUIRED')
temporary=path.with_name('.server.env.admin-'+secrets.token_hex(8)+'.tmp')
try:
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'wb') as stream:
        stream.write(updated.encode('utf-8'))
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    path.chmod(0o600)
finally:
    if temporary.exists(): temporary.unlink()
# This stdout is captured in memory by the local process, never displayed.
print(json.dumps({'configured':True,'username':'zhuhangcheng','password':password,'rotated':rotate}))
PY
'@
$remoteScript = $remoteScript.Replace('__ROTATE__', $(if ($Rotate) { '1' } else { '0' }))
$capturedOutput = $null
$admin = $null
try {
  $info = [Diagnostics.ProcessStartInfo]::new('ssh')
  foreach ($argument in @('-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','-o',"UserKnownHostsFile=$KnownHostsFile","$RemoteUser@$RemoteHost",'bash -s')) { $info.ArgumentList.Add($argument) }
  $info.UseShellExecute=$false
  $info.RedirectStandardInput=$true
  $info.RedirectStandardOutput=$true
  $info.RedirectStandardError=$true
  $info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
  $process=[Diagnostics.Process]::Start($info)
  $process.StandardInput.Write(($remoteScript -replace "`r",'')+"`n")
  $process.StandardInput.Close()
  $capturedOutput=$process.StandardOutput.ReadToEnd()
  $capturedError=$process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    if ($capturedError -match 'ADMIN_ALREADY_CONFIGURED') { throw 'Administrator already configured; no reset performed. Use -Rotate explicitly to replace it.' }
    throw "Administrator provisioning failed with exit $($process.ExitCode); no remote output displayed."
  }
  $admin=$capturedOutput | ConvertFrom-Json
  if (-not $admin.configured -or $admin.username -ne 'zhuhangcheng' -or $admin.password.Length -lt 22) { throw 'Invalid provisioning response.' }
  $credentialText = "网址：http://10.70.223.113/`n账号：zhuhangcheng`n密码：$($admin.password)`n`n此文件仅供当前 Windows 用户保管，不要提交或公开分享。`n建议首次登录后通过服务器管理脚本 provision-server-admin.ps1 -Rotate 轮换密码，再重启宿主服务使新配置生效。`n"
  [IO.File]::WriteAllText($CredentialFile, $credentialText, [Text.UTF8Encoding]::new($false))
  Write-Output ([pscustomobject]@{Configured=$true;Username='zhuhangcheng';CredentialFile=$CredentialFile})
}
finally {
  $credentialText=$null
  $capturedOutput=$null
  $capturedError=$null
  $admin=$null
  if ($createdCredentialFile -and (Test-Path -LiteralPath $CredentialFile) -and (Get-Item -LiteralPath $CredentialFile).Length -eq 0) { Remove-Item -LiteralPath $CredentialFile -Force }
}
