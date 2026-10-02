import * as THREE from 'three';
import { C, Kit, type PropGeo } from '../route/Props';

/**
 * Street furniture of Mira Road's residential sectors and main roads (AUTO_RIDE.md §3), in the
 * vertex-coloured prop buckets (paint, metal, glow): society gates and the watchman's cabin, the
 * tea tapri, vegetable and pani-puri handcarts, a coconut cart, plastic chairs, traffic-signal
 * heads, and the striped speed breakers of the lanes. Front is +z unless noted.
 */

type RGB = [number, number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** One leaf of a steel society gate (hinge at x = 0, leaf along +x), painted. */
export function gateLeaf(w: number, h: number, col: RGB): PropGeo {
  const k = new Kit();
  const t = 0.05;
  k.box('metal', w, t, t, w / 2, 0.12, 0, col);
  k.box('metal', w, t, t, w / 2, h - 0.04, 0, col);
  k.box('metal', w, t * 0.8, t * 0.8, w / 2, h * 0.55, 0, col);
  k.box('metal', t, h - 0.1, t, 0.03, h / 2, 0, col);
  k.box('metal', t, h - 0.1, t, w - 0.03, h / 2, 0, col);
  for (let x = 0.16; x < w - 0.1; x += 0.13) k.box('metal', 0.022, h - 0.2, 0.022, x, h / 2, 0, col);
  // A sheet across the bottom half (most society gates are half closed for privacy).
  k.box('paint', w - 0.06, h * 0.38, 0.012, w / 2, 0.15 + h * 0.19, 0, col.map((c) => c * 0.85) as RGB);
  // Spear tips along the top.
  for (let x = 0.16; x < w - 0.1; x += 0.26) k.box('metal', 0.03, 0.12, 0.03, x, h + 0.05, 0, col);
  return k.build();
}

/** Gate pillar: plastered, a cap and a globe lamp on top. */
export function gatePillar(col: RGB): PropGeo {
  const k = new Kit();
  k.box('paint', 0.46, 2.05, 0.46, 0, 1.025, 0, col);
  k.box('paint', 0.58, 0.1, 0.58, 0, 2.1, 0, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8]);
  k.cyl('metal', 0.04, 0.04, 0.12, 0, 2.15, 0, C.black, 6);
  k.sphere('glow', 0.13, 0, 2.38, 0, [1, 0.93, 0.78], 1, 1, 1, 10);
  return k.build();
}

/** The watchman's cabin by a society gate: a small plastered box with a window and a slab roof. */
export function watchCabin(): PropGeo {
  const k = new Kit();
  k.box('paint', 1.3, 2.15, 1.3, 0, 1.075, 0, [0.82, 0.78, 0.66]);
  k.box('paint', 1.6, 0.1, 1.6, 0, 2.2, 0, [0.62, 0.6, 0.55]);
  k.box('paint', 0.8, 0.6, 0.02, 0, 1.35, 0.66, [0.18, 0.2, 0.22]);
  k.box('paint', 0.06, 0.62, 0.03, 0, 1.35, 0.67, [0.4, 0.4, 0.38]);
  k.box('glow', 0.3, 0.06, 0.06, 0, 2.05, 0.67, [1, 0.97, 0.9]);
  k.box('paint', 0.62, 0.05, 0.4, 0, 1.0, 0.86, [0.45, 0.32, 0.2]);
  return k.build();
}

/** Plastic chair (the watchman's, the tea stall's), red, blue or white. */
export function plasticChair(col: RGB): PropGeo {
  const k = new Kit();
  k.box('paint', 0.44, 0.04, 0.42, 0, 0.44, 0, col);
  k.box('paint', 0.44, 0.42, 0.04, 0, 0.66, -0.2, col, 0, -0.12);
  for (const [x, z] of [
    [-0.19, -0.18],
    [0.19, -0.18],
    [-0.19, 0.18],
    [0.19, 0.18],
  ])
    k.box('paint', 0.035, 0.44, 0.035, x, 0.22, z, col);
  return k.build();
}

