import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type VehicleKind = 'taxi' | 'cab' | 'car' | 'suv' | 'bus' | 'doubleDecker' | 'scooter';

/** Per-material parts of one vehicle model (length along +Z = forward, width along X, ground at y=0). */
export interface VehicleParts {
  paint: THREE.BufferGeometry; // takes the per-instance body colour
  accent: THREE.BufferGeometry; // roof / stripe (fixed per kind, e.g. taxi yellow)
  glass: THREE.BufferGeometry;
  dark: THREE.BufferGeometry; // bumpers, trim, tyres
  lightsFront: THREE.BufferGeometry;
  lightsRear: THREE.BufferGeometry;
  length: number;
  width: number;
}

function extrudeSide(profile: [number, number][], width: number): THREE.BufferGeometry {
  // Profile in (z along the vehicle, y up); extruded across x.
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, curveSegments: 1 });
  // Shape x→ vehicle z, shape y → y, extrusion (z) → vehicle x. Swapping two axes mirrors the
  // mesh (inside-out faces), so x is also negated; the body is symmetric across x.
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const sx = p.getX(i);
    const sy = p.getY(i);
    const sz = p.getZ(i);
    p.setXYZ(i, width / 2 - sz, sy, sx);
  }
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function wheels(len: number, width: number, r: number, axles: number[], out: THREE.BufferGeometry[]): void {
  for (const z of axles)
    for (const s of [-1, 1]) {
      const w = new THREE.CylinderGeometry(r, r, 0.2, 14);
      w.rotateZ(Math.PI / 2);
      w.translate(s * (width / 2 - 0.08), r, z);
      out.push(w);
    }
  void len;
}

const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  return g;
}))!;

export function buildVehicle(kind: VehicleKind): VehicleParts {
  if (kind === 'bus' || kind === 'doubleDecker') return bus(kind === 'doubleDecker');
  if (kind === 'scooter') return scooter();
  const L = kind === 'taxi' ? 3.6 : kind === 'suv' ? 4.4 : kind === 'cab' ? 4.0 : 3.85;
  const W = kind === 'suv' ? 1.8 : kind === 'taxi' ? 1.6 : 1.7;
  const beltY = kind === 'suv' ? 1.08 : kind === 'taxi' ? 0.98 : 0.93;
  const roofY = kind === 'taxi' ? 1.58 : kind === 'suv' ? 1.76 : 1.46;
  const h = L / 2;
  // Cabin stations along the car (front windscreen base → top → rear top → rear glass base).
  const zA = h - (kind === 'taxi' ? 0.95 : kind === 'suv' ? 1.05 : 1.15);
  const zB = zA - (kind === 'taxi' ? 0.55 : 0.7);
  const zD = -h + (kind === 'cab' ? 0.75 : kind === 'suv' ? 0.18 : 0.22);
  const zC = zD + (kind === 'cab' ? 0.55 : 0.2);
  const paint: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  // Lower body: bumpers, sloping bonnet, boot.
  paint.push(
    extrudeSide(
      [
        [-h, 0.3],
        [h, 0.3],
        [h, 0.6],
        [h - 0.1, 0.74],
        [zA + 0.05, beltY],
        [zD - 0.02, beltY],
        [-h + 0.08, beltY - 0.06],
        [-h, 0.66],
      ],
      W - 0.08,
    ),
  );
  // Greenhouse (glass), slightly narrower than the body.
  glass.push(
    extrudeSide(
      [
        [zA, beltY - 0.02],
        [zB, roofY - 0.03],
        [zC, roofY - 0.03],
        [zD, beltY - 0.02],
      ],
      W - 0.26,
    ),
  );
  // Roof skin (yellow on kaali-peeli taxis) and a waistline strip.
  const roof = box(W - 0.3, 0.06, zB - zC + 0.06, 0, roofY, (zB + zC) / 2);
  (kind === 'taxi' ? accent : paint).push(roof);
  if (kind === 'taxi') for (const s of [-1, 1]) accent.push(box(0.04, 0.05, zA - zD, s * (W / 2 - 0.1), beltY + 0.01, (zA + zD) / 2));
  // Bumpers, grille, sills, wheel arches, mirrors.
  dark.push(box(W, 0.16, 0.1, 0, 0.4, h + 0.03), box(W, 0.16, 0.1, 0, 0.4, -h - 0.03));
  dark.push(box(W * 0.5, 0.1, 0.03, 0, 0.62, h + 0.005));
  dark.push(box(W + 0.01, 0.06, L - 1.9, 0, 0.34, 0));
  for (const z of [h - 0.72, -h + 0.72]) for (const s of [-1, 1]) dark.push(box(0.05, 0.12, 0.8, s * (W / 2 - 0.02), 0.62, z));
  for (const s of [-1, 1]) dark.push(box(0.12, 0.08, 0.1, s * (W / 2 + 0.03), beltY + 0.06, zA - 0.12));
  wheels(L, W, 0.3, [h - 0.72, -h + 0.72], dark);
  const lf = [box(0.3, 0.1, 0.04, -(W / 2 - 0.22), 0.66, h - 0.04), box(0.3, 0.1, 0.04, W / 2 - 0.22, 0.66, h - 0.04)];
  const lr = [box(0.2, 0.13, 0.04, -(W / 2 - 0.16), 0.75, -h + 0.03), box(0.2, 0.13, 0.04, W / 2 - 0.16, 0.75, -h + 0.03)];
  return { paint: merge(paint), accent: merge(accent.length ? accent : [box(0.01, 0.01, 0.01, 0, -5, 0)]), glass: merge(glass), dark: merge(dark), lightsFront: merge(lf), lightsRear: merge(lr), length: L, width: W };
}

