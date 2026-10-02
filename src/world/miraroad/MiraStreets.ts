import * as THREE from 'three';
import { boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { signQuad } from '../../gfx/Signage';
import { flatPolygon } from '../route/Path2';
import { heritageLamp, twinArmLamp, vendorCart, dustbin, type PropGeo } from '../route/Props';
import type { TreeSpot } from '../city/Trees';
import { FRONT, F } from './MiraFront';
import { autoRickshaw, carGeo, mbmtBus, tempo, twoWheelerLow } from './MiraVehicles';
import { FOOTPATH, GROUND, PLAZA, ROAD, V3, beam, lamp, mat4, raise, sign, solid, wall, type MiraCtx } from './MiraCtx';

/**
 * The streets around Mira Road station's east side, from OpenStreetMap (roads, the forecourt,
 * the auto-stand lot, building footprints) and the reference photos (auto_stand,
 * mira_road_railway_station_night_auto_paths, station_main_road, entrance2, outside/0_1, 3, 5
 * and the "transport & connectivity" video stills):
 *
 * - Asphalt carriageways with paver footpaths and yellow-and-black kerbs near the station.
 * - The station approach: a loop with a planted median and tall street lights, the cobbled
 *   forecourt with its steel bollards, the war memorial (soldiers raising the flag between white
 *   blades) and the fountain beside it, ornamental lamp posts, the MBMC no-parking sign.
 * - The auto stand: autos queued nose-first towards the forecourt in railed lanes, and the
 *   two-wheeler pay-and-park under the skywalk; the MBMT bus stop.
 * - Shopfronts along the buildings facing the streets (fictional names), awnings and shutters,
 *   hawkers' carts, utility poles with sagging cables, trees, hoardings (fictional adverts).
 *
 * Positions of the memorial, fountain, auto lanes, bike lot and bus stop are ⚠ estimates from the
 * photos; OSM does not map them.
 */

type Pt = [number, number];

export interface OsmWay {
  id: number;
  tags: Record<string, string>;
  pts: Pt[];
  /** From the extract south-east of the station (the auto ride's streets). */
  ext?: boolean;
}

export interface MiraStreets {
  /** Vehicle routes (local x/z polylines, one-way, with a speed limit m/s). */
  routes: { pts: Pt[]; speed: number; lanes: number[]; mix: 'station' | 'city' }[];
  /** Pedestrian polylines along the footpaths (local, with heights). */
  walks: THREE.Vector3[][];
  /** Gaps in the forecourt's bollards (local). */
  gates: Pt[];
  /** Where people wait or hang about (local x/z, facing h). */
  spots: { kind: 'bus' | 'driver' | 'hawker' | 'shop' | 'forecourt' | 'steps'; x: number; z: number; y: number; h: number }[];
  /** Front of each auto queue (local), for passengers getting in. */
  autoHeads: Pt[];
  /** Static instanced meshes (autos, bikes, cars) added to the group. */
  meshes: THREE.Object3D[];
}

export const inPoly = (pts: Pt[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/** Naya Nagar Road's centre line (OSM way 152327596), z at x. */
const NAYA: Pt[] = [
  [47, -80],
  [72, -81],
  [113, -85],
  [156, -91],
  [250, -121],
];
const nayaZ = (x: number) => {
  for (let i = 1; i < NAYA.length; i++)
    if (x <= NAYA[i][0] || i === NAYA.length - 1) {
      const [ax, az] = NAYA[i - 1];
      const [bx, bz] = NAYA[i];
      return az + ((x - ax) * (bz - az)) / (bx - ax);
    }
  return NAYA[0][1];
};

export const segDist = (x: number, z: number, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
};

/** Flat ribbon along a polyline between offsets o0..o1 (left +), mitred, world-planar UVs. */
export function ribbon(pts: Pt[], o0: number, o1: number, y: number, extend = 0): THREE.BufferGeometry {
  const P = pts.map((p) => [...p] as Pt);
  if (extend > 0 && P.length >= 2) {
    const e = (a: Pt, b: Pt): Pt => {
      const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      return [a[0] + ((a[0] - b[0]) / l) * extend, a[1] + ((a[1] - b[1]) / l) * extend];
    };
    P[0] = e(P[0], P[1]);
    P[P.length - 1] = e(P[P.length - 1], P[P.length - 2]);
  }
  const nrm = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dz / l, -dx / l];
  };
  const L: Pt[] = [];
  const R: Pt[] = [];
  for (let i = 0; i < P.length; i++) {
    const na = i > 0 ? nrm(P[i - 1], P[i]) : nrm(P[i], P[i + 1]);
    const nb = i < P.length - 1 ? nrm(P[i], P[i + 1]) : na;
    let nx = na[0] + nb[0];
    let nz = na[1] + nb[1];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const k = 1 / Math.max(0.4, nx * na[0] + nz * na[1]);
    L.push([P[i][0] + nx * o1 * k, P[i][1] + nz * o1 * k]);
    R.push([P[i][0] + nx * o0 * k, P[i][1] + nz * o0 * k]);
  }
  const pos: number[] = [];
  const tri = (a: Pt, b: Pt, c: Pt) => {
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (const v of cross < 0 ? [a, b, c] : [a, c, b]) pos.push(v[0], y, v[1]);
  };
  for (let i = 1; i < P.length; i++) {
    tri(R[i - 1], L[i - 1], R[i]);
    tri(R[i], L[i - 1], L[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i], -pos[i + 2]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** A vertical quad between two ground points, from y0 to y1 (kerb faces), UVs in metres along. */
export function face(a: Pt, b: Pt, y0: number, y1: number): THREE.BufferGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len, 0, len, 1, 0, 0, len, 1, 0, 1], 2));
  g.computeVertexNormals();
  return g;
}

/** Adds a prop's buckets to the builder at matrix m. */
export function prop(c: MiraCtx, p: PropGeo, m: THREE.Matrix4): void {
  if (p.paint) c.gb.add('prop_paint', p.paint.clone().applyMatrix4(m));
  if (p.metal) c.gb.add('prop_metal', p.metal.clone().applyMatrix4(m));
  if (p.glow) c.gb.add('prop_glow', p.glow.clone().applyMatrix4(m));
}

/** Instanced static vehicles (one mesh per model), coloured per instance. */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: { x: number; y: number; z: number; h: number; c?: THREE.Color }[], shadows = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((v, i) => {
    mesh.setMatrixAt(i, mat4(v.x, v.y, v.z, v.h));
    mesh.setColorAt(i, v.c ?? new THREE.Color(1, 1, 1));
  });
  mesh.count = list.length;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export const BODY = ['#f2f2ef', '#c9ccce', '#8e9296', '#2a2d31', '#7a1d1d', '#1d3f7a', '#b7b09e', '#e8e4da', '#5a5f63'].map((c) => new THREE.Color(c));
export const BIKES = ['#161616', '#1c1c1c', '#7a1414', '#1b3d8a', '#5a5f63', '#dcdcd6', '#3b0f15', '#20262e'].map((c) => new THREE.Color(c));

