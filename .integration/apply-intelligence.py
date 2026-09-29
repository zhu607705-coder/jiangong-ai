"""One-use transfer of an exact locally tested patch into the user's PR branch.
No model calls, package scripts, main writes or user data operations.
Removed from the final PR tree after application and hash verification.
"""
import hashlib
import pathlib
import re
import subprocess
import tempfile

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

assert not git('status', '--porcelain'), 'Checkout must be clean'
patch = b''.join(pathlib.Path(f'.integration/intelligence-{i:02d}.patch').read_bytes() for i in range(4))
assert hashlib.sha256(patch).hexdigest() == '2b0e8850d5c50d7827c736d7c8a6dbbc8fbd1a23e36ef5aea1a0736135165094', 'Transfer checksum mismatch'
entries = []
for block in patch.decode().split('diff --git ')[1:]:
    lines = block.splitlines()
    match = re.fullmatch(r'a/([\w./-]+) b/([\w./-]+)', lines[0])
    assert match and match[1] == match[2] and '..' not in match[1].split('/'), 'Invalid path'
    hashes = re.fullmatch(r'index ([a-f0-9]{40})\.\.([a-f0-9]{40}) 100644', lines[1])
    assert hashes, 'Full blob precondition required'
    name = match[1]
    assert git('rev-parse', 'HEAD:' + name) == hashes[1], 'Base changed: ' + name
    entries.append((name, hashes[2]))
assert len(entries) == 19 and len(set(name for name, _ in entries)) == 19
with tempfile.NamedTemporaryFile(suffix='.patch') as f:
    f.write(patch); f.flush()
    subprocess.run(['git', 'apply', '--check', '--index', '--unidiff-zero', f.name], check=True)
    subprocess.run(['git', 'apply', '--index', '--unidiff-zero', f.name], check=True)
assert set(git('diff', '--cached', '--name-only').splitlines()) == set(name for name, _ in entries)
for name, expected in entries:
    assert git('hash-object', name) == expected, 'Output differs from tested file: ' + name
print('Verified 19 exact base blobs and 19 tested output blobs; ready for scoped PR commit.')
