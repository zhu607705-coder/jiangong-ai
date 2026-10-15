"""Render the Qiushi decision report with the existing project PDF builder.

The font-path adaptation reuses the shared parser, typography and table layout
in the Windows workspace without installing an additional rendering framework.
"""
from pathlib import Path
from types import ModuleType
from xml.sax.saxutils import escape
import os
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts/build-introduction.py"
FONT_DIR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
if not FONT_DIR.exists():
    FONT_DIR = Path("/mnt/c/Windows/Fonts")
source = SOURCE.read_text(encoding="utf-8")
old = 'FONT = Path("/mnt/c/Windows/Fonts")'
assert old in source, "Shared PDF builder font declaration changed"
source = source.replace(old, f"FONT = Path({str(FONT_DIR)!r})", 1)
builder = ModuleType("qiushi_shared_pdf_builder")
builder.__file__ = str(SOURCE)
exec(compile(source, str(SOURCE), "exec"), builder.__dict__)
builder.SOURCE = ROOT / "docs/research/求是村_旧改深度调研与行动计划.md"
builder.OUTPUT = ROOT / "output/pdf/求是村_旧改深度调研与行动计划.pdf"
builder.DATE = "2026-10-15"
lines = [line.strip() for line in builder.SOURCE.read_text(encoding="utf-8").splitlines() if line.strip()]
keep_with_next = {
    line for line, following in zip(lines, lines[1:])
    if (following.startswith("|") and not line.startswith("|"))
    or (re.match(r"^\d+\. ", line) and re.match(r"^\d+\. ", following))
}
appendix_start = lines.index("## 附录A. 来源与原文定位")
appendix_lines = set(lines[appendix_start:])
appendix_style = builder.body.clone("SourceIndex", fontSize=9.2, leading=13.5, spaceAfter=3)


def report_text(value):
    value = escape(value)
    value = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        lambda match: '<link href="' + match[2].replace('"', "&quot;")
        + '" color="#2C6B60">' + match[1] + "</link>",
        value,
    )
    value = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", value)
    return value.replace("`", "")


def report_frame(canvas, doc):
    width, height = A4
    canvas.setStrokeColor(colors.HexColor(builder.ACCENT))
    canvas.setLineWidth(1.1)
    canvas.line(44, height - 35, width - 44, height - 35)
    canvas.setFont("IntroBody", 8)
    canvas.setFillColor(colors.HexColor(builder.MUTED))
    canvas.drawString(44, height - 26, "海之子  |  求是村更新决策研判与改造方案")
    canvas.drawString(44, 26, "2026-10-15  |  QS-R20261015")
    canvas.drawRightString(width - 44, 26, str(doc.page))


existing_doc = builder.SimpleDocTemplate
existing_table = builder.Table
existing_para = builder.para


def report_para(value, style=None):
    style = style or builder.body
    if value in appendix_lines and style is builder.body:
        style = appendix_style
    paragraph = existing_para(value, style)
    if value in keep_with_next:
        paragraph.keepWithNext = True
    return paragraph


def report_table(data, *args, **kwargs):
    # Keep at least two body rows together at either side of a page split.
    if len(data) >= 6:
        kwargs["rowSplitRange"] = (3, -2)
    return existing_table(data, *args, **kwargs)


def report_doc(*args, **kwargs):
    kwargs["title"] = "求是村更新决策研判报告与改造方案"
    kwargs["author"] = "海之子项目团队"
    return existing_doc(*args, **kwargs)


if __name__ == "__main__":
    builder.text = report_text
    builder.page_frame = report_frame
    builder.SimpleDocTemplate = report_doc
    builder.Table = report_table
    builder.para = report_para
    builder.build()
