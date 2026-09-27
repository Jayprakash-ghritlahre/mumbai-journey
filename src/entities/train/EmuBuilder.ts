import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { CAR, WIN_W, liveryU, windowPositions } from './Livery';

export type CarType = 'cab' | 'motor' | 'trailer';

/** Per-material geometry for one car, in car-local space (x across, y up from rail top, z along; cab at -z). */
export interface CarParts {
  body: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  interior: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
  steel: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  cab?: THREE.BufferGeometry;
  glass?: THREE.BufferGeometry;
  headLamps?: THREE.BufferGeometry;
  tailLamps?: THREE.BufferGeometry;
  /** Sliding door leaves (closed position) with an aSlide attribute: ±1 = direction they open. */
  doors: THREE.BufferGeometry;
}

/** How far a door leaf slides to open (m). */
export const DOOR_TRAVEL = 1.38;

/** One sliding leaf per doorway and side, on the inside of the wall: grey steel, a barred window. */
function doorLeaves(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const W = CAR.doorW + 0.06;
  const y0 = CAR.floorY + 0.02;
  const y1 = CAR.doorY1 - 0.02;
  const t = 0.035;
  CAR.doors.forEach((d, i) => {
    // The end doorways open towards the car ends, the middle one towards the far end.
    const dir = i === 0 ? -1 : 1;
    for (const s of [-1, 1]) {
      const x = s * (IN - 0.03);
      const leaf: THREE.BufferGeometry[] = [];
      const grey: [number, number, number] = [0.62, 0.63, 0.64];
      const band: [number, number, number] = [0.42, 0.24, 0.55];
      const add = (g: THREE.BufferGeometry, c: [number, number, number]) => {
        const ng = g.toNonIndexed();
        tint(ng, ...c);
        leaf.push(ng);
      };
      // Lower panel (violet band outside), side stiles and the head, around a window opening.
      add(boxGeo(t, 1.05, W).translate(x, y0 + 0.525, d), grey);
      add(boxGeo(t + 0.004, 0.35, W).translate(x, y0 + 0.2, d), band);
      add(boxGeo(t, y1 - (y0 + 1.75), W).translate(x, (y0 + 1.75 + y1) / 2, d), grey);
      for (const sz of [-1, 1]) add(boxGeo(t, 0.7, 0.2).translate(x, y0 + 1.4, d + sz * (W / 2 - 0.1)), grey);
      for (const yy of [y0 + 1.25, y0 + 1.42, y0 + 1.59]) add(boxGeo(0.02, 0.02, W - 0.4).translate(x, yy, d), [0.75, 0.76, 0.78]);
      const g = mergeGeometries(leaf)!;
      g.setAttribute('aSlide', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(dir), 1));
      // Per-leaf random: some doorways are never closed (as on most non-AC locals).
      const r = ((i * 7 + (s > 0 ? 3 : 0)) * 0.618) % 1;
      g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(r), 1));
      parts.push(g);
    }
  });
  const m = mergeGeometries(parts)!;
  for (const k of Object.keys(m.attributes)) if (!['position', 'normal', 'color', 'aSlide', 'aLeaf'].includes(k)) m.deleteAttribute(k);
  return m;
}

/** Louvred shutters in the window openings, lowered to a different height in each window. */
function windowShutters(acc: Acc, seed: number, isCab: boolean): void {
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (const s of [-1, 1]) {
    for (const w of windowPositions()) {
      if (isCab && w < -L + 2.2) continue;
      const lowered = rnd() < 0.35 ? rnd() * 0.6 : 0;
      const n = Math.round((lowered * (CAR.winY1 - CAR.winY0)) / 0.085);
      for (let i = 0; i < n; i++) {
        const slat = boxGeo(0.008, 0.07, WIN_W - 0.02);
        slat.rotateZ(s * 0.6);
        slat.translate(s * (HW - 0.045), CAR.winY1 - 0.05 - i * 0.085, w);
        acc.add(slat, [1.4, 1.38, 1.3]);
      }
    }
  }
}