/** Tea tapri: a tin-roofed stall on poles, a counter with the kettle on its stove, a bench. */
export function teaTapri(): PropGeo {
  const k = new Kit();
  const tin: RGB = [0.58, 0.6, 0.62];
  for (const [x, z] of [
    [-1.1, -0.7],
    [1.1, -0.7],
    [-1.1, 0.9],
    [1.1, 0.9],
  ])
    k.cyl('metal', 0.03, 0.03, z > 0 ? 2.15 : 2.35, x, 0, z, C.galv, 6);
  k.box('metal', 2.6, 0.03, 2.0, 0, 2.28, 0.1, tin, 0, -0.1);
  k.box('paint', 2.6, 0.18, 0.02, 0, 2.12, 1.1, [0.85, 0.16, 0.1]);
  // Counter, stove, kettle, glasses, biscuit jars.
  k.box('paint', 1.9, 0.9, 0.55, 0, 0.45, 0.35, [0.45, 0.3, 0.18]);
  k.box('paint', 1.95, 0.05, 0.6, 0, 0.92, 0.35, [0.7, 0.68, 0.64]);
  k.cyl('metal', 0.14, 0.14, 0.1, -0.5, 0.95, 0.3, C.black, 10);
  k.cyl('glow', 0.1, 0.1, 0.01, -0.5, 1.05, 0.3, [1, 0.4, 0.08], 8);
  k.cyl('metal', 0.11, 0.08, 0.2, -0.5, 1.06, 0.3, [0.72, 0.62, 0.42], 10);
  for (let i = 0; i < 4; i++) k.cyl('metal', 0.09, 0.09, 0.28, 0.25 + i * 0.22, 0.95, 0.42, [0.85, 0.85, 0.82], 8);
  for (let i = 0; i < 6; i++) k.cyl('paint', 0.025, 0.025, 0.08, -0.15 + i * 0.06, 0.95, 0.55, [0.95, 0.9, 0.75], 6);
  // Hanging packets (biscuits, chips) along the front edge.
  for (let i = 0; i < 9; i++) k.box('paint', 0.12, 0.2, 0.01, -1.0 + i * 0.25, 1.9, 1.05, [[0.9, 0.2, 0.1] as RGB, [0.95, 0.75, 0.1] as RGB, [0.15, 0.4, 0.8] as RGB][i % 3]);
  // The bench in front.
  k.box('paint', 1.6, 0.06, 0.32, 0, 0.42, 1.55, [0.4, 0.27, 0.16]);
  for (const x of [-0.7, 0.7]) k.box('paint', 0.06, 0.42, 0.28, x, 0.21, 1.55, [0.32, 0.22, 0.13]);
  k.box('glow', 0.5, 0.04, 0.04, 0, 2.18, 0.9, [1, 0.97, 0.9]);
  return k.build();
}

/** A vegetable seller's handcart (thela): a wooden tray on two cycle wheels, heaped greens and tomatoes. */
export function vegCart(seed: number): PropGeo {
  const k = new Kit();
  const wood: RGB = [0.42, 0.28, 0.16];
  k.box('paint', 1.7, 0.06, 0.95, 0, 0.82, 0, wood);
  for (const z of [-0.47, 0.47]) k.box('paint', 1.7, 0.1, 0.04, 0, 0.88, z, wood);
  for (const x of [-0.85, 0.85]) k.box('paint', 0.04, 0.1, 0.95, x, 0.88, 0, wood);
  for (const z of [-0.52, 0.52]) {
    const w = new THREE.TorusGeometry(0.34, 0.025, 4, 16);
    k.add('metal', w.translate(0.25, 0.36, z), C.black);
    k.rod('metal', V(0.25, 0.36, z), V(0.25, 0.8, z * 0.8), 0.02, C.galv, 4);
  }
  k.rod('metal', V(-0.85, 0.8, 0), V(-1.25, 0.95, 0), 0.025, C.galv, 4);
  k.rod('paint', V(-0.75, 0.8, -0.3), V(-0.75, 0, -0.3), 0.025, wood, 4);
  const heaps: RGB[] = [
    [0.2, 0.45, 0.12],
    [0.75, 0.12, 0.08],
    [0.55, 0.42, 0.25],
    [0.3, 0.55, 0.15],
    [0.85, 0.55, 0.1],
    [0.45, 0.1, 0.3],
  ];
  for (let i = 0; i < 6; i++) {
    const x = -0.6 + (i % 3) * 0.6;
    const z = i < 3 ? -0.22 : 0.22;
    k.sphere('paint', 0.28, x, 0.86, z, heaps[(i + seed) % heaps.length], 1, 0.42, 0.85, 8);
  }
  // A green umbrella on a pole.
  k.rod('paint', V(0.8, 0.85, -0.4), V(0.8, 2.2, -0.4), 0.018, C.steel, 4);
  k.add('paint', new THREE.ConeGeometry(0.9, 0.3, 8, 1, true).translate(0.8, 2.25, -0.4), seed % 2 ? [0.1, 0.45, 0.25] : [0.15, 0.3, 0.7]);
  return k.build();
}

/** Pani-puri cart: a glass-sided box on a wooden cart with the puris stacked inside. */
export function paniPuriCart(): PropGeo {
  const k = new Kit();
  const wood: RGB = [0.4, 0.26, 0.15];
  k.box('paint', 1.4, 0.06, 0.8, 0, 0.78, 0, wood);
  for (const [x, z] of [
    [-0.6, -0.33],
    [0.6, -0.33],
    [-0.6, 0.33],
    [0.6, 0.33],
  ])
    k.box('paint', 0.05, 0.78, 0.05, x, 0.39, z, wood);
  k.box('paint', 0.9, 0.5, 0.55, -0.15, 1.06, 0, [0.82, 0.86, 0.85]);
  for (let i = 0; i < 10; i++) k.sphere('paint', 0.05, -0.45 + (i % 5) * 0.12, 0.9 + Math.floor(i / 5) * 0.08, 0.05, [0.85, 0.66, 0.35], 1, 0.7, 1, 6);
  k.cyl('metal', 0.14, 0.12, 0.3, 0.45, 0.81, 0.05, [0.72, 0.72, 0.7], 10);
  k.box('paint', 1.0, 0.25, 0.02, -0.15, 1.45, 0.29, [0.9, 0.15, 0.12]);
  k.box('glow', 0.6, 0.04, 0.04, -0.15, 1.34, 0.28, [1, 0.97, 0.9]);
  return k.build();
}

