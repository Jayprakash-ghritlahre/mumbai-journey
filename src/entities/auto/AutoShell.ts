import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * The body of a Mumbai black-and-yellow auto-rickshaw of the Bajaj RE kind (AUTO_RIDE.md §3, the
 * photos in assets/auto/external), shared by the auto you ride (HeroAuto) and every other auto in the
 * streets (MiraVehicles.autoRickshaw), so they are the same vehicle seen nearer or further:
 * - the hood: a rounded black loaf over the whole length, overhanging the windscreen, its visor yellow;
 * - the nose: black below, yellow above round the base of the windscreen (a white line between),
 *   narrowing to the face with its twin round headlamps, the vent, the badge, amber indicators and
 *   the yellow front plate; the cowl's sides wrap back past the driver's knees in the same two colours;
 * - the yellow windscreen frame, round mirrors on stalks, the black tube posts;
 * - the rear body: black, rounded at the back corners, the wide yellow band along its belt line, the
 *   rear quarters above it with their windows, the small rear window, tail lamps and plate;
 * - the wheels under their mudguards, the chassis between the rear ones.
 *
 * Frame: +z forward, +x left, y up, ground at y = 0, centred between the axles.
 */

export type RGB = [number, number, number];
type Pt = [number, number];

export const BLACK: RGB = [0.028, 0.028, 0.03];
export const YELLOW: RGB = [0.96, 0.7, 0.04];
const AMBER: RGB = [0.95, 0.5, 0.05];
const TRIM: RGB = [0.78, 0.78, 0.76];
const DARK: RGB = [0.05, 0.05, 0.05];
const TUBE: RGB = [0.04, 0.04, 0.045];

/** Where the parts are (m). */
export const SHELL = {
  wheelR: 0.21,
  /** Front axle (z); the rear wheels (±x, z). */
  frontZ: 1.005,
  rearX: 0.585,
  rearZ: -0.905,
  /** Half-width of the rear body and the hood's sides. */
  hw: 0.662,
  /** The hood: from its skirt to the crown, its visor (front) and back. */
  hood: { y0: 1.5, y1: 1.76, front: 0.99, back: -1.3, r: 0.12 },
  /** The rear body: from its foot to the belt line; the rear quarters' front edge. */
  bodyY0: 0.4,
  beltY: 0.92,
  quarterZ: -0.55,
  /** The windscreen frame: base and top (y), base and top (z), half-width at the pillars. */
  ws: { y0: 1.04, y1: 1.66, z0: 0.93, z1: 0.86, halfW: 0.585 },
  /** The windows in the rear quarters and the back of the hood. */
  sideWin: { z0: -1.12, z1: -0.68, y0: 1.08, y1: 1.46 },
  backWin: { x: 0.3, y0: 1.24, y1: 1.44 },
  headlamp: { x: 0.27, y: 0.72, z: 1.36, r: 0.09 },
  tail: { x: 0.43, y: 0.72, z: -1.306, w: 0.09, h: 0.13 },
  /** Plates: centre, size, tilt (the front one sits on the yellow band under the windscreen). */
  plateFront: { y: 0.925, z: 1.336, w: 0.24, h: 0.075, tilt: -0.25 },
  plateRear: { y: 0.6, z: -1.307, w: 0.34, h: 0.13 },
  mirror: { x: 0.75, y: 1.42, z: 0.955, r: 0.075 },
};

/** Vertex-coloured pieces (position, normal, uv, colour) merged into one geometry. */
export class Parts {
  readonly list: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, c: RGB): this {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ng.deleteAttribute(k);
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    if (!ng.attributes.normal) ng.computeVertexNormals();
    const n = ng.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    ng.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.list.push(ng);
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, c: RGB, rx = 0, ry = 0, rz = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    return this.add(g.translate(x, y, z), c);
  }
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, c: RGB, seg = 8): this {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    return this.add(g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), c);
  }
  tube(pts: THREE.Vector3[], r: number, c: RGB, seg = 6): this {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    return this.add(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), r, seg, false), c);
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!;
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Turns every triangle the other way round (position and uv), and recomputes the normals. */
function flipWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const name of ['position', 'uv']) {
    const a = ng.attributes[name] as THREE.BufferAttribute | undefined;
    if (!a) continue;
    for (let i = 0; i < a.count; i += 3)
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.getComponent(i + 1, k);
        a.setComponent(i + 1, k, a.getComponent(i + 2, k));
        a.setComponent(i + 2, k, t);
      }
  }
  ng.deleteAttribute('normal');
  ng.computeVertexNormals();
  return ng;
}

