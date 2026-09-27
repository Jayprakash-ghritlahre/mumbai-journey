import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEVA, LATIN, fillFitted, signQuad, type AtlasRect } from '../../gfx/Signage';
import type { Ctx } from '../../gfx/TextureFactory';

/**
 * Procedural street furniture of South Mumbai, built from primitives with vertex colours.
 * Every prop is split into buckets so each can be drawn with one shared material:
 *   paint (dielectric), metal, glow (emissive lamp glass), leaf (alpha-cut foliage)
 */
export type Bucket = 'paint' | 'metal' | 'glow' | 'leaf';
export type PropGeo = Partial<Record<Bucket, THREE.BufferGeometry>>;
type RGB = [number, number, number];

export const C = {
  black: [0.03, 0.03, 0.03] as RGB,
  cast: [0.045, 0.045, 0.045] as RGB,
  steel: [0.62, 0.64, 0.66] as RGB,
  galv: [0.5, 0.52, 0.52] as RGB,
  white: [0.88, 0.87, 0.83] as RGB,
  whiteDirty: [0.74, 0.72, 0.67] as RGB,
  concrete: [0.6, 0.58, 0.54] as RGB,
  red: [0.55, 0.06, 0.04] as RGB,
  postRed: [0.62, 0.05, 0.04] as RGB,
  green: [0.07, 0.26, 0.13] as RGB,
  yellow: [0.85, 0.62, 0.05] as RGB,
  orange: [0.95, 0.35, 0.03] as RGB,
  blue: [0.06, 0.18, 0.5] as RGB,
  purple: [0.35, 0.07, 0.45] as RGB,
  wood: [0.35, 0.22, 0.12] as RGB,
  soil: [0.2, 0.14, 0.09] as RGB,
  glass: [0.2, 0.22, 0.24] as RGB,
  warm: [1, 0.86, 0.62] as RGB,
};

/** Accumulates coloured primitives into buckets. */
export class Kit {
  private parts: Record<Bucket, THREE.BufferGeometry[]> = { paint: [], metal: [], glow: [], leaf: [] };

  private push(bucket: Bucket, g: THREE.BufferGeometry, color: RGB): this {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ng.deleteAttribute(k);
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    const n = ng.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(color, i * 3);
    ng.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    this.parts[bucket].push(ng);
    return this;
  }

  add(bucket: Bucket, g: THREE.BufferGeometry, color: RGB): this {
    return this.push(bucket, g, color);
  }

  box(bucket: Bucket, w: number, h: number, d: number, x: number, y: number, z: number, color: RGB, ry = 0, rx = 0, rz = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    return this.push(bucket, g.translate(x, y, z), color);
  }

  cyl(bucket: Bucket, r0: number, r1: number, h: number, x: number, y: number, z: number, color: RGB, seg = 10, open = false): this {
    return this.push(bucket, new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(x, y + h / 2, z), color);
  }

