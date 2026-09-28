"""Generic content extraction ports from CRE (Apache-2.0); no financial interpretation."""

import pandas as pd
import re

import pdfplumber

from typing import Any, Dict, List, Optional

MAX_UPLOAD_INSPECTOR_ROWS = 250

def extract_pages(file_path: str) -> List[str]:
    """Return per-page extracted text (1-based page order)."""
    pages: List[str] = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages[:50]:
            pages.append(page.extract_text() or "")
    return pages

def normalize_text(value: Any) -> str:
    """Normalize labels while keeping word boundaries for fuzzy matching."""
    if pd.isna(value):
        return ""
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", str(value).lower()).strip()

def find_header_row(df: pd.DataFrame, max_rows: int = 15) -> int:
    """Find the row containing column headers."""
    for i in range(min(max_rows, len(df))):
        row = df.iloc[i]
        non_null = row.dropna()
        if len(non_null) >= 3:
            row_str = ' '.join(normalize_text(v) for v in non_null)
            # Look for common header indicators
            if any(kw in row_str for kw in ['unit', 'rent', 'type', 'status', 'line item', 'account', 'annual', 't12', '建筑', '编号', '面积', '用途', '租期', '名称', '指标']):
                return i
    return 0

def prepare_table(raw_df: pd.DataFrame, sheet_name: str) -> pd.DataFrame:
    """Convert a raw worksheet into a parsed table while preserving Excel row/column provenance."""
    header_row = find_header_row(raw_df)
    raw_headers = [
        str(value).strip() if not pd.isna(value) else None
        for value in raw_df.iloc[header_row]
    ]

    # Detect duplicate non-empty header labels. This happens when a single
    # merged header cell has been forward-filled across multiple columns, which
    # makes the resulting column mapping genuinely ambiguous (e.g. two columns
    # both labelled "Market Rent"). We disambiguate the column names so each is
    # addressable, but record the ambiguity so parsers can surface a warning
    # instead of silently mis-mapping.
    seen: Dict[str, int] = {}
    ambiguous_headers: List[str] = []
    headers: List[str] = []
    for index, value in enumerate(raw_headers):
        if value is None or value == "":
            headers.append(f"Column {index + 1}")
            continue
        normalized = normalize_text(value)
        if normalized and normalized in seen:
            seen[normalized] += 1
            if value not in ambiguous_headers:
                ambiguous_headers.append(value)
            headers.append(f"{value} ({seen[normalized]})")
        else:
            seen[normalized] = 0
            headers.append(value)

    data = raw_df.iloc[header_row + 1:].copy()
    data.columns = headers
    data["__excel_row_number"] = data.index + 1
    data = data.reset_index(drop=True)
    data.attrs["sheet_name"] = sheet_name
    data.attrs["header_row_number"] = header_row + 1
    data.attrs["column_positions"] = {str(header): index + 1 for index, header in enumerate(headers)}
    data.attrs["ambiguous_headers"] = ambiguous_headers
    return data

def serialize_cell(value: Any) -> str:
    if pd.isna(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)

def build_table_preview(df: pd.DataFrame) -> Dict[str, Any]:
    columns = [str(column) for column in df.columns if not str(column).startswith("__")]
    rows = []
    for _, row in df.head(MAX_UPLOAD_INSPECTOR_ROWS).iterrows():
        row_number = row.get("__excel_row_number")
        values = {column: serialize_cell(row.get(column)) for column in columns}
        rows.append({
            "rowNumber": int(row_number) if row_number and not pd.isna(row_number) else len(rows) + 1,
            "values": values
        })
    row_count = int(len(df))
    return {
        "label": df.attrs.get("sheet_name", "Source Data"),
        "rowCount": row_count,
        "columnCount": len(columns),
        "truncated": row_count > len(rows),
        "columns": columns,
        "rows": rows,
        "source": {
            "sheet": df.attrs.get("sheet_name", "Source Data"),
            "headerRow": df.attrs.get("header_row_number")
        }
    }
