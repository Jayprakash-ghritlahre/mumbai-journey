import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildVehicle, type VehicleKind } from '../../entities/traffic/VehicleGeometry';
import { autoCrowd } from '../../entities/auto/AutoShell';

/**
 * Vehicle meshes for Mira Road, vertex coloured so each kind is one draw (instances tinted by
 * instanceColor where the body colour varies): the black-and-yellow autorickshaw (the body of the
 * auto you ride, AutoShell), a motorcycle/scooter, cars and taxis
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

const GLASS: RGB = [0.12, 0.14, 0.15];

/** Mumbai autorickshaw (Bajaj RE style), front +z, ground y = 0: the same body as the auto you ride (AutoShell). */
export function autoRickshaw(lod: 'near' | 'far' = 'near'): THREE.BufferGeometry {
  return autoCrowd(lod);
}

/** A motorcycle (a Splendor-like commuter) or a scooter (an Activa-like one), front +z, ≈500 triangles; white where the body colour goes. */
export function twoWheeler(scooter: boolean): THREE.BufferGeometry {
  const p = new Parts();
  const W: RGB = [1, 1, 1];
  const K: RGB = [0.04, 0.04, 0.045];
  const CH: RGB = [0.62, 0.63, 0.65];
  const sph = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, c: RGB, seg = 7) => p.add(new THREE.SphereGeometry(r, Math.min(seg, 7), 4).scale(sx, sy, sz).translate(x, y, z), c);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, c: RGB) => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), 4, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    p.add(g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), c);
  };
  const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const tyre = (R: number, z: number) => {
    p.add(new THREE.TorusGeometry(R - 0.045, 0.048, 4, 10).rotateY(Math.PI / 2).translate(0, R, z), K);
    p.add(new THREE.CylinderGeometry(R * 0.5, R * 0.5, 0.06, 6).rotateZ(Math.PI / 2).translate(0, R, z), CH);
  };
  if (scooter) {
    tyre(0.25, 0.62);
    tyre(0.25, -0.6);
    // Floorboard, the rear cowl over the engine, seat, the leg shield and its apron.
    p.box(0.3, 0.06, 0.56, 0, 0.3, 0.06, [0.15, 0.15, 0.16]);
    sph(0.5, 0.36, 0.42, 0.9, 0, 0.5, -0.36, W, 12);
    sph(0.5, 0.3, 0.12, 0.74, 0, 0.75, -0.32, K, 10);
    p.box(0.38, 0.62, 0.07, 0, 0.6, 0.38, W, -0.22);
    sph(0.5, 0.36, 0.6, 0.26, 0, 0.6, 0.47, W, 10);
    // Front mudguard, steering column, handlebar cover with the headlamp, grips, mirrors.
    sph(0.5, 0.18, 0.12, 0.5, 0, 0.5, 0.64, W, 8);
    p.box(0.1, 0.42, 0.1, 0, 0.85, 0.45, W, -0.25);
    p.box(0.46, 0.1, 0.16, 0, 1.02, 0.42, W);
    p.box(0.16, 0.08, 0.04, 0, 1.0, 0.51, [0.92, 0.92, 0.85]);
    for (const s of [-1, 1]) {
      rod(V3(s * 0.22, 1.02, 0.42), V3(s * 0.33, 1.02, 0.4), 0.018, K);
      rod(V3(s * 0.18, 1.05, 0.42), V3(s * 0.24, 1.25, 0.4), 0.008, K);
      p.box(0.08, 0.05, 0.02, s * 0.25, 1.27, 0.4, K);
    }
    p.box(0.14, 0.05, 0.03, 0, 0.6, -0.8, [0.75, 0.06, 0.04]);
  } else {
    tyre(0.29, 0.68);
    tyre(0.29, -0.64);
    // Engine and exhaust, the tank, side panel, seat, the tail.
    p.box(0.24, 0.26, 0.34, 0, 0.47, 0.05, [0.22, 0.22, 0.23]);
    rod(V3(0.13, 0.33, 0.15), V3(0.15, 0.36, -0.72), 0.035, CH);
    sph(0.5, 0.32, 0.25, 0.54, 0, 0.86, 0.2, W, 12);
    p.box(0.22, 0.17, 0.3, 0, 0.66, -0.18, W);
    sph(0.5, 0.27, 0.1, 0.7, 0, 0.84, -0.26, K, 10);
    p.box(0.17, 0.06, 0.34, 0, 0.82, -0.58, W, 0.15);
    p.box(0.12, 0.04, 0.03, 0, 0.8, -0.76, [0.75, 0.06, 0.04]);
    // Frame tubes, the fork, mudguards.
    rod(V3(0, 0.96, 0.46), V3(0, 0.55, 0.0), 0.025, K);
    rod(V3(0, 0.75, -0.1), V3(0, 0.3, -0.64), 0.025, K);
    for (const s of [-1, 1]) rod(V3(s * 0.07, 0.29, 0.68), V3(s * 0.06, 0.98, 0.5), 0.022, CH);
    sph(0.5, 0.16, 0.08, 0.48, 0, 0.62, 0.7, K, 8);
    sph(0.5, 0.16, 0.08, 0.5, 0, 0.6, -0.68, K, 8);
    // Headlamp, handlebar and grips, mirrors.
    p.add(new THREE.CylinderGeometry(0.085, 0.09, 0.08, 8).rotateX(Math.PI / 2).translate(0, 0.92, 0.6), [0.95, 0.95, 0.88]);
    rod(V3(-0.34, 1.06, 0.46), V3(0.34, 1.06, 0.46), 0.014, CH);
    for (const s of [-1, 1]) {
      rod(V3(s * 0.26, 1.06, 0.46), V3(s * 0.36, 1.06, 0.45), 0.02, K);
      rod(V3(s * 0.2, 1.07, 0.46), V3(s * 0.24, 1.28, 0.44), 0.008, K);
      p.box(0.08, 0.05, 0.02, s * 0.25, 1.3, 0.44, K);
    }
  }
  return p.build();
}

/** A motorcycle or scooter in ≈120 triangles (the packed pay-and-park), front +z; tinted white where the body colour goes. */
export function twoWheelerLow(scooter: boolean): THREE.BufferGeometry {
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
