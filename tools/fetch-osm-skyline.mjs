// Downloads the wider Back Bay area (© OpenStreetMap contributors, ODbL 1.0) used for
// the distant skyline seen from Marine Drive: Nariman Point, Cuffe Parade, Malabar Hill,
// Walkeshwar, Girgaon, Tardeo — buildings, coastline and a few landmark features.
// Usage: node tools/fetch-osm-skyline.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const BBOX = [18.895, 72.768, 18.985, 72.845]; // south, west, north, east
const b = BBOX.join(',');
const query = `[out:json][timeout:180];
(
  way["building"](${b});
  relation["building"](${b});
  way["natural"="coastline"](${b});
  way["natural"="beach"](${b});
  way["leisure"="stadium"](${b});
  way["man_made"~"mast|tower|lighthouse"](${b});
  node["man_made"~"mast|tower|lighthouse"](${b});
  way["highway"~"primary|secondary|trunk"](${b});
);
out geom tags;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'User-Agent': 'MumbaiJourney/0.2 (prototype)', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
const json = await res.json();
await mkdir(new URL('../data/osm/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/osm/back-bay.raw.json', import.meta.url), JSON.stringify(json));
let buildings = 0;
let tagged = 0;
for (const e of json.elements) {
  if (e.tags?.building) {
    buildings++;
    if (e.tags['building:levels'] || e.tags.height) tagged++;
  }
}
console.log('elements:', json.elements.length, 'buildings:', buildings, 'with height/levels:', tagged, 'osm_base:', json.osm3s?.timestamp_osm_base);
