"""Use the canonical page renderer with a native Office-exported PDF on Windows."""
import importlib.util
import os
import shutil
from pathlib import Path

TASK = Path('D:/建工ai/output/documents/case-six-dim')
DOCUMENT = Path('D:/建工ai/docs/老旧小区改造案例拆分与六维数据说明.docx')
PDF = TASK / 'native-office.pdf'
RUNTIME = Path('C:/Users/123/.cache/codex-runtimes/codex-primary-runtime')
RENDERER = Path('C:/Users/123/.codex/plugins/cache/openai-primary-runtime/documents/26.1009.11318/skills/documents/render_docx.py')
os.environ['PATH'] = str(RUNTIME / 'dependencies/native/poppler/Library/bin') + os.pathsep + os.environ.get('PATH', '')
spec = importlib.util.spec_from_file_location('canonical_docx_renderer', RENDERER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def exported_pdf(doc_path, user_profile, convert_tmp_dir, stem, verbose):
    assert Path(doc_path).resolve() == DOCUMENT.resolve()
    assert PDF.read_bytes().startswith(b'%PDF-')
    target = Path(convert_tmp_dir) / (stem + '.pdf')
    shutil.copy2(PDF, target)
    return str(target), 'Native Office PDF export; canonical Poppler page rasterization'


module.convert_to_pdf = exported_pdf
paths = module.rasterize(str(DOCUMENT), str(TASK / 'render'), dpi=150, verbose=False, emit_pdf=False)
for path in paths:
    print(path)
