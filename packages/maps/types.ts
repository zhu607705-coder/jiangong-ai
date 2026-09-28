export interface MapConfiguration {
  provider: 'amap'; configured: boolean; js_key: string | null; revision: string;
  service_path: '/_AMapService'; sdk_version: '2.0';
}
export interface PlaceSelection {
  id: string; kind: 'point' | 'poi' | 'project'; name: string;
  longitude: number; latitude: number; coordinate_encoding: 'GCJ-02';
  address?: string; category?: string; city?: string; poi_id?: string; project_id?: string;
}
export interface PlaceDetails {
  address: string | null; category: string; telephone?: string;
  photos: { url: string; title: string }[]; source: '高德地图';
}
