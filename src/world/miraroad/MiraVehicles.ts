import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildVehicle, type VehicleKind } from '../../entities/traffic/VehicleGeometry';

/**
 * Vehicle meshes for Mira Road, vertex coloured so each kind is one draw (instances tinted by
 * instanceColor where the body colour varies): the black-and-yellow autorickshaw (from the auto
 * stand photos: black canopy, yellow lower body and nose), a motorcycle/scooter, cars and taxis
 * (the shared traffic models), the MBMT bus (red with the yellow advertising band) and a goods
 * tempo like the one parked on the forecourt in the main-entrance photo.
 */

type RGB = [number, number, number];

class Parts {
  readonly list: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, c: RGB): this {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal'].includes(k)) ng.deleteAttribute(k);
    const n = ng.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    ng.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    this.list.push(ng);
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, c: RGB, rx = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    return this.add(g.translate(x, y, z), c);
  }
  wheel(r: number, w: number, x: number, y: number, z: number, seg = 10): this {
    return this.add(new THREE.CylinderGeometry(r, r, w, seg).rotateZ(Math.PI / 2).translate(x, y, z), [0.05, 0.05, 0.05]);
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!;
    g.computeBoundingSphere();
    return g;
  }
}

const BLACK: RGB = [0.035, 0.035, 0.035];
const YELLOW: RGB = [0.95, 0.72, 0.06];
const GLASS: RGB = [0.12, 0.14, 0.15];

/** Mumbai autorickshaw (Bajaj RE style), front +z, ground y = 0. */
export function autoRickshaw(): THREE.BufferGeometry {
  const p = new Parts();
  // Floor pan and the rear body over the engine (black above, yellow skirt).
  p.box(1.28, 0.16, 2.3, 0, 0.36, -0.1, [0.08, 0.08, 0.08]);
  p.box(1.32, 0.34, 0.95, 0, 0.62, -0.78, YELLOW);
  p.box(1.3, 0.42, 0.9, 0, 1.0, -0.8, BLACK);
  p.box(1.33, 0.07, 0.95, 0, 0.8, -0.78, [0.8, 0.12, 0.08]);
  // Passenger bench and back.
  p.box(1.1, 0.12, 0.5, 0, 0.78, -0.2, [0.3, 0.07, 0.06]);
  p.box(1.1, 0.5, 0.1, 0, 1.08, -0.45, [0.25, 0.06, 0.05]);
  // Sides: yellow lower panels.
  for (const s of [-1, 1]) p.box(0.05, 0.3, 1.25, s * 0.64, 0.62, -0.1, YELLOW);
  // Nose: yellow cowl, black upper with the windscreen, the headlamp.
  p.box(1.0, 0.55, 0.55, 0, 0.72, 0.95, YELLOW);
  p.box(0.62, 0.18, 0.2, 0, 0.45, 1.2, YELLOW);
  p.box(1.1, 0.55, 0.12, 0, 1.28, 0.82, BLACK);
  p.box(0.92, 0.42, 0.04, 0, 1.3, 0.9, GLASS);
  p.box(0.22, 0.14, 0.06, 0, 0.9, 1.24, [0.9, 0.9, 0.82]);
  // Handlebar and the driver's seat.
  p.box(0.7, 0.04, 0.04, 0, 1.08, 0.62, BLACK);
  p.box(0.5, 0.1, 0.35, 0, 0.82, 0.35, [0.12, 0.12, 0.12]);
  // Canopy: black roof and rear, posts, the rear window.
  p.box(1.36, 0.08, 2.05, 0, 1.74, -0.05, BLACK);
  p.box(1.34, 0.9, 0.05, 0, 1.3, -1.24, BLACK);
  p.box(0.52, 0.22, 0.02, 0, 1.38, -1.27, GLASS);
  for (const s of [-1, 1]) {
    p.box(0.04, 0.95, 0.04, s * 0.64, 1.26, 0.82, BLACK);
    p.box(0.04, 0.95, 0.04, s * 0.64, 1.26, -0.4, BLACK);
    p.box(0.05, 0.14, 1.9, s * 0.66, 1.66, -0.1, BLACK);
  }
  // Tail lamps, number plate, wheels.
  for (const s of [-1, 1]) p.box(0.12, 0.08, 0.03, s * 0.5, 0.72, -1.27, [0.7, 0.05, 0.03]);
  p.box(0.34, 0.14, 0.02, 0, 0.55, -1.27, [0.95, 0.85, 0.2]);
  p.wheel(0.22, 0.13, 0, 0.22, 1.02);
  p.wheel(0.22, 0.13, -0.58, 0.22, -0.72);
  p.wheel(0.22, 0.13, 0.58, 0.22, -0.72);
  return p.build();
}

