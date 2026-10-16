"""Install the existing Let's Encrypt certificate on the campus workbench.

Run as zhuhangcheng over the existing verified SSH connection. Does not request
certificates, grant DNS permissions, or enable an untested renewal timer.
"""
import datetime
import fcntl
import hashlib
import http.cookiejar
import json
import os
import pathlib
import subprocess
import time
import urllib.request


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def atomic(path, data, mode):
    temporary = path.with_name(path.name + f'.https-{os.getpid()}.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


base = pathlib.Path.home() / 'apps/haizhizi'
release = (base / 'current').resolve(strict=True)
assert release.is_relative_to(base / 'releases')
lock = (base / 'shared/domain-publication.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
nginx = pathlib.Path('/etc/nginx/sites-available/haizhizi.conf')
environment = base / 'shared/server.env'
nginx_before, env_before = nginx.read_bytes(), environment.read_bytes()
index_before = hashlib.sha256((release / 'apps/workspace/dist/index.html').read_bytes()).hexdigest()
lineage = '/etc/letsencrypt/live/laneanew.cn'
run('sudo', '-n', 'openssl', 'verify', '-untrusted', lineage + '/chain.pem', lineage + '/cert.pem')
run('sudo', '-n', 'openssl', 'x509', '-in', lineage + '/cert.pem', '-checkend', '604800', '-noout')
certificate = run('sudo', '-n', 'openssl', 'x509', '-in', lineage + '/cert.pem', '-noout', '-issuer', '-dates', '-ext', 'subjectAltName')
assert 'DNS:laneanew.cn' in certificate and 'DNS:www.laneanew.cn' in certificate
assert 'COLLABORATIVE_WORKSPACE=true' in env_before.decode()

# Same read-only running-work check as the HTTP domain deployment. Never open
# the production PGlite database in a second process.
client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
    return json.load(client.open('http://10.70.223.113' + path, timeout=15))

get('/api/session')
projects = get('/api/projects')
for project in projects:
    record = get('/api/projects/' + project['id'])
    assert not any(item['status'] == 'running' for item in record['runs']), 'Analysis still running'
    if record['input'].get('business_profile') == 'neighborhood':
        rounds = get('/api/projects/' + project['id'] + '/research-rounds')
        assert not any(item['status'] == 'running' for item in rounds['rounds']), 'Research round still running'
    time.sleep(0.22)
assert not any(item['status'] == 'running' for item in get('/api/intelligence/status')['jobs'])
assert not run('ss', '-Htn', 'state', 'established', '( sport = :4310 )'), 'Active host request'

text = nginx_before.decode()
names = '    server_name 10.70.223.113 laneanew.cn www.laneanew.cn;'
assert text.count('server {') == 1 and text.count(names) == 1
prefix, body = text.split('server {', 1)
http_ip = 'server {' + body.replace(names, '    server_name 10.70.223.113;')
tls = 'server {' + body.replace('listen 10.70.223.113:80;', 'listen 10.70.223.113:443 ssl http2;').replace(names, '    server_name laneanew.cn www.laneanew.cn;')
tls_options = f'''    ssl_certificate {lineage}/fullchain.pem;
    ssl_certificate_key {lineage}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:HaizhiziTLS:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

'''
tls = tls.replace('    client_max_body_size', tls_options + '    client_max_body_size', 1)
redirect = '''server {
    listen 10.70.223.113:80;
    server_name laneanew.cn www.laneanew.cn;
    return 308 https://$host$request_uri;
}
'''
nginx_after = (prefix + http_ip + '\n' + redirect + '\n' + tls).encode()
env_lines = env_before.decode().splitlines()
alias_line = next(line for line in env_lines if line.startswith('TRUSTED_PUBLIC_ORIGINS='))
aliases = list(dict.fromkeys(alias_line.split('=', 1)[1].split(',') + ['https://laneanew.cn', 'https://www.laneanew.cn']))
env_after = ('\n'.join('TRUSTED_PUBLIC_ORIGINS=' + ','.join(aliases) if line == alias_line else line for line in env_lines) + '\n').encode()
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = base / 'shared/https-backups' / stamp
backup.mkdir(parents=True, mode=0o700)
(backup / 'nginx.before.conf').write_bytes(nginx_before)
(backup / 'server.env.before').write_bytes(env_before)
(backup / 'server.env.before').chmod(0o600)
candidate = backup / 'nginx.after.conf'
candidate.write_bytes(nginx_after)
assert (base / 'current').resolve() == release and environment.read_bytes() == env_before and nginx.read_bytes() == nginx_before
try:
    atomic(environment, env_after, 0o600)
    run('sudo', '-n', 'install', '-m', '0644', str(candidate), str(nginx))
    run('sudo', '-n', 'nginx', '-t')
    run('systemctl', '--user', 'restart', 'haizhizi-host.service')
    for attempt in range(20):
        try:
            health = urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:4310/health', timeout=2)
            if health.status == 200:
                break
        except OSError:
            time.sleep(1)
    else:
        raise RuntimeError('Host not ready')
    run('sudo', '-n', 'systemctl', 'reload', 'nginx.service')
    for domain in ['laneanew.cn', 'www.laneanew.cn']:
        assert run('curl', '--noproxy', '*', '--resolve', domain + ':443:10.70.223.113', '--max-time', '10', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://' + domain + '/') == '200'
except BaseException:
    atomic(environment, env_before, 0o600)
    run('sudo', '-n', 'install', '-m', '0644', str(backup / 'nginx.before.conf'), str(nginx))
    run('sudo', '-n', 'nginx', '-t')
    run('systemctl', '--user', 'restart', 'haizhizi-host.service')
    run('sudo', '-n', 'systemctl', 'reload', 'nginx.service')
    raise

assert index_before == hashlib.sha256((release / 'apps/workspace/dist/index.html').read_bytes()).hexdigest()
receipt = {'configured_at': stamp, 'domains': ['laneanew.cn', 'www.laneanew.cn'], 'certificate': certificate,
    'https_status': 200, 'http_domain_redirect': 308, 'campus_ip_http_preserved': True,
    'backup': str(backup), 'ui_unchanged': True, 'checked_projects_before_restart': len(projects),
    'host_main_pid': run('systemctl', '--user', 'show', 'haizhizi-host.service', '-p', 'MainPID', '--value'),
    'renewal': 'DNS credentials and automated authentication verification pending', 'model_calls': 0}
(backup / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
print(json.dumps(receipt, ensure_ascii=False))
