import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { GeoBuilder, tint } from '../../gfx/GeoBuilder';
import { FACADE } from '../../gfx/FacadeTextures';
import type { GeoBuilding } from '../city/City';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { MD, VN } from './RouteLayout';

type RGB = [number, number, number];

/** Mumbai Art Deco palette: wall tint and accent (fins, bands). */
const PALETTE: { wall: RGB; accent: RGB; band: RGB }[] = [
  { wall: [1.0, 0.93, 0.76], accent: [0.62, 0.2, 0.12], band: [1.02, 0.98, 0.9] }, // butter yellow / terracotta
  { wall: [1.0, 0.86, 0.74], accent: [0.55, 0.3, 0.2], band: [1.02, 0.95, 0.88] }, // peach
  { wall: [0.97, 0.95, 0.9], accent: [0.2, 0.35, 0.38], band: [1.0, 1.0, 0.97] }, // off-white / teal
  { wall: [0.92, 0.95, 0.88], accent: [0.35, 0.45, 0.3], band: [0.98, 1.0, 0.95] }, // pale mint
  { wall: [1.0, 0.84, 0.8], accent: [0.6, 0.25, 0.25], band: [1.02, 0.94, 0.92] }, // salmon pink
  { wall: [0.95, 0.9, 0.8], accent: [0.45, 0.32, 0.22], band: [1.0, 0.97, 0.9] }, // sand
  { wall: [1.0, 0.97, 0.9], accent: [0.72, 0.52, 0.2], band: [1.02, 1.0, 0.95] }, // ivory / ochre
];

export interface DecoInfo {
  id: number;
  wall: RGB;
  accent: RGB;
  band: RGB;
  style: number;
  /** Indices of footprint edges facing a street. */
  edges: number[];
  soona: boolean;
}

function centroid(fp: number[]): [number, number] {
  let x = 0;
  let z = 0;
  const n = fp.length / 2;
  for (let i = 0; i < n; i++) {
    x += fp[i * 2];
    z += fp[i * 2 + 1];
  }
  return [x / n, z / n];
}

/** Picks the corridor buildings (V.N. Road both sides, the Marine Drive row) and their street edges. */
export function decoBuildings(buildings: GeoBuilding[]): Map<number, DecoInfo> {
  const out = new Map<number, DecoInfo>();
  const rng = new RNG(1937);
  const vn = VN.axis;
  const md = MD.axis;
  for (const b of buildings) {
    if (b.t === 'train_station' || b.t === 'roof' || b.t === 'part') continue;
    // Heritage (stone) buildings keep their own look and floor heights.
    if (b.hist === 1 || ['university', 'college', 'government', 'civic', 'public', 'church', 'cathedral', 'service'].includes(b.t)) continue;
    const [cx, cz] = centroid(b.fp);
    const pv = vn.project(cx, cz);
    const pm = md.project(cx, cz);
    const onVN = pv.s > VN.sWest - 15 && pv.s < VN.sEast + 25 && Math.abs(pv.o) < 70 && Math.abs(pv.o) > VN.kerb;
    const onMD = pm.s > MD.sDetail0 - 40 && pm.s < MD.sDetail1 + 40 && pm.o > MD.eastFoot && pm.o < MD.eastFoot + 70;
    if (!onVN && !onMD) continue;
    const p = b.fp;
    const n = p.length / 2;
    const edges: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = p[i * 2];
      const z0 = p[i * 2 + 1];
      const x1 = p[j * 2];
      const z1 = p[j * 2 + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 4) continue;
      let nx = (z1 - z0) / len;
      let nz = -(x1 - x0) / len;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      if ((mx + nx - cx) ** 2 + (mz + nz - cz) ** 2 < (mx - cx) ** 2 + (mz - cz) ** 2) {
        nx = -nx;
        nz = -nz;
      }
      let facing = false;
      for (const ax of [vn, md]) {
        const q = ax.project(mx, mz);
        if (Math.abs(q.o) > 48 || q.d > 60) continue;
        const [px, pz] = ax.point(q.s, 0);
        const dx = px - mx;
        const dz = pz - mz;
        const dl = Math.hypot(dx, dz) || 1;
        if ((nx * dx + nz * dz) / dl > 0.6) facing = true;
      }
      if (facing) edges.push(i);
    }
    if (!edges.length) continue;
    const soona = b.n === 'Soona Mahal';
    const pal = soona ? { wall: [1.02, 0.86, 0.5] as RGB, accent: [0.66, 0.12, 0.08] as RGB, band: [1.02, 0.95, 0.78] as RGB } : rng.pick(PALETTE);
    out.set(b.id, {
      id: b.id,
      ...pal,
      style: soona || rng.chance(0.55) ? FACADE.decoBalcony : FACADE.deco,
      edges,
      soona,
    });
  }
  return out;
}