  sphere(bucket: Bucket, r: number, x: number, y: number, z: number, color: RGB, sx = 1, sy = 1, sz = 1, seg = 10): this {
    return this.push(bucket, new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)).scale(sx, sy, sz).translate(x, y, z), color);
  }

  /** Cylinder between two points. */
  rod(bucket: Bucket, a: THREE.Vector3, b: THREE.Vector3, r: number, color: RGB, seg = 6): this {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return this.push(bucket, g, color);
  }

  /** Tube through points. */
  tube(bucket: Bucket, pts: THREE.Vector3[], r: number, color: RGB, seg = 6): this {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    return this.push(bucket, new THREE.TubeGeometry(curve, Math.max(4, pts.length * 4), r, seg, false), color);
  }

  build(): PropGeo {
    const out: PropGeo = {};
    for (const k of Object.keys(this.parts) as Bucket[]) {
      if (!this.parts[k].length) continue;
      const g = mergeGeometries(this.parts[k], false)!;
      g.computeBoundingSphere();
      out[k] = g;
    }
    return out;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Black cast-iron heritage lamp post with a single lantern (V.N. Road, Churchgate precinct). */
export function heritageLamp(): PropGeo {
  const k = new Kit();
  k.cyl('paint', 0.2, 0.17, 0.5, 0, 0, 0, C.cast, 8);
  k.cyl('paint', 0.13, 0.11, 0.25, 0, 0.5, 0, C.cast, 8);
  k.cyl('paint', 0.075, 0.06, 3.1, 0, 0.75, 0, C.cast, 8);
  k.cyl('paint', 0.1, 0.1, 0.12, 0, 3.8, 0, C.cast, 8);
  // Lantern: tapered cage with glass panels and a cap.
  k.cyl('paint', 0.13, 0.16, 0.08, 0, 3.92, 0, C.cast, 6);
  k.cyl('glow', 0.15, 0.2, 0.52, 0, 4.0, 0, C.warm, 6, true);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.rod('paint', V(Math.cos(a) * 0.15, 4.0, Math.sin(a) * 0.15), V(Math.cos(a) * 0.205, 4.52, Math.sin(a) * 0.205), 0.012, C.cast, 4);
  }
  k.cyl('paint', 0.26, 0.05, 0.2, 0, 4.52, 0, C.cast, 6);
  k.sphere('paint', 0.05, 0, 4.78, 0, C.cast, 1, 1.4, 1, 6);
  return k.build();
}

/** Stainless steel bollard with a slanted top. */
export function bollard(): PropGeo {
  const k = new Kit();
  const g = new THREE.CylinderGeometry(0.085, 0.085, 0.95, 10);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + p.getX(i) * 0.35);
  g.computeVertexNormals();
  k.add('metal', g.translate(0, 0.475, 0), C.steel);
  k.cyl('paint', 0.11, 0.11, 0.04, 0, 0, 0, C.concrete, 10);
  return k.build();
}

/** White concrete planter box with a clipped shrub (V.N. Road kerb). */
export function planter(): PropGeo {
  const k = new Kit();
  k.box('paint', 0.95, 0.72, 0.95, 0, 0.36, 0, C.white);
  k.box('paint', 1.0, 0.06, 1.0, 0, 0.73, 0, C.whiteDirty);
  k.box('paint', 0.82, 0.04, 0.82, 0, 0.7, 0, C.soil);
  // Shrub: crossed leaf cards around a dense core.
  for (let i = 0; i < 5; i++) {
    const g = new THREE.PlaneGeometry(1.0, 0.8);
    g.rotateY((i / 5) * Math.PI);
    g.rotateZ((i - 2) * 0.12);
    k.add('leaf', g.translate(0, 1.1, 0), [0.9, 1, 0.85]);
  }
  k.sphere('leaf', 0.38, 0, 1.05, 0, [0.7, 0.8, 0.6], 1, 0.75, 1, 8);
  return k.build();
}

/** BEST / BMC electrical feeder pillar (1.3 m) covered in posters. */
export function feederPillar(color: RGB): PropGeo {
  const k = new Kit();
  k.box('paint', 0.95, 0.1, 0.5, 0, 0.05, 0, C.concrete);
  k.box('paint', 0.9, 1.25, 0.45, 0, 0.72, 0, color);
  k.box('paint', 1.0, 0.06, 0.55, 0, 1.37, 0, color, 0, 0.12);
  // Door seam and posters.
  k.box('paint', 0.01, 1.1, 0.46, 0, 0.72, 0, C.black);
  const posters: RGB[] = [
    [0.9, 0.88, 0.8],
    [0.95, 0.85, 0.3],
    [0.85, 0.3, 0.3],
    [0.9, 0.9, 0.9],
    [0.3, 0.5, 0.85],
  ];
  for (let i = 0; i < 6; i++) {
    const w = 0.18 + (i % 3) * 0.05;
    const h = 0.24 + (i % 2) * 0.08;
    k.box('paint', w, h, 0.005, -0.25 + (i % 3) * 0.24, 0.45 + Math.floor(i / 3) * 0.4, 0.228, posters[i % posters.length]);
    k.box('paint', w, h, 0.005, 0.22 - (i % 3) * 0.2, 0.5 + Math.floor(i / 3) * 0.35, -0.228, posters[(i + 2) % posters.length]);
  }
  return k.build();
}

