"""Synthetic spatial fixtures test topology; they are not real project boundaries."""
import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch
import pytest
from pydantic import ValidationError
from shapely.geometry import Polygon, Point, shape, box
spec=importlib.util.spec_from_file_location('map_regions',Path(__file__).parents[1]/'services/capabilities/map_regions.py')
regions=importlib.util.module_from_spec(spec);sys.modules[spec.name]=regions;spec.loader.exec_module(regions)
B=dict(west=120.15,east=120.17,south=30.27,north=30.29)
def request(boundaries=None):
    return regions.RegionRequest(**B,boundaries=boundaries or [])
def boundary(id='P1',geometry=None):
    return dict(id=id,label='测试厂区',coordinate_encoding='GCJ-02',geometry=geometry or {'type':'Polygon','coordinates':[[[120.152,30.272],[120.164,30.272],[120.168,30.283],[120.156,30.288],[120.152,30.272]]]})
def way(id,points,tags):
    # Overpass fixtures always carry WGS84, unlike the UI's GCJ-02.
    wgs=regions._coordinate(regions.LineString(points),inverse=True)
    return dict(id=id,type='way',tags=tags,geometry=[dict(lon=x,lat=y) for x,y in wgs.coords])
def test_empty_provider_does_not_fabricate_grid():
    assert regions.segment_regions(request(),[])['cells']==[]
def test_explicit_polygon_shape_and_anchor_preserved():
    result=regions.segment_regions(request([boundary()]),[])
    assert len(result['cells'])==1
    c=result['cells'][0];g=shape(c['geometry'])
    assert c['boundary_source']=='project:P1' and c['area_m2']>0
    assert g.contains(Point(c['anchor']))
    assert g.area < .02*.02
    assert len(g.exterior.coords)==5

def test_holes_and_water_are_not_colored():
    poly=boundary()['geometry'];hole=[[120.157,30.277],[120.16,30.277],[120.16,30.28],[120.157,30.28],[120.157,30.277]]
    poly['coordinates'].append(hole)
    cells=regions.segment_regions(request([boundary(geometry=poly)]),[])['cells']
    assert len(cells)==1 and not shape(cells[0]['geometry']).covers(Point(120.158,30.278))
    water=way(2,hole,{'natural':'water'})
    cells=regions.segment_regions(request([boundary()]),[water])['cells']
    assert all(not shape(c['geometry']).covers(Point(120.158,30.278)) for c in cells)

def test_selected_geometry_is_converted_to_wgs84_with_holes_and_round_trip():
    raw=boundary()['geometry']
    raw['coordinates'].append([[120.157,30.277],[120.16,30.277],[120.16,30.28],[120.157,30.28],[120.157,30.277]])
    result=regions.selected_geometry_wgs84(regions.GeometryConversionRequest(geometry=raw))
    assert result['coordinate_encoding']=='WGS84'
    converted=shape(result['geometry'])
    assert converted.is_valid and len(converted.interiors)==1
    assert converted.bounds != shape(raw).bounds
    restored=regions._coordinate(converted)
    assert restored.hausdorff_distance(shape(raw))<2e-6
    assert not restored.covers(Point(120.158,30.278))

def test_selected_geometry_does_not_silently_repair_invalid_input():
    with pytest.raises(ValueError):
        regions.selected_geometry_wgs84(regions.GeometryConversionRequest(geometry={'type':'Polygon','coordinates':[[[120,30],[121,31],[120,31],[121,30],[120,30]]]}))

def test_crossing_surface_roads_make_four_blocks_not_nine():
    roads=[way(1,[(120.14,30.28),(120.18,30.28)],{'highway':'primary'}),way(2,[(120.16,30.26),(120.16,30.3)],{'highway':'secondary'})]
    cells=regions.segment_regions(request(),roads)['cells']
    assert len(cells)==4
    for c in cells: assert shape(c['geometry']).contains(Point(c['anchor']))

def test_bridge_is_not_a_surface_divider():
    road=way(1,[(120.14,30.28),(120.18,30.28)],{'highway':'primary','bridge':'yes'})
    assert regions.segment_regions(request(),[road])['cells']==[]

