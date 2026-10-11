"""Render the Qiushi research report using the project's existing CJK PDF builder."""
from pathlib import Path
from xml.sax.saxutils import escape
import importlib.util
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("introduction_builder", ROOT / "scripts/build-introduction.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
builder.SOURCE = ROOT / "docs/research/求是村_旧改深度调研与行动计划.md"
builder.OUTPUT = ROOT / "output/pdf/求是村_旧改深度调研与行动计划.pdf"
builder.DATE = "2026-10-10"
builder.body.leading = 15.5


def report_text(value):
    value = escape(value)
    value = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        lambda match: '<link href="' + match[2].replace('"', "&quot;")
        + '" color="#2C6B60">' + match[1] + "</link>",
        value,
    )
    return re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", value)


def report_frame(canvas, doc):
    width, height = A4
    canvas.setStrokeColor(colors.HexColor(builder.ACCENT))
    canvas.setLineWidth(1.1)
    canvas.line(44, height - 35, width - 44, height - 35)
    canvas.setFont("IntroBody", 8)
    canvas.setFillColor(colors.HexColor(builder.MUTED))
    canvas.drawString(44, height - 26, "建工 AI  |  求是村旧改：研究决策与行动计划")
    canvas.drawString(44, 26, "2026-10-10  |  公开资料研究 · 现场与专业确认另列")
    canvas.drawRightString(width - 44, 26, str(doc.page))


existing_doc = builder.SimpleDocTemplate


def report_doc(*args, **kwargs):
    kwargs["title"] = "求是村：老旧小区改造深度调研与行动计划"
    kwargs["author"] = "建工 AI 项目团队"
    return existing_doc(*args, **kwargs)


if __name__ == "__main__":
    builder.text = report_text
    builder.page_frame = report_frame
    builder.SimpleDocTemplate = report_doc
    builder.build()
