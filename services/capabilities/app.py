from __future__ import annotations

import os
import secrets
from typing import Literal
from fastapi import FastAPI, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from services.capabilities.generated.contracts import ProjectInput
from services.capabilities.analysis import analyze, spatial_profile, retrieval_query, structured_query, gap_plan, get_geo_meta
from services.capabilities.parsers import parse_document
from zipfile import BadZipFile
from pdfminer.pdfparser import PDFSyntaxError
from pdfminer.pdfdocument import PDFPasswordIncorrect
from docx.opc.exceptions import PackageNotFoundError
from lxml.etree import XMLSyntaxError
from pdfplumber.utils.exceptions import PdfminerException

app = FastAPI(title="海之子 · 本地专业能力", version="0.2.0")


def authorize(x_capability_token: str = Header(default="")):
    token = os.environ.get("CAPABILITY_TOKEN", "")
    if not token or not secrets.compare_digest(token, x_capability_token):
        raise HTTPException(403, "capability authorization required")


class Request(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project: ProjectInput
    role: Literal["building_feasibility", "demand_operations", "case_enterprise"] = "building_feasibility"
    query: str = Field(default="建筑", max_length=1000)
    include_internal: bool = False
    source_id: str = ""
    round_number: int = Field(default=0, ge=0, le=2)


@app.get("/health")
def health():
    return {"status": "ok", "service": "capabilities", "spatial_tool": get_geo_meta(spatial_profile)}


class ParseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_path: str
    file_name: str
    document_id: str


@app.post("/parsers/parse", dependencies=[Depends(authorize)])
def parse_binary(request: ParseRequest):
    try:
        return parse_document(request.file_path, request.file_name, request.document_id)
    except (ValueError, OSError, BadZipFile, PDFSyntaxError, PDFPasswordIncorrect, PdfminerException, PackageNotFoundError, XMLSyntaxError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/capabilities/{name}", dependencies=[Depends(authorize)])
def capability(name: str, request: Request):
    project = request.project.model_dump(mode="json")
    # The generated root may be a RootModel; JSON serialization still yields ProjectInput.
    try:
        if name == "analyze":
            return analyze(project, request.role)
        if name == "spatial.profile":
            return spatial_profile(project["scope"])
        if name == "retrieval.query":
            return retrieval_query(project, request.query, request.include_internal)
        if name == "structured.query":
            if not request.include_internal:
                public_ids = {s["id"] for s in project["sources"] if s["visibility"] == "public"}
                project["facts"] = [f for f in project["facts"] if f["source_id"] in public_ids]
            return structured_query(project, request.source_id)
        if name == "research.gaps":
            return gap_plan(project, request.round_number)
        raise HTTPException(404, "unknown capability")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

# The existing authorized capability host owns topology and CRS conversion.
from services.capabilities.map_regions import RegionRequest, resolve_regions, GeometryConversionRequest, selected_geometry_wgs84

@app.post('/spatial/selected-geometry', dependencies=[Depends(authorize)])
def selected_geometry(request: GeometryConversionRequest):
    try:
        return selected_geometry_wgs84(request)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, 'invalid selected geometry') from exc

@app.post('/spatial/regions', dependencies=[Depends(authorize)])
def map_regions(request: RegionRequest):
    try:
        return resolve_regions(request)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, 'invalid region geometry') from exc
