// Converts the wider Back Bay OSM extract (© OpenStreetMap contributors, ODbL 1.0) into
// public/data/back-bay.geo.json in the game's local frame (see tools/build-geo.mjs):
//   land     — land polygons built from the coastline (land on the left of each way)
//   far      — buildings outside the detailed city area, with validated heights
//   stadiums — stadium outlines (floodlight masts are placed around them)
//   roads    — main roads (for the distant street-light "Queen's Necklace")
// Usage: node tools/build-skyline-geo.mjs
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
const r1 = (v) => Math.round(v * 10) / 10;

/** Must match the bounds City.build() uses for detailed buildings (south-mumbai extract). */
const NEAR = { x0: -560, x1: 300, z0: -760, z1: 420 };
const inNear = (x, z) => x >= NEAR.x0 && x <= NEAR.x1 && z >= NEAR.z0 && z <= NEAR.z1;

const raw = JSON.parse(readFileSync(new URL('../data/osm/back-bay.raw.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------------------------
// Heights: OSM has some broken height tags (e.g. 500 m on a 21-storey block). Trust levels.
const num = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
function heightOf(t, area) {
  let lv = num(t['building:levels']);
  let h = num(t.height);
  if (lv != null && (lv < 1 || lv > 120)) lv = null;
  if (h != null && (h < 2 || h > 400)) h = null;
  if (lv != null && h != null && (h > lv * 4.5 + 15 || h < lv * 2.2)) h = null;
  if (h != null) return { h, est: false };
  if (lv != null) return { h: lv * 3.3 + 2, est: false };
  // Untagged: modest, deterministic estimate from footprint size.
  const hash = Math.abs(Math.sin(area * 12.9898) * 43758.5453) % 1;
  const floors = area < 80 ? 1 + Math.floor(hash * 2) : area < 300 ? 3 + Math.floor(hash * 3) : 4 + Math.floor(hash * 4);
  return { h: floors * 3.3 + 2, est: true };
}

function ringArea(p) {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}
function simplify(pts, tol) {
  // Douglas–Peucker on [[x,z],...] (closed ring without the duplicate end point).
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bd = tol;
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------------------------------------
const out = {
  attribution: '© OpenStreetMap contributors — data available under the Open Database License (ODbL 1.0)',
  osmBase: raw.osm3s?.timestamp_osm_base ?? null,
  land: [],
  far: [],
  stadiums: [],
  roads: [],
};

const coastWays = [];
let estimated = 0;
for (const e of raw.elements) {
  const t = e.tags || {};
  if (!e.geometry) continue;
  const g = e.geometry.filter(Boolean).map((p) => toLocal(p.lat, p.lon));
  if (t.natural === 'coastline') {
    coastWays.push(g);
    continue;
  }
  if (t.leisure === 'stadium' && g.length > 3) {
    out.stadiums.push({ n: t.name ?? null, p: g.flat().map(r1) });
    continue;
  }
  if (t.highway && ['primary', 'secondary', 'trunk'].includes(t.highway)) {
    out.roads.push({ n: t.name ?? null, k: t.highway, p: g.flat().map(r1) });
    continue;
  }
  if (!t.building || e.type !== 'way' || g.length < 4) continue;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of g) {
    cx += x;
    cz += z;
  }
  cx /= g.length;
  cz /= g.length;
  if (inNear(cx, cz)) continue;
  let ring = g.slice(0, -1);
  ring = simplify(ring, 0.8);
  if (ring.length < 3) continue;
  let flat = ring.flat();
  const area = Math.abs(ringArea(flat));
  if (area < 25) continue;
  // Counter-clockwise viewed from above, as the city generator expects (negative shoelace in x/z).
  if (ringArea(flat) > 0) flat = ring.slice().reverse().flat();
  const { h, est } = heightOf(t, area);
  if (est) estimated++;
  out.far.push({ id: e.id, n: t.name ?? null, t: t.building, h: r1(h), e: est ? 1 : 0, fp: flat.map(r1) });
}

// ---------------------------------------------------------------------------------------------
// Land polygons from the coastline. Work in (u, v) = (x, -z) so that "left of the way"
// (where OSM puts land) is the usual mathematical left and land rings come out CCW.
function chain(ways) {
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const byStart = new Map();
  for (const w of ways) byStart.set(key(w[0]), w);
  const used = new Set();
  const chains = [];
  for (const w of ways) {
    if (used.has(w)) continue;
    // Walk backwards to the head of this chain.
    let head = w;
    const byEnd = new Map(ways.map((x) => [key(x[x.length - 1]), x]));
    const seen = new Set([head]);
    for (;;) {
      const prev = byEnd.get(key(head[0]));
      if (!prev || seen.has(prev) || used.has(prev)) break;
      seen.add(prev);
      head = prev;
    }
    const pts = [];
    let cur = head;
    while (cur && !used.has(cur)) {
      used.add(cur);
      pts.push(...(pts.length ? cur.slice(1) : cur));
      cur = byStart.get(key(cur[cur.length - 1]));
    }
    chains.push(pts);
  }
  return chains;
}

function landPolygons(ways, rect) {
  const uv = ways.map((w) => w.map(([x, z]) => [x, -z]));
  const { u0, u1, v0, v1 } = rect;
  const W = u1 - u0;
  const H = v1 - v0;
  const P = 2 * (W + H);
  const inside = ([u, v]) => u > u0 && u < u1 && v > v0 && v < v1;
  // Perimeter parameter, counter-clockwise from (u0, v0).
  const tOf = ([u, v]) => {
    const e = 1e-6;
    if (Math.abs(v - v0) < e) return u - u0;
    if (Math.abs(u - u1) < e) return W + (v - v0);
    if (Math.abs(v - v1) < e) return W + H + (u1 - u);
    return 2 * W + H + (v1 - v);
  };
  const corners = [
    [W, [u1, v0]],
    [W + H, [u1, v1]],
    [2 * W + H, [u0, v1]],
    [P, [u0, v0]],
  ];
  const clipSeg = (a, b) => {
    // Liang–Barsky: returns [tEnter, tExit] of the segment inside the rect, or null.
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    for (const [p, q] of [
      [-dx, a[0] - u0],
      [dx, u1 - a[0]],
      [-dy, a[1] - v0],
      [dy, v1 - a[1]],
    ]) {
      if (p === 0) {
        if (q < 0) return null;
      } else {
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    return t0 <= t1 ? [t0, t1] : null;
  };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  const pieces = [];
  const islands = [];
  for (const c of chain(uv)) {
    const closed = c.length > 3 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < 0.05;
    if (closed && c.every(inside)) {
      islands.push(c);
      continue;
    }
    let cur = null;
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i];
      const b = c[i + 1];
      const cl = clipSeg(a, b);
      if (!cl) continue;
      const [ta, tb] = cl;
      if (!cur) {
        const entry = ta > 0 ? lerp(a, b, ta) : a;
        if (ta === 0 && inside(a)) {
          // Chain starts inside the rectangle: extend it backwards to the boundary.
          const dir = [a[0] - b[0], a[1] - b[1]];
          const far = [a[0] + dir[0] * 1e4, a[1] + dir[1] * 1e4];
          const cl2 = clipSeg(a, far);
          cur = { pts: [lerp(a, far, cl2[1]), a], entry: lerp(a, far, cl2[1]) };
        } else cur = { pts: [entry], entry };
      }
      if (tb < 1) {
        const exit = lerp(a, b, tb);
        cur.pts.push(exit);
        cur.exit = exit;
        pieces.push(cur);
        cur = null;
      } else cur.pts.push(b);
    }
    if (cur) {
      // Chain ends inside: extend forwards to the boundary.
      const a = cur.pts[cur.pts.length - 1];
      const b = cur.pts[cur.pts.length - 2];
      const dir = [a[0] - b[0], a[1] - b[1]];
      const far = [a[0] + dir[0] * 1e4, a[1] + dir[1] * 1e4];
      const cl2 = clipSeg(a, far);
      const exit = lerp(a, far, cl2[1]);
      cur.pts.push(exit);
      cur.exit = exit;
      pieces.push(cur);
    }
  }
  for (const p of pieces) {
    p.tin = tOf(p.entry);
    p.tout = tOf(p.exit);
  }
  const polys = [];
  const used = new Set();
  for (const start of pieces) {
    if (used.has(start)) continue;
    const poly = [];
    let cur = start;
    for (let guard = 0; guard < 1000; guard++) {
      used.add(cur);
      poly.push(...cur.pts);
      let best = null;
      let bd = Infinity;
      for (const q of pieces) {
        const d = (q.tin - cur.tout + P) % P;
        if (d < bd && (q === start || !used.has(q))) {
          bd = d;
          best = q;
        }
      }
      // Rectangle corners passed while walking counter-clockwise to the next entry, in order.
      const passed = corners
        .map(([ct, cp]) => [(ct - cur.tout + P) % P, cp])
        .filter(([d]) => d > 0 && d < bd)
        .sort((a, b) => a[0] - b[0]);
      for (const [, cp] of passed) poly.push(cp);
      if (!best || best === start) break;
      cur = best;
    }
    polys.push(poly);
  }
  return { polys: polys.concat(islands), pieces: pieces.length };
}

// Clip rectangle: well inside the downloaded bbox so every coastline chain crosses it.
const cornersLL = [
  [18.895, 72.768],
  [18.895, 72.845],
  [18.985, 72.768],
  [18.985, 72.845],
].map(([la, lo]) => toLocal(la, lo));
const xs = cornersLL.map((c) => c[0]).sort((a, b) => a - b);
const zs = cornersLL.map((c) => c[1]).sort((a, b) => a - b);
const margin = 250;
const rect = { u0: xs[1] + margin, u1: xs[2] - margin, v0: -(zs[2] - margin), v1: -(zs[1] + margin) };
const { polys, pieces } = landPolygons(coastWays, rect);
const pointInPoly = (poly, [u, v]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, vi] = poly[i];
    const [uj, vj] = poly[j];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) c = !c;
  }
  return c;
};
// Sanity: Churchgate must be land; the middle of Back Bay must be water.
const churchgate = [0, -60];
const backBay = [-900, 600];
const landHit = polys.some((p) => pointInPoly(p, churchgate));
const waterHit = polys.some((p) => pointInPoly(p, backBay));
console.log(`coast ways ${coastWays.length}, pieces ${pieces}, land polygons ${polys.length}, churchgate-is-land ${landHit}, backbay-is-water ${!waterHit}`);
if (!landHit || waterHit) throw new Error('Land polygon orientation check failed');
out.land = polys.map((p) => p.map(([u, v]) => [r1(u), r1(-v)]).flat());
out.rect = { x0: rect.u0, x1: rect.u1, z0: -rect.v1, z1: -rect.v0 };
// Far buildings outside the land rectangle would stand on nothing: drop them.
{
  const before = out.far.length;
  out.far = out.far.filter((b) => {
    const x = b.fp[0];
    const z = b.fp[1];
    return x > out.rect.x0 && x < out.rect.x1 && z > out.rect.z0 && z < out.rect.z1;
  });
  console.log(`dropped ${before - out.far.length} far buildings outside the land rectangle`);
}

writeFileSync(new URL('../public/data/back-bay.geo.json', import.meta.url), JSON.stringify(out));
console.log(`far buildings ${out.far.length} (${estimated} estimated heights), stadiums ${out.stadiums.length}, roads ${out.roads.length}, land points ${out.land.reduce((a, p) => a + p.length / 2, 0)}`);