/** The geometry and its reverse (for thin panels seen from both sides under a single-sided material). */
function twoSided(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const a = g.index ? g.toNonIndexed() : g;
  return mergeGeometries([a, flipWinding(a.clone())], false)!;
}

/**
 * A side profile (z, y) extruded across x (±w/2) with rounded edges, narrowed towards the front
 * between z = taper[0] and taper[1] (to taper[2] of its width there).
 */
function profileSolid(profile: Pt[], w: number, taper: [number, number, number] | null, bevel: number, bevelSegments: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  profile.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments, curveSegments: 4 });
  const ng = g.index ? g.toNonIndexed() : g;
  // Shape x → z, shape y → y, extrusion → x (swapping the axes mirrors it: flipWinding turns it back).
  const p = ng.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const sz = p.getX(i);
    const sy = p.getY(i);
    let x = p.getZ(i) - w / 2;
    if (taper) {
      const t = Math.max(0, Math.min(1, (sz - taper[0]) / (taper[1] - taper[0])));
      x *= 1 - (1 - taper[2]) * t * t;
    }
    p.setXYZ(i, x, sy, sz);
  }
  return flipWinding(ng);
}

/** Plan outline of the rear body (x, z): down the left side, round the back corners, up the right side. */
export function rearOutline(hw: number, zFront: number, zBack: number, r: number, seg: number): Pt[] {
  const pts: Pt[] = [
    [hw, zFront],
    [hw, zBack + r],
  ];
  for (let k = 1; k <= seg; k++) {
    const a = (k / seg) * (Math.PI / 2);
    pts.push([hw - r + r * Math.cos(a), zBack + r - r * Math.sin(a)]);
  }
  pts.push([-(hw - r), zBack]);
  for (let k = 1; k <= seg; k++) {
    const a = (k / seg) * (Math.PI / 2);
    pts.push([-(hw - r) - r * Math.sin(a), zBack + r - r * Math.cos(a)]);
  }
  pts.push([-hw, zFront]);
  return pts;
}

/** An opening in a wall: two plan points on one straight run of the outline, bottom and top. */
export interface WallHole {
  a: Pt;
  b: Pt;
  y0: number;
  y1: number;
}

/** The rear quarters' and the hood back's windows on an outline of half-width hw with its back at zBack. */
export function windowHoles(hw: number, zBack: number): WallHole[] {
  const w = SHELL.sideWin;
  const b = SHELL.backWin;
  return [
    { a: [hw, w.z1], b: [hw, w.z0], y0: w.y0, y1: w.y1 },
    { a: [-hw, w.z0], b: [-hw, w.z1], y0: w.y0, y1: w.y1 },
    { a: [b.x, zBack], b: [-b.x, zBack], y0: b.y0, y1: b.y1 },
  ];
}

/**
 * Vertical walls along a plan polyline from y0 to y1, facing to the right of the direction of travel
 * (outwards for rearOutline), with rectangular openings; uv in metres (along, up).
 */
export function walls(pts: Pt[], y0: number, y1: number, holes: WallHole[] = []): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  let u0 = 0;
  const near = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]) < 1e-3;
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const quad = (t0: number, t1: number, ya: number, yb: number) => {
      if (t1 - t0 < 1e-4 || yb - ya < 1e-4) return;
      const x0 = a[0] + ux * t0;
      const z0 = a[1] + uz * t0;
      const x1 = a[0] + ux * t1;
      const z1 = a[1] + uz * t1;
      pos.push(x0, ya, z0, x1, ya, z1, x1, yb, z1, x0, ya, z0, x1, yb, z1, x0, yb, z0);
      uv.push(u0 + t0, ya, u0 + t1, ya, u0 + t1, yb, u0 + t0, ya, u0 + t1, yb, u0 + t0, yb);
    };
    const h = holes.find((q) => near(q.a, a, b) && near(q.b, a, b));
    if (h) {
      const ta = (h.a[0] - a[0]) * ux + (h.a[1] - a[1]) * uz;
      const tb = (h.b[0] - a[0]) * ux + (h.b[1] - a[1]) * uz;
      const t0 = Math.min(ta, tb);
      const t1 = Math.max(ta, tb);
      quad(0, t0, y0, y1);
      quad(t1, len, y0, y1);
      quad(t0, t1, y0, h.y0);
      quad(t0, t1, h.y1, y1);
    } else quad(0, len, y0, y1);
    u0 += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** The hood: a rounded loaf, open underneath, its crown raised a little; the visor (front) apart. */
