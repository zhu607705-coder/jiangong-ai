"""Create the local source release; exclude credentials, runtime data and caches."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
release = root / "release"
release.mkdir(exist_ok=True)
archive = release / "海之子_可运行工程_v0.2.zip"
directories = ["agent", "apps", "contracts", "docs", "fixtures", "licenses", "packages", "ported", "research", "runtime", "scripts", "services", "tests", "vendor", "output/playwright", "data/corpus", "data/public_case_snapshot"]
top_files = ["AGENTS.md", "README.md", "THIRD_PARTY_NOTICES.md", ".gitignore", ".env.example", "package.json", "package-lock.json", "requirements.txt", "requirements.lock.txt", "tsconfig.json", "vitest.config.ts", "启动工作台.cmd"]
excluded_parts = {"node_modules", ".venv", ".tools", ".cache", ".git", "__pycache__", ".pytest_cache", "dist", "test-results"}
files = [root / name for name in top_files]
for directory in directories:
    files.extend(path for path in (root / directory).rglob("*") if path.is_file() and not any(part in excluded_parts for part in path.relative_to(root).parts))
# The key is used only for a local exclusion assertion, never printed or copied.
secrets = []
env = root / ".env"
if env.exists():
    for line in env.read_text().splitlines():
        name, _, value = line.partition("=")
        if name.endswith(("_API_KEY", "_JS_KEY", "_SECURITY_CODE")) and value.strip():
            secrets.append(value.strip().strip("\"'").encode())
map_credentials = root / "data/local/amap-credentials.json"
if map_credentials.exists():
    secrets.extend(value.encode() for value in json.loads(map_credentials.read_text()).values() if value)
manifest = {"version": "0.2.0", "files": [], "excluded": [".env", "data/local", "dependencies", "temporary caches"], "credential_scan": "passed"}
manifest["public_snapshot_scope"] = "local_reproduction_only_not_a_training_or_redistribution_license"
with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=9) as output:
    for path in sorted(set(files)):
        rel = path.relative_to(root).as_posix()
        if path.name.startswith(".env") and path.name != ".env.example":
            continue
        data = path.read_bytes()
        if any(secret in data for secret in secrets):
            raise RuntimeError("Credential content detected; source release refused")
        output.writestr("haizhizi-v0.2/" + rel, data)
        manifest["files"].append({"path": rel, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
with ZipFile(archive) as check:
    assert check.testzip() is None
    assert not any(name.endswith("/.env") or "/data/local/" in name or "/node_modules/" in name for name in check.namelist())
    for record in manifest["files"]:
        assert hashlib.sha256(check.read("haizhizi-v0.2/" + record["path"])).hexdigest() == record["sha256"]
manifest.update(archive=archive.name, bytes=archive.stat().st_size, sha256=hashlib.sha256(archive.read_bytes()).hexdigest(), file_count=len(manifest["files"]))
(release / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({key: manifest[key] for key in ["archive", "bytes", "sha256", "file_count", "credential_scan"]}, ensure_ascii=False))
