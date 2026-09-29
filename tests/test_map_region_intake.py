"""Synthetic geometry contracts, no map provider network or live location assertions."""
import pytest
from pydantic import ValidationError
from services.capabilities.map_regions import RegionRequest, segment_regions
B = dict(west=120.15,south=30.27,east=120.16,north=30.28)
GOOD = {"type":"Polygon","coordinates":[[[120.151,30.271],[120.154,30.271],[120.154,30.274],[120.151,30.274],[120.151,30.271]]]}
BAD = {"type":"Polygon","coordinates":[[[120.151,30.271],[120.154,30.274],[120.151,30.274],[120.154,30.271],[120.151,30.271]]]}
def boundary(id,geometry):
    return dict(id=id,label=id,geometry=geometry,coordinate_encoding='GCJ-02')
def test_saved_invalid_boundary_does_not_block_valid_region():
    request=RegionRequest(**B,boundaries=[boundary('bad',BAD),boundary('good',GOOD)],partial_project_boundaries=True)
    result=segment_regions(request,[])
    assert result['skipped_project_boundaries']==1
    assert len(result['cells'])==1 and result['cells'][0]['boundary_source']=='project:good'
def test_explicit_boundary_remains_strict():
    with pytest.raises(ValidationError): RegionRequest(**B,boundaries=[boundary('bad',BAD)])
def test_explicit_clip_remains_strict_even_when_optional_projects_are_isolated():
    with pytest.raises(ValidationError): RegionRequest(**B,clip_geometry=BAD,partial_project_boundaries=True)
def test_clip_is_preserved_and_does_not_invent_an_asset():
    result=segment_regions(RegionRequest(**B,clip_geometry=GOOD,partial_project_boundaries=True),[])
    assert result['cells']==[]