const L = CAR.length / 2;
const HW = CAR.halfW;
/** Interior wall plane (|x|). */
export const IN = HW - 0.07;

type Quad = [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];

/** Accumulates quads (with uv) and arbitrary geometries into one non-indexed buffer. */
class Acc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  extra: THREE.BufferGeometry[] = [];

  quad(q: Quad, uvs: [number, number][], color: [number, number, number] = [1, 1, 1]): void {
    const n = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0])).normalize();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(q[i].x, q[i].y, q[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(...color);
    }
  }

  add(g: THREE.BufferGeometry, color: [number, number, number] = [1, 1, 1]): void {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    tint(ng, ...color);
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) ng.deleteAttribute(k);
    this.extra.push(ng);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const all = this.pos.length ? [g, ...this.extra] : this.extra;
    if (!all.length) return new THREE.BufferGeometry();
    const m = mergeGeometries(all, false)!;
    m.computeBoundingSphere();
    return m;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Openings in the side wall: doors (full height) and windows. */
function openings(): { z0: number; z1: number; y0: number; y1: number; door: boolean }[] {
  const o = CAR.doors.map((d) => ({ z0: d - CAR.doorW / 2, z1: d + CAR.doorW / 2, y0: CAR.floorY, y1: CAR.doorY1, door: true }));
  for (const w of windowPositions()) o.push({ z0: w - WIN_W / 2, z1: w + WIN_W / 2, y0: CAR.winY0, y1: CAR.winY1, door: false });
  return o.sort((a, b) => a.z0 - b.z0);
}

/**
 * Side wall at x = s*xw as rectangles around the openings.
 * `uvFor` maps (z, y) to texture coordinates (exterior livery or interior laminate).
 */
function sideWall(acc: Acc, s: number, xw: number, y0: number, y1: number, uvFor: (z: number, y: number) => [number, number], z0 = -L, z1 = L): void {
  const ops = openings();
  // Horizontal breakpoints.
  const ys = Array.from(new Set([y0, y1, CAR.winY0, CAR.winY1, CAR.doorY1, CAR.floorY].filter((y) => y >= y0 && y <= y1))).sort((a, b) => a - b);
  for (let k = 0; k < ys.length - 1; k++) {
    const ya = ys[k];
    const yb = ys[k + 1];
    const ym = (ya + yb) / 2;
    // Openings intersecting this band.
    const holes = ops.filter((o) => ym > o.y0 && ym < o.y1).map((o) => [o.z0, o.z1] as [number, number]);
    let z = z0;
    const segs: [number, number][] = [];
    for (const [a, b] of holes) {
      if (a > z) segs.push([z, a]);
      z = Math.max(z, b);
    }
    if (z < z1) segs.push([z, z1]);
    for (const [za, zb] of segs) {
      const q: Quad = s > 0 ? [V(xw, ya, zb), V(xw, ya, za), V(xw, yb, za), V(xw, yb, zb)] : [V(-xw, ya, za), V(-xw, ya, zb), V(-xw, yb, zb), V(-xw, yb, za)];
      const uvs = q.map((p) => uvFor(p.z, p.y)) as [number, number][];
      acc.quad(q, uvs);
    }
  }
}

