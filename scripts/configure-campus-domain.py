"""Apply the laneanew.cn campus entry to the existing host over verified SSH.

Input is a JSON packet containing only the two origin-policy source files.
DNS is managed separately in the domain owner's Aliyun console.
"""
import base64
import datetime
import fcntl
import hashlib
import http.cookiejar
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, data, mode=0o600):
    temporary = path.with_name(path.name + f'.domain-{os.getpid()}.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


packet = json.load(sys.stdin)
base = pathlib.Path.home() / 'apps/haizhizi'
release = (base / 'current').resolve(strict=True)
assert release.is_relative_to(base / 'releases')
assert set(packet['files']) == {'apps/host/config.ts', 'apps/host/request-origin.ts'}
lock = (base / 'shared/domain-publication.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
nginx = pathlib.Path('/etc/nginx/sites-available/haizhizi.conf')
environment = base / 'shared/server.env'
original = {path: (release / path).read_bytes() for path in packet['files']}
for path, item in packet['files'].items():
    assert sha(original[path]) == item['expected_before_sha256'], f'Concurrent source update: {path}'
    assert sha(base64.b64decode(item['base64'])) == item['sha256']
nginx_before = nginx.read_bytes()
env_before = environment.read_bytes()
index_before = sha((release / 'apps/workspace/dist/index.html').read_bytes())
assert 'COLLABORATIVE_WORKSPACE=true' in env_before.decode()
assert nginx_before.decode().count('server_name 10.70.223.113;') == 1
assert 'listen 10.70.223.113:80;' in nginx_before.decode()

# Use the running host's read APIs; never open the live PGlite database twice.
client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def get(path):
    try:
        return json.load(client.open('http://10.70.223.113' + path, timeout=15))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{path}: {error.code} {error.read(500).decode()}') from error

get('/api/session')
projects = get('/api/projects')
for project in projects:
    record = get('/api/projects/' + project['id'])
    assert not any(item['status'] == 'running' for item in record['runs']), 'An analysis is still running'
    if record['input'].get('business_profile') == 'neighborhood':
        rounds = get('/api/projects/' + project['id'] + '/research-rounds')
        assert not any(item['status'] == 'running' for item in rounds['rounds']), 'A research round is still running'
    time.sleep(0.22)
jobs = get('/api/intelligence/status')['jobs']
assert not any(item['status'] == 'running' for item in jobs), 'An intelligence job is still running'
assert not run('ss', '-Htn', 'state', 'established', '( sport = :4310 )'), 'Host requests are still active'

stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = base / 'shared/domain-backups' / stamp
backup.mkdir(parents=True, mode=0o700)
for path, data in original.items():
    destination = backup / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
(backup / 'server.env.before').write_bytes(env_before)
(backup / 'server.env.before').chmod(0o600)
(backup / 'nginx.before.conf').write_bytes(nginx_before)
nginx_after = nginx_before.decode().replace('server_name 10.70.223.113;', 'server_name 10.70.223.113 laneanew.cn www.laneanew.cn;').encode()
env_lines = [line for line in env_before.decode().splitlines() if not line.startswith('TRUSTED_PUBLIC_ORIGINS=')]
env_after = ('\n'.join(env_lines) + '\nTRUSTED_PUBLIC_ORIGINS=http://laneanew.cn,http://www.laneanew.cn\n').encode()
candidate = backup / 'nginx.after.conf'
candidate.write_bytes(nginx_after)
assert (base / 'current').resolve() == release
assert environment.read_bytes() == env_before and nginx.read_bytes() == nginx_before

try:
    for path, item in packet['files'].items():
        atomic(release / path, base64.b64decode(item['base64']), 0o644)
    atomic(environment, env_after)
    run('sudo', '-n', 'install', '-m', '0644', str(candidate), str(nginx))
    run('sudo', '-n', 'nginx', '-t')
    run('systemctl', '--user', 'restart', 'haizhizi-host.service')
    ready = False
    for attempt in range(20):
        try:
            check = urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:4310/health', timeout=2)
            ready = check.status == 200
            if ready:
                break
        except (OSError, urllib.error.URLError):
            time.sleep(1)
    assert ready, 'Host did not become ready'
    run('sudo', '-n', 'systemctl', 'reload', 'nginx.service')
    assert index_before == sha((release / 'apps/workspace/dist/index.html').read_bytes())
except BaseException:
    for path, data in original.items():
        atomic(release / path, data, 0o644)
    atomic(environment, env_before)
    run('sudo', '-n', 'install', '-m', '0644', str(backup / 'nginx.before.conf'), str(nginx))
    run('sudo', '-n', 'nginx', '-t')
    run('systemctl', '--user', 'restart', 'haizhizi-host.service')
    run('sudo', '-n', 'systemctl', 'reload', 'nginx.service')
    raise

receipt = {'configured_at': stamp, 'domain': 'laneanew.cn', 'aliases': ['www.laneanew.cn'],
    'target_ip': '10.70.223.113', 'access_scope': 'campus_collaborative',
    'backup': str(backup), 'release': str(release), 'ui_unchanged': True,
    'checked_projects_before_restart': len(projects), 'model_calls': 0,
    'nginx_before_sha256': sha(nginx_before), 'nginx_after_sha256': sha(nginx_after),
    'source_sha256': {path: item['sha256'] for path, item in packet['files'].items()},
    'host_main_pid': run('systemctl', '--user', 'show', 'haizhizi-host.service', '-p', 'MainPID', '--value')}
(backup / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
print(json.dumps(receipt, ensure_ascii=False))
