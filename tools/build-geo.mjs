// Converts raw OpenStreetMap data (© OpenStreetMap contributors, ODbL 1.0) into a
// compact JSON in the game's local metric frame.
//
// Local frame: origin at the Churchgate buffer-stop line (centre of the 4 tracks),
// Y up, -Z points up the tracks (true bearing STATION_BEARING), +X is to the right
// when looking north along the platforms. Units are metres.
//
// Usage: node tools/build-geo.mjs
import { readFileSync, writeFileSync } from 'node:fs';

export const ORIGIN = { lat: 18.93418, lon: 72.82743 };
export const STATION_BEARING = 351;

const R = 6378137;
const K = Math.PI / 180;
const cosLat = Math.cos(ORIGIN.lat * K);
const cb = Math.cos(STATION_BEARING * K);
const sb = Math.sin(STATION_BEARING * K);

function toLocal(lat, lon) {
  const x = (lon - ORIGIN.lon) * K * R * cosLat; // east
  const z = -(lat - ORIGIN.lat) * K * R; // south
  return [Math.round((x * cb + z * sb) * 10) / 10, Math.round((-x * sb + z * cb) * 10) / 10];
}

const raw = JSON.parse(readFileSync(new URL('../data/osm/south-mumbai.raw.json', import.meta.url), 'utf8'));
const out = {
  attribution: '© OpenStreetMap contributors — data available under the Open Database License (ODbL 1.0)',
  origin: ORIGIN,
  bearing: STATION_BEARING,
  osmBase: raw.osm3s?.timestamp_osm_base ?? null,
  buildings: [],
  roads: [],
  rails: [],
  areas: [],
  coast: [],
  barriers: [],
  trees: [],
  pois: [],
};

const flat = (geom) => {
  const a = [];
  for (const g of geom) if (g) a.push(...toLocal(g.lat, g.lon));
  return a;
};
const num = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const isClosed = (geom) =>
  geom.length > 3 && geom[0] && geom.at(-1) && geom[0].lat === geom.at(-1).lat && geom[0].lon === geom.at(-1).lon;

function ringArea(p) {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}
// Store footprints counter-clockwise when viewed from above (+Y), i.e. in x/z with z south.
function normaliseRing(p) {
  if (p.length >= 4 && p[0] === p.at(-2) && p[1] === p.at(-1)) p = p.slice(0, -2);
  if (ringArea(p) > 0) {
    const r = [];
    for (let i = p.length / 2 - 1; i >= 0; i--) r.push(p[i * 2], p[i * 2 + 1]);
    p = r;
  }
  return p;
}

const ROAD_WIDTH = {
  motorway: 14, trunk: 14, primary: 12, secondary: 10, tertiary: 8, residential: 6.5, unclassified: 6,
  service: 4.5, living_street: 5, pedestrian: 6, footway: 2.5, path: 2, steps: 2.5, cycleway: 2, track: 3,
};

for (const e of raw.elements) {
  const t = e.tags || {};
  if (e.type === 'node') {
    const [x, z] = toLocal(e.lat, e.lon);
    if (t.natural === 'tree') out.trees.push(x, z);
    else {
      const k = t.railway === 'subway_entrance' ? 'subway_entrance'
        : t.highway === 'bus_stop' ? 'bus_stop'
        : t.highway === 'traffic_signals' ? 'traffic_signals'
        : t.highway === 'street_lamp' ? 'street_lamp'
        : t.highway === 'crossing' ? 'crossing'
        : t.amenity ? t.amenity
        : t.railway ? 'rail_' + t.railway : null;
      if (k) out.pois.push({ k, n: t.name ?? null, x, z, ref: t.ref ?? null });
    }
    continue;
  }
  if (e.type === 'relation') {
    if (!t.building && !t.natural) continue;
    for (const m of e.members || []) {
      if (m.role !== 'outer' || !m.geometry) continue;
      const fp = normaliseRing(flat(m.geometry));
      if (fp.length < 6) continue;
      if (t.building) out.buildings.push({ id: e.id, n: t.name ?? null, lv: num(t['building:levels']), h: num(t.height), t: t.building, c: t['building:colour'] ?? null, hist: t.historic ? 1 : 0, fp });
      else out.areas.push({ k: t.natural, n: t.name ?? null, p: fp });
    }
    continue;
  }
  if (!e.geometry) continue;
  const closed = isClosed(e.geometry);
  if (t.building || t['building:part']) {
    if (!closed) continue;
    const fp = normaliseRing(flat(e.geometry));
    if (fp.length < 6) continue;
    out.buildings.push({
      id: e.id,
      n: t.name ?? null,
      lv: num(t['building:levels']),
      minLv: num(t['building:min_level']),
      h: num(t.height),
      t: t.building || 'part',
      c: t['building:colour'] ?? null,
      roof: t['roof:shape'] ?? null,
      hist: t.historic ? 1 : 0,
      fp,
    });
  } else if (t.highway) {
    if (t.area === 'yes' && closed) {
      out.areas.push({ k: 'pedestrian', n: t.name ?? null, p: normaliseRing(flat(e.geometry)) });
      continue;
    }
    const lanes = num(t.lanes);
    const w = lanes ? Math.max(lanes * 3.2, 3) : ROAD_WIDTH[t.highway] ?? 4;
    out.roads.push({ id: e.id, n: t.name ?? null, k: t.highway, ln: lanes, ow: t.oneway === 'yes' ? 1 : 0, w, br: t.bridge ? 1 : 0, tun: t.tunnel ? 1 : 0, lay: num(t.layer) ?? 0, p: flat(e.geometry) });
  } else if (t.railway) {
    if (t.railway === 'platform' && closed) out.areas.push({ k: 'platform', n: t.name ?? null, p: normaliseRing(flat(e.geometry)) });
    else out.rails.push({ id: e.id, k: t.railway, s: t.service ?? null, u: t.usage ?? null, n: t.name ?? null, tun: t.tunnel ? 1 : 0, p: flat(e.geometry) });
  } else if (t.natural === 'coastline') {
    out.coast.push({ p: flat(e.geometry) });
  } else if (t.barrier) {
    out.barriers.push({ k: t.barrier, p: flat(e.geometry) });
  } else if (closed && (t.leisure || t.landuse || t.natural || t.amenity || t.man_made)) {
    const k = t.leisure || t.landuse || t.natural || t.amenity || t.man_made;
    out.areas.push({ k, sport: t.sport ?? null, n: t.name ?? null, p: normaliseRing(flat(e.geometry)) });
  }
}

writeFileSync(new URL('../public/data/south-mumbai.geo.json', import.meta.url), JSON.stringify(out));
console.log(
  `buildings ${out.buildings.length}, roads ${out.roads.length}, rails ${out.rails.length}, areas ${out.areas.length}, ` +
    `coast ${out.coast.length}, trees ${out.trees.length / 2}, pois ${out.pois.length}`,
);