function hoodShell(seg: number): { body: THREE.BufferGeometry; visor: THREE.BufferGeometry } {
  const H = SHELL.hood;
  const hw = SHELL.hw + 0.002;
  const g = new RoundedBoxGeometry(2 * hw, H.y1 - H.y0, H.front - H.back, seg, H.r).toNonIndexed();
  g.translate(0, (H.y0 + H.y1) / 2, (H.front + H.back) / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const top = H.y1 - H.r;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > top) p.setY(i, y + 0.025 * ((y - top) / H.r) * Math.max(0, 1 - (p.getX(i) / hw) ** 2));
  }
  // Drop the underside; the faces looking forwards are the visor.
  const keep: number[][] = [[], []];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    const n = b.sub(a).cross(c.sub(a)).normalize();
    if (n.y < -0.35) continue;
    keep[n.z > 0.55 ? 1 : 0].push(i);
  }
  const pick = (idx: number[]) => {
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const src = g.attributes[name] as THREE.BufferAttribute;
      const arr = new Float32Array(idx.length * 3 * src.itemSize);
      idx.forEach((i, k) => {
        for (let j = 0; j < 3; j++) for (let q = 0; q < src.itemSize; q++) arr[(k * 3 + j) * src.itemSize + q] = src.getComponent(i + j, q);
      });
      out.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize));
    }
    return out;
  };
  return { body: pick(keep[0]), visor: pick(keep[1]) };
}

/** Where each part goes: painted steel, the rexine hood and quarters, bright trim. */
export interface ShellTargets {
  paint: Parts;
  hood: Parts;
  trim: Parts;
}

/**
 * How finely the auto is made: 'hero' is the auto you ride (its materials are double-sided; its
 * wheels, lamps, glass and cabin are its own); 'near' is the instanced one in the stand, the kerbs and
 * nearby traffic (single-sided, so thin panels get both faces); 'far' is traffic further off (the
 * same shape and colours, without the small things).
 */
export type AutoLod = 'hero' | 'near' | 'far';