/** Depth reveals around every opening (from exterior to interior plane). */
function reveals(acc: Acc, s: number, uvFor: (z: number, y: number) => [number, number]): void {
  for (const o of openings()) {
    const xo = s * HW;
    const xi = s * IN;
    // Top.
    acc.quad(s > 0 ? [V(xo, o.y1, o.z0), V(xo, o.y1, o.z1), V(xi, o.y1, o.z1), V(xi, o.y1, o.z0)] : [V(xo, o.y1, o.z1), V(xo, o.y1, o.z0), V(xi, o.y1, o.z0), V(xi, o.y1, o.z1)], [uvFor(o.z0, o.y1), uvFor(o.z1, o.y1), uvFor(o.z1, o.y1 + 0.05), uvFor(o.z0, o.y1 + 0.05)]);
    // Bottom (window sill / door threshold).
    acc.quad(s > 0 ? [V(xi, o.y0, o.z0), V(xi, o.y0, o.z1), V(xo, o.y0, o.z1), V(xo, o.y0, o.z0)] : [V(xi, o.y0, o.z1), V(xi, o.y0, o.z0), V(xo, o.y0, o.z0), V(xo, o.y0, o.z1)], [uvFor(o.z0, o.y0), uvFor(o.z1, o.y0), uvFor(o.z1, o.y0 - 0.05), uvFor(o.z0, o.y0 - 0.05)]);
    // Jambs.
    for (const [z, dir] of [
      [o.z0, 1],
      [o.z1, -1],
    ] as [number, number][]) {
      const q: Quad = dir * s > 0 ? [V(xo, o.y0, z), V(xi, o.y0, z), V(xi, o.y1, z), V(xo, o.y1, z)] : [V(xi, o.y0, z), V(xo, o.y0, z), V(xo, o.y1, z), V(xi, o.y1, z)];
      acc.quad(q, [uvFor(z - 0.05 * dir, o.y0), uvFor(z, o.y0), uvFor(z, o.y1), uvFor(z - 0.05 * dir, o.y1)]);
    }
  }
}

const exteriorUV = (s: number) => (z: number, y: number): [number, number] => [liveryU(s > 0 ? -z : z), (y - CAR.sideY0) / (CAR.sideY1 - CAR.sideY0)];
const interiorUV = (z: number, y: number): [number, number] => [z / 2, y / 2];

function roofGeometry(): THREE.BufferGeometry {
  const acc = new Acc();
  const n = 12;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.PI * (1 - t);
    const x = Math.cos(a) * HW;
    const y = CAR.sideY1 + Math.sin(a) * (CAR.roofY - CAR.sideY1) * (0.75 + 0.25 * Math.sin(a));
    prof.push(new THREE.Vector2(x, y));
  }
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = prof[i];
    const b = prof[i + 1];
    const du = a.distanceTo(b);
    acc.quad([V(a.x, a.y, L), V(b.x, b.y, L), V(b.x, b.y, -L), V(a.x, a.y, -L)], [
      [u, L],
      [u + du, L],
      [u + du, -L],
      [u, -L],
    ]);
    u += du;
  }
  // End caps of the roof curve.
  for (const z of [-L, L]) {
    const shape = new THREE.Shape(prof.map((p) => new THREE.Vector2(p.x, p.y)));
    const g = new THREE.ShapeGeometry(shape);
    if (z > 0) g.translate(0, 0, z);
    else {
      g.rotateY(Math.PI);
      g.translate(0, 0, z);
    }
    acc.add(g);
  }
  // Rain gutters along the cantrail and roof vents.
  for (const s of [-1, 1]) acc.add(boxGeo(0.06, 0.06, CAR.length).translate(s * (HW + 0.02), CAR.sideY1 + 0.02, 0));
  for (const z of [-7.5, -3.8, 3.8, 7.5]) acc.add(boxGeo(0.7, 0.14, 0.9).translate(0, CAR.roofY + 0.03, z));
  // Rows of rounded ventilator cowls along both sides of the roof (doors_sides 4, 6).
  for (const s of [-1, 1])
    for (let z = -L + 1.4; z < L - 1; z += 2.05) {
      const cowl = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 10, 1, false, 0, Math.PI);
      cowl.rotateX(Math.PI / 2);
      cowl.rotateZ(-Math.PI / 2 + s * 0.35);
      cowl.translate(s * 1.28, CAR.sideY1 + 0.34, z);
      acc.add(cowl);
    }
  return acc.build();
}