def test_buildings_are_a_fallback_and_overlaps_are_removed():
    b=boundary()['geometry']['coordinates'][0]
    cells=regions.segment_regions(request(),[way(1,b,{'building':'yes'})])['cells']
    assert len(cells)==1 and cells[0]['boundary_source']=='osm:way:1'
    cells=regions.segment_regions(request([boundary('P1'),boundary('P2')]),[])['cells']
    assert len(cells)==1

def test_source_order_does_not_change_ids_and_overlap_is_negligible():
    small={'type':'Polygon','coordinates':[[[120.158,30.274],[120.168,30.274],[120.168,30.284],[120.158,30.284],[120.158,30.274]]]}
    inputs=[boundary('P1'),boundary('P2',small)]
    one=regions.segment_regions(request(inputs),[])['cells'];two=regions.segment_regions(request(inputs[::-1]),[])['cells']
    assert [c['id'] for c in one]==[c['id'] for c in two]
    for i,c in enumerate(one):
        for other in one[i+1:]: assert shape(c['geometry']).intersection(shape(other['geometry'])).area<1e-9

def test_overlarge_invalid_and_nonfinite_inputs_fail():
    for patch_ in [dict(east=121),dict(west=float('nan')),dict(south=91)]:
        with pytest.raises(ValidationError):regions.RegionRequest(**(B|patch_))
    bow={'type':'Polygon','coordinates':[[[120.152,30.272],[120.165,30.285],[120.165,30.272],[120.152,30.285],[120.152,30.272]]]}
    with pytest.raises(ValidationError):request([boundary(geometry=bow)])

def test_provider_error_keeps_owned_boundary():
    with patch.object(regions,'fetch_elements',side_effect=regions.httpx.ConnectError('fixture unavailable')):
        result=regions.resolve_regions(request([boundary()]))
        assert result['provider_status']=='unavailable' and len(result['cells'])==1

def test_region_cap_is_explicit():
    polys=[]
    for i in range(30):
        x=120.1505+(i%6)*.003;y=30.2705+(i//6)*.003
        geometry={'type':'Polygon','coordinates':[[[x,y],[x+.001,y],[x+.001,y+.001],[x,y+.001],[x,y]]]}
        polys.append(boundary(str(i),geometry))
    result=regions.segment_regions(request(polys),[])
    assert len(result['cells'])==24 and result['total']==30 and result['truncated']

def test_campus_is_an_object_instead_of_an_arbitrary_road_cell():
    campus=way(31,boundary()['geometry']['coordinates'][0],{'amenity':'university','name':'测试大学校区'})
    cells=regions.segment_regions(request(),[campus])['cells']
    assert len(cells)==1 and cells[0]['label']=='测试大学校区'
    assert cells[0]['boundary_source']=='osm:way:31'

def test_campus_relation_preserves_inner_courtyard():
    outer=way(1,boundary()['geometry']['coordinates'][0],{})['geometry']
    hole=way(2,[(120.157,30.277),(120.160,30.277),(120.160,30.280),(120.157,30.280),(120.157,30.277)],{})['geometry']
    relation={'type':'relation','id':33,'tags':{'amenity':'university','name':'测试多环校区'},'members':[{'role':'outer','geometry':outer},{'role':'inner','geometry':hole}]}
    cells=regions.segment_regions(request(),[relation])['cells']
    assert len(cells)==1 and not shape(cells[0]['geometry']).covers(Point(120.158,30.278))

def test_buildings_outside_a_compound_are_not_silently_dropped():
    campus=way(31,[(120.151,30.271),(120.155,30.271),(120.155,30.275),(120.151,30.275),(120.151,30.271)],{'amenity':'university','name':'测试校园'})
    building=way(32,[(120.163,30.282),(120.165,30.282),(120.165,30.284),(120.163,30.284),(120.163,30.282)],{'building':'yes','name':'独立楼宇'})
    cells=regions.segment_regions(request(),[campus,building])['cells']
    assert len(cells)==2 and {c['boundary_source'] for c in cells}=={'osm:way:31','osm:way:32'}
