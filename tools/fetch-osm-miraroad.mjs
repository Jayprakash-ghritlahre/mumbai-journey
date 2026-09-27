// Downloads OpenStreetMap data (© OpenStreetMap contributors, ODbL 1.0) around Mira Road
// station: platforms, tracks, the footbridges, the station building and nearby streets.
// Usage: node tools/fetch-osm-miraroad.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const BBOX = [19.2775, 72.851, 19.2865, 72.862]; // south, west, north, east
const b = BBOX.join(',');
const query = `[out:json][timeout:120];
(
  way["building"](${b});
  way["building:part"](${b});
  way["highway"](${b});
  way["railway"](${b});
  node["railway"](${b});
  way["public_transport"](${b});
  way["man_made"](${b});
  way["amenity"](${b});
  way["leisure"](${b});
  way["landuse"](${b});
  node["historic"](${b});
  node["memorial"](${b});
  node["tourism"](${b});
);
out geom tags;`;

// The main Overpass instance is often busy; fall back to public mirrors.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let json = null;
for (const url of ENDPOINTS) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': 'MumbaiJourney/0.1 (prototype)', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
    break;
  } catch (e) {
    console.log(`${url}: ${e.message}`);
  }
}
if (!json) throw new Error('all Overpass endpoints failed');
await mkdir(new URL('../data/osm/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/osm/mira-road.raw.json', import.meta.url), JSON.stringify(json));
const counts = {};
for (const e of json.elements) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log('elements', counts);
