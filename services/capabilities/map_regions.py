"""Bounded physical-object segmentation. Shapely owns geometry; pyproj owns areas.

OSM is queried only on an explicit scan. No imagery inference, POI density grid,
model call, or project/private text is sent to the public boundary provider.
"""
from __future__ import annotations
from hashlib import sha256
from math import isfinite
from time import monotonic
from typing import Literal
import json
import threading
import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely import make_valid, normalize
from shapely.geometry import box, shape, mapping, Polygon, LineString
from shapely.ops import transform, unary_union, polygonize
from pyproj import CRS, Transformer

MAX_REGIONS = 24
MAX_FEATURES = 6000
MAX_BYTES = 8_000_000
OVERPASS = 'https://overpass-api.de/api/interpreter'
_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_LOCK = threading.Lock()

class ProvidedBoundary(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(max_length=120)
    label: str = Field(max_length=40)
    geometry: dict
    coordinate_encoding: Literal['WGS84', 'GCJ-02'] = 'WGS84'

class RegionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    west: float
    south: float
    east: float
    north: float
    boundaries: list[ProvidedBoundary] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def bounded(self):
        v = [self.west, self.south, self.east, self.north]
        if not all(isfinite(x) for x in v) or not (-180 <= self.west < self.east <= 180 and -85 < self.south < self.north < 85):
            raise ValueError('INVALID_BOUNDS')
        if self.east-self.west > .060001 or self.north-self.south > .060001:
            raise ValueError('REGION_TOO_LARGE')
        for b in self.boundaries:
            if b.geometry.get('type') != 'Polygon' or len(json.dumps(b.geometry)) > 60000:
                raise ValueError('INVALID_BOUNDARY')
            p = shape(b.geometry)
            if p.is_empty or not p.is_valid or any(len(r.coords) > 512 for r in [p.exterior, *p.interiors]) or len(p.interiors) > 19:
                raise ValueError('INVALID_BOUNDARY')
            if any(not isfinite(v) for ring in [p.exterior, *p.interiors] for xy in ring.coords for v in xy) or not box(-180,-85,180,85).covers(p):
                raise ValueError('INVALID_BOUNDARY')
        return self

def _coordinate(geom, inverse=False):
    # Reuse the published conversion library; never project GCJ-02 as WGS84.
    import eviltransform
    fn = eviltransform.gcj2wgs_exact if inverse else eviltransform.wgs2gcj
    def xy(x,y,z=None):
        lat, lon = fn(y,x)
        return (lon,lat)
    return transform(xy,geom)

class GeometryConversionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    geometry: dict

def selected_geometry_wgs84(request: GeometryConversionRequest):
    raw = request.geometry
    if raw.get('type') != 'Polygon' or len(json.dumps(raw)) > 1_000_000:
        raise ValueError('INVALID_BOUNDARY')
    polygon = shape(raw)
    if polygon.is_empty or not polygon.is_valid or len(polygon.interiors) > 19:
        raise ValueError('INVALID_BOUNDARY')
    rings = [polygon.exterior, *polygon.interiors]
    if any(len(r.coords) > 512 for r in rings) or any(not isfinite(v) for r in rings for xy in r.coords for v in xy) or not box(-180,-85,180,85).covers(polygon):
        raise ValueError('INVALID_BOUNDARY')
    converted = _coordinate(polygon, inverse=True)
    if not converted.is_valid or converted.is_empty:
        raise ValueError('INVALID_CONVERSION')
    return {'geometry': mapping(converted), 'coordinate_encoding': 'WGS84'}

def _parts(g):
    if g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    return [p for child in getattr(g,'geoms',[]) for p in _parts(child)]

def fetch_elements(wgs_bounds:tuple[float,float,float,float]) -> list[dict]:
    west,south,east,north=wgs_bounds
    bbox=f'{south:.6f},{west:.6f},{north:.6f},{east:.6f}'
    key=bbox
    with _CACHE_LOCK:
        cached=_CACHE.get(key)
        if cached and monotonic()-cached[0] < 600: return cached[1]
    query=f'''[out:json][timeout:12][maxsize:8388608];(
way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street)$"]({bbox});
way["railway"="rail"]["tunnel"!="yes"]({bbox});
way["natural"="water"]({bbox});relation["natural"="water"]({bbox});
way["waterway"~"^(river|canal)$"]({bbox});
way["building"]({bbox});way["amenity"="university"]({bbox});relation["amenity"="university"]({bbox});way["landuse"~"^(industrial|commercial|retail)$"]({bbox});
);out geom;'''
    with httpx.Client(timeout=httpx.Timeout(16,connect=4),follow_redirects=False) as client:
        with client.stream('POST',OVERPASS,data={'data':query},headers={'User-Agent':'JiangongAI/0.2 public-boundary-research'}) as response:
            response.raise_for_status(); chunks=[]; size=0
            for chunk in response.iter_bytes():
                size+=len(chunk)
                if size>MAX_BYTES: raise ValueError('BOUNDARY_RESPONSE_TOO_LARGE')
                chunks.append(chunk)
    data=json.loads(b''.join(chunks))
    # Overpass can return a partial result with a 200 status and remark.
    if data.get('remark') or not isinstance(data.get('elements'),list) or len(data['elements'])>MAX_FEATURES:
        raise ValueError('BOUNDARY_RESPONSE_INCOMPLETE')
    with _CACHE_LOCK:
        if len(_CACHE)>=32: _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key]=(monotonic(),data['elements'])
    return data['elements']