/** India Post red pillar box on a concrete base. */
export function postBox(): PropGeo {
  const k = new Kit();
  k.box('paint', 0.62, 0.35, 0.62, 0, 0.175, 0, C.concrete);
  k.cyl('paint', 0.26, 0.26, 1.05, 0, 0.35, 0, C.postRed, 16);
  k.cyl('paint', 0.3, 0.3, 0.07, 0, 1.4, 0, C.postRed, 16);
  k.sphere('paint', 0.28, 0, 1.47, 0, C.postRed, 1, 0.45, 1, 16);
  k.box('paint', 0.22, 0.03, 0.05, 0, 1.2, 0.25, C.black);
  k.box('paint', 0.3, 0.12, 0.01, 0, 1.0, 0.262, [0.85, 0.75, 0.2]);
  return k.build();
}

/** Stainless inverted-U barrier of the Marine Drive promenade. */
export function uHoop(): PropGeo {
  const k = new Kit();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * (i / 12);
    pts.push(V(Math.cos(a) * 0.38, 0.62 + Math.sin(a) * 0.3, 0));
  }
  k.tube('metal', [V(0.38, 0, 0), ...pts, V(-0.38, 0, 0)], 0.028, C.steel, 6);
  return k.build();
}

/** Tall Marine Drive street light: grey pole with a twin-arm head. `both` puts arms on both sides. */
export function twinArmLamp(both: boolean, height = 11.5): PropGeo {
  const k = new Kit();
  k.cyl('paint', 0.2, 0.16, 0.9, 0, 0, 0, C.galv, 10);
  k.cyl('metal', 0.13, 0.075, height - 0.9, 0, 0.9, 0, C.galv, 10);
  const top = height;
  const arm = (s: number) => {
    k.tube('metal', [V(0, top - 0.6, 0), V(s * 0.6, top + 0.15, 0), V(s * 1.5, top + 0.45, 0), V(s * 2.1, top + 0.45, 0)], 0.05, C.galv, 6);
    k.box('paint', 0.75, 0.13, 0.3, s * 2.3, top + 0.42, 0, C.galv);
    k.box('glow', 0.62, 0.02, 0.22, s * 2.3, top + 0.345, 0, C.warm);
  };
  arm(1);
  if (both) arm(-1);
  else {
    // Single-sided lights on the promenade carry a second head on the same side, lower.
    k.tube('metal', [V(0, top - 1.8, 0), V(0.9, top - 1.3, 0), V(1.4, top - 1.25, 0)], 0.045, C.galv, 6);
    k.box('paint', 0.6, 0.12, 0.26, 1.55, top - 1.28, 0, C.galv);
    k.box('glow', 0.5, 0.02, 0.2, 1.55, top - 1.345, 0, C.warm);
  }
  return k.build();
}

/** Four-legged concrete tetrapod (legs ~1 m). */
export function tetrapodGeometry(): THREE.BufferGeometry {
  const legs = [
    V(0, 1, 0),
    V(0.9428, -0.3333, 0),
    V(-0.4714, -0.3333, 0.8165),
    V(-0.4714, -0.3333, -0.8165),
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const d of legs) {
    const g = new THREE.CylinderGeometry(0.28, 0.46, 1.05, 6, 1, false);
    g.translate(0, 0.525, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d));
    parts.push(g.toNonIndexed());
  }
  parts.push(new THREE.IcosahedronGeometry(0.52, 0).toNonIndexed());
  const g = mergeGeometries(parts.map((p) => {
    p.deleteAttribute('uv');
    return p;
  }))!;
  // Slightly irregular, chipped look.
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 5.7 - y * 2.1) * 0.03;
    p.setXYZ(i, x * (1 + n), y * (1 + n), z * (1 + n));
  }
  g.computeVertexNormals();
  // Planar UVs for the concrete texture.
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) + p.getZ(i) * 0.7;
    uv[i * 2 + 1] = p.getY(i) + p.getZ(i) * 0.3;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Yellow water-filled plastic barricade with orange reflectors. */