export function buildStreets(
  c: MiraCtx,
  ways: OsmWay[],
  buildings: Pt[][],
  railLand: (x: number, z: number) => boolean,
  skywalkCols: Pt[],
  trees: (spots: TreeSpot[]) => THREE.Group,
  /** Also dressed beyond the station's surroundings: the auto ride's streets (footpaths, lamps, lane markings). */
  dressed: (x: number, z: number) => boolean = () => false,
): MiraStreets {
  const gb = c.gb;
  const rng = c.rng;
  const out: MiraStreets = { routes: [], walks: [], gates: [], spots: [], autoHeads: [], meshes: [] };
  const CENTER: Pt = [50, -50];
  const near = (x: number, z: number, r: number) => Math.hypot(x - CENTER[0], z - CENTER[1]) < r;

  // ---- The forecourt, and the paved apron north of it (under the skywalk) ---------------------
  const FC: Pt[] = [F(FRONT.u1 + 0.95, FRONT.stepsV), [46.8, -71.8], [66.2, -71.2], [65.6, -49.6], [65.2, -34.8], [64.9, -25.2], F(FRONT.u0 - 0.95, FRONT.stepsV)];
  const APRON: Pt[] = [F(FRONT.u1 + 0.95, FRONT.stepsV), F(FRONT.hallU1, 0.35), [47.5, -80.6], [66.4, -79.5], [66.2, -71.2], [46.8, -71.8]];
  gb.add('cobble', flatPolygon(FC, PLAZA));
  gb.add('pavers', tint(flatPolygon(APRON, PLAZA + 0.004), 0.95, 0.95, 0.95));
  raise(c, FC, PLAZA);
  raise(c, APRON, PLAZA);
  // Granite edging round the forecourt.
  for (let i = 1; i < FC.length - 1; i++) {
    const a = FC[i];
    const b = FC[i + 1];
    if (i === 1) continue;
    gb.add('granite', face(b, a, ROAD, PLAZA + 0.02));
    gb.add('granite', tint(beamXZ(a, b, 0.3, PLAZA + 0.012), 0.8, 0.8, 0.78));
  }

  // ---- Roads -------------------------------------------------------------------------------------
  const APPROACH = new Set([44427767, 1238879349]);
  const roads: { id: number; w: number; cls: string; pts: Pt[] }[] = [];
  for (const e of ways) {
    const hw = e.tags.highway;
    if (!hw || e.tags.bridge || ['footway', 'steps', 'path', 'pedestrian', 'track', 'cycleway', 'corridor'].includes(hw)) continue;
    if (!e.pts.some(([x, z]) => near(x, z, 520) || dressed(x, z))) continue;
    const w = APPROACH.has(e.id) ? 8 : hw === 'secondary' ? 9.5 : hw === 'tertiary' ? 8 : hw === 'residential' ? 6.5 : hw === 'living_street' ? 5 : 5.5;
    // Split into runs off the railway land.
    let run: Pt[] = [];
    const flush = () => {
      if (run.length >= 2) roads.push({ id: e.id, w, cls: APPROACH.has(e.id) ? 'approach' : hw, pts: run });
      run = [];
    };
    for (let i = 0; i < e.pts.length; i++) {
      const p = e.pts[i];
      if (i > 0) {
        const q = e.pts[i - 1];
        if (railLand((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) {
          flush();
          continue;
        }
        if (!run.length) run.push(q);
        run.push(p);
      }
    }
    flush();
  }
  for (const r of roads) gb.add('asphalt', tint(ribbon(r.pts, -r.w / 2, r.w / 2, ROAD, r.w * 0.45), 1, 1, 1));
  // Segment index for "is this point on some road?".
  const segs: { a: Pt; b: Pt; hw: number; ri: number }[] = [];
  roads.forEach((r, ri) => {
    for (let i = 1; i < r.pts.length; i++) segs.push({ a: r.pts[i - 1], b: r.pts[i], hw: r.w / 2, ri });
  });
  const onRoad = (x: number, z: number, pad: number, skip = -1) => segs.some((s) => s.ri !== skip && segDist(x, z, s.a, s.b) < s.hw + pad);

  // The approach loop's median (between its two carriageways), and the lot north of it.
  const zN = (x: number) => -42 + ((x - 72) * 4) / 110 + 4;
  const zS = (x: number) => -27 + ((x - 71) * 2) / 101 - 4;
  // Its kerbs stand on the carriageways' edges (4 m off OSM 44427767's eastbound run and 1238879349),
  // and its nose, chamfered, on the U-turn's (4 m east of the run up past the forecourt).
  const medN = (x: number) => -42.4 + ((x - 72) * 4.4) / 109.9 + 4.03;
  const medS = (x: number) => -27.3 + ((x - 71.4) * 2) / 100.3 - 4.03;
  const NOSE = 75.9;
  const MED: Pt[] = [
    [NOSE, medS(NOSE) - 0.6],
    [NOSE, medN(NOSE) + 0.6],
    [NOSE + 0.6, medN(NOSE + 0.6)],
  ];
  for (let x = 80; x <= 166; x += 4) MED.push([x, medN(x)]);
  for (let x = 166; x >= 80; x -= 4) MED.push([x, medS(x)]);
  MED.push([NOSE + 0.6, medS(NOSE + 0.6)]);
  const LOT: Pt[] = [
    [190.3, -54.1],
    [182.1, -91.2],
    [147.1, -77.7],
    [66.2, -71.2],
    [66.4, -49.6],
    [72.2, -49.4],
    [121.2, -49.8],
    [181.8, -50.3],
  ];
  gb.add('asphalt', tint(flatPolygon(LOT, ROAD + 0.003), 0.9, 0.9, 0.88));
  const medTop = FOOTPATH + 0.02;
  gb.add('pavers', tint(flatPolygon(MED, medTop), 0.85, 0.9, 0.85));
  for (let i = 0; i < MED.length; i++) gb.add('kerb', face(MED[(i + 1) % MED.length], MED[i], ROAD, medTop));
  raise(c, MED, medTop);

  // Footpaths with kerbs along the bigger streets near the station.
  const blocked = (x: number, z: number) => railLand(x, z) || inPoly(FC, x, z) || inPoly(APRON, x, z) || inPoly(LOT, x, z) || inPoly(MED, x, z);
  const lampSpots: { x: number; z: number; h: number }[] = [];
  const walkRuns: THREE.Vector3[][] = [];
  roads.forEach((r, ri) => {
    const fw = r.cls === 'approach' ? 2.8 : r.cls === 'secondary' ? 2.6 : r.cls === 'tertiary' ? 2.2 : r.cls === 'residential' ? 1.7 : 1.5;
    const maxR = r.cls === 'service' || r.cls === 'living_street' ? 170 : 330;
    for (const side of [-1, 1]) {
      // The approach is a one-way loop round its median: its inside (−1) is the median, or the turn.
      if (r.cls === 'approach' && side < 0) continue;
      let cur: Pt[] = [];
      let acc = 0;
      const flushWalk = () => {
        if (cur.length >= 4) walkRuns.push(cur.map(([x, z]) => V3(x, FOOTPATH, z)));
        cur = [];
      };
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1];
        const b = r.pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dx = (b[0] - a[0]) / len;
        const dz = (b[1] - a[1]) / len;
        const nx = dz * side;
        const nz = -dx * side;
        const steps = Math.max(1, Math.round(len / 2));
        for (let k = 0; k < steps; k++) {
          const t0 = (k / steps) * len;
          const t1 = ((k + 1) / steps) * len;
          const mx = a[0] + dx * (t0 + t1) * 0.5 + nx * (r.w / 2 + fw / 2);
          const mz = a[1] + dz * (t0 + t1) * 0.5 + nz * (r.w / 2 + fw / 2);
          const along = near(mx, mz, maxR) || (r.cls !== 'service' && r.cls !== 'living_street' && dressed(mx, mz));
          if (!along || blocked(mx, mz) || onRoad(mx, mz, 0.4, ri) || blocked(mx - nx * fw * 0.5, mz - nz * fw * 0.5)) {
            flushWalk();
            continue;
          }
          const p0: Pt = [a[0] + dx * t0 + nx * (r.w / 2), a[1] + dz * t0 + nz * (r.w / 2)];
          const p1: Pt = [a[0] + dx * t1 + nx * (r.w / 2), a[1] + dz * t1 + nz * (r.w / 2)];
          const q0: Pt = [p0[0] + nx * fw, p0[1] + nz * fw];
          const q1: Pt = [p1[0] + nx * fw, p1[1] + nz * fw];
          gb.add('pavers', tint(flatPolygon([p0, p1, q1, q0], FOOTPATH), 0.95, 0.95, 0.95));
          const painted = near(mx, mz, 190);
          gb.add(painted ? 'kerb' : 'concrete', side > 0 ? face(p0, p1, ROAD - 0.02, FOOTPATH) : face(p1, p0, ROAD - 0.02, FOOTPATH));
          raise(c, [p0, p1, q1, q0], FOOTPATH);
          cur.push([(p0[0] + q0[0]) / 2, (p0[1] + q0[1]) / 2]);
          acc += t1 - t0;
          if (acc > 27 && r.cls !== 'approach' && r.cls !== 'service' && r.cls !== 'living_street') {
            acc = 0;
            // The arm (prop +x) reaches out over the road (−n).
            lampSpots.push({ x: p0[0] + nx * 0.5, z: p0[1] + nz * 0.5, h: Math.atan2(nz, -nx) });
          }
        }
      }
      flushWalk();
    }
  });
  out.walks.push(...walkRuns.filter((w) => w.length > 6));

  // Road markings: lane dashes on the approach and the main roads, a zebra at the forecourt.
  const paint = (g: THREE.BufferGeometry) => gb.add('prop_paint', tint(g, 0.86, 0.86, 0.82));
  for (const r of roads) {
    if (!(r.cls === 'approach' || r.cls === 'secondary' || r.cls === 'tertiary')) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1];
      const b = r.pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 2; t + 3 < len; t += 8) {
        const x = a[0] + ((b[0] - a[0]) * (t + 1.5)) / len;
        const z = a[1] + ((b[1] - a[1]) * (t + 1.5)) / len;
        if (!(near(x, z, 420) || dressed(x, z)) || onRoad(x, z, -0.5, roads.indexOf(r))) continue;
        paint(boxGeo(0.13, 0.01, 3).rotateY(Math.atan2(b[0] - a[0], b[1] - a[1])).translate(x, ROAD + 0.012, z));
      }
    }
  }
  // Zebra across the U-turn from the forecourt's south gate: bars along the traffic, across the road.
  for (let k = 0; k < 8; k++) paint(boxGeo(0.5, 0.01, 3.0).translate(67.9 + k * 1.0, ROAD + 0.012, -31));

  // ---- The forecourt's furniture --------------------------------------------------------------
  // Steel bollards along the street edge (gaps to walk through), a ledge with parked bikes south.
  const bollard = (x: number, z: number) => {
    gb.add('stainless', new THREE.CylinderGeometry(0.1, 0.11, 0.86, 12).translate(x, PLAZA + 0.43, z));
    gb.add('stainless', new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, PLAZA + 0.86, z));
    gb.add('blackPaint', new THREE.CylinderGeometry(0.105, 0.105, 0.04, 12).translate(x, PLAZA + 0.7, z));
    solid(c, x, z, 0.12, 0.12, 0, -1, 1.2);
  };
  const edge: Pt[] = [
    [66.0, -70.6],
    [65.6, -49.6],
    [65.2, -34.8],
    [64.9, -25.8],
  ];
  const gateZ = [-63, -45.5, -31];
  for (let i = 1; i < edge.length; i++) {
    const [ax, az] = edge[i - 1];
    const [bx, bz] = edge[i];
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 0.6; t < len; t += 1.55) {
      const x = ax + ((bx - ax) * t) / len - 0.35;
      const z = az + ((bz - az) * t) / len;
      if (gateZ.some((g) => Math.abs(z - g) < 2.1)) continue;
      bollard(x, z);
    }
  }
  for (const g of gateZ) out.gates.push([65.2, g]);
  // South edge: the low ledge people sit on, bikes nosed in against it (entrance2).
  const ledgeA: Pt = [38, -24.6];
  const ledgeB: Pt = [64.6, -24.9];
  gb.add('concrete', tint(beamXZ(ledgeA, ledgeB, 0.45, PLAZA + 0.28, 0.56), 0.8, 0.79, 0.76));
  wall(c, ledgeA[0], ledgeA[1], ledgeB[0], ledgeB[1], 0.5, -1, 0.3);
  const ledgeBikes: { x: number; y: number; z: number; h: number; c?: THREE.Color }[] = [];
  for (let x = 40; x < 63; x += rng.range(0.85, 1.6)) {
    if (rng.chance(0.25)) continue;
    ledgeBikes.push({ x, y: ROAD, z: -23.4 + rng.range(-0.1, 0.2), h: rng.range(-0.25, 0.25), c: rng.pick(BIKES) });
    out.spots.push({ kind: 'steps', x: x + 0.3, z: -24.6, y: PLAZA + 0.1, h: 0 });
  }
  // Ornamental lamp posts (black, lantern tops) at the forecourt's corners and edge.
  const hl = heritageLamp();
  for (const [x, z] of [
    [63.4, -69],
    [63.2, -49.6],
    [62.9, -28],
    [38.5, -69.5],
    [38.4, -27.6],
  ] as Pt[]) {
    prop(c, hl, mat4(x, PLAZA, z));
    solid(c, x, z, 0.22, 0.22, 0);
    lamp(c, x, z, 17, 1.1);
  }
  // Tall twin lights at the forecourt's street edge (the night photo from the skywalk), and the
  // glow the lit hall throws out through the arches.
  const tall = twinArmLamp(true, 11);
  for (const z of [-60.5, -37.5]) {
    prop(c, tall, mat4(66.6, ROAD, z, 0));
    solid(c, 66.6, z, 0.25, 0.25, 0);
    lamp(c, 64.3, z, 20, 1.0);
    lamp(c, 68.9, z, 16, 0.8);
  }
  for (let u = FRONT.u0 + 3; u < FRONT.u1; u += 6.7) {
    const [x, z] = F(u, 3.5);
    lamp(c, x, z, 8, 0.45);
  }
  // The municipality's no-parking sign by the street edge.
  gb.add('prop_metal', tint(rodGeo(V3(64.4, PLAZA, -41), V3(64.4, PLAZA + 3.6, -41), 0.05, 8), 0.2, 0.2, 0.2));
  sign(c, c.signs.noParking, 1.0, 1.25, mat4(64.4, PLAZA + 3.05, -41, Math.PI / 2 + 0.25), { plate: [0.8, 0.8, 0.78], depth: 0.03 });
  solid(c, 64.4, -41, 0.12, 0.12, 0);
  // Dustbins.
  const bin = dustbin();
  for (const [x, z] of [
    [40, -60],
    [40, -38],
    [61.5, -53],
  ] as Pt[]) prop(c, bin, mat4(x, PLAZA, z, 1.2));
  // A goods tempo parked on the forecourt (as in the main-entrance photo).
  const tempoMesh = instanced(tempo(), c.M.prop_paint, [{ x: 45.5, y: PLAZA, z: -31.5, h: Math.PI - 0.25 }]);
  out.meshes.push(tempoMesh);
  solid(c, 45.5, -31.5, 1.0, 2.5, Math.PI - 0.25, -1, 2.5);

  // ---- The war memorial and the fountain (outside/0_1) ------------------------------------------
  buildMemorial(c, 47.5, -57.5);
  buildFountain(c, 57.8, -64.8);
  for (const [x, z] of [
    [53, -40],
    [44, -44],
    [55, -30],
    [50, -68],
  ] as Pt[])
    out.spots.push({ kind: 'forecourt', x, z, y: PLAZA, h: rng.range(0, 6.28) });

  // ---- The auto stand: railed queue lanes, autos nosed towards the forecourt --------------------
  const autoList: { x: number; y: number; z: number; h: number; c?: THREE.Color }[] = [];
  const laneZ = [-52.6, -55.4, -58.2, -61.0, -63.8];
  laneZ.forEach((z, li) => {
    const x0 = 73.5 + li * 0.7;
    const x1 = 148 - li * 5;
    out.autoHeads.push([x0 - 1.6, z]);
    for (let x = x0; x < x1; x += rng.range(2.75, 3.4)) {
      if (rng.chance(0.08)) continue;
      autoList.push({ x, y: ROAD, z: z + rng.range(-0.12, 0.12), h: -Math.PI / 2 + rng.range(-0.05, 0.05), c: new THREE.Color().setScalar(rng.range(0.85, 1.05)) });
    }
    solid(c, (x0 + x1) / 2, z, (x1 - x0) / 2 + 1.2, 0.72, 0, -1, 2);
    for (let k = 0; k < 3; k++) out.spots.push({ kind: 'driver', x: x0 + 2 + rng.range(0, 30), z: z + 1.2, y: ROAD, h: rng.pick([0, Math.PI]) + rng.range(-0.5, 0.5) });
  });
  const autos = instanced(autoRickshaw(), c.M.prop_paint, autoList);
  out.meshes.push(autos);
  // Pipe railings between the lanes.
  const rail = (a: THREE.Vector3, b: THREE.Vector3) => {
    const len = a.distanceTo(b);
    gb.add('prop_metal', tint(rodGeo(a.clone().setY(ROAD + 1.0), b.clone().setY(ROAD + 1.0), 0.03, 6), 0.55, 0.57, 0.56));
    gb.add('prop_metal', tint(rodGeo(a.clone().setY(ROAD + 0.5), b.clone().setY(ROAD + 0.5), 0.025, 6), 0.55, 0.57, 0.56));
    for (let t = 0; t <= len; t += 2.4) {
      const p = a.clone().lerp(b, t / len);
      gb.add('prop_metal', tint(rodGeo(p.clone().setY(ROAD), p.clone().setY(ROAD + 1.03), 0.03, 6), 0.5, 0.52, 0.51));
    }
  };
  for (let i = 0; i <= laneZ.length; i++) {
    const z = (laneZ[Math.max(0, i - 1)] + laneZ[Math.min(laneZ.length - 1, i)]) / 2 + (i === 0 ? 1.4 : i === laneZ.length ? -1.4 : 0);
    rail(V3(76 + i * 0.5, 0, z), V3(150 - i * 5, 0, z));
  }
  // The stand's board, and a tin shelter for the drivers.
  gb.add('prop_metal', tint(rodGeo(V3(70, ROAD, -49.2), V3(70, ROAD + 3.2, -49.2), 0.05, 8), 0.3, 0.3, 0.3));
  sign(c, c.signs.autoStand, 1.8, 0.6, mat4(70, ROAD + 2.9, -49.2, Math.PI / 2 - 0.3), { back: true });
  shed(c, 79, -67.5, 9, 3.4, 0);
  out.spots.push({ kind: 'driver', x: 77, z: -67.2, y: ROAD, h: Math.PI / 2 }, { kind: 'driver', x: 81, z: -67.6, y: ROAD, h: -Math.PI / 2 });

  // ---- Two-wheeler pay-and-park under the skywalk (outside/5) ------------------------------------
  const lotNorth = (x: number) => (x < 147.1 ? -71.2 + ((x - 66.2) * (-77.7 + 71.2)) / (147.1 - 66.2) : -77.7 + ((x - 147.1) * (-91.2 + 77.7)) / (182.1 - 147.1));
  const bikes: { x: number; y: number; z: number; h: number; c?: THREE.Color }[] = [];
  const scooters: { x: number; y: number; z: number; h: number; c?: THREE.Color }[] = [];
  for (let row = 0; row < 10; row++) {
    const z = -68.3 - row * 2.3;
    for (let x = 92; x < 178; x += rng.range(0.72, 0.95)) {
      if (z < lotNorth(x) + 1.3 || rng.chance(0.18)) continue;
      if (skywalkCols.some(([cx, cz]) => Math.abs(cx - x) < 1.1 && Math.abs(cz - z) < 1.3)) continue;
      const v = { x, y: ROAD, z: z + rng.range(-0.15, 0.15), h: (row & 1 ? 0 : Math.PI) + rng.range(-0.2, 0.2), c: rng.pick(BIKES) };
      (rng.chance(0.45) ? scooters : bikes).push(v);
    }
    solid(c, 135, z, 43, 1.0, 0, -1, 1.3);
  }
  out.meshes.push(instanced(twoWheelerLow(false), c.M.prop_paint, [...bikes, ...ledgeBikes.filter((_, i) => i % 2 === 0)], false));
  out.meshes.push(instanced(twoWheelerLow(true), c.M.prop_paint, [...scooters, ...ledgeBikes.filter((_, i) => i % 2 === 1)], false));
  // Its fence, board and the attendant's booth.
  rail(V3(90, 0, -66.6), V3(148, 0, -66.6));
  rail(V3(154, 0, -66.6), V3(180, 0, -66.6));
  sign(c, c.signs.payPark, 2.2, 1.4, mat4(151, ROAD + 2.4, -66.3, 0), { back: false });
  for (const x of [150, 152]) gb.add('prop_metal', tint(rodGeo(V3(x, ROAD, -66.4), V3(x, ROAD + 3.1, -66.4), 0.04, 6), 0.3, 0.3, 0.3));
  gb.add('prop_paint', tint(boxGeo(1.6, 2.2, 1.6).translate(155, ROAD + 1.1, -68.2), 0.3, 0.45, 0.62));
  gb.add('prop_paint', tint(boxGeo(1.9, 0.1, 1.9).translate(155, ROAD + 2.25, -68.2), 0.2, 0.2, 0.2));
  solid(c, 155, -68.2, 0.85, 0.85, 0);
  // Railing between the lot and the approach road's footpath (openings at the queue and the lot).
  rail(V3(72, 0, -48.2), V3(96, 0, -48.4));
  rail(V3(100, 0, -48.4), V3(149, 0, -48.8));
  rail(V3(155, 0, -48.9), V3(184, 0, -49.2));
  wall(c, 72, -48.2, 96, -48.4, 0.2, -1, 1.1);
  wall(c, 100, -48.4, 149, -48.8, 0.2, -1, 1.1);
  wall(c, 155, -48.9, 184, -49.2, 0.2, -1, 1.1);

  // ---- The bus stop and an MBMT bus at it ------------------------------------------------------
  busShelter(c, 104, -47.5);
  out.spots.push(...[0, 1, 2, 3, 4, 5].map((k) => ({ kind: 'bus' as const, x: 101.5 + k * 1.1 + rng.range(-0.2, 0.2), z: -46.8 + rng.range(-0.3, 0.2), y: FOOTPATH, h: rng.range(-0.5, 0.5) })));
  const bus = instanced(mbmtBus(), c.M.prop_paint, [{ x: 108, y: ROAD, z: -42.4, h: Math.PI / 2 - 0.035 }]);
  out.meshes.push(bus);
  solid(c, 108, -42.4, 1.35, 6, Math.PI / 2 - 0.035, -1, 3.2);

  // ---- Parked cars in front of the shops ----------------------------------------------------------
  const cars: Record<string, { x: number; y: number; z: number; h: number; c?: THREE.Color }[]> = { car: [], suv: [], cab: [], taxi: [] };
  for (let x = 82; x < 164; x += rng.range(6, 12)) {
    const kind = rng.pick(['car', 'car', 'suv', 'cab', 'taxi']);
    const z = -24.0 + ((x - 71) * 2) / 101;
    const car = { x, y: ROAD, z, h: -Math.PI / 2 + rng.range(-0.05, 0.05), c: kind === 'taxi' ? new THREE.Color(0.08, 0.08, 0.08) : rng.pick(BODY) };
    // In front of the shopping centre the kerb is the autos' (MiraStationShops); cars park by the junction.
    if (x < 149) continue;
    cars[kind].push(car);
    solid(c, x, z, 2.2, 0.95, 0, -1, 1.6);
  }
  for (const k of Object.keys(cars)) if (cars[k].length) out.meshes.push(instanced(carGeo(k as 'car', k === 'taxi' ? [0.95, 0.75, 0.1] : [0.9, 0.9, 0.9]), c.M.prop_paint, cars[k]));

  // ---- Shopfronts on the buildings facing the streets ------------------------------------------
  let shopK = 0;
  for (const poly of buildings) {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i];
      const [x1, z1] = poly[(i + 1) % poly.length];
      area += x0 * z1 - x1 * z0;
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 4.5) continue;
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      if (!near(mx, mz, 250)) continue;
      // Outward normal (area > 0: counter-clockwise in x/z).
      let nx = (b[1] - a[1]) / len;
      let nz = -(b[0] - a[0]) / len;
      if (area < 0) {
        nx = -nx;
        nz = -nz;
      }
      if (!onRoad(mx + nx * 6, mz + nz * 6, 3.5) && !inPoly(FC, mx + nx * 5, mz + nz * 5)) continue;
      const units = Math.max(1, Math.round(len / 4.6));
      const uw = len / units;
      const h = Math.atan2(nx, nz);
      for (let k = 0; k < units; k++) {
        const t = (k + 0.5) / units;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        shopfront(c, x, z, h, uw - 0.25, shopK++);
        if (rng.chance(0.35)) out.spots.push({ kind: 'shop', x: x + nx * 1.4, z: z + nz * 1.4, y: FOOTPATH, h: h + Math.PI + rng.range(-0.6, 0.6) });
      }
    }
  }

  // ---- Street lights ----------------------------------------------------------------------------
  const twin = twinArmLamp(true, 10);
  for (let x = 88; x < 164; x += 19) {
    const z = (zN(x) + zS(x)) / 2;
    // Arms north and south, over the two carriageways.
    prop(c, twin, mat4(x, medTop, z, Math.PI / 2));
    solid(c, x, z, 0.2, 0.2, 0);
    lamp(c, x, z - 3, 17, 0.85);
    lamp(c, x, z + 3, 17, 0.85);
  }
  const single = streetLight();
  for (const s of lampSpots) {
    prop(c, single, mat4(s.x, FOOTPATH, s.z, s.h));
    solid(c, s.x, s.z, 0.18, 0.18, 0);
    lamp(c, s.x + Math.cos(s.h) * 2.2, s.z - Math.sin(s.h) * 2.2, 15, 0.75);
  }
  // High mast at the approach road's junction end.
  highMast(c, 171, (zN(171) + zS(171)) / 2);

  // ---- Utility poles and the cables between them and the buildings -------------------------------
  const poles: THREE.Vector3[] = [];
  for (let x = 52; x < 196; x += 24) poles.push(V3(x, FOOTPATH, zS(x) + 8.6));
  for (let x = 58; x < 240; x += 26) poles.push(V3(x, GROUND, nayaZ(x) - 4.2));
  const cable = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      pts.push(a.clone().lerp(b, t).add(V3(0, -sag * 4 * t * (1 - t), 0)));
    }
    for (let k = 1; k < pts.length; k++) gb.add('cable', rodGeo(pts[k - 1], pts[k], 0.012, 3));
  };
  poles.forEach((p, i) => {
    gb.add('concrete', tint(new THREE.CylinderGeometry(0.1, 0.16, 8.5, 8).translate(p.x, p.y + 4.25, p.z), 0.75, 0.74, 0.7));
    gb.add('prop_metal', tint(boxGeo(1.4, 0.08, 0.08).translate(p.x, p.y + 8.0, p.z), 0.3, 0.3, 0.3));
    solid(c, p.x, p.z, 0.2, 0.2, 0);
    const q = poles[i + 1];
    if (q && q.distanceTo(p) < 34)
      for (const [dx, dy, sag] of [
        [-0.6, 7.95, 0.55],
        [0.6, 7.95, 0.6],
        [-0.2, 7.3, 0.8],
        [0.3, 6.8, 1.0],
      ])
        cable(V3(p.x + dx, p.y + dy, p.z), V3(q.x + dx, q.y + dy, q.z), sag);
  });
  // Across the approach road, and one with a lost kite's string (the forecourt photo's cable).
  cable(V3(poles[1].x, FOOTPATH + 7.8, poles[1].z), V3(100, ROAD + 6.8, -48.6), 0.9);
  cable(V3(poles[3].x, FOOTPATH + 7.6, poles[3].z), V3(146, ROAD + 6.6, -48.8), 1.0);
  cable(V3(poles[0].x, FOOTPATH + 7.4, poles[0].z), V3(66, PLAZA + 8.5, -44), 1.4);

  // ---- Hawkers ------------------------------------------------------------------------------
  const cart = vendorCart();
  for (const [x, z, h] of [
    [69.2, -45.9, 0.3],
    [88, -45.7, 0],
    [67.6, -23.2, Math.PI],
    [140, -20.8, Math.PI],
  ] as [number, number, number][]) {
    prop(c, cart, mat4(x, FOOTPATH, z, h));
    solid(c, x, z, 0.8, 0.5, -h);
    out.spots.push({ kind: 'hawker', x: x + Math.sin(h) * 0.9, z: z + Math.cos(h) * 0.9, y: FOOTPATH, h: h + Math.PI });
  }

  // ---- Hoardings: two on the walkway roof over the hall, one on the junction corner ---------------
  hoarding(c, F(-17.5, -4.8), 11.9, 10, 4.4, FRONT.angle, c.signs.hoardings[0], 11.0);
  hoarding(c, F(-5.2, -4.8), 11.9, 10, 4.4, FRONT.angle, c.signs.hoardings[1], 11.0);
  hoarding(c, [206, -12], 13, 12, 5.2, -Math.PI / 2 + 0.2, c.signs.hoardings[4], GROUND, true);
  hoarding(c, [122, -100], 12, 10, 4.5, 0.25, c.signs.hoardings[2], GROUND, true);

  // ---- Trees ---------------------------------------------------------------------------------
  const spots: TreeSpot[] = [];
  for (const x of [96, 116, 136, 158]) spots.push({ x, z: (zN(x) + zS(x)) / 2 + 0.3, s: rng.range(0.55, 0.75), kind: 'almond', y: medTop });
  for (let x = 62; x < 240; x += rng.range(18, 30)) spots.push({ x, z: nayaZ(x) - 6.5, s: rng.range(0.7, 1.0), y: GROUND });
  for (let z = 8; z < 110; z += rng.range(20, 30)) spots.push({ x: 40.5, z, s: rng.range(0.7, 1.0), y: GROUND });
  spots.push({ x: 188, z: -62, s: 0.9, y: GROUND }, { x: 70, z: -76.5, s: 0.8, y: GROUND }, { x: 29, z: -94, s: 0.9, y: GROUND });
  const treeGroup = trees(spots.filter((s) => !railLand(s.x, s.z)));
  out.meshes.push(treeGroup);
  for (const s of spots) solid(c, s.x, s.z, 0.35, 0.35, 0, -1, 3);

  // ---- Vehicle routes (one-way polylines through the junction; OSM) ------------------------------
  const W = (id: number) => ways.find((w) => w.id === id)?.pts ?? [];
  const rev = (p: Pt[]) => [...p].reverse();
  const cat = (...parts: Pt[][]) => {
    const o: Pt[] = [];
    for (const p of parts) for (const q of p) if (!o.length || Math.hypot(o[o.length - 1][0] - q[0], o[o.length - 1][1] - q[1]) > 0.5) o.push(q);
    return o;
  };
  // Into the station: west on Mira Road, round the junction, along the approach, the U-turn at
  // the forecourt, back out and away east.
  const approachIn = cat(W(788778489), W(1238879350), W(789760117), W(1238879349));
  const approachOut = cat(W(44427767).slice(0, 4), W(1238879348), W(788778487));
  if (approachIn.length && approachOut.length) out.routes.push({ pts: cat(approachIn, approachOut), speed: 6.5, lanes: [-1.6, -0.2], mix: 'station' });
  // Down Shrikant Dhadwe Road, through the junction and south on Poonam Sagar Road; and back north.
  const south = cat(W(44427829), W(1238879350), W(152327598));
  if (south.length > 4) out.routes.push({ pts: south, speed: 8.5, lanes: [-2.2, 0, 2.2], mix: 'city' });
  const north = cat(W(788778486), W(1238879347), W(1238879348).slice(0, 4), W(1154837058).slice(1), W(788763913));
  if (north.length > 4) out.routes.push({ pts: north, speed: 8.5, lanes: [-2.2, 0, 2.2], mix: 'city' });
  // Naya Nagar Road, both ways (it ends at the station: vehicles turn there).
  const naya = cat(W(44427975), W(152327596));
  if (naya.length > 4) out.routes.push({ pts: cat(naya, rev(naya)), speed: 7, lanes: [1.6], mix: 'station' });
  return out;
}