def segment_regions(request:RegionRequest, elements:list[dict]) -> dict:
    if len(elements)>MAX_FEATURES: raise ValueError('TOO_MANY_FEATURES')
    gcj_box=box(request.west,request.south,request.east,request.north)
    wgs_box=_coordinate(gcj_box,inverse=True)
    lon,lat=wgs_box.centroid.coords[0]
    metric=CRS.from_proj4(f'+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m')
    forward=Transformer.from_crs('EPSG:4326',metric,always_xy=True).transform
    reverse=Transformer.from_crs(metric,'EPSG:4326',always_xy=True).transform
    clip=transform(forward,wgs_box)
    explicit=[]; compounds=[]; buildings=[]; roads=[]; water=[]; ref_lines=[]
    for b in sorted(request.boundaries,key=lambda b:b.id):
        g=shape(b.geometry)
        if b.coordinate_encoding=='GCJ-02':g=_coordinate(g,inverse=True)
        explicit.append((transform(forward,g).intersection(clip),b.label,f'project:{b.id}'))
    for element in sorted(elements,key=lambda e:(str(e.get('type')),str(e.get('id')))):
        tags=element.get('tags') or {}; ref=f"osm:{element.get('type')}:{element.get('id')}"
        if element.get('type')=='relation' and (tags.get('natural')=='water' or tags.get('amenity')=='university'):
            rings={}
            for member in element.get('members',[]):
                points=[(p['lon'],p['lat']) for p in member.get('geometry',[]) if 'lon'in p and 'lat'in p]
                if 2<=len(points)<=2000 and all(isfinite(v) for p in points for v in p):
                    rings.setdefault(member.get('role','outer'),[]).append(transform(forward,LineString(points)))
            outer=unary_union(list(polygonize(unary_union(rings.get('outer',[])))))
            inner=unary_union(list(polygonize(unary_union(rings.get('inner',[])))))
            polygon=outer.difference(inner)
            if tags.get('natural')=='water':water.append(polygon)
            else:compounds.append((polygon,tags.get('name') or '校园',ref))
            continue
        points=[(p['lon'],p['lat']) for p in element.get('geometry',[]) if 'lon'in p and 'lat'in p]
        if not 2<=len(points)<=2000 or any(not isfinite(v) for p in points for v in p):continue
        # Keep a small overhang so GEOS nodes crossings on the clip boundary,
        # rather than relying on nearly-equal floating-point endpoints.
        line=transform(forward,LineString(points)).intersection(clip.buffer(5))
        if line.is_empty:continue
        if tags.get('highway') or tags.get('railway'):
            if tags.get('tunnel')=='yes' or tags.get('bridge')=='yes' or str(tags.get('layer','0')) not in ['0','']:
                continue
            roads.append(line);ref_lines.append(ref)
        elif tags.get('waterway') in ['river','canal']:
            water.append(line.buffer(5));ref_lines.append(ref)
        elif len(points)>=4 and points[0]==points[-1]:
            poly=make_valid(transform(forward,Polygon(points))).intersection(clip)
            if tags.get('natural')=='water':water.append(poly)
            elif tags.get('landuse') or tags.get('amenity')=='university':compounds.append((poly,tags.get('name') or '园区',ref))
            elif tags.get('building'):buildings.append((poly,tags.get('name') or '建筑',ref))
    excluded=unary_union(water)
    occupied=Polygon();candidates=[]
    def add(g,label,ref,minimum):
        nonlocal occupied
        g=make_valid(g).difference(excluded).difference(occupied)
        for part in sorted(_parts(g),key=lambda p:p.area,reverse=True):
            # Metric simplification with topology preserved; tiny slivers are discarded.
            simplified=part.simplify(1.0,preserve_topology=True).intersection(clip).difference(excluded).difference(occupied)
            for part in _parts(simplified):
                if part.area<minimum or len(part.interiors)>19 or any(len(r.coords)>512 for r in [part.exterior,*part.interiors]):continue
                candidates.append((part,label[:40],ref));occupied=unary_union([occupied,part])
    for g,label,ref in explicit:add(g,label,ref,25)
    for g,label,ref in compounds:add(g,label,ref,500)
    if roads:
        network=unary_union([clip.boundary,*roads])
        blocks=list(polygonize(network))
        # A lone clipped viewport is not a discovered street block.
        if len(blocks)>1:
            road_space=unary_union(roads).buffer(3)
            for g in sorted(blocks,key=lambda p:(p.centroid.x,p.centroid.y)):
                if clip.covers(g.representative_point()):add(g.difference(road_space),'街区','osm:street-network',1500)
    # Fill uncovered areas even when another part of the viewport has a compound.
    for g,label,ref in buildings:add(g,label,ref,25)
    # Stable, geographic priority, never record-count priority.
    candidates.sort(key=lambda c:(0 if c[2].startswith('project:') else 1,c[0].distance(clip.centroid),c[2]))
    total=len(candidates);cells=[]
    for i,(g,label,ref) in enumerate(candidates[:MAX_REGIONS]):
        identifier='R-'+sha256(normalize(g).wkb+ref.encode()).hexdigest()[:12]
        output=_coordinate(transform(reverse,g));anchor=_coordinate(transform(reverse,g.representative_point()))
        west,south,east,north=output.bounds
        cells.append({'id':identifier,'label':label if label not in ['街区','建筑','园区'] else f'{label} {i+1}',
            'bounds':dict(west=west,south=south,east=east,north=north),
            'geometry':mapping(output),'anchor':list(anchor.coords[0]),'boundary_source':ref,
            'area_m2':round(g.area,1),'context':None,'tier':'pending','rank':None,'metric_value':None})
    return {'cells':cells,'total':total,'truncated':total>MAX_REGIONS,
        'method':'source-polygons + road-water polygonize + building fallback',
        'attribution':'© OpenStreetMap contributors · ODbL 1.0' if elements else '项目范围',
        'source_url':'https://www.openstreetmap.org/copyright' if elements else None}

def resolve_regions(request:RegionRequest) -> dict:
    error=None
    try:
        wgs=_coordinate(box(request.west,request.south,request.east,request.north),inverse=True)
        elements=fetch_elements(wgs.buffer(.00015).bounds)
    except (httpx.HTTPError,ValueError,KeyError) as exc:
        elements=[];error=type(exc).__name__
    result=segment_regions(request,elements)
    result['provider_status']='unavailable' if error else 'available'
    return result
