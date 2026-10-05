"""Build the current project introduction from its single editable Markdown source."""
from pathlib import Path
import re
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/项目介绍.md"
OUTPUT = ROOT / "output/pdf/建工AI_项目介绍.pdf"
FONT = Path("/mnt/c/Windows/Fonts")
pdfmetrics.registerFont(TTFont("IntroBody", str(FONT / "msyh.ttc"), subfontIndex=0))
pdfmetrics.registerFont(TTFont("IntroBold", str(FONT / "msyhbd.ttc"), subfontIndex=0))
pdfmetrics.registerFontFamily("IntroBody", normal="IntroBody", bold="IntroBold", italic="IntroBody", boldItalic="IntroBold")
DATE = re.search(r"更新日期：(\d{4}-\d{2}-\d{2})", SOURCE.read_text()).group(1)
INK, ACCENT, MUTED = "#24362F", "#2C6B60", "#65776D"
body = ParagraphStyle("Body", fontName="IntroBody", fontSize=10.2, leading=16, textColor=colors.HexColor(INK), spaceAfter=7, wordWrap="CJK")
title = ParagraphStyle("Title", parent=body, fontName="IntroBold", fontSize=27, leading=34, spaceAfter=11)
h1 = ParagraphStyle("H1", parent=body, fontName="IntroBold", fontSize=20, leading=27, spaceAfter=13)
h2 = ParagraphStyle("H2", parent=body, fontName="IntroBold", fontSize=13, leading=20, spaceBefore=9, spaceAfter=6)
subtitle = ParagraphStyle("Subtitle", parent=body, fontSize=15, leading=24, spaceAfter=12)
cell = ParagraphStyle("Cell", parent=body, fontSize=9.2, leading=14, spaceAfter=0)
cell_head = ParagraphStyle("CellHead", parent=cell, fontName="IntroBold", textColor=colors.white)

def text(value):
    return re.sub(r"\*\*(.*?)\*\*", r'<b>\1</b>', escape(value))

def para(value, style=body):
    return Paragraph(text(value), style)

def page_frame(canvas, doc):
    width, height = A4
    canvas.setStrokeColor(colors.HexColor(ACCENT))
    canvas.setLineWidth(1.2)
    canvas.line(44, height - 35, width - 44, height - 35)
    canvas.setFont("IntroBody", 8)
    canvas.setFillColor(colors.HexColor(MUTED))
    canvas.drawString(44, height - 26, "建工 AI  |  项目介绍与原型进展")
    canvas.drawString(44, 26, DATE + "  |  依据当前本地工作台核对")
    canvas.drawRightString(width - 44, 26, str(doc.page))

def build():
    lines = SOURCE.read_text().splitlines()
    story, index = [], 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line == "<!-- pagebreak -->":
            story.append(PageBreak()); index += 1; continue
        if line.startswith("|"):
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                row = [value.strip() for value in lines[index].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"[-:]+", value) for value in row):
                    rows.append(row)
                index += 1
            width = A4[0] - 88
            widths = [width * .19, width * .42, width * .39]
            table = Table([[para(value, cell_head if r == 0 else cell) for value in row] for r, row in enumerate(rows)], colWidths=widths, repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(ACCENT)),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#F2F6F3"), colors.white]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LINEBELOW", (0, 0), (-1, 0), .5, colors.HexColor(ACCENT)),
                ("LINEBELOW", (0, 1), (-1, -1), .3, colors.HexColor("#DFE7E1")),
            ]))
            story.extend([table, Spacer(1, 9)]); continue
        if line.startswith("### "):
            heading = para(line[4:], h2)
        elif line.startswith("## "):
            heading = para(line[3:], subtitle if index < 3 else h1)
        elif line.startswith("# "):
            heading = para(line[2:], title)
        else:
            heading = None
        if heading:
            # Keep each heading with a small paragraph or the table's first row.
            heading.keepWithNext = True
            story.append(heading)
        else:
            story.append(para(line))
        index += 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, rightMargin=44, leftMargin=44, topMargin=51, bottomMargin=45, title="建工AI：片区投资前期研判辅助智能体", author="建工 AI 项目团队")
    doc.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    print(OUTPUT)

if __name__ == "__main__":
    build()