function pantograph(acc: Acc, z0: number): void {
  const y0 = CAR.roofY + 0.12;
  // Base frame on insulators.
  acc.add(boxGeo(1.1, 0.08, 1.4).translate(0, y0, z0));
  for (const [x, z] of [
    [-0.45, -0.6],
    [0.45, -0.6],
    [-0.45, 0.6],
    [0.45, 0.6],
  ])
    acc.add(new THREE.CylinderGeometry(0.06, 0.07, 0.22, 8).translate(x, y0 - 0.1, z0 + z), [0.85, 0.85, 0.8]);
  // Single-arm: lower arm to knee, upper arm to head at the contact wire.
  const knee = V(0, y0 + 0.62, z0 + 0.95);
  const head = V(0, 5.3, z0 - 0.05);
  for (const x of [-0.25, 0.25]) acc.add(rodGeo(V(x, y0 + 0.05, z0 - 0.55), V(x * 0.4, knee.y, knee.z), 0.035, 6));
  acc.add(rodGeo(knee, V(0, head.y - 0.1, head.z), 0.03, 6));
  acc.add(boxGeo(1.75, 0.05, 0.08).translate(0, head.y, head.z));
  acc.add(boxGeo(0.06, 0.18, 0.06).translate(-0.6, head.y - 0.1, head.z));
  acc.add(boxGeo(0.06, 0.18, 0.06).translate(0.6, head.y - 0.1, head.z));
  // Roof HT conduit.
  acc.add(boxGeo(0.08, 0.08, 8).translate(0.55, CAR.roofY + 0.06, z0 + 4));
}

function bogie(acc: Acc, zc: number): void {
  const wr = 0.47;
  for (const dz of [-1.3, 1.3]) {
    for (const s of [-1, 1]) {
      const w = new THREE.CylinderGeometry(wr, wr, 0.13, 18);
      w.rotateZ(Math.PI / 2);
      w.translate(s * 0.82, wr, zc + dz);
      acc.add(w, [0.35, 0.33, 0.3]);
      const hub = new THREE.CylinderGeometry(0.16, 0.16, 0.18, 10);
      hub.rotateZ(Math.PI / 2);
      hub.translate(s * 0.98, wr, zc + dz);
      acc.add(hub);
    }
    const ax = new THREE.CylinderGeometry(0.08, 0.08, 1.9, 8);
    ax.rotateZ(Math.PI / 2);
    ax.translate(0, wr, zc + dz);
    acc.add(ax);
  }
  for (const s of [-1, 1]) {
    acc.add(boxGeo(0.18, 0.34, 3.4).translate(s * 1.0, 0.62, zc));
    for (const dz of [-0.7, 0.7]) acc.add(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 8).translate(s * 1.0, 0.92, zc + dz), [0.6, 0.55, 0.2]);
  }
  acc.add(boxGeo(2.1, 0.22, 0.6).translate(0, 0.72, zc));
  acc.add(boxGeo(1.6, 0.18, 0.4).translate(0, 0.92, zc));
}

function underframe(acc: Acc, rngSeed: number): void {
  let s = rngSeed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const side of [-1, 1]) acc.add(boxGeo(0.12, 0.2, CAR.length - 0.2).translate(side * (HW - 0.12), CAR.sideY0 - 0.05, 0));
  for (let z = -5.2; z < 5.2; ) {
    const len = 0.8 + r() * 1.6;
    const h = 0.35 + r() * 0.35;
    const w = 1.2 + r() * 1.6;
    const x = (r() - 0.5) * (3.2 - w);
    acc.add(boxGeo(w, h, len).translate(x, CAR.sideY0 - h / 2 - 0.02, z + len / 2));
    z += len + 0.15 + r() * 0.4;
  }
  // Brake/air pipes.
  for (const x of [-0.6, 0.3]) acc.add(rodGeo(V(x, 0.82, -L + 0.2), V(x, 0.82, L - 0.2), 0.025, 5));
}

