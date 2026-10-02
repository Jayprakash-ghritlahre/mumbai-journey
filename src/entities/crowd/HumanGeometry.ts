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
  /** Open hair (its length per person, aWear.x); ponytail, bun and plait are the other styles (aStyle.y). */
  hairLong: 10,
  hairTail: 11,
  /** Legs: bare under a skirt or dress, else the bottom colour (aStyle.z). */
  leg: 12,
  /** Skirt, dress or kurti below the waist (its length per person, aWear.y). */
  skirt: 13,
  /** Upper arm near the shoulder / the rest of the arm: covered for short / long sleeves (aStyle.w 1 / 2). */
  sleeveShort: 14,
  sleeveLong: 15,
  /** Wide trouser legs: palazzos, wide-leg trousers, cargo pants. */
  flare: 16,
  /** A shirt: collar, lapels and the hem worn out over the waistband. */
  shirt: 17,
  /** The waist between top and waistband: the top, or skin under a crop top. */
  midriff: 18,
  /** An open jacket, overshirt or shrug; its colour also covers the arms. */
  layer: 19,
  dupatta: 20,
  sneaker: 21,
  /** The upper of a flat shoe: the shoe colour, or the foot in sandals. */
  shoeUpper: 22,
  sneakerSole: 23,
  sling: 24,
  tote: 25,
  earrings: 26,
  hairBun: 27,
  hairBraid: 28,
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

/**
 * man: shirt and trousers; woman: salwar kurta; saree; youth: T-shirt, jeans, sneakers; girl: a
 * contemporary woman in whatever she has on (buildWoman), also drawn for young girls.
 */
export type Variant = 'man' | 'woman' | 'saree' | 'youth' | 'girl';

type Add = (g: THREE.BufferGeometry, part: number, region: number) => void;