/** A motorcycle or scooter (≈120 triangles), front +z; tinted white where the body colour goes. */
export function twoWheeler(scooter: boolean): THREE.BufferGeometry {
  const p = new Parts();
  const W: RGB = [1, 1, 1];
  p.wheel(0.3, 0.09, 0, 0.3, 0.66, 8);
  p.wheel(0.3, 0.1, 0, 0.3, -0.62, 8);
  if (scooter) {
    p.box(0.3, 0.35, 0.5, 0, 0.58, -0.4, W);
    p.box(0.2, 0.12, 0.7, 0, 0.36, 0.05, [0.2, 0.2, 0.2]);
    p.box(0.32, 0.75, 0.2, 0, 0.72, 0.5, W);
    p.box(0.28, 0.08, 0.55, 0, 0.8, -0.35, [0.1, 0.1, 0.1]);
  } else {
    p.box(0.26, 0.25, 0.5, 0, 0.78, 0.18, W);
    p.box(0.22, 0.25, 0.4, 0, 0.5, 0.0, [0.25, 0.25, 0.26]);
    p.box(0.26, 0.1, 0.6, 0, 0.82, -0.32, [0.08, 0.08, 0.08]);
    p.box(0.1, 0.1, 0.7, 0.12, 0.35, -0.3, [0.5, 0.5, 0.5]);
  }
  p.box(0.66, 0.035, 0.035, 0, 1.06, 0.48, [0.1, 0.1, 0.1]);
  p.box(0.05, 0.4, 0.05, 0, 0.84, 0.56, [0.35, 0.35, 0.35]);
  p.box(0.12, 0.1, 0.06, 0, 0.96, 0.66, [0.9, 0.9, 0.85]);
  return p.build();
}

/** The shared car/bus models as one vertex-coloured mesh; `paint` is left white for instanceColor. */
export function carGeo(kind: VehicleKind, accent: RGB = [0.95, 0.75, 0.1]): THREE.BufferGeometry {
  const v = buildVehicle(kind);
  const p = new Parts();
  p.add(v.paint.clone(), [1, 1, 1]);
  p.add(v.accent.clone(), accent);
  p.add(v.glass.clone(), GLASS);
  p.add(v.dark.clone(), [0.05, 0.05, 0.05]);
  p.add(v.lightsFront.clone(), [0.95, 0.93, 0.85]);
  p.add(v.lightsRear.clone(), [0.7, 0.05, 0.04]);
  return p.build();
}

/** MBMT bus: the shared bus body in red with the yellow advertising band along both sides. */
export function mbmtBus(): THREE.BufferGeometry {
  const v = buildVehicle('bus');
  const p = new Parts();
  p.add(v.paint.clone(), [0.62, 0.06, 0.05]);
  p.add(v.accent.clone(), [0.85, 0.8, 0.75]);
  p.add(v.glass.clone(), GLASS);
  p.add(v.dark.clone(), [0.05, 0.05, 0.05]);
  p.add(v.lightsFront.clone(), [0.95, 0.93, 0.85]);
  p.add(v.lightsRear.clone(), [0.7, 0.05, 0.04]);
  const L = v.length;
  for (const s of [-1, 1]) p.box(0.03, 0.55, L * 0.62, (s * v.width) / 2 + s * 0.02, 0.95, -L * 0.05, [0.93, 0.78, 0.08]);
  return p.build();
}

/** Small goods tempo: cab and an open wooden box body (the forecourt photo's pink-and-green one). */
export function tempo(): THREE.BufferGeometry {
  const p = new Parts();
  const cab: RGB = [0.18, 0.55, 0.42];
  p.box(1.7, 1.2, 1.4, 0, 1.25, 1.75, cab);
  p.box(1.6, 0.5, 0.05, 0, 1.55, 2.46, GLASS);
  p.box(1.72, 0.35, 1.45, 0, 0.62, 1.75, [0.15, 0.15, 0.15]);
  p.box(1.8, 0.2, 3.3, 0, 0.72, -0.6, [0.2, 0.2, 0.2]);
  const box: RGB = [0.82, 0.45, 0.45];
  p.box(1.9, 0.9, 0.08, 0, 1.3, -2.22, box);
  p.box(1.9, 0.9, 0.08, 0, 1.3, 1.02, box);
  for (const s of [-1, 1]) {
    p.box(0.08, 0.9, 3.25, s * 0.93, 1.3, -0.6, box);
    for (let k = 0; k < 4; k++) p.box(0.1, 0.08, 3.25, s * 0.94, 0.95 + k * 0.22, -0.6, [0.6, 0.28, 0.28]);
  }
  for (const z of [1.7, -1.4]) {
    p.wheel(0.38, 0.22, -0.82, 0.38, z);
    p.wheel(0.38, 0.22, 0.82, 0.38, z);
  }
  return p.build();
}
