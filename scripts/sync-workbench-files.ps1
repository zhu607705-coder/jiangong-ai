param(
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$RemoteHost = '10.70.223.113',
  [string]$RemoteUser = 'zhuhangcheng',
  [string]$KnownHostsFile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/haizhizi-known-hosts'),
  [string]$ReceiptPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'research/test_results/server-runtime-files-20261015.json')
)
# Add-only migration of the four existing workbench file stores. No DB, blobs,
# credentials, model calls, service changes, or unrelated workspace data.
$ErrorActionPreference = 'Stop'
if ($RemoteHost -ne '10.70.223.113' -or $RemoteUser -ne 'zhuhangcheng') { throw 'This migration is scoped to zhuhangcheng@10.70.223.113.' }
if (-not (Test-Path -LiteralPath $KnownHostsFile -PathType Leaf)) { throw 'The verified known_hosts file is required.' }
$fingerprints = & ssh-keygen -lf $KnownHostsFile
if ($LASTEXITCODE -ne 0 -or -not ($fingerprints -match [regex]::Escape('SHA256:cSL1ZahVyJgkLnPl0aLtu3AIs9/wvvJDP+GdiAA/1mk'))) { throw 'SSH host fingerprint mismatch.' }
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', '-o', "UserKnownHostsFile=$KnownHostsFile")
$target = "$RemoteUser@$RemoteHost"
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'data/local'))
$sourcePrefix = $sourceRoot.TrimEnd('\') + '\'
$stores = @('map-screening', 'sessions', 'corpus', 'intelligence')
$run = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "haizhizi-runtime-$run"
$null = New-Item -ItemType Directory -Path $temporaryRoot
$utf8 = [Text.UTF8Encoding]::new($false)

function Assert-SafeLocalPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -ne $sourceRoot -and -not $full.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Local source path escaped data/local.' }
  # Check every ancestor rather than Get-ChildItem -Recurse, which can follow
  # a junction on some PowerShell/.NET combinations.
  $cursor = $full
  while ($cursor) {
    $attributes = [IO.File]::GetAttributes($cursor)
    if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points are not eligible for this migration.' }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
}

$remotePython = @'
import ctypes, errno, hashlib, io, json, os, pathlib, re, stat, subprocess, sys, tarfile, uuid

MODE, RUN = sys.argv[1:3]
ARCHIVE_SHA = sys.argv[3] if len(sys.argv) > 3 else ''
if MODE not in ('plan', 'apply') or not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{12}', RUN):
    raise RuntimeError('Invalid migration mode/run')
os.umask(0o077)
BASE = pathlib.Path.home() / 'apps/haizhizi'
DATA = BASE / 'shared/data'
AUDIT_REL = ('shared', 'incoming', 'migration-conflicts', RUN)
STORES = ('map-screening', 'sessions', 'corpus', 'intelligence')
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
libc = ctypes.CDLL(None, use_errno=True)
rename = libc.renameat2
rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
rename.restype = ctypes.c_int

def atomic_rename_no_replace(fd, temporary, name):
    if rename(fd, os.fsencode(temporary), fd, os.fsencode(name), 1):
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number), name)
    os.fsync(fd)

def open_absolute_directory(path):
    current = os.open('/', FLAGS)
    try:
        for part in pathlib.Path(path).parts[1:]:
            next_fd = os.open(part, FLAGS, dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise

def open_directory(root, components, create=False):
    current = os.dup(root)
    try:
        for part in components:
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=current)
                except FileExistsError:
                    pass
            try:
                next_fd = os.open(part, FLAGS, dir_fd=current)
            except FileNotFoundError:
                os.close(current)
                return None
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise

def runtime():
    pid = int(subprocess.check_output(['systemctl', '--user', 'show', 'haizhizi-host.service', '--property=MainPID', '--value']).strip())
    if pid <= 0:
        raise RuntimeError('The deployed host is not running')
    # Read only the selected location from the process environment; never log
    # or persist other environment variables or the environment as a whole.
    data_dir = next((x.split(b'=', 1)[1].decode() for x in pathlib.Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if x.startswith(b'DATA_DIR=')), '')
    if data_dir != str(DATA):
        raise RuntimeError('Running host DATA_DIR does not match shared/data')
    return {'host_pid': pid, 'data_dir': data_dir, 'host_uses_shared_data': True}

def file_info(root, relative):
    parts = relative.split('/')
    parent = open_directory(root, parts[:-1])
    if parent is None:
        return None
    try:
        try:
            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            return None
        with os.fdopen(fd, 'rb') as handle:
            s = os.fstat(handle.fileno())
            if not stat.S_ISREG(s.st_mode):
                raise RuntimeError('A target is not a regular file')
            h = hashlib.file_digest(handle, 'sha256').hexdigest()
            return {'size': s.st_size, 'sha256': h, 'mode': stat.S_IMODE(s.st_mode)}
    finally:
        os.close(parent)