/** Part and region share one vertex attribute (aTag = part + region × 32) to save attribute slots. */
function tag(g: THREE.BufferGeometry, part: number, region: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  g.setAttribute('aTag', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part + region * 32), 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aTag'].includes(k)) g.deleteAttribute(k);
  // Indexed, so each shared vertex is skinned once (every part is indexed, so they merge).
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
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

/** An open lathe sheet from angle a0 to a1 (0 = front, π = back): hair down the back, an open jacket. */
function lathePartial(ys: number[], rx: number[], rz: number[], seg: number, a0: number, a1: number, zOff: number[] = []): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < ys.length; r++)
    for (let s = 0; s <= seg; s++) {
      const a = a0 + ((a1 - a0) * s) / seg;
      pos.push(Math.sin(a) * rx[r], ys[r], Math.cos(a) * rz[r] + (zOff[r] ?? 0));
    }
  for (let r = 0; r < ys.length - 1; r++)
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s;
      const b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
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
  const parts: THREE.BufferGeometry[] = [];
  const add: Add = (g, part, region) => parts.push(tag(g, part, region));
  if (variant === 'man') buildMan(add, lod);
  else if (variant === 'youth') buildLad(add, lod);
  else if (variant === 'girl') buildWoman(add, lod);
  else buildTraditional(add, variant, lod);
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Shared head (skull, nose, ears) and neck. */
function headAndNeck(add: Add, hi: boolean, lseg: number): void {
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

/** A man in a shirt and trousers: collar, placket and belt; bag, backpack, cap per person. */
function buildMan(add: Add, lod: 0 | 1): void {
  const hi = lod === 0;
  const seg = hi ? 10 : 5;
  const lseg = hi ? 8 : 4;
  const J = JOINT;
  headAndNeck(add, hi, lseg);
  add(hairShell([1.575, 1.61, 1.645, 1.678, 1.702], [0.083, 0.086, 0.079, 0.058, 0.0], [0.1, 0.103, 0.096, 0.07, 0.0], hi ? 12 : 6), PART.head, REGION.hair);
  const sh = 0.188;
  const ys = [0.86, 0.96, 1.08, 1.2, 1.3, 1.38, 1.43, 1.46];
  const rx = [0.16, 0.152, 0.155, 0.168, 0.178, sh, 0.15, 0.07];
  const rz = [0.11, 0.105, 0.108, 0.118, 0.122, 0.105, 0.085, 0.055];
  const zo = [0, 0, 0.004, 0.01, 0.012, 0, -0.008, -0.005];
  add(lathe(hi ? ys : [0.86, 1.08, 1.3, 1.43, 1.46], hi ? rx : [rx[0], rx[2], rx[4], rx[6], rx[7]], hi ? rz : [rz[0], rz[2], rz[4], rz[6], rz[7]], seg, 0, hi ? zo : []), PART.torso, REGION.top);
  // Collar, placket and belt.
  add(lathe([1.44, 1.475], [0.075, 0.062], [0.07, 0.058], lseg, 0, [0.004, 0.006]), PART.torso, REGION.top);
  if (hi) add(box(0.018, 0.4, 0.01, 0, 1.22, 0.122), PART.torso, REGION.top);
  add(lathe([0.855, 0.9], [0.163, 0.161], [0.113, 0.111], seg), PART.torso, REGION.shoes);
  for (const s of [-1, 1]) {
    const thigh = s < 0 ? PART.thighL : PART.thighR;
    const shin = s < 0 ? PART.shinL : PART.shinR;
    const x = s * J.hipX;
    add(lathe([J.kneeY, 0.62, 0.78, J.hipY + 0.02], [0.056, 0.066, 0.078, 0.085], [0.058, 0.07, 0.08, 0.085], lseg, x), thigh, REGION.bottom);
    add(lathe([0.075, 0.16, 0.34, J.kneeY + 0.02], [0.045, 0.042, 0.052, 0.056], [0.047, 0.045, 0.058, 0.058], lseg, x, [0, 0, -0.006, 0]), shin, REGION.bottom);
    add(lathe([0.0, 0.03, 0.075], [0.047, 0.047, 0.04], [0.12, 0.12, 0.09], lseg, x, [0.045, 0.045, 0.03]), shin, REGION.shoes);
  }
  for (const s of [-1, 1]) {
    const upper = s < 0 ? PART.upperL : PART.upperR;
    const fore = s < 0 ? PART.foreL : PART.foreR;
    const x = s * J.shoulderX;
    add(lathe([J.elbowY, 1.24, J.shoulderY + 0.03], [0.04, 0.047, 0.052], [0.042, 0.05, 0.056], lseg, x), upper, REGION.top);
    add(lathe([0.875, 0.97, J.elbowY + 0.01], [0.028, 0.034, 0.038], [0.03, 0.037, 0.041], lseg, x), fore, REGION.sleeve);
    add(sphere(0.04, x, 0.835, 0.008, 0.72, 1.35, 0.5, hi ? 7 : 4, hi ? 5 : 3), fore, REGION.skin);
  }
  add(lathe([1.0, 1.08, 1.34, 1.42], [0.13, 0.15, 0.15, 0.12], [0.07, 0.085, 0.08, 0.06], lseg, 0, [-0.19, -0.2, -0.2, -0.18]), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, 0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, -0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  add(box(0.26, 0.2, 0.08, -0.22, 0.98, 0.0), PART.bag, REGION.bag);
  add(obox(0.03, 0.62, 0.015, -0.07, 1.2, 0.12, 0, 0, 0.62), PART.bag, REGION.bag);
  add(obox(0.03, 0.5, 0.015, -0.07, 1.22, -0.105, 0, 0, 0.62), PART.bag, REGION.bag);
  // Cap (white Gandhi topi / dark cap) — shown per instance.
  add(lathe([1.66, 1.7, 1.725], [0.085, 0.082, 0.07], [0.1, 0.098, 0.03], lseg), PART.head, REGION.cap);
}

/**
 * Women's hair: the crown, then per person open hair down the back (to any length, a bob to the
 * waist) with strands framing the face, a ponytail, a bun or a plait.
 */
function femaleHair(add: Add, hi: boolean): void {
  add(hairShell([1.49, 1.575, 1.63, 1.672, 1.702], [0.074, 0.088, 0.084, 0.062, 0.0], [0.094, 0.106, 0.1, 0.074, 0.0], hi ? 12 : 6, 1.645), PART.head, REGION.hair);
  const hs = hi ? 8 : 4;
  add(lathePartial([1.47, 1.53, 1.6], [0.09, 0.093, 0.09], [0.098, 0.104, 0.106], hs, Math.PI * 0.5, Math.PI * 1.5, [-0.018, -0.016, -0.012]), PART.head, REGION.hairLong);
  add(lathePartial([1.2, 1.3, 1.4, 1.47], [0.13, 0.125, 0.108, 0.092], [0.09, 0.092, 0.09, 0.096], hs, Math.PI * 0.55, Math.PI * 1.45, [-0.045, -0.04, -0.03, -0.02]), PART.torso, REGION.hairLong);
  if (hi) for (const s of [-1, 1]) add(obox(0.04, 0.2, 0.03, s * 0.086, 1.44, 0.03, -0.1, 0, s * 0.08), PART.torso, REGION.hairLong);
  add(sphere(0.034, 0, 1.6, -0.105, 0.9, 1, 1, hi ? 7 : 4, hi ? 5 : 3), PART.head, REGION.hairTail);
  add(obox(0.05, 0.22, 0.04, 0, 1.47, -0.13, 0.22), PART.torso, REGION.hairTail);
  add(sphere(0.05, 0, 1.6, -0.1, 1, 0.95, 0.85, hi ? 8 : 5, hi ? 6 : 4), PART.head, REGION.hairBun);
  add(obox(0.055, 0.34, 0.035, 0, 1.36, -0.12, 0.12), PART.torso, REGION.hairBraid);
}

/** Earrings and a cap, shown per person. */
function femaleAdornments(add: Add, hi: boolean, lseg: number): void {
  if (hi)
    for (const s of [-1, 1]) {
      add(sphere(0.008, s * 0.081, 1.556, -0.002, 1, 1, 1, 5, 4), PART.head, REGION.earrings);
      add(sphere(0.011, s * 0.081, 1.537, -0.002, 1, 1.2, 1, 6, 4), PART.head, REGION.earrings);
    }
  add(lathe([1.64, 1.69, 1.722], [0.09, 0.087, 0.062], [0.106, 0.102, 0.072], lseg), PART.head, REGION.cap);
  add(obox(0.15, 0.012, 0.09, 0, 1.645, 0.12, -0.12), PART.head, REGION.cap);
}

/** Flats (the upper is the foot in sandals) or sneakers with a white sole. */
function femaleShoes(add: Add, x: number, shin: number, lseg: number): void {
  add(lathe([0.0, 0.013], [0.043, 0.043], [0.113, 0.113], lseg, x, [0.045, 0.045]), shin, REGION.shoes);
  add(lathe([0.013, 0.032, 0.066], [0.041, 0.039, 0.035], [0.108, 0.098, 0.074], lseg, x, [0.045, 0.042, 0.03]), shin, REGION.shoeUpper);
  add(lathe([0.022, 0.048, 0.088], [0.05, 0.048, 0.04], [0.126, 0.122, 0.088], lseg, x, [0.048, 0.047, 0.032]), shin, REGION.sneaker);
  add(lathe([0.0, 0.024], [0.052, 0.052], [0.131, 0.131], lseg, x, [0.049, 0.049]), shin, REGION.sneakerSole);
}

/** A backpack, a shoulder bag or a tote hanging at the side, a sling bag across the body. */
function femaleBags(add: Add, lseg: number): void {
  add(lathe([1.0, 1.08, 1.34, 1.42], [0.13, 0.15, 0.15, 0.12], [0.07, 0.085, 0.08, 0.06], lseg, 0, [-0.19, -0.2, -0.2, -0.18]), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, 0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, -0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  add(box(0.08, 0.17, 0.24, 0.225, 1.0, -0.01), PART.bag, REGION.bag);
  add(obox(0.025, 0.42, 0.012, 0.2, 1.24, -0.01, 0, 0, -0.08), PART.bag, REGION.bag);
  add(box(0.17, 0.12, 0.05, -0.14, 0.99, 0.11), PART.bag, REGION.sling);
  add(obox(0.022, 0.64, 0.012, 0.01, 1.2, 0.145, 0.06, 0, -0.68), PART.bag, REGION.sling);
  add(obox(0.022, 0.64, 0.012, 0.01, 1.2, -0.13, -0.06, 0, -0.68), PART.bag, REGION.sling);
  add(box(0.1, 0.3, 0.3, 0.245, 0.97, -0.02), PART.bag, REGION.tote);
  for (const z of [-0.07, 0.05]) add(obox(0.02, 0.32, 0.012, 0.215, 1.27, z, 0, 0, -0.1), PART.bag, REGION.tote);
}

/** A dupatta draped like a pallu: across the chest from the waist, over one shoulder and down the back. */
function dupatta(add: Add, front: number): void {
  add(obox(0.15, 0.52, 0.02, 0.02, 1.2, front, -0.14, 0, 0.55), PART.torso, REGION.dupatta);
  add(obox(0.12, 0.04, 0.26, 0.125, 1.43, 0.0, 0, 0, -0.2), PART.torso, REGION.dupatta);
  add(obox(0.19, 0.72, 0.02, 0.085, 1.07, -0.135, 0.06, 0, -0.08), PART.torso, REGION.dupatta);
}

/** Salwar kurta with an optional dupatta, or a saree; hair, earrings, shoes and bags per person. */
function buildTraditional(add: Add, variant: 'woman' | 'saree', lod: 0 | 1): void {
  const hi = lod === 0;
  const seg = hi ? 10 : 5;
  const lseg = hi ? 8 : 4;
  const J = JOINT;
  headAndNeck(add, hi, lseg);
  femaleHair(add, hi);
  femaleAdornments(add, hi, lseg);
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
    const ys = [0.86, 0.96, 1.08, 1.2, 1.3, 1.38, 1.43, 1.46];
    const rx = [0.165, 0.14, 0.135, 0.15, 0.158, 0.165, 0.13, 0.065];
    const rz = [0.115, 0.1, 0.1, 0.115, 0.118, 0.095, 0.08, 0.05];
    const zo = [0, 0, 0.004, 0.014, 0.014, 0, -0.008, -0.005];
    add(lathe(hi ? ys : [0.86, 1.08, 1.3, 1.43, 1.46], hi ? rx : [rx[0], rx[2], rx[4], rx[6], rx[7]], hi ? rz : [rz[0], rz[2], rz[4], rz[6], rz[7]], seg, 0, hi ? zo : []), PART.torso, REGION.top);
    // Kurta flares to the knees; the dupatta across the shoulders and down the front.
    add(lathe([0.5, 0.62, 0.76, 0.88], [0.215, 0.205, 0.185, 0.168], [0.16, 0.15, 0.135, 0.118], seg + 2), PART.skirt, REGION.top);
    dupatta(add, 0.13);
  }
  for (const s of [-1, 1]) {
    const thigh = s < 0 ? PART.thighL : PART.thighR;
    const shin = s < 0 ? PART.shinL : PART.shinR;
    const x = s * J.hipX;
    const k = 0.88;
    add(lathe([J.kneeY, 0.62, 0.78, J.hipY + 0.02], [0.056 * k, 0.066 * k, 0.078 * k, 0.085 * k], [0.058 * k, 0.07 * k, 0.08 * k, 0.085 * k], lseg, x), thigh, REGION.bottom);
    add(lathe([0.075, 0.16, 0.34, J.kneeY + 0.02], [0.045 * k, 0.042 * k, 0.052 * k, 0.056 * k], [0.047 * k, 0.045 * k, 0.058 * k, 0.058 * k], lseg, x, [0, 0, -0.006, 0]), shin, variant === 'saree' ? REGION.skin : REGION.bottom);
    femaleShoes(add, x, shin, lseg);
  }
  const shoulderX = J.shoulderX - 0.02;
  for (const s of [-1, 1]) {
    const upper = s < 0 ? PART.upperL : PART.upperR;
    const fore = s < 0 ? PART.foreL : PART.foreR;
    const x = s * shoulderX;
    const k = 0.85;
    add(lathe([J.elbowY, 1.24, J.shoulderY + 0.03], [0.04 * k, 0.047 * k, 0.052 * k], [0.042 * k, 0.05 * k, 0.056 * k], lseg, x), upper, variant === 'saree' ? REGION.skin : REGION.top);
    add(lathe([0.875, 0.97, J.elbowY + 0.01], [0.028 * k, 0.034 * k, 0.038 * k], [0.03 * k, 0.037 * k, 0.041 * k], lseg, x), fore, REGION.skin);
    add(sphere(0.04 * k, x, 0.835, 0.008, 0.72, 1.35, 0.5, hi ? 7 : 4, hi ? 5 : 3), fore, REGION.skin);
    if (hi) add(lathe([0.9, 0.925], [0.036, 0.036], [0.038, 0.038], 6, x), fore, REGION.accent); // bangles
  }
  femaleBags(add, lseg);
}

/** Young man: a T-shirt or casual shirt, jeans and sneakers; a sling bag or backpack, a cap now and then. */
function buildLad(add: Add, lod: 0 | 1): void {
  const hi = lod === 0;
  const seg = hi ? 10 : 5;
  const lseg = hi ? 8 : 4;
  const J = JOINT;
  headAndNeck(add, hi, lseg);
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
  for (const s of [-1, 1]) {
    const thigh = s < 0 ? PART.thighL : PART.thighR;
    const shin = s < 0 ? PART.shinL : PART.shinR;
    const x = s * J.hipX;
    const k = 0.96;
    add(lathe([J.kneeY, 0.62, 0.78, J.hipY + 0.02], [0.055 * k, 0.064 * k, 0.076 * k, 0.085 * k], [0.057 * k, 0.068 * k, 0.078 * k, 0.085 * k], lseg, x), thigh, REGION.bottom);
    add(lathe([0.075, 0.16, 0.34, J.kneeY + 0.02], [0.043 * k, 0.041 * k, 0.051 * k, 0.055 * k], [0.045 * k, 0.044 * k, 0.057 * k, 0.057 * k], lseg, x, [0, 0, -0.006, 0]), shin, REGION.bottom);
    add(lathe([0.0, 0.035, 0.085], [0.054, 0.052, 0.043], [0.135, 0.132, 0.095], lseg, x, [0.048, 0.048, 0.032]), shin, REGION.shoes);
  }
  const shoulderX = J.shoulderX - 0.004;
  for (const s of [-1, 1]) {
    const upper = s < 0 ? PART.upperL : PART.upperR;
    const fore = s < 0 ? PART.foreL : PART.foreR;
    const x = s * shoulderX;
    const k = 0.98;
    add(lathe([1.25, 1.33, J.shoulderY + 0.03], [0.053 * k, 0.055 * k, 0.056 * k], [0.057 * k, 0.059 * k, 0.06 * k], lseg, x), upper, REGION.sleeveShort);
    add(lathe([J.elbowY, 1.18, 1.26], [0.04 * k, 0.045 * k, 0.047 * k], [0.042 * k, 0.048 * k, 0.05 * k], lseg, x), upper, REGION.sleeveLong);
    add(lathe([0.875, 0.97, J.elbowY + 0.01], [0.028 * k, 0.034 * k, 0.038 * k], [0.03 * k, 0.037 * k, 0.041 * k], lseg, x), fore, REGION.sleeveLong);
    add(sphere(0.04 * k, x, 0.835, 0.008, 0.72, 1.35, 0.5, hi ? 7 : 4, hi ? 5 : 3), fore, REGION.skin);
    if (hi && s < 0) add(lathe([0.9, 0.918], [0.033 * k, 0.033 * k], [0.035 * k, 0.035 * k], 6, x), fore, REGION.accent); // watch
  }
  add(lathe([1.0, 1.08, 1.34, 1.42], [0.13, 0.15, 0.15, 0.12], [0.07, 0.085, 0.08, 0.06], lseg, 0, [-0.19, -0.2, -0.2, -0.18]), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, 0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  add(obox(0.045, 0.42, 0.02, -0.115, 1.25, -0.085, 0.08), PART.pack, REGION.pack);
  // Sling bag across the chest.
  add(box(0.2, 0.13, 0.06, -0.15, 1.02, 0.1), PART.bag, REGION.bag);
  add(obox(0.028, 0.62, 0.012, 0.0, 1.22, 0.125, 0, 0, 0.7), PART.bag, REGION.bag);
  // Cap (visor forward).
  add(lathe([1.64, 1.69, 1.725], [0.088, 0.085, 0.06], [0.104, 0.1, 0.07], lseg), PART.head, REGION.cap);
  add(obox(0.15, 0.012, 0.09, 0, 1.645, 0.12, -0.12), PART.head, REGION.cap);
}

/**
 * A contemporary Mumbai woman (college, office, out for the evening, a tourist): one mesh with
 * every garment, each person showing her own (CrowdMaterial) — a fitted top, a shirt with its
 * collar and hem out, a crop top; jeans or trousers, wide trousers, a skirt, a dress or a kurti to
 * any length; an open jacket or overshirt, a dupatta; open hair to any length, a ponytail, a bun, a
 * plait; flats, sandals or sneakers; a shoulder bag, a sling, a tote or a backpack; earrings, a cap.
 * Build and face come from the shader too.
 */
function buildWoman(add: Add, lod: 0 | 1): void {
  const hi = lod === 0;
  const seg = hi ? 10 : 5;
  const lseg = hi ? 8 : 4;
  const J = JOINT;
  const pick = (a: number[]) => (hi ? a : [a[0], a[2], a[4], a[5], a[6]]);
  headAndNeck(add, hi, lseg);
  femaleHair(add, hi);
  femaleAdornments(add, hi, lseg);
  // The waist (skin under a crop top), then the top to the neck.
  add(lathe(hi ? [0.9, 0.98, 1.03] : [0.9, 1.03], hi ? [0.148, 0.128, 0.126] : [0.148, 0.126], hi ? [0.105, 0.092, 0.092] : [0.105, 0.092], seg, 0, hi ? [0, 0, 0.002] : []), PART.torso, REGION.midriff);
  add(lathe(pick([1.03, 1.08, 1.2, 1.3, 1.38, 1.43, 1.46]), pick([0.126, 0.125, 0.145, 0.154, 0.162, 0.128, 0.064]), pick([0.092, 0.092, 0.112, 0.118, 0.094, 0.078, 0.05]), seg, 0, pick([0.002, 0.004, 0.016, 0.016, 0, -0.008, -0.005])), PART.torso, REGION.top);
  // A shirt: collar, lapels, and the hem worn out over the waistband.
  add(lathe([1.43, 1.475], [0.08, 0.068], [0.076, 0.062], lseg, 0, [0.006, 0.008]), PART.torso, REGION.shirt);
  if (hi) for (const s of [-1, 1]) add(obox(0.035, 0.07, 0.012, s * 0.028, 1.425, 0.1, -0.3, 0, s * 0.45), PART.torso, REGION.shirt);
  add(lathe([0.83, 0.9], [0.172, 0.156], [0.124, 0.11], seg), PART.torso, REGION.shirt);
  // Waistband of the jeans, trousers or skirt.
  add(lathe([0.8, 0.86, 0.915], [0.165, 0.162, 0.15], [0.118, 0.114, 0.106], seg), PART.torso, REGION.bottom);
  // Skirt, dress or kurti from the waist down; its length is per person.
  add(lathe(hi ? [0.5, 0.6, 0.74, 0.88, 0.94] : [0.5, 0.7, 0.88, 0.94], hi ? [0.215, 0.2, 0.182, 0.16, 0.15] : [0.215, 0.188, 0.16, 0.15], hi ? [0.18, 0.165, 0.145, 0.118, 0.108] : [0.18, 0.15, 0.118, 0.108], seg + 2), PART.skirt, REGION.skirt);
  // An open jacket, overshirt or shrug (open down the front); a dupatta.
  const ly = [0.84, 0.96, 1.1, 1.22, 1.32, 1.4, 1.455];
  const lrx = [0.178, 0.154, 0.15, 0.166, 0.175, 0.182, 0.138];
  const lrz = [0.13, 0.112, 0.112, 0.13, 0.136, 0.112, 0.09];
  const lzo = [0, 0, 0.004, 0.016, 0.016, 0, -0.008];
  const lp = (a: number[]) => (hi ? a : [a[0], a[2], a[4], a[6]]);
  add(lathePartial(lp(ly), lp(lrx), lp(lrz), hi ? 14 : 7, 0.42, Math.PI * 2 - 0.42, lp(lzo)), PART.torso, REGION.layer);
  dupatta(add, 0.145);
  // Legs: bare under a skirt or dress, else in the bottom colour; wide trouser legs over them.
  for (const s of [-1, 1]) {
    const thigh = s < 0 ? PART.thighL : PART.thighR;
    const shin = s < 0 ? PART.shinL : PART.shinR;
    const x = s * J.hipX;
    const k = 0.84;
    add(lathe([J.kneeY, 0.62, 0.78, J.hipY + 0.02], [0.055 * k, 0.064 * k, 0.076 * k, 0.085 * k], [0.057 * k, 0.068 * k, 0.078 * k, 0.085 * k], lseg, x), thigh, REGION.leg);
    add(lathe([0.075, 0.16, 0.34, J.kneeY + 0.02], [0.043 * k, 0.041 * k, 0.051 * k, 0.055 * k], [0.045 * k, 0.044 * k, 0.057 * k, 0.057 * k], lseg, x, [0, 0, -0.006, 0]), shin, REGION.leg);
    add(lathe([0.03, 0.2, 0.36, 0.47], [0.095, 0.087, 0.078, 0.07], [0.098, 0.089, 0.08, 0.072], lseg, x), shin, REGION.flare);
    femaleShoes(add, x, shin, lseg);
  }
  // Arms: sleeveless, short or long sleeves (or the jacket's).
  const shoulderX = J.shoulderX - 0.024;
  for (const s of [-1, 1]) {
    const upper = s < 0 ? PART.upperL : PART.upperR;
    const fore = s < 0 ? PART.foreL : PART.foreR;
    const x = s * shoulderX;
    const k = 0.82;
    add(lathe([1.25, 1.33, J.shoulderY + 0.03], [0.053 * k, 0.055 * k, 0.056 * k], [0.057 * k, 0.059 * k, 0.06 * k], lseg, x), upper, REGION.sleeveShort);
    add(lathe([J.elbowY, 1.18, 1.26], [0.04 * k, 0.045 * k, 0.047 * k], [0.042 * k, 0.048 * k, 0.05 * k], lseg, x), upper, REGION.sleeveLong);
    add(lathe([0.875, 0.97, J.elbowY + 0.01], [0.028 * k, 0.034 * k, 0.038 * k], [0.03 * k, 0.037 * k, 0.041 * k], lseg, x), fore, REGION.sleeveLong);
    add(sphere(0.04 * k, x, 0.835, 0.008, 0.72, 1.35, 0.5, hi ? 7 : 4, hi ? 5 : 3), fore, REGION.skin);
    if (hi && s < 0) add(lathe([0.9, 0.918], [0.033 * k, 0.033 * k], [0.035 * k, 0.035 * k], 6, x), fore, REGION.accent); // watch / bracelet
  }
  femaleBags(add, lseg);
}