/** A thin horizontal strip between two ground points (edging, ledges). */
export function beamXZ(a: Pt, b: Pt, w: number, y: number, h = 0.03): THREE.BufferGeometry {
  return beam(V3(a[0], y, a[1]), V3(b[0], y, b[1]), w, h);
}

/** Roadside light: galvanised pole, curved arm over the road (prop +x) ⚠. */
export function streetLight(): PropGeo {
  return twinArmLamp(false, 9);
}

function highMast(c: MiraCtx, x: number, z: number): void {
  const gb = c.gb;
  gb.add('prop_metal', tint(new THREE.CylinderGeometry(0.18, 0.42, 22, 10).translate(x, FOOTPATH + 11, z), 0.55, 0.57, 0.56));
  gb.add('prop_metal', tint(new THREE.TorusGeometry(1.3, 0.08, 6, 16).rotateX(Math.PI / 2).translate(x, FOOTPATH + 22, z), 0.4, 0.4, 0.4));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const hx = x + Math.cos(a) * 1.3;
    const hz = z + Math.sin(a) * 1.3;
    const m = mat4(hx, FOOTPATH + 21.7, hz, -a + Math.PI / 2, 0.5);
    gb.add('prop_paint', tint(boxGeo(0.6, 0.35, 0.45), 0.3, 0.3, 0.3).applyMatrix4(m));
    gb.add('prop_glow', tint(boxGeo(0.5, 0.02, 0.38).translate(0, -0.18, 0), 1, 0.9, 0.75).applyMatrix4(m));
  }
  solid(c, x, z, 0.5, 0.5, 0);
  lamp(c, x, z, 55, 1.0);
}

