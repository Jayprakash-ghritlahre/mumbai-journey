import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, beamGeo, boxGeo } from '../../gfx/GeoBuilder';
import type { StationMaterials } from './StationMaterials';
import type { CollisionWorld } from '../../core/Collision';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import { CONCOURSE, SHED, Y } from './Layout';

const HALF = 24.4;
const WALL_X = 24.65;

// Quadratic Bézier profiles for the pointed-arch crescent trusses (right half; mirrored for left).
const TOP = { p0: [0, 17.6], p1: [14, 16.2], p2: [HALF, SHED.eaveY] };
const BOT = { p0: [0, 15.3], p1: [13, 13.9], p2: [HALF - 0.35, SHED.springY] };

function bez(c: typeof TOP, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * c.p0[0] + 2 * u * t * c.p1[0] + t * t * c.p2[0], u * u * c.p0[1] + 2 * u * t * c.p1[1] + t * t * c.p2[1]];
}

const PANELS = 12;

/** Top chord point i (0 = apex … PANELS = eave) on side s (+1 east / -1 west). */
export function topPoint(i: number, s: number): THREE.Vector3 {
  const [x, y] = bez(TOP, i / PANELS);
  return new THREE.Vector3(x * s, y, 0);
}
export function botPoint(i: number, s: number): THREE.Vector3 {
  const [x, y] = bez(BOT, i / PANELS);
  return new THREE.Vector3(x * s, y, 0);
}

/** Height of the roof's underside (top chord) at x. */
export function roofHeightAt(x: number): number {
  const ax = Math.min(HALF, Math.abs(x));
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    if (bez(TOP, mid)[0] < ax) lo = mid;
    else hi = mid;
  }
  return bez(TOP, lo)[1];
}

/** Lower chord height at x (for hanging fixtures). */
export function trussBottomAt(x: number): number {
  const ax = Math.min(HALF - 0.4, Math.abs(x));
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    if (bez(BOT, mid)[0] < ax) lo = mid;
    else hi = mid;
  }
  return bez(BOT, lo)[1];
}

export function trussZ(i: number): number {
  return SHED.south - i * SHED.bay;
}

/** One complete truss (both halves) with its two lattice wall columns, at z = 0. */
function trussGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const Z = new THREE.Vector3(0, 0, 1);
  for (const s of [-1, 1]) {
    for (let i = 0; i < PANELS; i++) {
      parts.push(beamGeo(topPoint(i, s), topPoint(i + 1, s), 0.24, 0.3, Z));
      parts.push(beamGeo(botPoint(i, s), botPoint(i + 1, s), 0.2, 0.24, Z));
    }
    for (let i = 1; i < PANELS; i++) parts.push(beamGeo(botPoint(i, s), topPoint(i, s), 0.12, 0.1, Z));
    for (let i = 0; i < PANELS; i++) {
      const a = i % 2 === 0 ? botPoint(i, s) : topPoint(i, s);
      const b = i % 2 === 0 ? topPoint(i + 1, s) : botPoint(i + 1, s);
      parts.push(beamGeo(a, b, 0.1, 0.09, Z));
      // Secondary lacing on the deeper inner panels.
      if (i < PANELS - 3) {
        const m0 = botPoint(i, s).lerp(topPoint(i, s), 0.5);
        const m1 = botPoint(i + 1, s).lerp(topPoint(i + 1, s), 0.5);
        parts.push(beamGeo(m0, m1, 0.06, 0.06, Z));
      }
    }
    // Lattice column against the side wall.
    const cx = s * (HALF - 0.35);
    const base = Y.platform;
    const top = SHED.eaveY + 0.1;
    for (const off of [-0.28, 0.28]) {
      const g = boxGeo(0.22, top - base, 0.3);
      g.translate(cx + off * s, (base + top) / 2, 0);
      parts.push(g);
    }
    const n = 9;
    for (let k = 0; k < n; k++) {
      const y0 = base + 0.4 + ((top - base - 0.8) * k) / n;
      const y1 = base + 0.4 + ((top - base - 0.8) * (k + 1)) / n;
      parts.push(beamGeo(new THREE.Vector3(cx - 0.28 * s, y0, 0), new THREE.Vector3(cx + 0.28 * s, y1, 0), 0.06, 0.06, Z));
      parts.push(beamGeo(new THREE.Vector3(cx + 0.28 * s, y0, 0), new THREE.Vector3(cx - 0.28 * s, y1, 0), 0.06, 0.06, Z));
    }
    // Base plate and knee brace into the arch.
    const bp = boxGeo(0.9, 0.12, 0.6);
    bp.translate(cx, base + 0.06, 0);
    parts.push(bp);
    parts.push(beamGeo(new THREE.Vector3(cx, 6.2, 0), botPoint(PANELS - 2, s), 0.14, 0.14, Z));
  }
  // Apex vertical.
  parts.push(beamGeo(botPoint(0, 1), topPoint(0, 1), 0.14, 0.12, new THREE.Vector3(0, 0, 1)));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** Per-bay lattice: ridge girder diagonals, bottom-chord ties and roof-plane wind bracing (bay spans z ∈ [-bay, 0]). */
