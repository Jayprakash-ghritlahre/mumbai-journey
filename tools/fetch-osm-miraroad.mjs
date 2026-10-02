// Downloads OpenStreetMap data (© OpenStreetMap contributors, ODbL 1.0) around Mira Road
// station: platforms, tracks, the footbridges, the station building and nearby streets; and, for
// the auto ride from Shanti Nagar (AUTO_RIDE.md), the buildings and streets south-east of it
// (Shanti Nagar's sectors, Poonam Sagar Road).
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
async function fetchTo(q, file) {
  let json = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'MumbaiJourney/0.1 (prototype)', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
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
  await writeFile(new URL(`../data/osm/${file}`, import.meta.url), JSON.stringify(json));
  const counts = {};
  for (const e of json.elements) counts[e.type] = (counts[e.type] ?? 0) + 1;
  console.log(file, 'elements', counts);
}

await fetchTo(query, 'mira-road.raw.json');

// South-east of the station: Shanti Nagar's sectors and Poonam Sagar Road, where the auto ride
// starts. Only what the model uses (buildings, streets); build-miraroad.mjs appends it.
const SOUTH = [19.2738, 72.8525, 19.2785, 72.8645].join(',');
await fetchTo(`[out:json][timeout:60];(way["building"](${SOUTH});way["highway"](${SOUTH}););out geom tags;`, 'mira-road-south.raw.json');
