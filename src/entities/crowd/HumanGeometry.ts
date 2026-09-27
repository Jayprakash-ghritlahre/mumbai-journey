import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural commuters (≈1.68 m tall, feet at y=0, facing +Z) built from lathed
 * body segments. Each vertex carries:
 *   aTag: which bone it follows (see PART) + 32 × which colour slot it takes (see REGION)
 * Animation and colouring happen in the vertex shader (CrowdMaterial).
 */
export const PART = {
  torso: 0,
  head: 1,
  thighL: 2,
  shinL: 3,
  thighR: 4,
  shinR: 5,
  upperL: 6,
  foreL: 7,
  upperR: 8,
  foreR: 9,
  skirt: 10,
  pack: 11,
  bag: 12,
} as const;

export const REGION = {
  skin: 0,
  top: 1,
  bottom: 2,
  shoes: 3,
  hair: 4,
  accent: 5,
  sleeve: 6, // top colour or skin depending on sleeve flag
  pack: 7,
  bag: 8,
  cap: 9,
  /** Long open hair / ponytail: one of the two is shown per person (aStyle.y). */
  hairLong: 10,
  hairTail: 11,
  /** Legs under a skirt are bare, in jeans they take the bottom colour (aStyle.z). */
  leg: 12,
  /** Skirt / dress hem, only shown when aStyle.z is set. */
  skirt: 13,
  /** Upper arm near the shoulder / the rest of the arm: covered for short / long sleeves (aStyle.w 1 / 2). */
  sleeveShort: 14,
  sleeveLong: 15,
} as const;

/** Joint pivots (metres) shared with the shader. */
export const JOINT = {
  hipY: 0.9,
  hipX: 0.095,
  kneeY: 0.48,
  shoulderY: 1.4,
  shoulderX: 0.195,
  elbowY: 1.11,
};

/** man: shirt and trousers; woman: salwar kurta; saree; youth: T-shirt, jeans, sneakers; girl: fitted top with jeans or a skirt. */
export type Variant = 'man' | 'woman' | 'saree' | 'youth' | 'girl';

/** Part and region share one vertex attribute (aTag = part + region × 32) to save attribute slots. */
function tag(g: THREE.BufferGeometry, part: number, region: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.attributes.position.count;
  ng.setAttribute('aTag', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part + region * 32), 1));
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'aTag'].includes(k)) ng.deleteAttribute(k);
  return ng;
}

/**
 * Lathed body segment: rings at heights `ys` with elliptical radii (rx, rz), optional
 * forward offset per ring. Caps close the ends when the end radius is > 0.
 */
function lathe(ys: number[], rx: number[], rz: number[], seg: number, x = 0, zOff: number[] = []): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const rings = ys.length;
  for (let r = 0; r < rings; r++)
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      pos.push(x + Math.sin(a) * rx[r], ys[r], Math.cos(a) * rz[r] + (zOff[r] ?? 0));
    }
  for (let r = 0; r < rings - 1; r++)
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s;
      const b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  // End caps.
  const cap = (r: number, up: boolean) => {
    if (rx[r] < 1e-3) return;
    const c = pos.length / 3;
    pos.push(x, ys[r], zOff[r] ?? 0);
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s;
      if (up) idx.push(c, a, a + 1);
      else idx.push(c, a + 1, a);
    }
  };
  cap(0, false);
  cap(rings - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** Box rotated about its own centre, then placed. */
function obox(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  return g.translate(x, y, z);
}

function sphere(r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, w = 8, h = 6): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h).scale(sx, sy, sz).translate(x, y, z);
}