function bayGeometry(withWindBracing: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const b = SHED.bay;
  const up = new THREE.Vector3(0, 1, 0);
  // Ridge girder zig-zag.
  const rTop = topPoint(0, 1).y - 0.15;
  const rBot = botPoint(0, 1).y;
  parts.push(beamGeo(new THREE.Vector3(0, rBot, 0), new THREE.Vector3(0, rTop, -b / 2), 0.08, 0.08, up));
  parts.push(beamGeo(new THREE.Vector3(0, rTop, -b / 2), new THREE.Vector3(0, rBot, -b), 0.08, 0.08, up));
  if (withWindBracing)
    for (const s of [-1, 1])
      for (const [i0, i1] of [
        [1, 4],
        [8, 11],
      ]) {
        const a = topPoint(i0, s);
        const c = topPoint(i1, s);
        const p0 = a.clone().setZ(0);
        const p1 = c.clone().setZ(-b);
        const p2 = c.clone().setZ(0);
        const p3 = a.clone().setZ(-b);
        p0.y -= 0.25;
        p1.y -= 0.25;
        p2.y -= 0.25;
        p3.y -= 0.25;
        parts.push(beamGeo(p0, p1, 0.08, 0.08, up), beamGeo(p2, p3, 0.08, 0.08, up));
      }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, zs: number[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, zs.length);
  const m = new THREE.Matrix4();
  zs.forEach((z, i) => mesh.setMatrixAt(i, m.makeTranslation(0, 0, z)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

export interface ShedResult {
  group: THREE.Group;
}

export function buildShed(mats: StationMaterials, col: CollisionWorld, av: AmbientVolume): ShedResult {
  const group = new THREE.Group();
  group.name = 'shed';
  const M = mats.m;
  const south = SHED.south;
  const north = SHED.north;
  const len = south - north;

  // Trusses at every bay line.
  const trussZs: number[] = [];
  for (let i = 0; i <= SHED.bays; i++) trussZs.push(trussZ(i));
  group.add(instanced(trussGeometry(), M.steelTruss, trussZs));
  const bayZs: number[] = [];
  const windZs: number[] = [];
  for (let i = 0; i < SHED.bays; i++) (i % 4 === 1 ? windZs : bayZs).push(trussZ(i));
  group.add(instanced(bayGeometry(false), M.steelTruss, bayZs));
  group.add(instanced(bayGeometry(true), M.steelTruss, windZs));

  const gb = new GeoBuilder();
  const cz = (south + north) / 2;
  // Purlins along every top-chord panel point; ties along the lower chord.
  for (const s of [-1, 1]) {
    for (let i = 0; i <= PANELS; i++) {
      const p = topPoint(i, s);
      gb.box('steelTruss', 0.12, 0.22, len, p.x, p.y - 0.12, cz);
    }
    for (const i of [3, 6, 9]) {
      const p = botPoint(i, s);
      gb.box('steelTruss', 0.1, 0.14, len, p.x, p.y, cz);
    }
    // Eaves girder and gutter.
    gb.box('steelTruss', 0.25, 0.5, len, s * (HALF - 0.35), SHED.eaveY - 0.3, cz);
    gb.box('darkMetal', 0.45, 0.3, len, s * (HALF + 0.15), SHED.eaveY + 0.05, cz);
  }
  gb.box('steelTruss', 0.2, 0.2, len, 0, botPoint(0, 1).y, cz);

  // Roof sheeting: each top-chord panel split in two strips; some strips are skylights.
  const skylightStrips = new Set([3, 8, 13, 18]);
  for (const s of [-1, 1]) {
    for (let i = 0; i < PANELS; i++) {
      const a = topPoint(i, s);
      const b = topPoint(i + 1, s);
      for (let h = 0; h < 2; h++) {
        const p = a.clone().lerp(b, h / 2);
        const q = a.clone().lerp(b, (h + 1) / 2);
        const strip = i * 2 + h;
        const key = skylightStrips.has(strip) ? 'skylight' : 'roof';
        gb.add(key, roofStrip(p, q, south + 0.4, north - 0.4, s, strip));
      }
    }
  }
  // Ridge vent cap.
  gb.box('roof', 1.4, 0.08, len + 0.8, 0, topPoint(0, 1).y + 0.55, cz);
  for (const s of [-1, 1]) gb.box('darkMetal', 0.06, 0.55, len, s * 0.65, topPoint(0, 1).y + 0.25, cz);

  // Side walls with dado, openings for the concourse exits, and high louvred clerestory.
  const exitZ0 = CONCOURSE.passageZ - 4.2;
  const exitZ1 = CONCOURSE.passageZ + 4.2;
  for (const s of [-1, 1]) {
    const x = s * WALL_X;
    const segs: [number, number][] = [
      [north, exitZ0],
      [exitZ1, south],
    ];
    for (const [z0, z1] of segs) {
      const zc = (z0 + z1) / 2;
      const l = z1 - z0;
      gb.box('wall', 0.4, SHED.sideWallY - 1.9, l, x, (SHED.sideWallY + 1.9) / 2, zc);
      gb.box('dado', 0.42, 1.9 - Y.street, l, x, (1.9 + Y.street) / 2, zc);
      col.addBox(x - 0.25, z0, x + 0.25, z1, -5, 12);
      // Coping band on top of the wall.
      gb.box('wallGrey', 0.55, 0.25, l, x, SHED.sideWallY + 0.12, zc);
    }
    // Lintel over the exit opening.
    gb.box('wall', 0.4, SHED.sideWallY - 4.6, exitZ1 - exitZ0, x, (SHED.sideWallY + 4.6) / 2, CONCOURSE.passageZ);
    // Clerestory louvres between wall top and eaves (let light and air through).
    for (let k = 0; k < 4; k++) {
      const y = SHED.sideWallY + 0.45 + k * 0.42;
      gb.add('louvre', louvreStrip(x, y, north, south));
    }
    // Windows in the wall (offices behind), one per bay, and doors every 4th bay.
    for (let i = 0; i < SHED.bays; i++) {
      const z = trussZ(i) - SHED.bay / 2;
      if (z > exitZ0 - 1 && z < exitZ1 + 1) continue;
      for (const face of [-1, 1]) {
        const fx = x + face * 0.21;
        const wy = 4.4;
        gb.box('glassDark', 0.04, 1.9, 2.6, fx, wy, z);
        for (let k = 0; k < 7; k++) gb.box('louvre', 0.08, 0.05, 2.6, fx + face * 0.03, wy - 0.85 + k * 0.28, z);
        gb.box('wallGrey', 0.1, 0.12, 2.9, fx, wy - 1.02, z);
        if (i % 4 === 2 && face === -s) {
          gb.box('wood', 0.06, 2.4, 1.4, fx, Y.platform + 1.2, z + 1.6);
          gb.box('wallGrey', 0.08, 0.14, 1.6, fx, Y.platform + 2.48, z + 1.6);
        }
      }
    }
  }

  // Gable valances hanging from the end trusses.
  for (const z of [north - 0.15]) gb.add('roof', valance(z));
  gb.add('roof', valance(south + 0.15, 13.3));

  const built = gb.build(M, { noShadowKeys: ['skylight'] });
  group.add(built);

  // Ambient volume: the shed shades the platforms; skylights, clerestories and the open
  // north end let some sky in. Ceiling height follows the roof profile across x.
  av.paint(-WALL_X - 0.3, north - 1, WALL_X + 0.3, south + 0.5, (x, z, sky, ceil) => {
    const nearOpenEnd = Math.max(0, 1 - (z - north) / 35);
    const nearSide = Math.max(0, 1 - (WALL_X - Math.abs(x)) / 5);
    const nearExit = Math.abs(z - CONCOURSE.passageZ) < 5 && Math.abs(x) > WALL_X - 6 ? 0.25 : 0;
    const v = 0.26 + 0.55 * nearOpenEnd * nearOpenEnd + 0.1 * nearSide + nearExit;
    return [Math.min(sky, v), Math.max(ceil, roofHeightAt(x) + 0.15)];
  });
  return { group };
}

/** A roof sheet strip between two top-chord points, running the length of the shed. */
function roofStrip(p: THREE.Vector3, q: THREE.Vector3, zS: number, zN: number, s: number, strip: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const lift = 0.16;
  const verts = new Float32Array([p.x, p.y + lift, zS, q.x, q.y + lift, zS, q.x, q.y + lift, zN, p.x, p.y + lift, zN]);
  const w = p.distanceTo(q);
  const u0 = strip * w;
  const uvs = new Float32Array([u0, zS, u0 + w, zS, u0 + w, zN, u0, zN]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // Front face must point up/outwards.
  g.setIndex(s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  return g;
}

function louvreStrip(x: number, y: number, zN: number, zS: number): THREE.BufferGeometry {
  const g = boxGeo(0.34, 0.04, zS - zN);
  g.rotateZ(x > 0 ? -0.6 : 0.6);
  g.translate(x, y, (zS + zN) / 2);
  return g;
}

/** Corrugated screen following the top chord down ~2.2 m at a gable end. */
function valance(z: number, minX = -HALF): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const pts: THREE.Vector3[] = [];
  for (let i = PANELS; i >= 0; i--) pts.push(topPoint(i, -1));
  for (let i = 1; i <= PANELS; i++) pts.push(topPoint(i, 1));
  const drop = 2.2;
  let u = 0;
  pts.forEach((p, k) => {
    if (k > 0) u += p.distanceTo(pts[k - 1]);
    const x = Math.max(minX, p.x);
    pos.push(x, p.y + 0.1, z, x, p.y - drop, z);
    uv.push(u, 0, u, drop);
    if (k > 0) {
      const a = (k - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