function shed(c: MiraCtx, x: number, z: number, w: number, d: number, ry: number): void {
  const gb = c.gb;
  const m = mat4(x, ROAD, z, ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.add('prop_metal', tint(rodGeo(V3((sx * w) / 2, 0, (sz * d) / 2), V3((sx * w) / 2, sz > 0 ? 2.6 : 2.9, (sz * d) / 2), 0.05, 6), 0.35, 0.36, 0.35).applyMatrix4(m));
  const roof = boxGeo(w + 0.6, 0.04, d + 0.6).rotateX(-0.09).translate(0, 2.8, 0);
  gb.add('tin', tint(roof, 0.75, 0.78, 0.82).applyMatrix4(m));
  gb.add('tarp', tint(boxGeo(w * 0.6, 1.1, 0.02).translate(-w * 0.15, 2.2, -d / 2), 0.1, 0.3, 0.75).applyMatrix4(m));
  gb.add('prop_paint', tint(boxGeo(w * 0.7, 0.08, 0.4).translate(0, 0.45, -d / 2 + 0.3), 0.3, 0.3, 0.3).applyMatrix4(m));
}

export function busShelter(c: MiraCtx, x: number, z: number, ry = 0): void {
  const gb = c.gb;
  const m = mat4(x, FOOTPATH, z, ry);
  // Curved steel ribs, a polycarbonate roof, a bench, the red board.
  for (let k = 0; k < 4; k++) {
    const u = -3 + k * 2;
    const pts: THREE.Vector3[] = [];
    for (let t = 0; t <= 6; t++) {
      const a = (t / 6) * Math.PI * 0.55;
      pts.push(V3(u, 2.6 * Math.sin(a) + 0.02, -0.9 + 1.9 * (1 - Math.cos(a))));
    }
    for (let t = 1; t < pts.length; t++) gb.add('prop_metal', tint(rodGeo(pts[t - 1], pts[t], 0.05, 6), 0.6, 0.62, 0.62).applyMatrix4(m));
  }
  gb.add('prop_paint', tint(boxGeo(6.6, 0.04, 2.0).rotateX(0.35).translate(0, 2.65, 0.4), 0.55, 0.62, 0.66).applyMatrix4(m));
  gb.add('prop_metal', tint(boxGeo(5.5, 0.05, 0.45).translate(0, 0.45, -0.6), 0.65, 0.67, 0.68).applyMatrix4(m));
  gb.add('prop_paint', tint(boxGeo(6.2, 1.0, 0.03).translate(0, 1.2, -0.95), 0.75, 0.78, 0.8).applyMatrix4(m));
  sign(c, c.signs.busStop, 2.2, 0.72, mat4(0, 2.35, 1.35, Math.PI).premultiply(m), { back: true });
  const bx = x - Math.sin(ry) * 0.95;
  const bz = z - Math.cos(ry) * 0.95;
  solid(c, bx, bz, 3.2, 0.2, -ry, -1, 2.5);
}

/** A lit hoarding on its frame: on short legs down to `base` (a roof), or on one tall pole. */
export function hoarding(c: MiraCtx, at: Pt, y: number, w: number, h: number, ry: number, rect: import('../../gfx/Signage').AtlasRect, base: number, pole = false): void {
  const gb = c.gb;
  const m = mat4(at[0], y, at[1], ry);
  gb.add('signsLit', signQuad(rect, w, h).translate(0, h / 2, 0.08).applyMatrix4(m));
  gb.add('prop_paint', tint(boxGeo(w + 0.3, h + 0.3, 0.12).translate(0, h / 2, 0), 0.2, 0.2, 0.2).applyMatrix4(m));
  const drop = y - base;
  if (pole) {
    gb.add('prop_metal', tint(new THREE.CylinderGeometry(0.32, 0.42, drop + h * 0.5, 12).translate(0, (h * 0.5 - drop) / 2, -0.7), 0.4, 0.41, 0.4).applyMatrix4(m));
    gb.add('prop_metal', tint(boxGeo(w * 0.9, 0.3, 0.3).translate(0, h * 0.25, -0.35), 0.35, 0.36, 0.35).applyMatrix4(m));
    gb.add('prop_metal', tint(boxGeo(w, 0.06, 0.9).translate(0, -0.1, 0.45), 0.35, 0.36, 0.35).applyMatrix4(m));
    const [px, pz] = [at[0] - Math.sin(ry) * 0.7, at[1] - Math.cos(ry) * 0.7];
    solid(c, px, pz, 0.45, 0.45, 0);
  } else
    for (const s of [-0.35, 0.35]) {
      gb.add('prop_metal', tint(boxGeo(0.25, h + drop, 0.25).translate(s * w, (h - drop) / 2, -0.4), 0.35, 0.36, 0.35).applyMatrix4(m));
      gb.add('prop_metal', tint(beam(V3(s * w, -drop, -2.0), V3(s * w, h * 0.6, -0.4), 0.15, 0.15), 0.35, 0.36, 0.35).applyMatrix4(m));
    }
  // Lamps along the top.
  for (let k = 0; k < 4; k++) {
    const u = -w * 0.375 + (k * w * 0.75) / 3;
    gb.add('prop_glow', tint(boxGeo(0.4, 0.12, 0.25).translate(u, h + 0.35, 0.9), 1, 0.95, 0.85).applyMatrix4(m));
    gb.add('prop_metal', tint(rodGeo(V3(u, h + 0.15, 0.05), V3(u, h + 0.35, 0.9), 0.025, 4), 0.3, 0.3, 0.3).applyMatrix4(m));
  }
}

export interface ShopOpts {
  /** A named board (another atlas, under that material key) instead of a station-atlas shop. */
  board?: { rect: import('../../gfx/Signage').AtlasRect; key: string };
  /** Which interior shows through the shutters (0 grocery, 1 clothes, 2 sweets, 3 phones). */
  interior?: number;
  open?: boolean;
  /** A corrugated tin awning (the station side and the main roads), or none. */
  awning?: 'tin' | 'none';
}

/** One shop unit on a building face: shutter box, fascia board, lit interior, goods, awning. */
export function shopfront(c: MiraCtx, x: number, z: number, h: number, w: number, k: number, opts: ShopOpts = {}): void {
  const gb = c.gb;
  const rng = c.rng;
  const m = mat4(x, FOOTPATH, z, h);
  const closed = opts.open ? false : rng.chance(0.14);
  if (closed) {
    gb.add('shutter', boxGeo(w - 0.2, 2.85, 0.05).translate(0, 1.43, 0.04).applyMatrix4(m));
  } else {
    const tintC = rng.pick([
      [1, 0.93, 0.8],
      [0.95, 0.97, 1],
      [1, 0.88, 0.7],
      [0.9, 1, 0.92],
    ]);
    const g = new THREE.PlaneGeometry(w - 0.2, 2.85);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const vk = opts.interior ?? k % 4;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (vk + 0.02 + uv.getX(i) * 0.96) / 5);
    gb.add('shopGlow', tint(g.translate(0, 1.43, 0.03), tintC[0], tintC[1], tintC[2]).applyMatrix4(m));
    const p = V3(0, 0, 2).applyMatrix4(m);
    lamp(c, p.x, p.z, 6, 0.3);
    // Shelves and goods in the doorway.
    for (let g = 0; g < 4; g++) {
      const gw = rng.range(0.3, 0.8);
      gb.add('prop_paint', tint(boxGeo(gw, rng.range(0.3, 1.1), rng.range(0.3, 0.6)).translate(rng.range(-w / 2 + gw, w / 2 - gw), 0.3, 0.35), rng.range(0.2, 0.9), rng.range(0.2, 0.8), rng.range(0.1, 0.7)).applyMatrix4(m));
    }
  }
  gb.add('shutter', boxGeo(w - 0.1, 0.32, 0.32).translate(0, 3.02, 0.16).applyMatrix4(m));
  const shops = c.signs.shops;
  const rect = opts.board?.rect ?? shops[k % shops.length];
  const bw = Math.min(w - 0.1, 5.2);
  gb.add(opts.board?.key ?? 'signsLit', signQuad(rect, bw, bw / 4).translate(0, 3.25 + bw / 8 + 0.12, 0.16).applyMatrix4(m));
  gb.add('prop_paint', tint(boxGeo(bw + 0.08, bw / 4 + 0.08, 0.1).translate(0, 3.25 + bw / 8 + 0.12, 0.1), 0.15, 0.15, 0.15).applyMatrix4(m));
  if (opts.awning === 'tin') {
    // Corrugated sheet on two brackets, sloping out over the footpath, rusted at the edge.
    const col = [
      [0.56, 0.46, 0.38],
      [0.62, 0.64, 0.66],
      [0.42, 0.55, 0.68],
      [0.45, 0.56, 0.44],
    ][k % 4];
    gb.add('tin', tint(boxGeo(w + 0.15, 0.02, 1.45).rotateX(0.3).translate(0, 3.02, 0.72), col[0], col[1], col[2]).applyMatrix4(m));
    gb.add('prop_paint', tint(boxGeo(w + 0.15, 0.05, 0.05).translate(0, 2.8, 1.4), col[0] * 0.6, col[1] * 0.5, col[2] * 0.45).applyMatrix4(m));
    for (const e of [-w / 2 + 0.1, w / 2 - 0.1]) gb.add('prop_metal', tint(rodGeo(V3(e, 3.2, 0.02), V3(e, 2.85, 1.35), 0.015, 4), 0.3, 0.3, 0.3).applyMatrix4(m));
  } else if (opts.awning !== 'none' && rng.chance(0.4)) {
    const col = rng.pick([
      [0.1, 0.35, 0.75],
      [0.85, 0.35, 0.1],
      [0.15, 0.55, 0.3],
      [0.75, 0.12, 0.12],
      [0.9, 0.75, 0.2],
    ]);
    gb.add('tarp', tint(boxGeo(w, 0.03, 1.5).rotateX(0.32).translate(0, 2.85, 0.75), col[0], col[1], col[2]).applyMatrix4(m));
  }
  void solid;
}

