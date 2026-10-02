// Trims data/osm/mira-road.raw.json (© OpenStreetMap contributors, ODbL 1.0) to what the Mira Road
// station model uses (platforms, deck and foot-over-bridges, steps, streets, buildings, forecourt)
// and writes public/data/mira-road.osm.json. The extract south-east of it (mira-road-south.raw.json,
// Shanti Nagar and Poonam Sagar Road, for the auto ride) is appended after it, its ways marked
// `ext` (so the station's own build stays as it was). Usage: node tools/build-miraroad.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync(new URL('../data/osm/mira-road.raw.json', import.meta.url), 'utf8'));
const southFile = new URL('../data/osm/mira-road-south.raw.json', import.meta.url);
const south = existsSync(southFile) ? JSON.parse(readFileSync(southFile, 'utf8')) : { elements: [] };
const KEEP_TAGS = ['building', 'building:levels', 'height', 'name', 'highway', 'bridge', 'railway', 'ref', 'escalator', 'conveying', 'amenity', 'area', 'covered'];
const keep = (t) => t.building || t.highway || t.railway === 'platform' || t.amenity === 'parking';
const elements = [];
const seen = new Set();
for (const [src, ext] of [
  [raw, false],
  [south, true],
]) {
  for (const e of src.elements) {
    const t = e.tags ?? {};
    if (e.type !== 'way' || !e.geometry || !keep(t) || seen.has(e.id)) continue;
    seen.add(e.id);
    const tags = {};
    for (const k of KEEP_TAGS) if (t[k] !== undefined) tags[k] = t[k];
    elements.push({ type: 'way', id: e.id, tags, geometry: e.geometry.map((g) => ({ lat: +g.lat.toFixed(7), lon: +g.lon.toFixed(7) })), ...(ext ? { ext: 1 } : {}) });
  }
}
const out = { attribution: '© OpenStreetMap contributors — data available under the Open Database License (ODbL 1.0)', osmBase: raw.osm3s?.timestamp_osm_base ?? null, elements };
writeFileSync(new URL('../public/data/mira-road.osm.json', import.meta.url), JSON.stringify(out));
console.log('kept', elements.length, 'ways');