/** Builds the body into the targets. */
export function buildShell(lod: AutoLod, t: ShellTargets): void {
  const hero = lod === 'hero';
  const far = lod === 'far';
  const both = (g: THREE.BufferGeometry) => (hero ? g : twoSided(g));
  const { paint, hood, trim } = t;
  const S = SHELL;

  // ---- Floor, sills, the chassis between the rear wheels ---------------------------------------
  paint.box(1.22, 0.04, 2.15, 0, 0.35, -0.175, [0.08, 0.08, 0.08]);
  if (!far) for (const s of [-1, 1]) paint.box(0.04, 0.1, 1.45, s * 0.62, 0.32, 0.175, BLACK);
  paint.box(0.92, 0.18, 0.67, 0, 0.33, -0.885, DARK);

  // ---- The nose: black below, yellow above (white line between), narrowing to the face ---------
  const taper: [number, number, number] = [1.0, 1.33, 0.7];
  const bevel = far ? 0 : 0.03;
  const bs = hero ? 2 : 1;
  paint.add(
    profileSolid(
      [
        [0.9, 0.42],
        [0.98, 0.47],
        [1.2, 0.47],
        [1.29, 0.56],
        [1.325 + 0.03 - bevel, 0.72],
        [1.31 + 0.03 - bevel, 0.88],
        [0.9, 0.88],
      ],
      1.16,
      taper,
      bevel,
      bs,
    ),
    BLACK,
  );
  paint.add(
    profileSolid(
      [
        [0.9, 0.88],
        [1.31 + 0.03 - bevel, 0.88],
        [1.29, 0.95],
        [1.2, 1.0],
        [0.96, 1.02],
        [0.9, 1.02],
      ],
      1.16,
      taper,
      bevel,
      bs,
    ),
    YELLOW,
  );
  // Half-width of the nose at z (outside its bevel).
  const noseW = (z: number) => {
    const k = Math.max(0, Math.min(1, (z - taper[0]) / (taper[1] - taper[0])));
    return (0.58 + bevel) * (1 - (1 - taper[2]) * k * k);
  };
  if (hero) {
    // The white line round the nose where the colours meet.
    const line: THREE.Vector3[] = [];
    for (const z of [0.9, 1.05, 1.15, 1.25, 1.3]) line.push(V(noseW(z) + 0.004, 0.88, z));
    line.push(V(noseW(1.31) - 0.03, 0.88, 1.343));
    trim.tube([...line, ...line.map((v) => V(-v.x, v.y, v.z)).reverse()], 0.006, TRIM, 4);
  }
  // The cowl's sides back past the driver's knees.
  for (const s of [-1, 1]) {
    const x = s * 0.618;
    paint.add(
      profileSolid(
        [
          [0.9, 0.33],
          [0.9, 0.88],
          [0.64, 0.88],
          [0.6, 0.62],
          [0.55, 0.45],
          [0.5, 0.33],
        ],
        0.035,
        null,
        0,
        0,
      ).translate(x, 0, 0),
      BLACK,
    );
    paint.add(
      profileSolid(
        [
          [0.9, 0.88],
          [0.9, 1.03],
          [0.74, 1.03],
          [0.64, 0.88],
        ],
        0.035,
        null,
        0,
        0,
      ).translate(x, 0, 0),
      YELLOW,
    );
  }
  // The face: headlamp bezels; nearer, the vent between the lamps, the badge, the indicators.
  const L = S.headlamp;
  if (far) for (const s of [-1, 1]) paint.box(0.15, 0.15, 0.02, s * L.x, L.y, L.z, [0.75, 0.75, 0.7]);
  else {
    for (let k = 0; k < (hero ? 4 : 2); k++) paint.box(0.2, hero ? 0.014 : 0.03, 0.012, 0, (hero ? 0.575 : 0.59) + k * (hero ? 0.034 : 0.06), 1.347, [0.16, 0.16, 0.17]);
    paint.box(0.26, 0.17, 0.008, 0, 0.625, 1.34, [0.06, 0.06, 0.065]);
    trim.box(0.11, 0.055, 0.014, 0, 0.81, 1.352, [0.75, 0.76, 0.78]);
    for (const s of [-1, 1]) paint.box(0.1, 0.04, 0.03, s * 0.36, 0.925, 1.318, AMBER, -0.25);
    for (const s of [-1, 1]) trim.add(new THREE.CylinderGeometry(L.r, L.r * 1.05, 0.05, hero ? 20 : 8, 1, !hero).rotateX(Math.PI / 2).translate(s * L.x, L.y, L.z), [0.62, 0.63, 0.65]);
  }

  // ---- Front fender over the wheel, the fork ---------------------------------------------------
  paint.add(both(new THREE.CylinderGeometry(0.26, 0.26, 0.19, hero ? 16 : far ? 5 : 8, 1, true, -0.12 * Math.PI, 0.92 * Math.PI).rotateZ(Math.PI / 2).translate(0, S.wheelR, S.frontZ)), BLACK);
  if (!hero && !far) for (const s of [-1, 1]) paint.box(0.03, 0.32, 0.04, s * 0.075, 0.36, 0.985, DARK, -0.15);

  // ---- The windscreen frame (yellow), the posts (black tube), the mirrors ----------------------
  const W = S.ws;
  for (const s of [-1, 1]) paint.box(0.07, W.y1 - W.y0 + 0.04, 0.07, s * W.halfW, (W.y0 + W.y1) / 2, (W.z0 + W.z1) / 2, YELLOW, 0.11);
  paint.box(1.24, 0.08, 0.08, 0, W.y1, W.z1, YELLOW);
  paint.box(1.2, 0.05, 0.06, 0, W.y0, W.z0, YELLOW);
  if (!far) {
    const tseg = hero ? 8 : 3;
    for (const s of [-1, 1]) {
      paint.rod(V(s * 0.62, 0.36, 0.12), V(s * 0.62, 1.66, 0.12), 0.022, TUBE, tseg);
      paint.rod(V(s * 0.63, 0.92, S.quarterZ), V(s * 0.63, 1.66, S.quarterZ), 0.02, TUBE, tseg);
      const M = S.mirror;
      if (hero) paint.tube([V(s * 0.6, 1.24, 0.9), V(s * 0.68, 1.3, 0.93), V(s * (M.x - 0.01), M.y - 0.04, M.z - 0.005)], 0.012, TUBE, 6);
      else paint.rod(V(s * 0.6, 1.24, 0.9), V(s * (M.x - 0.01), M.y - 0.04, M.z - 0.005), 0.012, TUBE, 3);
      paint.add(new THREE.CylinderGeometry(M.r + 0.003, M.r + 0.003, 0.03, hero ? 18 : 6).rotateX(Math.PI / 2).translate(s * M.x, M.y, M.z), DARK);
    }
  }

  // ---- The rear body: rounded at the back, the yellow band along the belt line ------------------
  const back = S.hood.back;
  const r = S.hood.r;
  const cseg = hero ? 5 : far ? 1 : 3;
  const body = rearOutline(S.hw, S.quarterZ, back, r, cseg);
  paint.add(far ? walls(body, S.bodyY0, S.beltY) : both(walls(body, S.bodyY0, S.beltY)), BLACK);
  const band = rearOutline(S.hw + 0.007, S.quarterZ - 0.004, back - 0.007, r + 0.007, cseg);
  paint.add(walls(band, S.beltY - 0.065, S.beltY + 0.035), YELLOW);
  if (hero) paint.add(walls(rearOutline(S.hw + 0.009, S.quarterZ - 0.002, back - 0.009, r + 0.009, cseg), S.beltY - 0.072, S.beltY - 0.064), [0.7, 0.1, 0.06]);
  // The engine under the parcel shelf (closed, so it is the shelf too), behind the backrest.
  const eng = rearOutline(S.hw - 0.004, -1.03, back + 0.004, r - 0.004, cseg);
  const sh = new THREE.Shape();
  eng.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
  paint.add(
    new THREE.ExtrudeGeometry(sh, { depth: S.beltY - S.bodyY0, bevelEnabled: false })
      .rotateX(Math.PI / 2)
      .translate(0, S.beltY, 0),
    BLACK,
  );
  // The bumper strip and louvres across the back.
  paint.box(1.0, 0.055, 0.012, 0, 0.47, back - 0.006, YELLOW);
  if (hero) for (let k = 0; k < 3; k++) paint.box(0.5, 0.018, 0.012, 0, 0.75 + k * 0.04, back - 0.006, [0.12, 0.12, 0.12]);
  // Rear mudguards over the wheels.
  for (const s of [-1, 1]) paint.add(both(new THREE.CylinderGeometry(0.25, 0.25, 0.17, hero ? 14 : far ? 4 : 7, 1, true, 0.04 * Math.PI, 0.92 * Math.PI).rotateZ(Math.PI / 2).translate(s * S.rearX, S.wheelR, S.rearZ)), BLACK);

  // ---- The hood and the rear quarters (rexine), the windows cut in them --------------------------
  const H = hoodShell(hero ? 3 : far ? 1 : 2);
  hood.add(H.body, BLACK);
  hood.add(H.visor, YELLOW);
  const quarters = walls(body, S.beltY, S.hood.y0 + r, far ? [] : windowHoles(S.hw, back));
  hood.add(far ? quarters : both(quarters), BLACK);
}