/** The war memorial (outside/0_1, ⚠ simplified): a planted round base, a granite pedestal, two
 *  soldiers raising the national flag on a tilted pole, tall white blades behind them. */
function buildMemorial(c: MiraCtx, x: number, z: number): void {
  const gb = c.gb;
  const y0 = PLAZA;
  gb.add('granite', new THREE.CylinderGeometry(5.6, 5.7, 0.5, 40).translate(x, y0 + 0.25, z));
  gb.add('kerb', new THREE.CylinderGeometry(5.72, 5.72, 0.28, 40, 1, true).translate(x, y0 + 0.14, z));
  gb.add('prop_paint', tint(new THREE.CylinderGeometry(5.3, 5.3, 0.04, 36).translate(x, y0 + 0.52, z), 0.22, 0.3, 0.14));
  // Shrubs round the base.
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    const r = 4.3 + (k % 3) * 0.3;
    gb.add('prop_paint', tint(new THREE.SphereGeometry(0.55 + (k % 2) * 0.2, 8, 5).scale(1, 0.7, 1).translate(x + Math.cos(a) * r, y0 + 0.75, z + Math.sin(a) * r), 0.16 + (k % 3) * 0.03, 0.34, 0.1));
  }
  // Chained stainless posts round it.
  const posts: THREE.Vector3[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    posts.push(V3(x + Math.cos(a) * 6.3, y0, z + Math.sin(a) * 6.3));
  }
  posts.forEach((p, k) => {
    gb.add('stainless', new THREE.CylinderGeometry(0.06, 0.07, 0.8, 8).translate(p.x, y0 + 0.4, p.z));
    const q = posts[(k + 1) % posts.length];
    for (let t = 0; t < 4; t++) {
      const a = p.clone().lerp(q, t / 4).setY(y0 + 0.7 - 0.12 * Math.sin((Math.PI * t) / 4));
      const b = p.clone().lerp(q, (t + 1) / 4).setY(y0 + 0.7 - 0.12 * Math.sin((Math.PI * (t + 1)) / 4));
      gb.add('blackPaint', rodGeo(a, b, 0.015, 3));
    }
  });
  solid(c, x, z, 6.35, 6.35, 0, -1, 30);
  solid(c, x, z, 6.35, 6.35, Math.PI / 4, -1, 30);
  // Pedestal.
  gb.add('granite', tint(boxGeo(2.6, 1.3, 2.2).translate(x, y0 + 1.15, z), 0.55, 0.55, 0.55));
  gb.add('granite', tint(boxGeo(3.0, 0.2, 2.6).translate(x, y0 + 0.6, z), 0.6, 0.6, 0.6));
  const top = y0 + 1.8;
  // Soldiers (bronze): one kneeling at the foot of the pole, one standing pushing it up.
  const bronze = (g: THREE.BufferGeometry) => gb.add('prop_metal', tint(g, 0.24, 0.26, 0.18));
  const soldier = (px: number, pz: number, ry: number, kneel: boolean, lean: number) => {
    // Larger than life (≈1.7×), bronze.
    const m = mat4(x + px, top, z + pz, ry).multiply(new THREE.Matrix4().makeScale(1.7, 1.7, 1.7));
    const hip = kneel ? 0.62 : 1.0;
    const g: THREE.BufferGeometry[] = [];
    g.push(boxGeo(0.34, 0.62, 0.24).rotateX(lean).translate(0, hip + 0.33, Math.sin(lean) * 0.3));
    g.push(new THREE.SphereGeometry(0.13, 8, 6).translate(0, hip + 0.8, Math.sin(lean) * 0.6));
    g.push(new THREE.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, hip + 0.84, Math.sin(lean) * 0.6));
    if (kneel) {
      g.push(boxGeo(0.14, 0.5, 0.16).rotateX(-1.3).translate(-0.1, 0.45, 0.2));
      g.push(boxGeo(0.14, 0.5, 0.16).translate(-0.1, 0.25, 0.42));
      g.push(boxGeo(0.14, 0.62, 0.16).translate(0.1, 0.31, -0.08));
    } else {
      g.push(boxGeo(0.14, 1.0, 0.16).rotateX(0.25).translate(-0.1, 0.5, -0.1));
      g.push(boxGeo(0.14, 1.0, 0.16).rotateX(-0.3).translate(0.1, 0.5, 0.15));
    }
    g.push(boxGeo(0.1, 0.6, 0.1).rotateX(-1.1 + lean).translate(-0.2, hip + 0.55, 0.25 + Math.sin(lean) * 0.5));
    g.push(boxGeo(0.1, 0.6, 0.1).rotateX(-1.4 + lean).translate(0.2, hip + 0.6, 0.25 + Math.sin(lean) * 0.5));
    for (const q of g) bronze(q.applyMatrix4(m));
  };
  soldier(-0.8, 0.3, 0.9, true, 0.2);
  soldier(0.5, -0.5, 0.5, false, 0.45);
  // The pole, tilted as it is raised, and the flag.
  const pa = V3(x + 0.1, top + 0.1, z + 0.4);
  const pb = V3(x + 1.6, top + 7.4, z - 1.3);
  bronze(rodGeo(pa, pb, 0.05, 8));
  const dir = pb.clone().sub(pa).normalize();
  const flag = (row: number, col: [number, number, number]) => {
    const g = new THREE.PlaneGeometry(2.1, 0.47, 8, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2.4 + 0.6) * 0.14);
    g.translate(1.05, -0.235 - row * 0.47, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir);
    g.applyQuaternion(q).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(dir, 0.6));
    g.translate(pb.x, pb.y, pb.z);
    gb.add('flag', tint(g.toNonIndexed(), ...col));
  };
  flag(0, [1.0, 0.45, 0.1]);
  flag(1, [0.96, 0.96, 0.93]);
  flag(2, [0.08, 0.5, 0.16]);
  // White blades, curving up behind the group.
  for (const [bx, bz, ry, hgt] of [
    [-1.9, 1.0, 0.4, 5.6],
    [-2.3, -0.4, 0.2, 6.6],
    [2.0, 1.2, -0.3, 5.9],
    [2.4, -0.2, -0.5, 7.0],
  ] as [number, number, number, number][]) {
    const s = new THREE.Shape();
    s.moveTo(-0.35, 0);
    s.quadraticCurveTo(-0.45, hgt * 0.55, 0, hgt);
    s.quadraticCurveTo(0.25, hgt * 0.5, 0.35, 0);
    s.lineTo(-0.35, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false, curveSegments: 8 });
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + (p.getY(i) / hgt) ** 2 * 0.9);
    g.computeVertexNormals();
    gb.add('white', g.applyMatrix4(mat4(x + bx, y0 + 0.5, z + bz, ry)));
  }
  // Uplights.
  for (const [ux, uz] of [
    [1.6, 1.6],
    [-1.6, 1.6],
    [0, -1.8],
  ])
    gb.add('prop_glow', tint(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10).translate(x + ux, y0 + 0.56, z + uz), 1, 0.92, 0.8));
  lamp(c, x, z, 8, 0.35);
}