export function barricade(): PropGeo {
  const k = new Kit();
  k.box('paint', 1.25, 0.18, 0.5, 0, 0.09, 0, C.yellow);
  k.box('paint', 1.15, 0.5, 0.34, 0, 0.43, 0, C.yellow);
  k.box('paint', 1.05, 0.15, 0.22, 0, 0.75, 0, C.yellow);
  for (const x of [-0.35, 0.35]) k.sphere('glow', 0.07, x, 0.9, 0, [1, 0.45, 0.05], 1, 1, 0.5, 8);
  return k.build();
}

/** Small traffic police booth with a sloping roof. */
/**
 * A police chowki: a small cabin on a plinth, solid below and glazed above, a door on the front
 * (+z), a hipped blue roof with a beacon. Its name board is added separately (chowkiBoards).
 */
export function policeChowki(): PropGeo {
  const k = new Kit();
  const W = 1.9;
  const cream: RGB = [0.86, 0.84, 0.78];
  k.box('paint', W + 0.4, 0.2, W + 0.4, 0, 0.1, 0, C.concrete);
  // Dado all round, the door gap on the front.
  k.box('paint', W, 1.0, 0.1, 0, 0.7, -W / 2 + 0.05, cream);
  for (const sx of [-1, 1]) k.box('paint', 0.1, 1.0, W, sx * (W / 2 - 0.05), 0.7, 0, cream);
  k.box('paint', W - 0.8, 1.0, 0.1, -0.4, 0.7, W / 2 - 0.05, cream);
  // Corner posts, window glass, the door.
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    k.box('paint', 0.12, 1.25, 0.12, (x * (W - 0.12)) / 2, 1.82, (z * (W - 0.12)) / 2, C.blue);
  k.box('paint', W - 0.1, 1.05, 0.03, 0, 1.72, -W / 2 + 0.05, C.glass);
  for (const sx of [-1, 1]) k.box('paint', 0.03, 1.05, W - 0.1, sx * (W / 2 - 0.05), 1.72, 0, C.glass);
  k.box('paint', W - 0.8, 1.05, 0.03, -0.4, 1.72, W / 2 - 0.05, C.glass);
  k.box('paint', 0.7, 2.1, 0.05, 0.55, 1.25, W / 2 - 0.02, [0.1, 0.16, 0.34]);
  k.box('paint', W + 0.02, 0.06, W + 0.02, 0, 1.2, 0, C.blue);
  // Fascia (carries the name boards) and a hipped roof.
  k.box('paint', W + 0.1, 0.36, W + 0.1, 0, 2.62, 0, C.white);
  const roof = new THREE.ConeGeometry((W + 0.7) * Math.SQRT1_2, 0.62, 4, 1).rotateY(Math.PI / 4).translate(0, 3.11, 0);
  k.add('paint', roof, [0.1, 0.2, 0.5]);
  k.cyl('paint', 0.07, 0.07, 0.08, 0, 3.38, 0, C.black, 8);
  k.cyl('glow', 0.06, 0.05, 0.12, 0, 3.46, 0, [0.25, 0.45, 1], 8);
  k.box('glow', W - 0.2, 0.02, W - 0.2, 0, 2.43, 0, [0.95, 0.95, 1]);
  return k.build();
}

/** Blue name board: POLICE / पोलीस चौकी. */
export function drawChowkiBoard(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#16307a';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#c62828';
  c.fillRect(0, h * 0.86, w, h * 0.14);
  c.fillStyle = '#ffffff';
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  fillFitted(c, 'POLICE', w * 0.05, h * 0.44, '800', LATIN, h * 0.5, w * 0.42);
  c.textAlign = 'right';
  fillFitted(c, 'पोलीस चौकी', w * 0.95, h * 0.44, '700', DEVA, h * 0.46, w * 0.46);
}