function interior(acc: Acc, steel: Acc, lights: Acc, isCab: boolean): void {
  const floor: [number, number, number] = [0.22, 0.23, 0.24];
  const seat: [number, number, number] = [0.8, 0.82, 0.85];
  const ceiling: [number, number, number] = [1.0, 1.0, 0.98];
  const zStart = isCab ? -L + 2.2 : -L + 0.1;
  // Floor and ceiling.
  acc.quad([V(-IN, CAR.floorY, L - 0.1), V(IN, CAR.floorY, L - 0.1), V(IN, CAR.floorY, zStart), V(-IN, CAR.floorY, zStart)], [
    [0, 0],
    [1.8, 0],
    [1.8, 10],
    [0, 10],
  ], floor);
  acc.quad([V(-IN, 3.42, zStart), V(IN, 3.42, zStart), V(IN, 3.42, L - 0.1), V(-IN, 3.42, L - 0.1)], [
    [0, 0],
    [1.8, 0],
    [1.8, 10],
    [0, 10],
  ], ceiling);
  // Interior faces of the side walls (with the same openings).
  for (const s of [-1, 1]) {
    const tmp = new Acc();
    sideWall(tmp, -s, IN, CAR.floorY, 3.42, interiorUV, zStart, L - 0.1);
    // sideWall with -s produces faces pointing outward; flip by using the mirrored side.
    // Mirroring in x moves the faces to side s; mirrored winding makes them face inwards.
    const g = tmp.build();
    g.scale(-1, 1, 1);
    g.computeVertexNormals();
    acc.add(g);
  }
  // End walls.
  for (const z of [zStart, L - 0.1]) {
    const f = z > 0 ? -1 : 1;
    acc.quad(f > 0 ? [V(-IN, CAR.floorY, z), V(IN, CAR.floorY, z), V(IN, 3.42, z), V(-IN, 3.42, z)] : [V(IN, CAR.floorY, z), V(-IN, CAR.floorY, z), V(-IN, 3.42, z), V(IN, 3.42, z)], [
      [0, 0],
      [1.8, 0],
      [1.8, 1.1],
      [0, 1.1],
    ]);
  }
  // Transverse bench bays between doorways: facing benches either side of the aisle.
  const bays: number[] = [];
  const secs = [
    [zStart + 0.3, CAR.doors[0] - CAR.doorW / 2 - 0.35],
    [CAR.doors[0] + CAR.doorW / 2 + 0.35, CAR.doors[1] - CAR.doorW / 2 - 0.35],
    [CAR.doors[1] + CAR.doorW / 2 + 0.35, CAR.doors[2] - CAR.doorW / 2 - 0.35],
    [CAR.doors[2] + CAR.doorW / 2 + 0.35, L - 0.4],
  ];
  for (const [a, b] of secs) {
    const n = Math.max(1, Math.floor((b - a) / 1.7));
    for (let i = 0; i < n; i++) bays.push(a + ((b - a) * (i + 0.5)) / n);
  }
  for (const zc of bays) {
    for (const facing of [-1, 1]) {
      const z = zc + facing * 0.55;
      for (const s of [-1, 1]) {
        const x = s * (IN - 0.72);
        // Second-class benches are brushed stainless steel with a slatted, slightly reclined back.
        steel.add(boxGeo(1.3, 0.035, 0.46).translate(x, CAR.floorY + 0.44, z), seat);
        steel.add(boxGeo(1.3, 0.05, 0.06).translate(x, CAR.floorY + 0.42, z - facing * 0.2), seat);
        for (let k = 0; k < 4; k++) {
          const b = boxGeo(1.3, 0.1, 0.025);
          b.rotateX(-facing * 0.12);
          b.translate(x, CAR.floorY + 0.56 + k * 0.13, z + facing * (0.22 + k * 0.016));
          steel.add(b, seat);
        }
        acc.add(boxGeo(1.2, 0.4, 0.04).translate(x, CAR.floorY + 0.2, z - facing * 0.18), [0.3, 0.31, 0.33]);
        for (const lx of [-0.55, 0.55]) steel.add(boxGeo(0.04, 0.44, 0.04).translate(x + lx, CAR.floorY + 0.22, z), [0.5, 0.5, 0.52]);
      }
    }
    for (const s of [-1, 1]) {
      // Luggage racks above the windows.
      acc.add(boxGeo(0.35, 0.03, 1.5).translate(s * (IN - 0.2), 3.02, zc), [0.75, 0.75, 0.75]);
      steel.add(rodGeo(V(s * 0.42, CAR.floorY, zc), V(s * 0.42, 3.42, zc), 0.02, 6));
    }
  }
  // Door poles, ceiling grab rails with hanging handles, fans and tube lights.
  for (const d of CAR.doors) for (const s of [-1, 1]) steel.add(rodGeo(V(s * (HW - 0.18), CAR.floorY, d), V(s * (HW - 0.18), CAR.doorY1, d), 0.022, 8));
  for (const x of [-0.42, 0.42]) {
    steel.add(rodGeo(V(x, 3.2, zStart + 0.3), V(x, 3.2, L - 0.3), 0.016, 6));
    for (let z = zStart + 0.6; z < L - 0.4; z += 0.55) steel.add(boxGeo(0.012, 0.22, 0.08).translate(x, 3.07, z), [0.9, 0.9, 0.9]);
  }
  for (let z = zStart + 1.5; z < L - 1; z += 2.4) {
    acc.add(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10).translate(0, 3.35, z), [0.9, 0.9, 0.9]);
    for (let k = 0; k < 3; k++) {
      const b = boxGeo(0.34, 0.01, 0.07);
      b.translate(0.22, 3.3, 0);
      b.rotateY((k / 3) * Math.PI * 2 + z);
      b.translate(0, 0, z);
      acc.add(b, [0.85, 0.85, 0.85]);
    }
  }
  for (const x of [-0.95, 0.95]) lights.add(boxGeo(0.06, 0.04, CAR.length - (isCab ? 3 : 1)).translate(x, 3.39, isCab ? 1.1 : 0));
}