export function buildHuman(variant: Variant, lod: 0 | 1): THREE.BufferGeometry {
  if (variant === 'youth' || variant === 'girl') return buildYoung(variant, lod);
  const parts: THREE.BufferGeometry[] = [];
  const hi = lod === 0;
  const seg = hi ? 10 : 5;
  const lseg = hi ? 8 : 4;
  const J = JOINT;
  const add = (g: THREE.BufferGeometry, part: number, region: number) => parts.push(tag(g, part, region));
  const man = variant === 'man';

  // ---- Head: lathed skull with jaw, hair shell, nose and ears ----
  const hy = [1.475, 1.5, 1.528, 1.56, 1.6, 1.64, 1.672, 1.69];
  const hw = [0.042, 0.05, 0.068, 0.076, 0.079, 0.072, 0.052, 0.0];
  const hd = [0.045, 0.062, 0.084, 0.094, 0.097, 0.09, 0.066, 0.0];
  add(lathe(hi ? hy : [1.475, 1.53, 1.6, 1.66, 1.69], hi ? hw : [0.042, 0.07, 0.079, 0.065, 0], hi ? hd : [0.045, 0.085, 0.097, 0.08, 0], hi ? 12 : 6, 0, hi ? [0, 0.012, 0.014, 0.01, 0, -0.004, -0.006, -0.006] : []), PART.head, REGION.skin);
  // Hair: covers the crown and the back of the head.
  const hairY = man ? [1.575, 1.61, 1.645, 1.678, 1.702] : [1.5, 1.58, 1.63, 1.672, 1.7];
  const hairW = man ? [0.083, 0.086, 0.079, 0.058, 0.0] : [0.07, 0.086, 0.082, 0.06, 0.0];
  const hairD = man ? [0.1, 0.103, 0.096, 0.07, 0.0] : [0.09, 0.104, 0.098, 0.072, 0.0];
  const hair = lathe(hairY, hairW, hairD, hi ? 12 : 6, 0, [-0.008, -0.01, -0.012, -0.012, -0.01]);
  // Push the hairline back on the face side so the forehead shows.
  const hp = hair.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    const z = hp.getZ(i);
    const y = hp.getY(i);
    if (z > 0.04 && y < 1.64) hp.setZ(i, z - (1.64 - y) * 0.9);
  }
  hair.computeVertexNormals();
  add(hair, PART.head, REGION.hair);
  if (hi) {
    add(sphere(0.017, 0, 1.566, 0.093, 0.9, 1.35, 1.2, 6, 5), PART.head, REGION.skin); // nose
    for (const s of [-1, 1]) add(sphere(0.02, s * 0.079, 1.585, -0.004, 0.45, 1, 0.8, 6, 4), PART.head, REGION.skin); // ears
  }
  if (!man) {
    // Hair bun / plait.
    add(sphere(0.05, 0, 1.585, -0.1, 1, 0.95, 0.85, hi ? 8 : 5, hi ? 6 : 4), PART.head, REGION.hair);
    add(obox(0.07, 0.3, 0.035, 0, 1.4, -0.105, 0.12), PART.torso, REGION.hair);
  }
  // Neck.
  add(lathe([1.43, 1.47, 1.5], [0.045, 0.042, 0.042], [0.045, 0.043, 0.043], lseg), PART.torso, REGION.skin);

  // ---- Torso ----
  if (variant === 'saree') {
    // Blouse and bare midriff, then the pleated drape to the ankles.
    add(lathe([1.08, 1.18, 1.3, 1.38, 1.44], [0.135, 0.14, 0.155, 0.165, 0.12], [0.095, 0.1, 0.11, 0.1, 0.08], seg), PART.torso, REGION.accent);
    add(lathe([0.9, 0.98, 1.08], [0.15, 0.14, 0.135], [0.11, 0.1, 0.095], seg), PART.torso, REGION.skin);
    add(lathe([0.04, 0.3, 0.6, 0.85, 0.96], [0.23, 0.21, 0.19, 0.165, 0.155], [0.19, 0.17, 0.14, 0.12, 0.115], seg + 2), PART.skirt, REGION.top);
    // Pallu: from the waist across the chest and over the left shoulder, hanging down the back.
    add(obox(0.24, 0.5, 0.03, 0.02, 1.2, 0.118, -0.12, 0, 0.55), PART.torso, REGION.top);
    add(obox(0.13, 0.08, 0.26, 0.13, 1.43, 0.0, 0, 0, -0.2), PART.torso, REGION.top);
    add(obox(0.22, 0.75, 0.03, 0.08, 1.05, -0.125, 0.06, 0, -0.08), PART.torso, REGION.top);
  } else {
    const sh = man ? 0.188 : 0.165;
    const ys = [0.86, 0.96, 1.08, 1.2, 1.3, 1.38, 1.43, 1.46];
    const rx = man ? [0.16, 0.152, 0.155, 0.168, 0.178, sh, 0.15, 0.07] : [0.165, 0.14, 0.135, 0.15, 0.158, sh, 0.13, 0.065];
    const rz = man ? [0.11, 0.105, 0.108, 0.118, 0.122, 0.105, 0.085, 0.055] : [0.115, 0.1, 0.1, 0.115, 0.118, 0.095, 0.08, 0.05];
    const zo = man ? [0, 0, 0.004, 0.01, 0.012, 0, -0.008, -0.005] : [0, 0, 0.004, 0.014, 0.014, 0, -0.008, -0.005];
    add(lathe(hi ? ys : [0.86, 1.08, 1.3, 1.43, 1.46], hi ? rx : [rx[0], rx[2], rx[4], rx[6], rx[7]], hi ? rz : [rz[0], rz[2], rz[4], rz[6], rz[7]], seg, 0, hi ? zo : []), PART.torso, REGION.top);
    if (man) {
      // Collar, placket and belt.
      add(lathe([1.44, 1.475], [0.075, 0.062], [0.07, 0.058], lseg, 0, [0.004, 0.006]), PART.torso, REGION.top);
      if (hi) add(box(0.018, 0.4, 0.01, 0, 1.22, 0.122), PART.torso, REGION.top);
      add(lathe([0.855, 0.9], [0.163, 0.161], [0.113, 0.111], seg), PART.torso, REGION.shoes);
    } else {
      // Kurta flares to the knees; dupatta across the shoulders and down the front.
      add(lathe([0.5, 0.62, 0.76, 0.88], [0.215, 0.205, 0.185, 0.168], [0.16, 0.15, 0.135, 0.118], seg + 2), PART.skirt, REGION.top);
      add(obox(0.34, 0.05, 0.22, 0, 1.4, 0.0), PART.torso, REGION.accent);
      add(obox(0.09, 0.55, 0.02, 0.1, 1.13, 0.125, 0.08), PART.torso, REGION.accent);
      add(obox(0.09, 0.55, 0.02, -0.1, 1.13, 0.125, 0.08), PART.torso, REGION.accent);
    }
  }

  // ---- Legs ----
  for (const s of [-1, 1]) {
    const thigh = s < 0 ? PART.thighL : PART.thighR;
    const shin = s < 0 ? PART.shinL : PART.shinR;
    const x = s * J.hipX;
    const k = man ? 1 : 0.88;
    add(lathe([J.kneeY, 0.62, 0.78, J.hipY + 0.02], [0.056 * k, 0.066 * k, 0.078 * k, 0.085 * k], [0.058 * k, 0.07 * k, 0.08 * k, 0.085 * k], lseg, x), thigh, REGION.bottom);
    const shinRegion = variant === 'saree' ? REGION.skin : REGION.bottom;
    add(lathe([0.075, 0.16, 0.34, J.kneeY + 0.02], [0.045 * k, 0.042 * k, 0.052 * k, 0.056 * k], [0.047 * k, 0.045 * k, 0.058 * k, 0.058 * k], lseg, x, [0, 0, -0.006, 0]), shin, shinRegion);
    // Shoe: rounded toe.
    add(lathe([0.0, 0.03, 0.075], [0.047, 0.047, 0.04], [0.12, 0.12, 0.09], lseg, x, [0.045, 0.045, 0.03]), shin, REGION.shoes);
  }

  // ---- Arms ----
  const shoulderX = man ? J.shoulderX : J.shoulderX - 0.02;
  for (const s of [-1, 1]) {
    const upper = s < 0 ? PART.upperL : PART.upperR;
    const fore = s < 0 ? PART.foreL : PART.foreR;
    const x = s * shoulderX;
    const k = man ? 1 : 0.85;
    add(lathe([J.elbowY, 1.24, J.shoulderY + 0.03], [0.04 * k, 0.047 * k, 0.052 * k], [0.042 * k, 0.05 * k, 0.056 * k], lseg, x), upper, variant === 'saree' ? REGION.skin : REGION.top);
    add(lathe([0.875, 0.97, J.elbowY + 0.01], [0.028 * k, 0.034 * k, 0.038 * k], [0.03 * k, 0.037 * k, 0.041 * k], lseg, x), fore, man ? REGION.sleeve : REGION.skin);
    // Hand.
    add(sphere(0.04 * k, x, 0.835, 0.008, 0.72, 1.35, 0.5, hi ? 7 : 4, hi ? 5 : 3), fore, REGION.skin);
    if (!man && hi) add(lathe([0.9, 0.925], [0.036, 0.036], [0.038, 0.038], 6, x), fore, REGION.accent); // bangles
  }

  // ---- Accessories (shown per instance) ----
  add(lathe([1.0, 1.08, 1.34, 1.42], [0.13, 0.15, 0.15, 0.12], [0.07, 0.085, 0.08, 0.06], lseg, 0, [-0.19, -0.2, -0.2, -0.18]), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, 0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, -0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  add(box(0.26, 0.2, 0.08, man ? -0.22 : 0.21, 0.98, 0.0), PART.bag, REGION.bag);
  add(obox(0.03, 0.62, 0.015, man ? -0.07 : 0.07, 1.2, 0.12, 0, 0, man ? 0.62 : -0.62), PART.bag, REGION.bag);
  add(obox(0.03, 0.5, 0.015, man ? -0.07 : 0.07, 1.22, -0.105, 0, 0, man ? 0.62 : -0.62), PART.bag, REGION.bag);
  // Cap (white Gandhi topi / dark cap) — shown per instance.
  if (man) add(lathe([1.66, 1.7, 1.725], [0.085, 0.082, 0.07], [0.1, 0.098, 0.03], lseg), PART.head, REGION.cap);

  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Shared head (skull, nose, ears) and neck. */
function headAndNeck(add: (g: THREE.BufferGeometry, part: number, region: number) => void, hi: boolean, lseg: number): void {
  const hy = [1.475, 1.5, 1.528, 1.56, 1.6, 1.64, 1.672, 1.69];
  const hw = [0.042, 0.05, 0.068, 0.076, 0.079, 0.072, 0.052, 0.0];
  const hd = [0.045, 0.062, 0.084, 0.094, 0.097, 0.09, 0.066, 0.0];
  add(lathe(hi ? hy : [1.475, 1.53, 1.6, 1.66, 1.69], hi ? hw : [0.042, 0.07, 0.079, 0.065, 0], hi ? hd : [0.045, 0.085, 0.097, 0.08, 0], hi ? 12 : 6, 0, hi ? [0, 0.012, 0.014, 0.01, 0, -0.004, -0.006, -0.006] : []), PART.head, REGION.skin);
  if (hi) {
    add(sphere(0.017, 0, 1.566, 0.093, 0.9, 1.35, 1.2, 6, 5), PART.head, REGION.skin);
    for (const s of [-1, 1]) add(sphere(0.02, s * 0.079, 1.585, -0.004, 0.45, 1, 0.8, 6, 4), PART.head, REGION.skin);
  }
  add(lathe([1.43, 1.47, 1.5], [0.045, 0.042, 0.042], [0.045, 0.043, 0.043], lseg), PART.torso, REGION.skin);
}

/** Hair shell over the crown; `front` pushes the hairline back so the forehead shows. */
function hairShell(ys: number[], w: number[], d: number[], seg: number, front = 1.64): THREE.BufferGeometry {
  const hair = lathe(ys, w, d, seg, 0, [-0.008, -0.01, -0.012, -0.012, -0.01]);
  const hp = hair.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    const z = hp.getZ(i);
    const y = hp.getY(i);
    if (z > 0.04 && y < front) hp.setZ(i, z - (front - y) * 0.9);
  }
  hair.computeVertexNormals();
  return hair;
}