/** Name boards on the front and both sides of a chowki placed with matrix m. */
export function chowkiBoards(rect: AtlasRect, m: THREE.Matrix4): THREE.BufferGeometry {
  const W = 1.9;
  const faces = [0, Math.PI / 2, -Math.PI / 2].map((ry) => signQuad(rect, W - 0.1, 0.3).translate(0, 2.62, W / 2 + 0.056).rotateY(ry).applyMatrix4(m));
  return mergeGeometries(faces)!;
}

/** Roasted-corn (bhutta) seller's cart with a coal brazier and umbrella. */
export function vendorCart(): PropGeo {
  const k = new Kit();
  k.box('paint', 1.3, 0.08, 0.75, 0, 0.8, 0, C.wood);
  k.box('paint', 1.3, 0.12, 0.05, 0, 0.9, 0.36, C.wood);
  k.box('paint', 1.3, 0.12, 0.05, 0, 0.9, -0.36, C.wood);
  for (const [x, z] of [
    [-0.55, -0.3],
    [0.55, -0.3],
    [-0.55, 0.3],
    [0.55, 0.3],
  ])
    k.box('paint', 0.05, 0.8, 0.05, x, 0.4, z, C.wood);
  for (const z of [-0.42, 0.42]) {
    const w = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 12);
    w.rotateX(Math.PI / 2);
    k.add('paint', w.translate(0.3, 0.22, z), C.black);
  }
  // Brazier with glowing coals, and a heap of corn cobs.
  k.cyl('metal', 0.22, 0.26, 0.18, -0.25, 0.84, 0, C.black, 10);
  k.cyl('glow', 0.2, 0.2, 0.02, -0.25, 1.0, 0, [1, 0.35, 0.05], 10);
  for (let i = 0; i < 8; i++) k.sphere('paint', 0.05, 0.25 + (i % 4) * 0.1, 0.9, -0.15 + Math.floor(i / 4) * 0.12, [0.75, 0.62, 0.2], 3, 1, 1, 6);
  // Umbrella.
  k.rod('paint', V(0.5, 0.85, 0.3), V(0.5, 2.2, 0.3), 0.02, C.steel, 5);
  const um = new THREE.ConeGeometry(0.95, 0.35, 8, 1, true);
  k.add('paint', um.translate(0.5, 2.25, 0.3), [0.75, 0.12, 0.1]);
  return k.build();
}

/** Steel sign gantry spanning a carriageway (width w). */
export function gantry(w: number): PropGeo {
  const k = new Kit();
  for (const x of [-w / 2, w / 2]) k.cyl('metal', 0.18, 0.15, 7.2, x, 0, 0, C.galv, 10);
  k.box('metal', w + 0.4, 0.3, 0.3, 0, 7.0, 0, C.galv);
  k.box('metal', w + 0.4, 0.2, 0.2, 0, 6.4, 0, C.galv);
  for (let x = -w / 2; x < w / 2; x += 1.2) k.rod('metal', V(x, 6.4, 0), V(x + 0.6, 7.0, 0), 0.03, C.galv, 4);
  for (const x of [-w / 4, w / 4]) k.box('paint', 0.35, 0.25, 0.35, x, 6.1, 0.1, C.whiteDirty);
  return k.build();
}

/** Green BMC litter bin on a post. */
export function dustbin(): PropGeo {
  const k = new Kit();
  k.cyl('metal', 0.03, 0.03, 0.9, 0, 0, -0.2, C.galv, 6);
  k.cyl('paint', 0.2, 0.22, 0.5, 0, 0.35, 0, C.green, 12, true);
  k.cyl('paint', 0.2, 0.2, 0.02, 0, 0.35, 0, C.green, 12);
  return k.build();
}

/** A sign board on two legs (the sign face itself is an atlas quad placed separately). */
export function boardFrame(w: number, h: number, y: number): PropGeo {
  const k = new Kit();
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) k.box('metal', 0.06, y + h, 0.06, x, (y + h) / 2, -0.04, C.galv);
  k.box('paint', w + 0.06, h + 0.06, 0.04, 0, y + h / 2, -0.03, C.white);
  return k.build();
}
