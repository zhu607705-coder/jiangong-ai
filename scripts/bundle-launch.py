"""Launch a restored workbench bundle using its original development launcher."""
from pathlib import Path
import os,shutil,subprocess,sys

root=Path(__file__).resolve().parents[1]
os.chdir(root)
node=shutil.which('node');npm=shutil.which('npm.cmd' if os.name=='nt' else 'npm')
if not node or not npm:raise SystemExit('Install Node.js24 or later, then run this launcher again.')
if int(subprocess.check_output([node,'--version'],text=True).strip().lstrip('v').split('.')[0])<24:raise SystemExit('Node.js24 or later is required.')
if sys.version_info<(3,12):raise SystemExit('Python3.12 or later is required; this bundle was checked with Python3.12.')
if not (root/'data/local/postgres/PG_VERSION').is_file():raise SystemExit('Database snapshot not found. Extract the complete bundle before starting.')
if not (root/'.env').exists():shutil.copy2(root/'.env.example',root/'.env')
venv=root/('.venv-win' if os.name=='nt' else '.venv')
python=venv/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
if not python.is_file():
 subprocess.run([sys.executable,'-m','venv',str(venv)],check=True)
 subprocess.run([str(python),'-m','pip','install','-r','requirements.txt'],check=True)
if not (root/'node_modules/tsx').is_dir():subprocess.run([npm,'ci'],check=True)
env=dict(os.environ,HZZ_PYTHON=str(python),DATA_DIR=str(root/'data/local'))
print('Workbench data: '+str(root/'data/local'))
print('Open http://127.0.0.1:5173 after startup. Saved reports are available without model API keys.')
raise SystemExit(subprocess.call([npm,'run','dev'],env=env))