/** Floor bands, rounded corner stacks, fins and stepped parapets on the corridor's Art Deco buildings. */
export function buildDecoDressing(buildings: GeoBuilding[], heights: Map<number, number>, info: Map<number, DecoInfo>, mats: StationMaterials): THREE.Group {
  const gb = new GeoBuilder();
  const rng = new RNG(1938);
  const ground = 4.3;
  const floorH = 3.35;
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number, c: RGB) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(ry);
    gb.add('cityDetail', tint(g.translate(x, y, z), c[0], c[1], c[2]));
  };
  for (const d of info.values()) {
    const b = byId.get(d.id);
    const H = heights.get(d.id);
    if (!b || !H) continue;
    const p = b.fp;
    const n = p.length / 2;
    const [cx, cz] = centroid(p);
    const floors = Math.max(1, Math.round((H - ground) / floorH));
    const street = new Set(d.edges);
    for (const i of d.edges) {
      const j = (i + 1) % n;
      const x0 = p[i * 2];
      const z0 = p[i * 2 + 1];
      const x1 = p[j * 2];
      const z1 = p[j * 2 + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      let nx = (z1 - z0) / len;
      let nz = -(x1 - x0) / len;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      if ((mx + nx - cx) ** 2 + (mz + nz - cz) ** 2 < (mx - cx) ** 2 + (mz - cz) ** 2) {
        nx = -nx;
        nz = -nz;
      }
      const ry = Math.atan2(-(z1 - z0), x1 - x0);
      const depth = 0.55 + rng.range(0, 0.2);
      // Projecting floor bands (balcony slabs / eyebrow sunshades) on every floor.
      for (let k = 0; k < floors; k++) {
        const y = ground + k * floorH - 0.1;
        if (y > H - 0.8) break;
        box(len + 0.3, 0.16, depth, mx + nx * (depth / 2 - 0.02), y, mz + nz * (depth / 2 - 0.02), ry, d.band);
      }
      // Ground-floor canopy.
      box(len, 0.14, 1.3, mx + nx * 0.65, ground - 0.55, mz + nz * 0.65, ry, [0.5, 0.48, 0.45]);
      // Stepped parapet panel and vertical fin on long facades.
      if (len > 11) {
        const fin = len > 18 || d.soona ? 2 : 1;
        for (let f = 0; f < fin; f++) {
          const t = fin === 1 ? 0.5 : 0.36 + f * 0.28;
          const fx = x0 + (x1 - x0) * t + nx * 0.45;
          const fz = z0 + (z1 - z0) * t + nz * 0.45;
          box(0.34, H - ground + 2.2, 0.9, fx, ground + (H - ground + 2.2) / 2, fz, ry, d.accent);
        }
        const pw = Math.min(len * 0.34, 9);
        box(pw, 1.6, 0.35, mx + nx * 0.1, H + 0.8, mz + nz * 0.1, ry, d.band);
        box(pw * 0.6, 1.0, 0.35, mx + nx * 0.1, H + 2.1, mz + nz * 0.1, ry, d.band);
        for (let g = 0; g < 3; g++) box(pw + 0.02, 0.06, 0.4, mx + nx * 0.1, H + 0.35 + g * 0.35, mz + nz * 0.1, ry, d.accent);
      }
    }
    // Rounded corner stacks at convex corners between two street-facing edges (or at the end of one).
    for (let v = 0; v < n; v++) {
      const prev = (v - 1 + n) % n;
      const a = street.has(prev);
      const c = street.has(v);
      if (!a && !c) continue;
      const vx = p[v * 2];
      const vz = p[v * 2 + 1];
      const px = p[prev * 2];
      const pz = p[prev * 2 + 1];
      const qx = p[((v + 1) % n) * 2];
      const qz = p[((v + 1) % n) * 2 + 1];
      const e1 = new THREE.Vector2(px - vx, pz - vz);
      const e2 = new THREE.Vector2(qx - vx, qz - vz);
      if (e1.length() < 6 || e2.length() < 6) continue;
      e1.normalize();
      e2.normalize();
      const cos = e1.dot(e2);
      if (cos < -0.5 || cos > 0.5) continue; // roughly right angles only
      if (!(a && c) && !d.soona && rng.chance(0.55)) continue;
      // Convex test: the corner must point away from the centroid.
      const bis = e1.clone().add(e2).normalize();
      const toC = new THREE.Vector2(cx - vx, cz - vz).normalize();
      if (bis.dot(toC) < 0.2) continue;
      const R = d.soona ? 3.6 : rng.range(2.0, 2.8);
      const ox = vx + bis.x * R * 0.85;
      const oz = vz + bis.y * R * 0.85;
      {
        // Keep the drum clear of the footpaths.
        const qv = VN.axis.project(ox, oz);
        const qm = MD.axis.project(ox, oz);
        const inVN = qv.s > VN.sWest - 10 && qv.s < VN.sEast + 20 && Math.abs(qv.o) - R < VN.footpath + 0.5;
        const inMD = qm.o - R < MD.eastFoot + 0.5 && qm.o > 0;
        if (inVN || inMD) continue;
      }
      const tall = d.soona ? H + 5.5 : H + rng.range(0, 1.5);
      const cyl = new THREE.CylinderGeometry(R, R, tall, 20);
      gb.add('cityDetail', tint(cyl.translate(ox, tall / 2, oz), d.wall[0] * 0.98, d.wall[1] * 0.98, d.wall[2] * 0.98));
      // Curved balcony slabs wrapping the corner.
      for (let k = 0; k < floors; k++) {
        const y = ground + k * floorH - 0.1;
        if (y > H - 0.8) break;
        const disc = new THREE.CylinderGeometry(R + 0.55, R + 0.55, 0.16, 20);
        gb.add('cityDetail', tint(disc.translate(ox, y, oz), d.band[0], d.band[1], d.band[2]));
        // Curved window band (dark glazing ring) between slabs.
        const ring = new THREE.CylinderGeometry(R + 0.02, R + 0.02, 1.3, 20, 1, true);
        gb.add('cityDetail', tint(ring.translate(ox, y + 1.35, oz), 0.16, 0.18, 0.2));
      }
      if (d.soona) {
        // Soona Mahal's round tower: a drum with windows and a flying-saucer cap.
        const drum = new THREE.CylinderGeometry(R * 0.72, R * 0.72, 3.4, 20);
        gb.add('cityDetail', tint(drum.translate(ox, tall + 1.7, oz), 1.02, 0.9, 0.6));
        const ringW = new THREE.CylinderGeometry(R * 0.73, R * 0.73, 1.2, 20, 1, true);
        gb.add('cityDetail', tint(ringW.translate(ox, tall + 1.8, oz), 0.16, 0.18, 0.2));
        const cap = new THREE.CylinderGeometry(R * 1.25, R * 0.8, 0.5, 24);
        gb.add('cityDetail', tint(cap.translate(ox, tall + 3.65, oz), 0.95, 0.9, 0.82));
        const lip = new THREE.CylinderGeometry(R * 1.28, R * 1.28, 0.12, 24);
        gb.add('cityDetail', tint(lip.translate(ox, tall + 3.45, oz), 0.66, 0.12, 0.08));
      }
    }
  }
  const group = gb.build(mats.m);
  group.name = 'deco-dressing';
  return group;
}
