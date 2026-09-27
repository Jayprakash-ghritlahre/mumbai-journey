// Builds public/data/western-line.json from data/osm/western-line.raw.json (© OpenStreetMap
// contributors, ODbL 1.0): one smoothed centre line of the Western Railway main tracks from
// Churchgate to Mira Road in the local frame, and the stations on it with their arc lengths.
// Usage: node tools/build-railway.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const ORIGIN = { lat: 18.93418, lon: 72.82743 };
const BEARING = 351;
const R = 6378137;
const K = Math.PI / 180;
const cosLat = Math.cos(ORIGIN.lat * K);
const cb = Math.cos(BEARING * K);
const sb = Math.sin(BEARING * K);
const toLocal = (lat, lon) => {
  const x = (lon - ORIGIN.lon) * K * R * cosLat;
  const z = -(lat - ORIGIN.lat) * K * R;
  return [x * cb + z * sb, -x * sb + z * cb];
};

const raw = JSON.parse(readFileSync(new URL('../data/osm/western-line.raw.json', import.meta.url), 'utf8'));
const ways = raw.elements.filter((e) => e.type === 'way' && e.tags?.railway === 'rail');
// Western Railway main tracks only (the Central and Harbour lines, yards, sidings and spurs are out).
const isMain = (t) => (t.usage === 'main' || (!t.service && !t.usage)) && !/central|harbour|port|pune|fci/i.test(t.name ?? '');

// Graph on shared coordinates.
const key = (g) => `${g.lat.toFixed(7)},${g.lon.toFixed(7)}`;
const nodes = new Map(); // key -> { x, z, adj: [ [key, len] ] }
const node = (g) => {
  const k = key(g);
  let n = nodes.get(k);
  if (!n) {
    const [x, z] = toLocal(g.lat, g.lon);
    nodes.set(k, (n = { x, z, adj: [] }));
  }
  return k;
};
for (const w of ways) {
  if (!isMain(w.tags)) continue;
  const g = w.geometry;
  for (let i = 1; i < g.length; i++) {
    const a = node(g[i - 1]);
    const b = node(g[i]);
    const A = nodes.get(a);
    const B = nodes.get(b);
    const len = Math.hypot(A.x - B.x, A.z - B.z);
    A.adj.push([b, len]);
    B.adj.push([a, len]);
  }
}
const nearest = (x, z) => {
  let best = null;
  let bd = Infinity;
  for (const [k, n] of nodes) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return { k: best, d: bd };
};
// From the northern throat of Churchgate (PF 3 road, x = 6) to Mira Road.
const from = nearest(6, -300);
const to = nearest(9030, -37737);
console.log('from', from.d.toFixed(1), 'to', to.d.toFixed(1));
// Dijkstra.
const dist = new Map([[from.k, 0]]);
const prev = new Map();
const open = new Set([from.k]);
while (open.size) {
  let u = null;
  let du = Infinity;
  for (const k of open) {
    const d = dist.get(k);
    if (d < du) {
      du = d;
      u = k;
    }
  }
  open.delete(u);
  if (u === to.k) break;
  for (const [v, len] of nodes.get(u).adj) {
    const nd = du + len;
    if (nd < (dist.get(v) ?? Infinity)) {
      dist.set(v, nd);
      prev.set(v, u);
      open.add(v);
    }
  }
}
if (!prev.has(to.k)) throw new Error('no path');
const chain = [];
for (let k = to.k; k; k = prev.get(k)) chain.push(nodes.get(k));
chain.reverse();
console.log('path nodes', chain.length, 'length', dist.get(to.k).toFixed(0));

// Resample every 5 m, then smooth (moving average over ~120 m) so crossovers between parallel
// tracks do not show as kinks: the result is the corridor's centre line.
const pts = chain.map((n) => [n.x, n.z]);
const resample = (p, step) => {
  const out = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1];
    const [bx, bz] = p[i];
    const len = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  out.push(p[p.length - 1]);
  return out;
};
let line = resample(pts, 5);
const W = 24;
for (let pass = 0; pass < 2; pass++) {
  const sm = line.map((_, i) => {
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(line.length - 1, i + W); j++) {
      sx += line[j][0];
      sz += line[j][1];
      n++;
    }
    return [sx / n, sz / n];
  });
  // Keep the ends where they were.
  sm[0] = line[0];
  sm[sm.length - 1] = line[line.length - 1];
  line = sm;
}
line = resample(line, 10);
const cum = [0];
for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));

// Stations (by name) projected onto the line.
const WANT = ['Churchgate', 'Marine Lines', 'Charni Road', 'Grant Road', 'Mumbai Central', 'Mahalaxmi', 'Lower Parel', 'Prabhadevi', 'Dadar', 'Matunga Road', 'Mahim Junction', 'Bandra', 'Khar Road', 'Santacruz', 'Vile Parle', 'Andheri', 'Jogeshwari', 'Ram Mandir', 'Goregaon', 'Malad', 'Kandivali', 'Borivali', 'Dahisar', 'Mira Road'];
const stations = [];
for (const name of WANT) {
  const cands = raw.elements.filter((e) => e.type === 'node' && (e.tags?.name === name || e.tags?.name === name + ' (Western Line)') && e.tags?.railway === 'station');
  let best = null;
  for (const c of cands) {
    const [x, z] = toLocal(c.lat, c.lon);
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < line.length; i++) {
      const d = Math.hypot(line[i][0] - x, line[i][1] - z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (!best || bd < best.d) best = { name, s: Math.round(cum[bi]), d: bd, x: Math.round(x), z: Math.round(z) };
  }
  if (best && best.d < 400) stations.push({ name: best.name, s: best.s, off: Math.round(best.d) });
  else console.log('skip station', name, best?.d);
}
stations.sort((a, b) => a.s - b.s);
// North of Mira Road (where the Churchgate train comes from): the PF 4 road, OSM way 327856040,
// from the Mira Road extract (tools/fetch-osm-miraroad.mjs).
let north = [];
try {
  const mr = JSON.parse(readFileSync(new URL('../data/osm/mira-road.raw.json', import.meta.url), 'utf8'));
  const w = mr.elements.find((e) => e.type === 'way' && e.id === 327856040);
  north = w.geometry
    .map((g) => toLocal(g.lat, g.lon))
    .filter(([, z]) => z < -37800)
    .sort((a, b) => a[1] - b[1]);
} catch (e) {
  console.log('no Mira Road extract:', e.message);
}
const out = {
  attribution: '© OpenStreetMap contributors — data available under the Open Database License (ODbL 1.0)',
  note: 'Western Railway main-track centre line, Churchgate (s = 0) to Mira Road, local frame metres, smoothed.',
  length: Math.round(cum[cum.length - 1]),
  line: line.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
  stations,
  north: north.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
};
writeFileSync(new URL('../public/data/western-line.json', import.meta.url), JSON.stringify(out));
console.log('length', out.length, 'points', line.length);
for (const s of stations) console.log(s.name.padEnd(16), s.s, 'off', s.off);
