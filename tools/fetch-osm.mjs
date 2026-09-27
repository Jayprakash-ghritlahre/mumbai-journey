// Downloads OpenStreetMap data (© OpenStreetMap contributors, ODbL 1.0) for the
// South Mumbai area covered by the journey: Churchgate, Marine Drive, Nariman Point.
// Usage: node tools/fetch-osm.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const BBOX = [18.918, 72.812, 18.948, 72.836]; // south, west, north, east
const b = BBOX.join(',');
const query = `[out:json][timeout:120];
(
  way["building"](${b});
  relation["building"](${b});
  way["building:part"](${b});
  way["highway"](${b});
  way["railway"](${b});
  node["railway"](${b});
  way["public_transport"](${b});
  way["natural"](${b});
  relation["natural"](${b});
  way["leisure"](${b});
  way["landuse"](${b});
  way["amenity"](${b});
  way["man_made"](${b});
  way["barrier"](${b});
  node["natural"="tree"](${b});
  node["highway"~"street_lamp|traffic_signals|bus_stop|crossing"](${b});
  node["amenity"](${b});
);
out geom tags;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'User-Agent': 'MumbaiJourney/0.1 (prototype)', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
const json = await res.json();
await mkdir(new URL('../data/osm/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/osm/south-mumbai.raw.json', import.meta.url), JSON.stringify(json));
const counts = {};
for (const e of json.elements) {
  const k = e.tags?.building ? 'building' : e.tags?.highway ? 'highway' : e.tags?.railway ? 'railway' : e.type;
  counts[k] = (counts[k] || 0) + 1;
}
console.log('elements:', json.elements.length, counts, 'osm_base:', json.osm3s?.timestamp_osm_base);
