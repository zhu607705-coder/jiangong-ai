param(
  [string]$RemoteHost = '10.70.223.113',
  [string]$RemoteUser = 'zhuhangcheng',
  [string]$AllowedClient = '10.194.110.116',
  [string]$KnownHostsFile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/haizhizi-known-hosts'),
  [string]$ExpectedHostFingerprint = 'SHA256:cSL1ZahVyJgkLnPl0aLtu3AIs9/wvvJDP+GdiAA/1mk'
)
$ErrorActionPreference = 'Stop'
if ($RemoteHost -ne '10.70.223.113' -or $RemoteUser -ne 'zhuhangcheng') { throw 'This deployment is scoped to zhuhangcheng@10.70.223.113.' }
$parsedClient = $null
if (-not [Net.IPAddress]::TryParse($AllowedClient, [ref]$parsedClient) -or $parsedClient.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $parsedClient.ToString() -ne $AllowedClient) { throw 'AllowedClient must be a single IPv4 address, not a subnet.' }
if (-not (Test-Path -LiteralPath $KnownHostsFile)) { throw 'Use the previously verified target known_hosts file.' }
$fingerprints = & ssh-keygen -lf $KnownHostsFile
if ($LASTEXITCODE -ne 0 -or -not ($fingerprints -match [regex]::Escape($ExpectedHostFingerprint))) { throw 'SSH host fingerprint mismatch.' }
$remoteScript = @'
set -euo pipefail
umask 077
target_ip='10.70.223.113'
allowed_client='__ALLOWED_CLIENT__'
base="$HOME/apps/haizhizi"
test -f "$base/shared/server.env"
ip -o -4 address show | grep -F " $target_ip/" >/dev/null
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$base/shared/nginx-backups/$stamp"
mkdir -p "$backup"
fresh_install=0
if ! command -v nginx >/dev/null; then
  fresh_install=1
  # Prevent the package's default 0.0.0.0 listener from starting during install.
  sudo -n systemctl mask nginx.service
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
fi
for enabled in /etc/nginx/sites-enabled/*; do
  test -e "$enabled" || test -L "$enabled" || continue
  case "$enabled" in /etc/nginx/sites-enabled/default|/etc/nginx/sites-enabled/haizhizi.conf) ;; *) echo 'Unexpected enabled web site; stop before modifying it.' >&2; exit 1;; esac
done
default_link='/etc/nginx/sites-enabled/default'
if test -e "$default_link" || test -L "$default_link"; then
  test -L "$default_link"
  test "$(readlink -f "$default_link")" = '/etc/nginx/sites-available/default'
  dpkg-query -S /etc/nginx/sites-available/default | grep '^nginx-common:' >/dev/null
  expected_default_md5="$(dpkg-query -W -f='${Conffiles}\n' nginx-common | awk '$1=="/etc/nginx/sites-available/default" {print $2}')"
  test -n "$expected_default_md5"
  test "$(md5sum /etc/nginx/sites-available/default | cut -d ' ' -f1)" = "$expected_default_md5"
  sudo -n cp -a "$default_link" "$backup/default-enabled.link"
  sudo -n cp -p /etc/nginx/sites-available/default "$backup/default-site.conf"
  sudo -n rm -- "$default_link"
fi
if test -e /etc/nginx/sites-available/haizhizi.conf; then
  sudo -n cp -p /etc/nginx/sites-available/haizhizi.conf "$backup/haizhizi.conf.before"
fi
if test -L /etc/nginx/sites-enabled/haizhizi.conf; then
  test "$(readlink -f /etc/nginx/sites-enabled/haizhizi.conf)" = /etc/nginx/sites-available/haizhizi.conf
  sudo -n cp -a /etc/nginx/sites-enabled/haizhizi.conf "$backup/haizhizi-enabled.link.before"
elif test -e /etc/nginx/sites-enabled/haizhizi.conf; then
  echo 'Existing project enabled site is not the expected symlink.' >&2
  exit 1
fi
candidate="$backup/haizhizi.conf.new"
cat > "$candidate" <<'NGINX'
limit_req_zone $binary_remote_addr zone=haizhizi_public:10m rate=10r/s;

server {
    listen 10.70.223.113:80;
    server_name 10.70.223.113;

    client_max_body_size 12m;
    limit_req_status 429;
    access_log /var/log/nginx/haizhizi.access.log;
    error_log /var/log/nginx/haizhizi.error.log warn;

    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header Forwarded "";
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    # Six inspected, non-persistent query/calculation POST endpoints.
    location ~* ^/api/(?:projects/[^/]+/(?:knowledge/(?:retrieve|chunks|groups)|community-operations/preview|experiences/knowledge-match)|maps/geometry/wgs84)/?$ {
        limit_req zone=haizhizi_public burst=40 nodelay;
        limit_except GET POST {
            allow __ALLOWED_CLIENT__;
            allow 127.0.0.1;
            deny all;
        }
        proxy_pass http://127.0.0.1:4310;
    }

    location /api/ {
        limit_req zone=haizhizi_public burst=40 nodelay;
        limit_except GET {
            allow __ALLOWED_CLIENT__;
            allow 127.0.0.1;
            deny all;
        }
        proxy_pass http://127.0.0.1:4310;
    }

    location /_AMapService/ {
        limit_req zone=haizhizi_public burst=40 nodelay;
        limit_except GET {
            allow __ALLOWED_CLIENT__;
            allow 127.0.0.1;
            deny all;
        }
        proxy_pass http://127.0.0.1:4310;
    }

    location / {
        limit_except GET {
            allow __ALLOWED_CLIENT__;
            allow 127.0.0.1;
            deny all;
        }
        proxy_pass http://127.0.0.1:4310;
    }
}
NGINX
sudo -n install -m 0644 "$candidate" /etc/nginx/sites-available/haizhizi.conf
sudo -n ln -sfn /etc/nginx/sites-available/haizhizi.conf /etc/nginx/sites-enabled/haizhizi.conf
if ! sudo -n nginx -t; then
  if test -e "$backup/haizhizi.conf.before"; then
    sudo -n cp -p "$backup/haizhizi.conf.before" /etc/nginx/sites-available/haizhizi.conf
  else
    sudo -n rm -- /etc/nginx/sites-enabled/haizhizi.conf /etc/nginx/sites-available/haizhizi.conf
  fi
  echo "nginx validation failed; previous project configuration restored. Backups: $backup" >&2
  echo 'Fresh nginx remains masked; the unrestricted default site is not automatically started.' >&2
  exit 1
fi
BASE_DIR="$base" python3 - <<'PY'
import os,pathlib,secrets
path=pathlib.Path(os.environ['BASE_DIR'])/'shared'/'server.env'
before=path.read_bytes()
kept=''.join(line for line in before.decode('utf-8').splitlines(keepends=True) if not line.startswith(('TRUSTED_PUBLIC_ORIGIN=','PUBLIC_READ_ONLY=')))
if kept and not kept.endswith(('\r','\n')): kept+='\n'
updated=kept+'TRUSTED_PUBLIC_ORIGIN=http://10.70.223.113\nPUBLIC_READ_ONLY=true\n'
temporary=path.with_name('.server.env.ingress-'+secrets.token_hex(8)+'.tmp')
try:
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'wb') as stream:
        stream.write(updated.encode('utf-8'))
        stream.flush()
        os.fsync(stream.fileno())
    if path.read_bytes()!=before: raise RuntimeError('Server configuration changed concurrently; refusing to replace it.')
    temporary.replace(path)
finally:
    if temporary.exists(): temporary.unlink()
path.chmod(0o600)
PY
sudo -n systemctl unmask nginx.service
sudo -n systemctl enable nginx.service
if sudo -n systemctl is-active --quiet nginx.service; then
  sudo -n systemctl reload nginx.service
else
  sudo -n systemctl start nginx.service
fi
printf '\nIP_ACCESS_CONFIGURED\n'
printf 'url=http://%s\nallowed_client=%s/32\nbackup=%s\nfresh_install=%s\n' "$target_ip" "$allowed_client" "$backup" "$fresh_install"
printf 'public_reads=GET,HEAD and six inspected query POST paths\nwrite_device_restriction=%s/32 and 127.0.0.1\n' "$allowed_client"
sudo -n nginx -v
sudo -n systemctl is-active nginx.service
ss -ltn | awk 'NR==1 || $4 ~ /:(80|443|4310|4311)$/'
printf 'env_permissions='; stat -c '%a' "$base/shared/server.env"
printf 'Application host was not restarted; deploy the public read-only host version before enabling the viewer session.\n'
'@
$remoteScript = $remoteScript.Replace('__ALLOWED_CLIENT__', $AllowedClient)
$info = [Diagnostics.ProcessStartInfo]::new('ssh')
foreach ($argument in @('-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','-o',"UserKnownHostsFile=$KnownHostsFile","$RemoteUser@$RemoteHost",'bash -s')) { $info.ArgumentList.Add($argument) }
$info.UseShellExecute=$false
$info.RedirectStandardInput=$true
$info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
$process=[Diagnostics.Process]::Start($info)
$process.StandardInput.Write(($remoteScript -replace "`r",'')+"`n")
$process.StandardInput.Close()
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "IP entry configuration failed, exit $($process.ExitCode)." }
