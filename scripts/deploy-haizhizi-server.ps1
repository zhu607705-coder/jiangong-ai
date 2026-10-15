param(
  [string]$RemoteHost = '10.70.223.113',
  [string]$RemoteUser = 'zhuhangcheng',
  [string]$ExpectedHostFingerprint = 'SHA256:cSL1ZahVyJgkLnPl0aLtu3AIs9/wvvJDP+GdiAA/1mk',
  [string]$NodeVersion = '24.22.0',
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Stop'
if ($RemoteHost -notmatch '^[A-Za-z0-9.-]+$' -or $RemoteUser -notmatch '^[a-z_][a-z0-9_-]*$') { throw 'Invalid SSH target.' }
if ($NodeVersion -notmatch '^24\.\d+\.\d+$') { throw 'Use a pinned Node 24 release.' }
$commit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Cannot resolve Git HEAD.' }
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('haizhizi-deploy-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temporaryRoot
$knownHosts = Join-Path $temporaryRoot 'known_hosts'
$archive = Join-Path $temporaryRoot 'source.tar.gz'
$target = "$RemoteUser@$RemoteHost"
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-o', "UserKnownHostsFile=$knownHosts")
function Invoke-RemoteScript([string]$Script) {
  $info = [Diagnostics.ProcessStartInfo]::new('ssh')
  foreach ($argument in ($sshOptions + @($target, 'bash -s'))) { $info.ArgumentList.Add($argument) }
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
  $process = [Diagnostics.Process]::Start($info)
  $process.StandardInput.Write(($Script -replace "`r", '') + "`n")
  $process.StandardInput.Close()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "Remote deployment step exited $($process.ExitCode)." }
}
try {
  & ssh @sshOptions $target 'true'
  if ($LASTEXITCODE -ne 0) { throw 'SSH authentication failed.' }
  $fingerprints = & ssh-keygen -lf $knownHosts
  if ($LASTEXITCODE -ne 0 -or -not ($fingerprints -match [regex]::Escape($ExpectedHostFingerprint))) { throw 'SSH host fingerprint does not match the recorded target.' }
  # Only committed application/reproduction inputs; no local DB, credentials,
  # caches, unrelated workspaces, or working-tree document changes.
  $archivePaths = @('apps', 'packages', 'runtime', 'services', 'scripts', 'contracts', 'data', 'fixtures', 'ported', 'vendor', 'tests', 'examples', 'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'requirements.lock.txt', 'requirements.txt', 'README.md', 'THIRD_PARTY_NOTICES.md', 'licenses', 'research/training/cost-neural-prototype/synthetic-dataset.json', 'research/training/cost-neural-prototype/workbook-dataset.json', 'research/test_results/scientific-methods-results.json')
  & git -C $RepositoryRoot archive --format=tar.gz --output=$archive HEAD @archivePaths
  if ($LASTEXITCODE -ne 0) { throw 'Source archive failed.' }
  $archiveSha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  Invoke-RemoteScript 'set -eu; umask 077; mkdir -p "$HOME/apps/haizhizi/incoming"'
  & scp @sshOptions $archive "${target}:apps/haizhizi/incoming/source-$commit.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'Source upload failed.' }
  $remoteScript = @'
set -euo pipefail
umask 077
commit='__COMMIT__'
archive_sha='__ARCHIVE_SHA__'
node_version='__NODE_VERSION__'
base="$HOME/apps/haizhizi"
release="$base/releases/$commit-$(date -u +%Y%m%dT%H%M%SZ)"
archive="$base/incoming/source-$commit.tar.gz"
printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum --check --status
test "$(uname -m)" = x86_64
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3.12-venv ca-certificates xz-utils
mkdir -p "$base/toolchain" "$base/shared/data" "$release" "$HOME/.config/systemd/user"
node_name="node-v${node_version}-linux-x64"
if [ ! -x "$base/toolchain/$node_name/bin/node" ]; then
  cd "$base/incoming"
  curl --fail --location --retry 1 --connect-timeout 10 --max-time 180 -o "$node_name.tar.xz" "https://nodejs.org/dist/v${node_version}/$node_name.tar.xz"
  curl --fail --location --connect-timeout 10 --max-time 30 -o "SHASUMS256-$node_version.txt" "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt"
  grep "  $node_name.tar.xz$" "SHASUMS256-$node_version.txt" | sha256sum --check
  tar -xJf "$node_name.tar.xz" -C "$base/toolchain"
fi
ln -sfn "$base/toolchain/$node_name" "$base/toolchain/node"
export PATH="$base/toolchain/node/bin:$PATH"
tar -xzf "$archive" -C "$release"
cd "$release"
printf '%s\n' "$commit" > DEPLOYED_COMMIT
python3 -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.lock.txt
npm ci --no-audit --no-fund
npm run build
.venv/bin/python -m pip freeze > "$base/shared/python-installed.txt"
if [ ! -f "$base/shared/server.env" ]; then
  BASE_DIR="$base" python3 - <<'PY'
import os, pathlib, secrets
base = pathlib.Path(os.environ['BASE_DIR'])
values = {'HOST':'127.0.0.1', 'PORT':'4310', 'CAPABILITY_PORT':'4311', 'WORKSPACE_PORT':'15173',
          'DATA_DIR':str(base/'shared'/'data'), 'CAPABILITY_TOKEN':secrets.token_hex(32),
          'DEEPSEEK_MODEL':'deepseek-flash', 'QWEN_DECISION_ENABLED':'false',
          'QWEN_DECISION_MODEL':'decision-model-preview',
          'QWEN_DECISION_ENDPOINT':'https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
          'NODE_USE_ENV_PROXY':'1', 'NO_PROXY':'127.0.0.1,localhost',
          'ALLOW_INTERNAL_MODEL':'false', 'INTELLIGENCE_COLLECTION_ENABLED':'false', 'INTELLIGENCE_MODEL_ENABLED':'false'}
path=base/'shared'/'server.env'
path.write_text(''.join(f'{key}={value}\n' for key,value in values.items()), encoding='utf-8')
path.chmod(0o600)
PY
fi
chmod 600 "$base/shared/server.env"
cat > "$HOME/.config/systemd/user/haizhizi-capabilities.service" <<EOF
[Unit]
Description=Haizhizi professional capabilities (loopback)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$base/current
EnvironmentFile=$base/shared/server.env
Environment=PYTHONUNBUFFERED=1
ExecStart=$base/current/.venv/bin/python -m uvicorn services.capabilities.app:app --host 127.0.0.1 --port 4311 --no-access-log
Restart=on-failure
RestartSec=3
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF
cat > "$HOME/.config/systemd/user/haizhizi-host.service" <<EOF
[Unit]
Description=Haizhizi decision workbench (loopback)
After=network-online.target haizhizi-capabilities.service
Wants=haizhizi-capabilities.service

[Service]
Type=simple
WorkingDirectory=$base/current
EnvironmentFile=$base/shared/server.env
Environment=PATH=$base/toolchain/node/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$base/toolchain/node/bin/node --use-env-proxy --import tsx apps/host/server.ts
Restart=on-failure
RestartSec=3
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF
ln -sfn "$release" "$base/current"
sudo -n loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable haizhizi-capabilities.service haizhizi-host.service
systemctl --user restart haizhizi-capabilities.service haizhizi-host.service
ready=0
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:4310/health >/dev/null && curl --fail --silent http://127.0.0.1:4311/health >/dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  systemctl --user --no-pager --full status haizhizi-host.service haizhizi-capabilities.service
  exit 1
fi
python3 - <<'PY'
import http.cookiejar, json, urllib.request, urllib.error
base='http://127.0.0.1:4310'
checks={}
client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
with client.open(base+'/health') as response:
    assert response.status == 200
    checks['/health']={'status':response.status,'body':json.load(response)}
try:
    with client.open(base+'/api/session') as response:
        session_status=response.status
        session_body=json.load(response)
        checks['/api/session']={'status':response.status,'body':session_body}
except urllib.error.HTTPError as response:
    session_status=response.code
    body=json.load(response)
    assert response.code == 401 and body.get('code') == 'ADMIN_LOGIN_REQUIRED'
    checks['/api/session']={'status':response.code,'authentication_required':True}
admin_mode=session_status == 401
public_viewer=not admin_mode and session_body.get('authentication',{}).get('role') == 'viewer'
try:
    with client.open(base+'/api/ready') as response:
        assert not admin_mode and not public_viewer and response.status == 200
        checks['/api/ready']={'status':response.status,'body':json.load(response)}
except urllib.error.HTTPError as response:
    assert (admin_mode and response.code == 401) or (public_viewer and response.code == 403)
    checks['/api/ready']={'status':response.code,'authentication_required':True}
with urllib.request.urlopen(base+'/') as response:
    body=response.read().decode()
    if admin_mode:
        assert 'id="login"' in body and '/assets/' not in body
    else:
        assert '<div id="root"></div>' in body and '/assets/' in body
    checks['/']={'status':response.status,'independent_login_shell':admin_mode,'production_assets':'/assets/' in body}
print(json.dumps(checks,ensure_ascii=False,indent=2))
PY
printf '\nDEPLOYED_COMMIT=%s\n' "$commit"
printf 'NODE_VERSION='; node --version
printf 'PYTHON_VERSION='; .venv/bin/python --version
printf '\nLISTENERS\n'; ss -ltn | grep -E ':(22|4310|4311)\b'
printf '\nUSER_SERVICES\n'; systemctl --user is-active haizhizi-host.service haizhizi-capabilities.service
loginctl show-user "$USER" -p Linger
printf '\nENV_PERMISSIONS\n'; stat -c '%a %n' "$base/shared/server.env"
'@
  $remoteScript = $remoteScript.Replace('__COMMIT__', $commit).Replace('__ARCHIVE_SHA__', $archiveSha).Replace('__NODE_VERSION__', $NodeVersion)
  Invoke-RemoteScript $remoteScript
  Write-Output "Deployment complete: $commit, source SHA256 $archiveSha"
  Write-Output "SSH tunnel: ssh -N -L 15173:127.0.0.1:4310 $target"
}
finally {
  $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
  $resolvedSystemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolvedTemporaryRoot.StartsWith($resolvedSystemTemp, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemporaryRoot).StartsWith('haizhizi-deploy-')) {
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
