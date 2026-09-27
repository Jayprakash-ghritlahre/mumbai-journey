// Downloads the Western Railway suburban corridor geometry from OpenStreetMap
// (© OpenStreetMap contributors, ODbL 1.0): track centre lines and station nodes between
// Churchgate and Mira Road. Used for the local-train milestone (LOCAL_TRAIN.md).
// Usage: node tools/fetch-osm-railway.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const BBOX = [18.925, 72.8, 19.3, 72.9]; // south, west, north, east
const b = BBOX.join(',');
const query = `[out:json][timeout:180];
(
  way["railway"="rail"](${b});
  node["railway"~"station|halt"](${b});
  node["public_transport"="station"](${b});
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
await writeFile(new URL('../data/osm/western-line.raw.json', import.meta.url), JSON.stringify(json));
const counts = {};
for (const e of json.elements) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log('elements', counts);