/**
 * Young Mumbaikars (college crowd, couples on the sea wall): a lad in a T-shirt, jeans and
 * sneakers, and a young woman in a fitted top with jeans or a skirt, hair open or in a ponytail.
 */
function buildYoung(variant: 'youth' | 'girl', lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hi = lod === 0;
  const seg = hi ? 10 : 5;
  const lseg = hi ? 8 : 4;
  const J = JOINT;
  const add = (g: THREE.BufferGeometry, part: number, region: number) => parts.push(tag(g, part, region));
  const lad = variant === 'youth';
  headAndNeck(add, hi, lseg);

  if (lad) {
    // Fuller, styled hair on top.
    add(hairShell([1.575, 1.615, 1.655, 1.695, 1.722], [0.084, 0.088, 0.083, 0.064, 0.0], [0.101, 0.106, 0.1, 0.078, 0.0], hi ? 12 : 6, 1.635), PART.head, REGION.hair);
    // T-shirt worn loose over the jeans, crew neck.
    const ys = [0.83, 0.96, 1.08, 1.2, 1.3, 1.38, 1.43, 1.46];
    const rx = [0.158, 0.15, 0.152, 0.165, 0.175, 0.185, 0.148, 0.068];
    const rz = [0.112, 0.106, 0.108, 0.116, 0.12, 0.104, 0.084, 0.054];
    add(lathe(hi ? ys : [0.83, 1.08, 1.3, 1.43, 1.46], hi ? rx : [rx[0], rx[2], rx[4], rx[6], rx[7]], hi ? rz : [rz[0], rz[2], rz[4], rz[6], rz[7]], seg), PART.torso, REGION.top);
    add(lathe([1.44, 1.462], [0.062, 0.056], [0.06, 0.054], lseg, 0, [0.006, 0.008]), PART.torso, REGION.accent);
    // Jeans seat below the hem.
    add(lathe([0.8, 0.86], [0.158, 0.156], [0.11, 0.11], seg), PART.torso, REGION.bottom);
  } else {
    // Crown hair reaching over the ears, then either long open hair or a ponytail.
    add(hairShell([1.49, 1.575, 1.63, 1.672, 1.702], [0.074, 0.088, 0.084, 0.062, 0.0], [0.094, 0.106, 0.1, 0.074, 0.0], hi ? 12 : 6, 1.645), PART.head, REGION.hair);
    add(obox(0.17, 0.14, 0.07, 0, 1.55, -0.075, -0.1), PART.head, REGION.hairLong);
    add(obox(0.2, 0.34, 0.05, 0, 1.36, -0.105, 0.1), PART.torso, REGION.hairLong);
    if (hi) for (const s of [-1, 1]) add(obox(0.045, 0.2, 0.03, s * 0.088, 1.43, 0.035, -0.1, 0, s * 0.08), PART.torso, REGION.hairLong);
    add(sphere(0.034, 0, 1.6, -0.105, 0.9, 1, 1, hi ? 7 : 4, hi ? 5 : 3), PART.head, REGION.hairTail);
    add(obox(0.05, 0.22, 0.04, 0, 1.47, -0.13, 0.22), PART.torso, REGION.hairTail);
    // Fitted top, a narrow waist, the waistband of the jeans / skirt.
    const ys = [0.9, 0.98, 1.08, 1.2, 1.3, 1.38, 1.43, 1.46];
    const rx = [0.148, 0.128, 0.125, 0.145, 0.154, 0.162, 0.128, 0.064];
    const rz = [0.105, 0.092, 0.092, 0.112, 0.118, 0.094, 0.078, 0.05];
    const zo = [0, 0, 0.004, 0.016, 0.016, 0, -0.008, -0.005];
    add(lathe(hi ? ys : [0.9, 1.08, 1.3, 1.43, 1.46], hi ? rx : [rx[0], rx[2], rx[4], rx[6], rx[7]], hi ? rz : [rz[0], rz[2], rz[4], rz[6], rz[7]], seg, 0, hi ? zo : []), PART.torso, REGION.top);
    add(lathe([0.8, 0.86, 0.915], [0.165, 0.162, 0.15], [0.118, 0.114, 0.106], seg), PART.torso, REGION.bottom);
    // Skirt / dress to just above the knee (hidden for jeans).
    add(lathe([0.5, 0.6, 0.74, 0.88], [0.215, 0.2, 0.182, 0.16], [0.18, 0.165, 0.145, 0.118], seg + 2), PART.skirt, REGION.skirt);
  }

  // ---- Legs ----
  for (const s of [-1, 1]) {
    const thigh = s < 0 ? PART.thighL : PART.thighR;
    const shin = s < 0 ? PART.shinL : PART.shinR;
    const x = s * J.hipX;
    const k = lad ? 0.96 : 0.84;
    const legRegion = lad ? REGION.bottom : REGION.leg;
    add(lathe([J.kneeY, 0.62, 0.78, J.hipY + 0.02], [0.055 * k, 0.064 * k, 0.076 * k, 0.085 * k], [0.057 * k, 0.068 * k, 0.078 * k, 0.085 * k], lseg, x), thigh, legRegion);
    add(lathe([0.075, 0.16, 0.34, J.kneeY + 0.02], [0.043 * k, 0.041 * k, 0.051 * k, 0.055 * k], [0.045 * k, 0.044 * k, 0.057 * k, 0.057 * k], lseg, x, [0, 0, -0.006, 0]), shin, legRegion);
    // Sneakers (chunkier) / flats.
    if (lad) add(lathe([0.0, 0.035, 0.085], [0.054, 0.052, 0.043], [0.135, 0.132, 0.095], lseg, x, [0.048, 0.048, 0.032]), shin, REGION.shoes);
    else add(lathe([0.0, 0.028, 0.065], [0.042, 0.042, 0.037], [0.112, 0.11, 0.08], lseg, x, [0.045, 0.045, 0.03]), shin, REGION.shoes);
  }

  // ---- Arms: short sleeves (long when the sleeve flag is set) ----
  const shoulderX = lad ? J.shoulderX - 0.004 : J.shoulderX - 0.024;
  for (const s of [-1, 1]) {
    const upper = s < 0 ? PART.upperL : PART.upperR;
    const fore = s < 0 ? PART.foreL : PART.foreR;
    const x = s * shoulderX;
    const k = lad ? 0.98 : 0.82;
    add(lathe([1.25, 1.33, J.shoulderY + 0.03], [0.053 * k, 0.055 * k, 0.056 * k], [0.057 * k, 0.059 * k, 0.06 * k], lseg, x), upper, REGION.sleeveShort);
    add(lathe([J.elbowY, 1.18, 1.26], [0.04 * k, 0.045 * k, 0.047 * k], [0.042 * k, 0.048 * k, 0.05 * k], lseg, x), upper, REGION.sleeveLong);
    add(lathe([0.875, 0.97, J.elbowY + 0.01], [0.028 * k, 0.034 * k, 0.038 * k], [0.03 * k, 0.037 * k, 0.041 * k], lseg, x), fore, REGION.sleeveLong);
    add(sphere(0.04 * k, x, 0.835, 0.008, 0.72, 1.35, 0.5, hi ? 7 : 4, hi ? 5 : 3), fore, REGION.skin);
    if (hi && s < 0) add(lathe([0.9, 0.918], [0.033 * k, 0.033 * k], [0.035 * k, 0.035 * k], 6, x), fore, REGION.accent); // watch / bracelet
  }

  // ---- Accessories ----
  add(lathe([1.0, 1.08, 1.34, 1.42], [0.13, 0.15, 0.15, 0.12], [0.07, 0.085, 0.08, 0.06], lseg, 0, [-0.19, -0.2, -0.2, -0.18]), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, 0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, -0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  if (lad) {
    // Sling bag across the chest.
    add(box(0.2, 0.13, 0.06, -0.15, 1.02, 0.1), PART.bag, REGION.bag);
    add(obox(0.028, 0.62, 0.012, 0.0, 1.22, 0.125, 0, 0, 0.7), PART.bag, REGION.bag);
    // Cap (visor forward).
    add(lathe([1.64, 1.69, 1.725], [0.088, 0.085, 0.06], [0.104, 0.1, 0.07], lseg), PART.head, REGION.cap);
    add(obox(0.15, 0.012, 0.09, 0, 1.645, 0.12, -0.12), PART.head, REGION.cap);
  } else {
    // Handbag on the shoulder.
    add(box(0.24, 0.17, 0.08, 0.2, 1.0, 0.0), PART.bag, REGION.bag);
    add(obox(0.025, 0.42, 0.012, 0.19, 1.24, 0.0, 0, 0, -0.08), PART.bag, REGION.bag);
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}