/** A wheel (tyre, steel rim, hub) on the x axis, centred at the origin. */
export function wheelGeometry(lod: AutoLod): THREE.BufferGeometry {
  const R = SHELL.wheelR;
  const t = new Parts();
  if (lod === 'hero') {
    t.add(new THREE.TorusGeometry(R - 0.055, 0.058, 8, 22).rotateY(Math.PI / 2), [0.035, 0.035, 0.035]);
    t.add(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 16).rotateZ(Math.PI / 2), [0.55, 0.56, 0.58]);
    t.add(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 10).rotateZ(Math.PI / 2), [0.3, 0.3, 0.3]);
    // Spokes of the rim (so the turning shows).
    for (let k = 0; k < 5; k++) t.add(new THREE.BoxGeometry(0.11, 0.022, 0.03).translate(0, 0.055, 0).rotateX((k / 5) * Math.PI * 2), [0.25, 0.25, 0.26]);
  } else {
    const seg = lod === 'far' ? 6 : 8;
    t.add(new THREE.CylinderGeometry(R, R, 0.13, seg, 1, true).rotateZ(Math.PI / 2), [0.035, 0.035, 0.035]);
    t.add(new THREE.CylinderGeometry(R - 0.06, R - 0.06, 0.128, seg).rotateZ(Math.PI / 2), lod === 'far' ? [0.06, 0.06, 0.06] : [0.4, 0.41, 0.43]);
  }
  return t.build();
}

