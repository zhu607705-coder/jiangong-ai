from pathlib import Path
import json, shutil
from pdf2image import convert_from_path
from pypdf import PdfReader
from PIL import Image, ImageOps, ImageDraw
qa = Path(r"D:\建工ai\output\documents\renewal-review\shanghai")
pdf = qa / "上海旧改_模式与经济机制对标.pdf"
poppler = r"C:\Users\123\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin"
pages = convert_from_path(str(pdf), dpi=130, poppler_path=poppler)
thumb_w = 620
thumb_h = 920
sheet = Image.new("RGB", (1280, 3 * thumb_h + 40), "#dedede")
draw = ImageDraw.Draw(sheet)
for i, page in enumerate(pages):
    page.save(qa / f"page-{i+1:02d}.png")
    thumb = ImageOps.contain(page, (thumb_w, 880))
    x = 10 + (i % 2) * 640
    y = 25 + (i // 2) * thumb_h
    draw.text((x, y - 20), f"Page {i+1}", fill="black")
    sheet.paste(thumb, (x, y))
sheet.save(qa / "contact-sheet.png")
reader = PdfReader(str(pdf))
texts = [p.extract_text() or "" for p in reader.pages]
bad = ["Overfull", "undefined", "Missing character", "LaTeX Error"]
log = (qa / "上海旧改_模式与经济机制对标.log").read_text(encoding="utf-8", errors="replace")
report = {
    "pages": len(reader.pages),
    "page_text_characters": [len(t) for t in texts],
    "warnings": {key: key in log for key in bad},
    "author": str(reader.metadata.author),
    "source_link_annotations": sum(1 for p in reader.pages for a in (p.get("/Annots") or []) if str(a.get_object().get("/A", {}).get("/S")) == "/URI"),
    "contact_sheet": str(qa / "contact-sheet.png"),
    "rendered_pages": [str(qa / f"page-{i+1:02d}.png") for i in range(len(pages))],
    "pdf_output": r"D:\建工ai\docs\research\上海旧改_模式与经济机制对标.pdf",
}
assert len(reader.pages) == 6, report
assert all(len(t)>200 for t in texts), report
assert not any(report["warnings"].values()), report
shutil.copyfile(pdf, report["pdf_output"])
(qa / "qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))