/** A cart of green coconuts (shahale), a sickle on top. */
export function coconutCart(): PropGeo {
  const k = new Kit();
  const wood: RGB = [0.45, 0.3, 0.17];
  k.box('paint', 1.6, 0.06, 0.9, 0, 0.75, 0, wood);
  for (const z of [-0.5, 0.5]) k.add('metal', new THREE.TorusGeometry(0.32, 0.025, 4, 16).translate(0.2, 0.34, z), C.black);
  for (let i = 0; i < 26; i++) {
    const a = i * 2.4;
    const r = 0.1 + (i % 7) * 0.08;
    k.sphere('paint', 0.13, Math.cos(a) * r * 1.4, 0.88 + Math.floor(i / 9) * 0.14, Math.sin(a) * r * 0.9, [0.28 + (i % 3) * 0.04, 0.5 + (i % 4) * 0.03, 0.14], 1, 1.15, 1, 7);
  }
  return k.build();
}

/** Striped speed breaker across a road of width w (centred, across x), 1.5 m long, 0.08 m high. */
export function speedBreaker(w: number): PropGeo {
  const k = new Kit();
  const n = Math.max(2, Math.round(w / 0.5));
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(0.75, 0.75, w / n, 10, 1, false, Math.PI / 2, Math.PI);
    g.rotateZ(Math.PI / 2);
    g.scale(1, 0.11, 1);
    g.translate(-w / 2 + (i + 0.5) * (w / n), -0.002, 0);
    k.add('paint', g, i % 2 ? [0.07, 0.07, 0.07] : [0.85, 0.72, 0.12]);
  }
  return k.build();
}

/** Height of a speed breaker's top at a distance d (m) from its crest. */
export function bumpHeight(d: number): number {
  const t = d / 0.75;
  return Math.abs(t) >= 1 ? 0 : 0.08 * Math.sqrt(1 - t * t);
}

/**
 * Traffic-signal head: a black housing with red, amber and green lenses facing +z (lenses are
 * left out: they are lit separately), a visor over each, on a bracket. Lens centres at y = 0.25,
 * 0, −0.25 relative to the head's centre.
 */
export function signalHead(): PropGeo {
  const k = new Kit();
  k.box('paint', 0.34, 0.86, 0.22, 0, 0, 0, [0.05, 0.05, 0.05]);
  k.box('paint', 0.5, 1.02, 0.02, 0, 0, -0.12, [0.06, 0.06, 0.06]);
  for (const y of [0.27, 0, -0.27]) {
    const v = new THREE.CylinderGeometry(0.13, 0.13, 0.16, 12, 1, true, -Math.PI / 2, Math.PI);
    v.rotateX(Math.PI / 2);
    k.add('paint', v.translate(0, y + 0.02, 0.19), [0.05, 0.05, 0.05]);
  }
  return k.build();
}

/** The signal's pole: galvanised, with a cantilever arm over the road (+x) for a second head. */
export function signalPole(arm: number): PropGeo {
  const k = new Kit();
  k.cyl('paint', 0.12, 0.11, 0.6, 0, 0, 0, [0.85, 0.75, 0.15], 10);
  k.cyl('metal', 0.09, 0.08, 5.6, 0, 0.6, 0, C.galv, 10);
  if (arm > 0) {
    k.rod('metal', V(0, 5.6, 0), V(arm, 5.7, 0), 0.06, C.galv, 6);
    k.rod('metal', V(0, 4.6, 0), V(arm * 0.4, 5.62, 0), 0.035, C.galv, 6);
  }
  // Black-and-yellow bands on the pole base (as on Mumbai's signal poles).
  for (let i = 0; i < 4; i++) k.cyl('paint', 0.095, 0.095, 0.25, 0, 0.7 + i * 0.5, 0, i % 2 ? [0.9, 0.75, 0.1] : [0.04, 0.04, 0.04], 10);
  return k.build();
}

/** Boxwood-like hedge block (median planting), w long along x. */
export function hedge(w: number, h: number, d: number, seed: number): PropGeo {
  const k = new Kit();
  const n = Math.max(1, Math.round(w / 0.7));
  for (let i = 0; i < n; i++) {
    const g = 0.28 + ((i * 37 + seed * 11) % 10) * 0.012;
    k.sphere('paint', 0.5, -w / 2 + (i + 0.5) * (w / n), h * 0.62, 0, [0.12, g, 0.08], (w / n) * 1.25, h * 0.9, d * 1.1, 7);
  }
  return k.build();
}