/**
 * An instanced auto (the stand, the kerbs, the traffic; ≈1.4k triangles near, ≈0.3k far): the same
 * body with its wheels, lamps, plates and windows painted on and, near, the cabin seen through the
 * openings: the passenger bench, the driver's seat, the teal dash and the handlebar. Drivers and
 * passengers are drawn by their owners (driver at y 0.27, z 0.36 in POSE.drive; passengers at
 * y 0.24, z −0.76 in POSE.sit).
 */
export function autoCrowd(lod: 'near' | 'far' = 'near'): THREE.BufferGeometry {
  const p = new Parts();
  const far = lod === 'far';
  buildShell(lod, { paint: p, hood: p, trim: p });
  const S = SHELL;
  // Wheels.
  const wheel = wheelGeometry(lod);
  p.list.push(wheel.clone().translate(0, S.wheelR, S.frontZ));
  for (const s of [-1, 1]) p.list.push(wheel.clone().translate(s * S.rearX, S.wheelR, S.rearZ));
  // Tail lamps and plates.
  const T = S.tail;
  for (const s of [-1, 1]) p.box(T.w, T.h, 0.012, s * T.x, T.y, T.z - 0.002, [0.75, 0.06, 0.04]);
  const R = S.plateRear;
  p.box(R.w, R.h, 0.01, 0, R.y, R.z - 0.002, [0.98, 0.84, 0.12]);
  // Under the hood, so the cabin's ceiling is not see-through from below.
  p.add(new THREE.PlaneGeometry(1.28, 2.2).rotateX(Math.PI / 2).translate(0, S.hood.y0 + 0.1, -0.155), [0.1, 0.1, 0.12]);
  if (far) {
    // The seats as one dark block.
    p.box(1.12, 0.5, 0.5, 0, 0.62, -0.75, [0.2, 0.06, 0.05]);
    return p.build();
  }
  // Lamp lenses, the front plate, windows (dark: clear vinyl, but the cabin behind is dim), mirrors.
  const L = S.headlamp;
  for (const s of [-1, 1]) p.add(new THREE.CircleGeometry(L.r - 0.016, 8).translate(s * L.x, L.y, L.z + 0.026), [0.92, 0.92, 0.85]);
  const F = S.plateFront;
  p.box(F.w, F.h, 0.01, 0, F.y, F.z, [0.98, 0.84, 0.12], F.tilt);
  const sw = S.sideWin;
  for (const s of [-1, 1]) p.add(new THREE.PlaneGeometry(sw.z1 - sw.z0, sw.y1 - sw.y0).rotateY((s * Math.PI) / 2).translate(s * (S.hw - 0.006), (sw.y0 + sw.y1) / 2, (sw.z0 + sw.z1) / 2), [0.1, 0.11, 0.12]);
  const bw = S.backWin;
  p.add(new THREE.PlaneGeometry(bw.x * 2, bw.y1 - bw.y0).rotateY(Math.PI).translate(0, (bw.y0 + bw.y1) / 2, S.hood.back + 0.006), [0.1, 0.11, 0.12]);
  for (const s of [-1, 1]) p.add(new THREE.CircleGeometry(S.mirror.r, 6).rotateY(Math.PI).translate(s * S.mirror.x, S.mirror.y, S.mirror.z - 0.016), [0.45, 0.48, 0.5]);
  // The cabin: bench (maroon on a black base), the driver's seat, the dash and the handlebar.
  const maroon: RGB = [0.19, 0.045, 0.04];
  p.box(1.16, 0.3, 0.44, 0, 0.51, -0.72, DARK);
  p.box(1.12, 0.1, 0.46, 0, 0.68, -0.7, maroon);
  p.box(1.12, 0.5, 0.11, 0, 1.0, -0.98, maroon, 0.16);
  p.box(0.5, 0.1, 0.38, 0, 0.69, 0.4, DARK);
  p.box(0.3, 0.32, 0.3, 0, 0.5, 0.42, DARK);
  p.box(0.42, 0.24, 0.07, 0, 0.84, 0.2, DARK, -0.12);
  p.box(1.12, 0.5, 0.04, 0, 0.74, 0.85, [0.07, 0.3, 0.26], -0.2);
  p.box(0.72, 0.035, 0.035, 0, 1.0, 0.73, [0.45, 0.45, 0.45]);
  p.box(0.04, 0.6, 0.04, 0, 0.72, 0.8, DARK, -0.35);
  return p.build();
}