function cabFront(acc: Acc, glass: Acc, head: Acc, tail: Acc, metal: Acc): void {
  const zf = -L - 0.18;
  const U = (x: number, y: number): [number, number] => [(HW - x) / (2 * HW), (y - 0.9) / 3.2];
  // Lower vertical face, raked upper face, curved top edge.
  const yK = 2.22;
  const zTop = zf + 0.2;
  acc.quad([V(HW, 0.9, zf), V(-HW, 0.9, zf), V(-HW, yK, zf), V(HW, yK, zf)], [U(HW, 0.9), U(-HW, 0.9), U(-HW, yK), U(HW, yK)]);
  acc.quad([V(HW, yK, zf), V(-HW, yK, zf), V(-HW, 3.62, zTop), V(HW, 3.62, zTop)], [U(HW, yK), U(-HW, yK), U(-HW, 3.62), U(HW, 3.62)]);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI;
    const a1 = ((i + 1) / n) * Math.PI;
    const p = (a: number) => V(Math.cos(a) * HW, 3.62 + Math.sin(a) * 0.4, zTop + Math.sin(a) * 0.12);
    const pa = p(a0);
    const pb = p(a1);
    acc.quad([pa, pb, V(pb.x, pb.y, -L + 0.3), V(pa.x, pa.y, -L + 0.3)], [U(pa.x, pa.y), U(pb.x, pb.y), U(pb.x, 4.1), U(pa.x, 4.1)]);
  }
  // Side cheeks closing the nose.
  for (const s of [-1, 1]) {
    const x = s * HW;
    const q: Quad = s > 0 ? [V(x, 0.9, zf), V(x, 0.9, -L), V(x, 3.62, -L), V(x, 3.62, zTop)] : [V(x, 0.9, -L), V(x, 0.9, zf), V(x, 3.62, zTop), V(x, 3.62, -L)];
    acc.quad(q, [U(x * 0.98, 0.95), U(x * 0.98, 0.95), U(x * 0.98, 3.5), U(x * 0.98, 3.5)]);
  }
  // Windscreens (glass slightly proud of the raked face).
  const rake = (y: number) => zf + ((y - yK) / (3.62 - yK)) * (zTop - zf) - 0.012;
  for (const s of [-1, 1]) {
    const cx = s * 0.78;
    const y0 = 2.36;
    const y1 = 3.24;
    glass.quad([V(cx + 0.6, y0, rake(y0)), V(cx - 0.6, y0, rake(y0)), V(cx - 0.6, y1, rake(y1)), V(cx + 0.6, y1, rake(y1))], [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    // Wiper.
    metal.add(boxGeo(0.03, 0.62, 0.02).rotateZ(s * 0.5).translate(cx - s * 0.05, 2.7, rake(2.7) - 0.02));
  }
  // Headlight cluster on the roof front, marker lamps in the black band.
  metal.add(boxGeo(0.62, 0.3, 0.3).translate(0, 3.98, zTop + 0.05), [0.25, 0.25, 0.25]);
  for (const x of [-0.14, 0.14]) {
    const d = new THREE.CircleGeometry(0.1, 16);
    d.rotateY(Math.PI);
    d.translate(x, 3.98, zTop - 0.11);
    head.add(d);
  }
  for (const s of [-1, 1]) {
    const d = new THREE.CircleGeometry(0.1, 16);
    d.rotateY(Math.PI);
    d.translate(s * 1.1, 1.97, zf - 0.012);
    head.add(d.clone());
    const t = new THREE.CircleGeometry(0.08, 14);
    t.rotateY(Math.PI);
    t.translate(s * 1.33, 1.97, zf - 0.013);
    tail.add(t);
  }
  // Buffers, coupler, pilot grille, horns.
  for (const s of [-1, 1]) {
    const b = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16);
    b.rotateX(Math.PI / 2);
    b.translate(s * 0.95, 1.12, zf - 0.42);
    metal.add(b, [0.55, 0.55, 0.55]);
    const st = new THREE.CylinderGeometry(0.08, 0.1, 0.4, 10);
    st.rotateX(Math.PI / 2);
    st.translate(s * 0.95, 1.12, zf - 0.2);
    metal.add(st);
    metal.add(new THREE.CylinderGeometry(0.05, 0.08, 0.26, 8).rotateX(-Math.PI / 2).translate(s * 1.45, 4.12, zTop + 0.2), [0.4, 0.4, 0.4]);
  }
  metal.add(boxGeo(0.34, 0.3, 0.55).translate(0, 1.0, zf - 0.28));
  metal.add(boxGeo(3.1, 0.12, 0.25).translate(0, 0.86, zf - 0.08));
  for (let i = -8; i <= 8; i++) metal.add(boxGeo(0.05, 0.5, 0.06).translate(i * 0.17, 0.55, zf - 0.12));
  metal.add(boxGeo(2.9, 0.08, 0.08).translate(0, 0.33, zf - 0.12));
  // Driver's cab interior (behind the windscreen): dark console.
  metal.add(boxGeo(3.3, 0.9, 1.4).translate(0, 1.7, -L + 0.8), [0.15, 0.15, 0.16]);
}