def matches(info, entry):
    return info is not None and info['size'] == entry['size'] and info['sha256'] == entry['sha256']

def publish_stream(root, relative, stream, entry):
    parent = open_directory(root, relative.split('/')[:-1], create=True)
    name = relative.split('/')[-1]
    temporary = '.migration-' + RUN + '-' + uuid.uuid4().hex + '.tmp'
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=parent)
        h, size = hashlib.sha256(), 0
        with os.fdopen(fd, 'wb') as handle:
            while True:
                block = stream.read(1024 * 1024)
                if not block:
                    break
                handle.write(block)
                h.update(block)
                size += len(block)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), 0o600)
        if size != entry['size'] or h.hexdigest() != entry['sha256']:
            raise RuntimeError('Transferred file does not match source manifest')
        # Linux RENAME_NOREPLACE is atomic and refuses a concurrent target.
        # The caller then re-reads it and either skips or preserves a conflict.
        atomic_rename_no_replace(parent, temporary, name)
        return True
    except FileExistsError:
        return False
    finally:
        try:
            os.unlink(temporary, dir_fd=parent)
        except FileNotFoundError:
            pass
        os.close(parent)

def publish_bytes(root, name, data):
    entry = {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    if not publish_stream(root, name, io.BytesIO(data), entry) and not matches(file_info(root, name), entry):
        raise RuntimeError('An audit manifest already exists with different content')

def read_bytes(root, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root)
    with os.fdopen(fd, 'rb') as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise RuntimeError('Audit input is not a regular file')
        return handle.read()

raw = sys.stdin.buffer.read()
manifest_sha = hashlib.sha256(raw).hexdigest()
manifest = json.loads(raw)
if manifest.get('schema_version') != 'haizhizi-runtime-files-v1' or manifest.get('run') != RUN:
    raise RuntimeError('Unexpected source manifest')
entries = manifest['files']
seen = set()
for entry in entries:
    path = entry['path']
    parts = path.split('/')
    if len(parts) < 2 or parts[0] not in STORES or any(p in ('', '.', '..') or '\\' in p or '\n' in p or '\r' in p or '\0' in p for p in parts):
        raise RuntimeError('An entry escaped the four allowed stores')
    if path in seen or not isinstance(entry['size'], int) or entry['size'] < 0 or not re.fullmatch('[a-f0-9]{64}', entry['sha256']):
        raise RuntimeError('Invalid/duplicate manifest entry')
    seen.add(path)
observed_runtime = runtime()
base_fd = open_absolute_directory(BASE)
data_fd = open_directory(base_fd, ('shared', 'data'))
if data_fd is None:
    raise RuntimeError('Deployed shared/data is absent')
audit_fd = open_directory(base_fd, AUDIT_REL, create=True)

if MODE == 'plan':
    plan = []
    for entry in entries:
        existing = file_info(data_fd, entry['path'])
        status = 'missing' if existing is None else ('identical' if matches(existing, entry) else 'conflict')
        plan.append({'path': entry['path'], 'status': status, 'remote': existing})
    result = {'run': RUN, 'source_manifest_sha256': manifest_sha, 'runtime': observed_runtime, 'files': plan}
    publish_bytes(audit_fd, 'source-manifest.json', raw)
    publish_bytes(audit_fd, 'migration-plan.json', json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode())
    print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
else:
    if read_bytes(audit_fd, 'source-manifest.json') != raw:
        raise RuntimeError('Source manifest changed after planning')
    plan = json.loads(read_bytes(audit_fd, 'migration-plan.json'))
    requested = {i['path'] for i in plan['files'] if i['status'] != 'identical'}
    if not re.fullmatch('[a-f0-9]{64}', ARCHIVE_SHA):
        raise RuntimeError('Missing archive SHA256')
    archive_fd = os.open('payload.upload.tmp', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=audit_fd)
    with os.fdopen(archive_fd, 'rb') as archive_handle:
        os.fchmod(archive_handle.fileno(), 0o600)
        if hashlib.file_digest(archive_handle, 'sha256').hexdigest() != ARCHIVE_SHA:
            raise RuntimeError('Archive SHA256 mismatch')
        archive_handle.seek(0)
        with tarfile.open(fileobj=archive_handle, mode='r:gz') as archive:
            members = archive.getmembers()
            names = [m.name for m in members]
            expected_names = {'manifest.json'} | {'files/' + p for p in requested}
            if len(names) != len(set(names)) or set(names) != expected_names or any(not m.isfile() for m in members):
                raise RuntimeError('Archive has unexpected/duplicate/symlink entries')
            if archive.extractfile('manifest.json').read() != raw:
                raise RuntimeError('Archive manifest mismatch')
            counts = {s: {'source_files': 0, 'source_bytes': 0, 'added': 0, 'identical': 0, 'conflicts': 0, 'added_bytes': 0, 'conflict_bytes': 0} for s in STORES}
            results = []
            private_new_files = True
            for entry in entries:
                path = entry['path']
                count = counts[path.split('/')[0]]
                count['source_files'] += 1
                count['source_bytes'] += entry['size']
                existing = file_info(data_fd, path)
                if matches(existing, entry):
                    status = 'identical'
                    final_root = data_fd
                else:
                    if path not in requested:
                        # A previously identical target changed after planning;
                        # do not overwrite it or fabricate missing payload bytes.
                        raise RuntimeError('An unchanged target changed after planning; rerun migration')
                    member = archive.getmember('files/' + path)
                    if member.size != entry['size']:
                        raise RuntimeError('Archive file size differs from manifest')
                    if existing is None:
                        published = publish_stream(data_fd, path, archive.extractfile(member), entry)
                        existing = file_info(data_fd, path)
                        if published:
                            status, final_root = 'added', data_fd
                        elif matches(existing, entry):
                            status, final_root = 'identical', data_fd
                        else:
                            status, final_root = 'conflicts', audit_fd
                    else:
                        status, final_root = 'conflicts', audit_fd
                    if status == 'conflicts':
                        # The live server original remains untouched.
                        if not publish_stream(audit_fd, path, archive.extractfile(member), entry) and not matches(file_info(audit_fd, path), entry):
                            raise RuntimeError('Conflict copy was concurrently changed')
                final = file_info(final_root, path)
                if not matches(final, entry):
                    raise RuntimeError('Published file failed SHA256 readback')
                if status != 'identical':
                    private_new_files = private_new_files and final['mode'] == 0o600
                    parent = open_directory(final_root, path.split('/')[:-1])
                    try:
                        private_new_files = private_new_files and stat.S_IMODE(os.fstat(parent).st_mode) == 0o700
                    finally:
                        os.close(parent)
                count[status] += 1
                if status == 'added':
                    count['added_bytes'] += entry['size']
                elif status == 'conflicts':
                    count['conflict_bytes'] += entry['size']
                results.append({'path': path, 'size': entry['size'], 'sha256': entry['sha256'], 'result': status})
    if not private_new_files:
        raise RuntimeError('New destination permissions are not private')
    totals = {k: sum(c[k] for c in counts.values()) for k in next(iter(counts.values()))}
    result = {'status': 'completed', 'run': RUN, 'runtime': runtime(), 'directories': counts, 'totals': totals,
              'validation': {'source_manifest_sha256': manifest_sha, 'remote_source_manifest_sha256': hashlib.sha256(read_bytes(audit_fd, 'source-manifest.json')).hexdigest(),
                             'archive_sha256': ARCHIVE_SHA, 'archive_verified': True, 'manifest_files_verified': len(results),
                             'atomic_rename_no_replace': True, 'new_directories_mode': '0700', 'new_files_mode': '0600', 'private_new_permissions_verified': private_new_files},
              'audit_directory': str(BASE.joinpath(*AUDIT_REL))}
    publish_bytes(audit_fd, 'migration-result.json', json.dumps({'summary': result, 'files': results}, ensure_ascii=False, separators=(',', ':')).encode())
    os.unlink('payload.upload.tmp', dir_fd=audit_fd)
    print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
'@
$remoteCode = [Convert]::ToBase64String($utf8.GetBytes($remotePython))
function Invoke-MigrationRemote([string]$Mode, [string]$ManifestJson, [string]$ArchiveSha = '') {
  $command = "python3 -c `"import base64;exec(base64.b64decode('$remoteCode'))`" '$Mode' '$run' '$ArchiveSha'"
  $info = [Diagnostics.ProcessStartInfo]::new('ssh')
  foreach ($argument in ($sshOptions + @($target, $command))) { $info.ArgumentList.Add($argument) }
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardInputEncoding = $utf8
  $info.StandardOutputEncoding = $utf8
  $process = [Diagnostics.Process]::Start($info)
  $output = $process.StandardOutput.ReadToEndAsync()
  $errors = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.Write($ManifestJson)
  $process.StandardInput.Close()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "Remote $Mode step failed: $($errors.GetAwaiter().GetResult())" }
  return ($output.GetAwaiter().GetResult() | ConvertFrom-Json -Depth 30)
}

try {
  Assert-SafeLocalPath $sourceRoot
  $files = [Collections.Generic.List[object]]::new()
  foreach ($store in $stores) {
    $storePath = Join-Path $sourceRoot $store
    if (-not (Test-Path -LiteralPath $storePath -PathType Container)) { throw "Expected local store is absent: $store" }
    $queue = [Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($storePath)
    while ($queue.Count -gt 0) {
      $directory = $queue.Dequeue()
      Assert-SafeLocalPath $directory
      foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
        Assert-SafeLocalPath $item.FullName
        if ($item.PSIsContainer) { $queue.Enqueue($item.FullName); continue }
        $relative = [IO.Path]::GetRelativePath($sourceRoot, $item.FullName).Replace('\', '/')
        if ($relative -match '[\r\n\x00]') { throw 'Unsupported source filename.' }
        $files.Add([ordered]@{path=$relative; size=[long]$item.Length; sha256=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()})
      }
    }
  }
  $manifest = [ordered]@{schema_version='haizhizi-runtime-files-v1'; run=$run; source='data/local'; stores=$stores; files=@($files | Sort-Object { $_.path })}
  $manifestJson = $manifest | ConvertTo-Json -Depth 8 -Compress
  $plan = Invoke-MigrationRemote 'plan' $manifestJson
  $snapshot = Join-Path $temporaryRoot 'snapshot'
  $null = New-Item -ItemType Directory -Path $snapshot
  [IO.File]::WriteAllText((Join-Path $snapshot 'manifest.json'), $manifestJson, $utf8)
  $byPath = @{}
  foreach ($entry in $files) { $byPath[$entry.path] = $entry }
  $selected = @($plan.files | Where-Object { $_.status -ne 'identical' } | ForEach-Object { $_.path })
  foreach ($relative in $selected) {
    $source = Join-Path $sourceRoot $relative
    Assert-SafeLocalPath $source
    $destination = Join-Path $snapshot $relative
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
    # Hold a read-only sharing lock during snapshotting; a concurrent writer
    # must not silently replace the file represented by the earlier manifest.
    $inputStream = [IO.FileStream]::new($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      if ($inputStream.Length -ne $byPath[$relative].size) { throw 'Source file changed after manifest creation; rerun migration.' }
      $outputStream = [IO.FileStream]::new($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
    } finally { $inputStream.Dispose() }
    Assert-SafeLocalPath $source
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $byPath[$relative].sha256) { throw 'Source file changed after manifest creation; rerun migration.' }
  }
  $selectedPath = Join-Path $temporaryRoot 'selected.json'
  [IO.File]::WriteAllText($selectedPath, (ConvertTo-Json -InputObject $selected -Compress), $utf8)
  $archive = Join-Path $temporaryRoot 'payload.tar.gz'
  $pack = @'
import json,pathlib,sys,tarfile
root, selection, output = map(pathlib.Path, sys.argv[1:4])
paths=json.loads(selection.read_text(encoding='utf-8'))
with tarfile.open(output,'w:gz') as archive:
    archive.add(root/'manifest.json',arcname='manifest.json',recursive=False)
    for path in paths:
        archive.add(root/path,arcname='files/'+path,recursive=False)
'@
  & python -c $pack $snapshot $selectedPath $archive
  if ($LASTEXITCODE -ne 0) { throw 'Snapshot archive creation failed.' }
  $archiveSha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  & scp @sshOptions $archive "${target}:/home/zhuhangcheng/apps/haizhizi/shared/incoming/migration-conflicts/$run/payload.upload.tmp"
  if ($LASTEXITCODE -ne 0) { throw 'Snapshot upload failed.' }
  $result = Invoke-MigrationRemote 'apply' $manifestJson $archiveSha
  if ($result.validation.source_manifest_sha256 -ne $plan.source_manifest_sha256 -or $result.validation.source_manifest_sha256 -ne $result.validation.remote_source_manifest_sha256) { throw 'Manifest readback mismatch.' }
  $receipt = [ordered]@{schema_version='haizhizi-runtime-migration-receipt-v1'; completed_at_utc=(Get-Date).ToUniversalTime().ToString('o'); remote_host=$RemoteHost; remote_user=$RemoteUser; source='data/local'; result=$result; exclusions=@('database','blobs','server.env','code','services','proxy','DNS','models','light 4','tests','caches'); source_files_deleted=0; server_originals_overwritten=0}
  $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ReceiptPath)))
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($ReceiptPath), ($receipt | ConvertTo-Json -Depth 12), $utf8)
  [pscustomobject]@{status=$result.status; source_files=$result.totals.source_files; added=$result.totals.added; identical=$result.totals.identical; conflicts=$result.totals.conflicts; source_bytes=$result.totals.source_bytes; receipt=[IO.Path]::GetFullPath($ReceiptPath)} | ConvertTo-Json -Compress
}
finally {
  # Only this run's exact, independently generated temporary directory is removed.
  $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
  $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolvedTemporary.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTemporary) -ne "haizhizi-runtime-$run") { throw 'Refusing unsafe temporary cleanup.' }
  if (Test-Path -LiteralPath $resolvedTemporary) { Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force }
}