function bus(double: boolean): VehicleParts {
  const L = double ? 11.2 : 11.8;
  const W = 2.55;
  const H = double ? 4.35 : 3.15;
  const h = L / 2;
  const paint: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  paint.push(box(W, 1.0, L, 0, 0.85, 0));
  paint.push(box(W, 0.35, L, 0, 2.28, 0));
  if (double) {
    paint.push(box(W, 0.4, L, 0, 3.02, 0));
    glass.push(box(W - 0.04, 0.9, L - 0.6, 0, 3.66, 0));
    accent.push(box(W - 0.02, 0.18, L - 0.2, 0, H - 0.05, 0));
  } else accent.push(box(W - 0.1, 0.25, L - 0.4, 0, H - 0.1, 0));
  glass.push(box(W - 0.04, 0.95, L - 0.6, 0, 1.75, 0));
  glass.push(box(W - 0.2, 1.3, 0.05, 0, 1.8, h + 0.01));
  // Destination board.
  accent.push(box(W - 0.5, 0.32, 0.06, 0, double ? 2.95 : 2.62, h + 0.03));
  dark.push(box(W + 0.02, 0.3, 0.2, 0, 0.3, h), box(W + 0.02, 0.3, 0.2, 0, 0.3, -h));
  dark.push(box(W - 0.3, 0.12, L - 2, 0, 0.3, 0));
  wheels(L, W, 0.5, [h - 2.2, -h + 2.8], dark);
  const lf = [box(0.3, 0.16, 0.04, -(W / 2 - 0.3), 0.75, h + 0.02), box(0.3, 0.16, 0.04, W / 2 - 0.3, 0.75, h + 0.02)];
  const lr = [box(0.2, 0.3, 0.04, -(W / 2 - 0.2), 0.95, -h - 0.02), box(0.2, 0.3, 0.04, W / 2 - 0.2, 0.95, -h - 0.02)];
  return { paint: merge(paint), accent: merge(accent), glass: merge(glass), dark: merge(dark), lightsFront: merge(lf), lightsRear: merge(lr), length: L, width: W };
}

function scooter(): VehicleParts {
  const paint = [box(0.32, 0.45, 1.3, 0, 0.55, 0), box(0.3, 0.55, 0.2, 0, 0.95, 0.5)];
  const dark = [box(0.1, 0.5, 0.5, 0, 0.3, 0.0)];
  for (const z of [0.55, -0.5]) {
    const w = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12);
    w.rotateZ(Math.PI / 2);
    w.translate(0, 0.24, z);
    dark.push(w);
  }
  dark.push(box(0.6, 0.04, 0.04, 0, 1.18, 0.5));
  // A rider (simple silhouette).
  const accent = [box(0.36, 0.6, 0.28, 0, 1.25, -0.15), new THREE.SphereGeometry(0.14, 8, 6).translate(0, 1.72, -0.12), box(0.28, 0.4, 0.5, 0, 0.8, 0.0)];
  const glass = [box(0.28, 0.2, 0.02, 0, 1.2, 0.62)];
  const lf = [box(0.12, 0.1, 0.03, 0, 0.98, 0.62)];
  const lr = [box(0.1, 0.06, 0.03, 0, 0.7, -0.66)];
  return { paint: merge(paint), accent: merge(accent), glass: merge(glass), dark: merge(dark), lightsFront: merge(lf), lightsRear: merge(lr), length: 1.4, width: 0.6 };
}