/** Inner faces of both side walls (with the window and door openings) from z0 to z1, up to y1. */
export function interiorWalls(z0: number, z1: number, y1: number): THREE.BufferGeometry {
  const acc = new Acc();
  for (const s of [-1, 1]) {
    const tmp = new Acc();
    sideWall(tmp, -s, IN, CAR.floorY, y1, interiorUV, z0, z1);
    const g = tmp.build();
    g.scale(-1, 1, 1);
    g.computeVertexNormals();
    acc.add(g);
  }
  return acc.build();
}

/** `opts.interior: false` leaves out the simple interior (the ridden car has its own). */
export function buildCar(type: CarType, seed = 1, opts: { interior?: boolean } = {}): CarParts {
  const body = new Acc();
  const interiorAcc = new Acc();
  const steel = new Acc();
  const metal = new Acc();
  const lights = new Acc();
  const roofAcc = new Acc();
  const isCab = type === 'cab';
  for (const s of [-1, 1]) {
    sideWall(body, s, HW, CAR.sideY0, CAR.sideY1, exteriorUV(s), isCab ? -L + 0.02 : -L, L);
    reveals(body, s, exteriorUV(s));
    // Window bars (steel) across each window opening.
    for (const w of windowPositions()) {
      if (isCab && w < -L + 2.2) continue;
      const bar: [number, number, number] = [0.62, 0.63, 0.65];
      for (const y of [2.22, 2.4, 2.58, 2.76, 2.92]) steel.add(boxGeo(0.012, 0.012, WIN_W).translate(s * (HW - 0.03), y, w), bar);
      for (const dz of [-0.25, 0.25]) steel.add(boxGeo(0.012, CAR.winY1 - CAR.winY0, 0.012).translate(s * (HW - 0.03), (CAR.winY0 + CAR.winY1) / 2, w + dz), bar);
    }
    // Footsteps below the doorways.
    for (const d of CAR.doors) metal.add(boxGeo(0.14, 0.04, CAR.doorW - 0.1).translate(s * (HW + 0.04), 1.08, d), [0.3, 0.3, 0.3]);
    // Lower skirt curving under the body.
    body.quad(
      s > 0 ? [V(HW - 0.1, CAR.sideY0 - 0.12, L), V(HW - 0.1, CAR.sideY0 - 0.12, -L), V(HW, CAR.sideY0, -L), V(HW, CAR.sideY0, L)] : [V(-HW + 0.1, CAR.sideY0 - 0.12, -L), V(-HW + 0.1, CAR.sideY0 - 0.12, L), V(-HW, CAR.sideY0, L), V(-HW, CAR.sideY0, -L)],
      [
        [0.5, 0.01],
        [0.5, 0.01],
        [0.5, 0.02],
        [0.5, 0.02],
      ],
    );
  }
  // Car ends (dark), except the cab end which gets the yellow front.
  for (const z of isCab ? [L] : [-L, L]) {
    const f = z > 0 ? 1 : -1;
    const q: Quad = f > 0 ? [V(-HW, CAR.sideY0 - 0.1, z), V(HW, CAR.sideY0 - 0.1, z), V(HW, CAR.sideY1, z), V(-HW, CAR.sideY1, z)] : [V(HW, CAR.sideY0 - 0.1, z), V(-HW, CAR.sideY0 - 0.1, z), V(-HW, CAR.sideY1, z), V(HW, CAR.sideY1, z)];
    // Painted body colour (sampled from the plain band above the cantrail stripe).
    body.quad(q, [
      [0.5, 0.985],
      [0.52, 0.985],
      [0.52, 0.99],
      [0.5, 0.99],
    ]);
    // End door window and a couple of hoses between cars.
    metal.add(boxGeo(0.7, 0.9, 0.02).translate(0, 2.55, z + f * 0.012), [0.2, 0.2, 0.22]);
    for (const x of [-0.9, 0.9]) metal.add(rodGeo(V(x, 1.0, z), V(x * 0.8, 0.8, z + f * 0.28), 0.04, 5), [0.4, 0.4, 0.4]);
  }
  if (opts.interior !== false) interior(interiorAcc, steel, lights, isCab);
  windowShutters(metal, seed, isCab);
  underframe(metal, seed * 7 + 3);
  bogie(metal, -7.25);
  bogie(metal, 7.25);
  if (type === 'motor') pantograph(metal, 1.5);
  const roof = roofGeometry();
  void roofAcc;
  const parts: CarParts = {
    body: body.build(),
    roof,
    interior: interiorAcc.build(),
    metal: metal.build(),
    steel: steel.build(),
    lights: lights.build(),
    doors: doorLeaves(),
  };
  if (isCab) {
    const cab = new Acc();
    const glass = new Acc();
    const head = new Acc();
    const tail = new Acc();
    cabFront(cab, glass, head, tail, metal);
    parts.metal = metal.build();
    parts.cab = cab.build();
    parts.glass = glass.build();
    parts.headLamps = head.build();
    parts.tailLamps = tail.build();
  }
  return parts;
}