function buildFountain(c: MiraCtx, x: number, z: number): void {
  const gb = c.gb;
  const y0 = PLAZA;
  gb.add('granite', new THREE.CylinderGeometry(3.3, 3.35, 0.55, 36, 1, true).translate(x, y0 + 0.27, z));
  gb.add('granite', new THREE.TorusGeometry(3.3, 0.18, 6, 36).rotateX(Math.PI / 2).translate(x, y0 + 0.55, z));
  gb.add('water', new THREE.CircleGeometry(3.25, 36).rotateX(-Math.PI / 2).translate(x, y0 + 0.4, z));
  gb.add('granite', new THREE.CylinderGeometry(0.7, 0.9, 0.7, 16).translate(x, y0 + 0.35, z));
  // Jets.
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const r = k === 0 ? 0 : 1.6;
    const hgt = k === 0 ? 2.6 : 1.3;
    gb.add('jet', new THREE.ConeGeometry(0.09, hgt, 6, 1, true).translate(x + Math.cos(a) * r, y0 + 0.4 + hgt / 2, z + Math.sin(a) * r));
  }
  // Stainless railing.
  const n = 20;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const b = ((k + 1) / n) * Math.PI * 2;
    const p = V3(x + Math.cos(a) * 3.9, y0, z + Math.sin(a) * 3.9);
    const q = V3(x + Math.cos(b) * 3.9, y0, z + Math.sin(b) * 3.9);
    gb.add('stainless', rodGeo(p, p.clone().setY(y0 + 1.0), 0.03, 6));
    gb.add('stainless', rodGeo(p.clone().setY(y0 + 1.0), q.clone().setY(y0 + 1.0), 0.028, 6));
    gb.add('stainless', rodGeo(p.clone().setY(y0 + 0.55), q.clone().setY(y0 + 0.55), 0.02, 6));
  }
  solid(c, x, z, 4.0, 4.0, 0, -1, 3);
  solid(c, x, z, 4.0, 4.0, Math.PI / 4, -1, 3);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    gb.add('prop_glow', tint(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8).translate(x + Math.cos(a) * 2.2, y0 + 0.42, z + Math.sin(a) * 2.2), 0.8, 0.9, 1));
  }
  lamp(c, x, z, 6, 0.25);
}
