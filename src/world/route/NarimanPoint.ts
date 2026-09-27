import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { GeoBuilder } from '../../gfx/GeoBuilder';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import type { CollisionWorld } from '../../core/Collision';
import { makeCanvas, rgba, type TextureFactory } from '../../gfx/TextureFactory';
import { InstanceCuller } from '../../gfx/InstanceCuller';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { LATIN } from '../../gfx/Signage';
import type { GeoBuilding } from '../city/City';
import type { TreeSpot } from '../city/Trees';
import { flatPolygon, pathStrip, pathWall, type Path2 } from './Path2';
import { H, MD, NP } from './RouteLayout';
import { at, instanceProps } from './MarineDrive';
import { C, Kit, dustbin, tetrapodGeometry, twinArmLamp, uHoop, type PropGeo } from './Props';
import type { WalkSurface } from './WalkSurface';
import type { SignalDef, Phase } from './Signals';
import type { VehicleKind } from '../../entities/traffic/VehicleGeometry';

/** OSM ids of the hand-built Nariman Point landmarks (outline and tower part). */
export const NP_LANDMARKS = {
  airIndia: 358470268,
  airIndiaTower: 1009324337,
  airIndiaBase: 1009324336,
  express: 356173966,
  expressTower: 1009324335,
  trident: 753875938,
  tridentTower: 1242501114,
  oberoi: 753875937,
  oberoiTower: 1009324323,
  tata: 207413334,
  bhabha: 38748504,
};

/** Area the city generator builds for Nariman Point (local metres). */
export const NP_CITY_AREA = { x0: -1250, x1: -380, z0: 380, z1: 1130 };

/**
 * One cycle of the Air India junction: Marine Drive / Sir Dorab Tata Road through traffic, then
 * Madame Cama Road, then the green man on the zebras (seconds).
 */
export const NP_PHASES: Phase[] = [
  { dur: 34, green: ['NP_MD'] },
  { dur: 3, amber: ['NP_MD'] },
  { dur: 2 },
  { dur: 20, green: ['NP_MC'] },
  { dur: 3, amber: ['NP_MC'] },
  { dur: 2 },
  { dur: 20, green: ['NP_PED'] },
  { dur: 7, flash: ['NP_PED'] },
  { dur: 3 },
];

// Carriageway centre lines from OSM (see RouteLayout NP): land side (southbound) and sea side
// (northbound), each continuing round the turning loop by the NCPA.
const SB_OSM: [number, number][] = [
  [-659.5, 424.5], [-663.6, 428.8], [-677.1, 442.9], [-691.2, 457.5], [-740.7, 511.8], [-798.2, 563.2], [-806.4, 570.5],
  [-849.2, 608.8], [-916.9, 669.3], [-926.6, 677.9], [-992.9, 737.6], [-1061.4, 799.1],
];
const NB_OSM: [number, number][] = [
  [-673, 414.4], [-674.2, 415.6], [-676.3, 418], [-689.2, 432.1], [-750.6, 499.4], [-768.9, 519.7], [-771, 521.6],
  [-935.6, 667.9], [-1002.4, 727.9], [-1070.4, 789],
];
// Madame Cama Road, inbound to the junction (OSM way 1178038145), for its stop line.
const MC_IN: [number, number][] = [
  [-643.2, 438.5], [-653.7, 429.5], [-658.2, 425.7], [-659.5, 424.5],
];

export interface NarimanResult {
  group: THREE.Group;
  cullers: InstanceCuller[];
  lampHeads: THREE.Vector3[];
  wallSeats: { x: number; z: number; ry: number }[];
  trees: TreeSpot[];
  signals: SignalDef[];
  stops: { x: number; z: number; dx: number; dz: number; group: string }[];
  parked: { x: number; z: number; heading: number; kind: VehicleKind }[];
  standing: { x: number; z: number; ry: number }[];
  /** Offset of the promenade's inner (road-side) edge along the arc (for walkers). */
  promInner: (s: number) => number;
  /** A viewing spot at the tip; ry is the camera yaw looking back north along the necklace. */
  tipView: { x: number; z: number; ry: number };
}

/** Piecewise-linear offset along the arc, from (s, o) samples. */
function knots(samples: [number, number][]): (s: number) => number {
  const k = samples.slice().sort((p, q) => p[0] - q[0]);
  return (s: number) => {
    if (s <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) {
      if (s <= k[i][0]) {
        const t = (s - k[i - 1][0]) / (k[i][0] - k[i - 1][0] || 1);
        return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * t;
      }
    }
    return k[k.length - 1][1];
  };
}

/** Flat ribbon between two offset functions (metre UVs as pathStrip). */
function vstrip(a: Path2, s0: number, s1: number, oA: (s: number) => number, oB: (s: number) => number, y: number, step = 2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const [ax, az] = a.point(s, oA(s));
    const [bx, bz] = a.point(s, oB(s));
    pos.push(ax, y, az, bx, y, bz);
    uv.push(s, oA(s), s, oB(s));
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if ((g.attributes.normal as THREE.BufferAttribute).getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** Vertical face along a varying offset (kerb faces); `facing` as pathWall. */
function vwall(a: Path2, s0: number, s1: number, o: (s: number) => number, y0: number, y1: number, facing: 1 | -1, step = 2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const [x, z] = a.point(s, o(s));
    pos.push(x, y0, z, x, y1, z);
    uv.push(s, 0, s, y1 - y0);
    if (i > 0) {
      const k = (i - 1) * 2;
      if (facing > 0) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- Landmark facades -------------------------------------------------------------------------

interface FacadeSpec {
  /** Metres per texture tile (across, up). */
  tileW: number;
  tileH: number;
  /** Bays and floors in one tile. */
  bays: number;
  floors: number;
  draw: (c: CanvasRenderingContext2D, x: number, y: number, bw: number, fh: number) => void;
  wall: string;
  /** Window rectangles within a bay (fractions of the bay / floor), for the lit-window map. */
  windows: [number, number, number, number][];
  litShare: number;
}

/** Tower facades whose windows light up after dusk (dark by day: windows read as glass). */
const nightMats: THREE.MeshStandardMaterial[] = [];

/** Lights the towers' windows with the evening (lamps: 0 by day … 1 at night). */
export function updateNarimanNight(lamps: number): void {
  const k = THREE.MathUtils.smoothstep(lamps, 0.25, 1);
  for (const m of nightMats) m.emissiveIntensity = 1.7 * k;
}

/** Canvas facade with a matching emissive map of randomly lit windows (brighter after dark). */
function facadeMaterial(tf: TextureFactory, mats: StationMaterials, key: string, f: FacadeSpec): THREE.MeshStandardMaterial {
  const existing = mats.m[key] as THREE.MeshStandardMaterial | undefined;
  if (existing) return existing;
  const W = 512;
  const Hh = Math.round((W * (f.tileH * f.floors)) / (f.tileW * f.bays));
  const [c, ctx] = makeCanvas(W, Hh);
  const [e, ectx] = makeCanvas(W, Hh);
  ctx.fillStyle = f.wall;
  ctx.fillRect(0, 0, W, Hh);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, Hh);
  const bw = W / f.bays;
  const fh = Hh / f.floors;
  const rng = new RNG(key.length * 131);
  for (let j = 0; j < f.floors; j++)
    for (let i = 0; i < f.bays; i++) {
      const x = i * bw;
      const y = j * fh;
      f.draw(ctx, x, y, bw, fh);
      const lit = rng.chance(f.litShare);
      const warm = rng.chance(0.7);
      for (const [wx, wy, ww, wh] of f.windows) {
        if (!lit && !rng.chance(0.08)) continue;
        ectx.fillStyle = warm ? rgba(255, rng.range(200, 225), rng.range(140, 170), 1) : rgba(215, 230, 255, 1);
        ectx.fillRect(x + wx * bw, y + wy * fh, ww * bw, wh * fh);
      }
    }
  tf.overlayNoise(ctx, W, Hh, 2, 3, 0.18, 'multiply', key.length);
  const map = tf.tex(c);
  const emissiveMap = tf.tex(e);
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82 });
  mats.add(key, mat, 0.15);
  nightMats.push(mat);
  // One texture tile covers `bays` bays and `floors` floors.
  (mat.userData as { tile: [number, number] }).tile = [f.tileW * f.bays, f.tileH * f.floors];
  return mat;
}

/** Walls of a footprint prism with outward faces and metre UVs scaled to the facade tile. */
function prismWalls(fp: number[], y0: number, y1: number, tile: [number, number], vOffset = 0): THREE.BufferGeometry {
  const n = fp.length / 2;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += fp[i * 2] / n;
    cz += fp[i * 2 + 1] / n;
  }
  const pos: number[] = [];
  const uv: number[] = [];
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ax = fp[i * 2];
    let az = fp[i * 2 + 1];
    let bx = fp[j * 2];
    let bz = fp[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    // The quad (a0, b0, b1) faces (−dz, dx); flip the edge so that points away from the centroid.
    const mx = (ax + bx) / 2 - cx;
    const mz = (az + bz) / 2 - cz;
    if (-(bz - az) * mx + (bx - ax) * mz < 0) [ax, az, bx, bz] = [bx, bz, ax, az];
    const u0 = u / tile[0];
    const u1 = (u + len) / tile[0];
    const v0 = (y0 - vOffset) / tile[1];
    const v1 = (y1 - vOffset) / tile[1];
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    u += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Footprint scaled about its centroid (for set-backs and roof overhangs). */
function scaleFp(fp: number[], k: number): number[] {
  const n = fp.length / 2;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += fp[i * 2] / n;
    cz += fp[i * 2 + 1] / n;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(cx + (fp[i * 2] - cx) * k, cz + (fp[i * 2 + 1] - cz) * k);
  return out;
}

const pairs = (fp: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < fp.length; i += 2) out.push([fp[i], fp[i + 1]]);
  return out;
};

/** Longest edge of a footprint (for placing signs on the narrow or broad faces). */
function edges(fp: number[]): { ax: number; az: number; bx: number; bz: number; len: number }[] {
  const n = fp.length / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = fp[i * 2];
    const az = fp[i * 2 + 1];
    const bx = fp[j * 2];
    const bz = fp[j * 2 + 1];
    out.push({ ax, az, bx, bz, len: Math.hypot(bx - ax, bz - az) });
  }
  return out;
}

function buildLandmarks(buildings: GeoBuilding[], tf: TextureFactory, mats: StationMaterials, col: CollisionWorld, av: AmbientVolume): THREE.Group {
  const group = new THREE.Group();
  group.name = 'np-landmarks';
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const fpOf = (id: number) => byId.get(id)?.fp ?? null;
  const gb = new GeoBuilder();
  const M = mats.m;
  if (!M.npStone) mats.add('npStone', new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.9 }), 0.4);
  if (!M.npRoof) mats.add('npRoof', new THREE.MeshStandardMaterial({ color: 0x8c877d, roughness: 0.95 }), 0.4);
  if (!M.npGlassDark) mats.add('npGlassDark', new THREE.MeshStandardMaterial({ color: 0x1d252c, roughness: 0.15, metalness: 0.7 }));
  if (!M.npGreen) mats.add('npGreen', new THREE.MeshStandardMaterial({ color: 0x4e6b34, roughness: 0.95 }), 0.5);
  const T = (m: THREE.Material) => (m.userData as { tile: [number, number] }).tile;
  const solid = (fp: number[], h: number) => {
    const n = fp.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      col.addWall(fp[i * 2], fp[i * 2 + 1], fp[j * 2], fp[j * 2 + 1], 0.4, -2, h);
    }
  };

  // Air-India Building: white slab, rows of small square windows, a recessed glazed top floor
  // under a thin overhanging roof, and a round podium at the foot. No airline branding (see doc).
  // Rows of small square windows (≈1 m, 0.9 m apart) on every floor (reference photos).
  const aiMat = facadeMaterial(tf, mats, 'npAirIndia', {
    tileW: 1.9,
    tileH: 3.9,
    bays: 12,
    floors: 6,
    wall: '#e6e3da',
    litShare: 0.35,
    windows: [[0.24, 0.4, 0.52, 0.3]],
    draw: (c, x, y, bw, fh) => {
      c.fillStyle = 'rgba(0,0,0,0.05)';
      c.fillRect(x, y + fh * 0.84, bw, fh * 0.05);
      c.fillStyle = '#2a2e33';
      c.fillRect(x + bw * 0.24, y + fh * 0.4, bw * 0.52, fh * 0.3);
      c.fillStyle = 'rgba(255,255,255,0.3)';
      c.fillRect(x + bw * 0.24, y + fh * 0.7, bw * 0.52, fh * 0.025);
    },
  });
  const podMat = facadeMaterial(tf, mats, 'npPodium', {
    tileW: 3.0,
    tileH: 5.5,
    bays: 8,
    floors: 2,
    wall: '#d9d5cb',
    litShare: 0.6,
    windows: [[0.04, 0.3, 0.92, 0.42]],
    draw: (c, x, y, bw, fh) => {
      c.fillStyle = '#343c43';
      c.fillRect(x + bw * 0.04, y + fh * 0.3, bw * 0.92, fh * 0.42);
      c.fillStyle = 'rgba(210,220,230,0.25)';
      c.fillRect(x + bw * 0.04, y + fh * 0.3, bw * 0.92, fh * 0.1);
    },
  });
  {
    const tower = fpOf(NP_LANDMARKS.airIndiaTower);
    const base = fpOf(NP_LANDMARKS.airIndiaBase);
    if (tower) {
      const H1 = 99;
      gb.add('npAirIndia', prismWalls(tower, 0, H1, T(aiMat)));
      const top = scaleFp(tower, 0.95);
      gb.add('npGlassDark', prismWalls(top, H1, H1 + 4.2, [4, 4]));
      const roof = scaleFp(tower, 1.04);
      gb.add('npStone', prismWalls(roof, H1 + 4.2, H1 + 5.0, [4, 4]));
      gb.add('npStone', flatPolygon(pairs(roof), H1 + 5.0));
      // Underside of the overhang (seen from the street).
      gb.add('npStone', flatPolygon(pairs(roof), H1 + 4.2).scale(1, -1, 1).translate(0, 2 * (H1 + 4.2), 0));
      // Plant rooms on the roof.
      gb.add('npRoof', prismWalls(scaleFp(tower, 0.35), H1 + 5.0, H1 + 8.0, [4, 4]));
      gb.add('npRoof', flatPolygon(pairs(scaleFp(tower, 0.35)), H1 + 8.0));
      solid(tower, H1);
    }
    if (base) {
      // The rounded podium: two glazed floors, a roof garden, a billboard on the corner that faces
      // the junction (the advertiser is fictional).
      gb.add('npPodium', prismWalls(base, 0, 11, T(podMat)));
      gb.add('npGreen', flatPolygon(pairs(base), 11.02));
      solid(base, 11);
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < base.length; i += 2) {
        const d = Math.hypot(base[i] + 667, base[i + 1] - 419);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      const bx = base[best];
      const bz = base[best + 1];
      const ry = Math.atan2(-667 - bx, 419 - bz);
      const ad = tf.memo('npBillboard', () => {
        const [c, ctx] = makeCanvas(512, 224);
        const g = ctx.createLinearGradient(0, 0, 512, 0);
        g.addColorStop(0, '#0f5c4a');
        g.addColorStop(1, '#1b8a6b');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 512, 224);
        ctx.fillStyle = '#f7e7b0';
        ctx.beginPath();
        ctx.arc(420, 112, 70, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.font = `800 64px ${LATIN}`;
        ctx.fillText('KAVERI TEA', 28, 84, 330);
        ctx.font = `600 28px ${LATIN}`;
        ctx.fillText('every sunset, a fresh cup', 30, 150, 330);
        return tf.tex(c, { wrap: false });
      });
      if (!M.npBillboard) {
        const bm = new THREE.MeshStandardMaterial({ map: ad, emissiveMap: ad, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
        mats.add('npBillboard', bm);
        nightMats.push(bm);
      }
      const board = new THREE.PlaneGeometry(9, 3.9).rotateY(ry).translate(bx + Math.sin(ry) * 0.6, 6.3, bz + Math.cos(ry) * 0.6);
      gb.add('npBillboard', board);
    }
  }

  // Express Towers: dark tinted grid tower on a low podium.
  const exMat = facadeMaterial(tf, mats, 'npExpress', {
    tileW: 1.6,
    tileH: 3.6,
    bays: 12,
    floors: 6,
    wall: '#3b3a36',
    litShare: 0.3,
    windows: [[0.1, 0.12, 0.8, 0.66]],
    draw: (c, x, y, bw, fh) => {
      c.fillStyle = '#20262c';
      c.fillRect(x + bw * 0.1, y + fh * 0.12, bw * 0.8, fh * 0.66);
      c.fillStyle = 'rgba(160,180,200,0.12)';
      c.fillRect(x + bw * 0.1, y + fh * 0.12, bw * 0.8, fh * 0.2);
    },
  });
  {
    const tower = fpOf(NP_LANDMARKS.expressTower);
    const outline = fpOf(NP_LANDMARKS.express);
    if (outline) {
      gb.add('npStone', prismWalls(outline, 0, 9, [4, 4]));
      gb.add('npRoof', flatPolygon(pairs(outline), 9));
      solid(outline, 9);
    }
    if (tower) {
      gb.add('npExpress', prismWalls(tower, 9, 105, T(exMat), 9));
      gb.add('npRoof', flatPolygon(pairs(tower), 105));
      gb.add('npRoof', prismWalls(scaleFp(tower, 0.5), 105, 108, [4, 4]));
    }
  }

  // Trident: tall cream slab with balcony bands; red name letters at the top of the narrow faces.
  const trMat = facadeMaterial(tf, mats, 'npTrident', {
    tileW: 3.6,
    tileH: 3.2,
    bays: 8,
    floors: 6,
    wall: '#e3dccb',
    litShare: 0.45,
    windows: [[0.12, 0.3, 0.76, 0.45]],
    draw: (c, x, y, bw, fh) => {
      c.fillStyle = '#4a5058';
      c.fillRect(x + bw * 0.12, y + fh * 0.3, bw * 0.76, fh * 0.45);
      c.fillStyle = 'rgba(255,255,255,0.3)';
      c.fillRect(x + bw * 0.49, y + fh * 0.3, bw * 0.02, fh * 0.45);
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.fillRect(x, y + fh * 0.76, bw, fh * 0.07);
    },
  });
  const oberoiMat = facadeMaterial(tf, mats, 'npOberoi', {
    tileW: 3.2,
    tileH: 3.35,
    bays: 8,
    floors: 6,
    wall: '#e8e0cc',
    litShare: 0.5,
    windows: [[0.0, 0.34, 1.0, 0.4]],
    draw: (c, x, y, bw, fh) => {
      c.fillStyle = '#394148';
      c.fillRect(x, y + fh * 0.34, bw, fh * 0.4);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(x + bw * 0.97, y + fh * 0.34, bw * 0.03, fh * 0.4);
    },
  });
  const letters = tf.memo('npTridentLetters', () => {
    const [c, ctx] = makeCanvas(1024, 192);
    ctx.clearRect(0, 0, 1024, 192);
    ctx.fillStyle = '#c4161c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 150px ${LATIN}`;
    ctx.fillText('TRIDENT', 512, 100, 1000);
    const t = tf.tex(c, { wrap: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
  if (!M.npLetters) {
    const lm = new THREE.MeshStandardMaterial({ map: letters, emissiveMap: letters, emissive: 0xffffff, emissiveIntensity: 0.3, alphaTest: 0.4, transparent: false, roughness: 0.5, side: THREE.DoubleSide });
    mats.add('npLetters', lm);
    mats.lampMats.push({ mat: lm, color: new THREE.Color(1, 1, 1), intensity: 2.2 });
  }
  {
    const tower = fpOf(NP_LANDMARKS.tridentTower);
    const outline = fpOf(NP_LANDMARKS.trident);
    const TH = 117;
    if (outline) {
      gb.add('npStone', prismWalls(outline, 0, 12, [4, 4]));
      gb.add('npRoof', flatPolygon(pairs(outline), 12));
      solid(outline, 12);
    }
    if (tower) {
      gb.add('npTrident', prismWalls(tower, 12, TH - 4, T(trMat), 12));
      gb.add('npStone', prismWalls(tower, TH - 4, TH, [4, 4]));
      gb.add('npRoof', flatPolygon(pairs(tower), TH));
      gb.add('npRoof', prismWalls(scaleFp(tower, 0.55), TH, TH + 4, [4, 4]));
      gb.add('npRoof', flatPolygon(pairs(scaleFp(tower, 0.55)), TH + 4));
      // Name letters on both narrow faces.
      const es = edges(tower).sort((p, q) => p.len - q.len).slice(0, 2);
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < tower.length; i += 2) {
        cx += tower[i] / (tower.length / 2);
        cz += tower[i + 1] / (tower.length / 2);
      }
      for (const e of es) {
        const mx = (e.ax + e.bx) / 2;
        const mz = (e.az + e.bz) / 2;
        let nx = mx - cx;
        let nz = mz - cz;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl;
        nz /= nl;
        const w = Math.min(e.len * 0.8, 17);
        const q = new THREE.PlaneGeometry(w, w * 0.19);
        q.rotateY(Math.atan2(nx, nz));
        gb.add('npLetters', q.translate(mx + nx * 0.15, TH - 2.2, mz + nz * 0.15));
      }
    }
  }
  {
    const tower = fpOf(NP_LANDMARKS.oberoiTower);
    const outline = fpOf(NP_LANDMARKS.oberoi);
    if (outline) {
      gb.add('npOberoi', prismWalls(outline, 0, 22, T(oberoiMat)));
      gb.add('npRoof', flatPolygon(pairs(outline), 22));
      solid(outline, 22);
    }
    if (tower) {
      gb.add('npOberoi', prismWalls(tower, 22, 52, T(oberoiMat)));
      gb.add('npRoof', flatPolygon(pairs(tower), 52));
    }
  }

  // NCPA: the Tata Theatre (fan-shaped auditorium under a low domed roof) and the Jamshed Bhabha
  // Theatre (stone, with a colonnade on its longest face). Forms simplified (NARIMAN_POINT.md §7).
  {
    const tata = fpOf(NP_LANDMARKS.tata);
    if (tata) {
      gb.add('npStone', prismWalls(tata, 0, 13, [4, 4]));
      const roof = flatPolygon(pairs(tata), 13);
      const p = roof.attributes.position as THREE.BufferAttribute;
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < p.count; i++) {
        cx += p.getX(i) / p.count;
        cz += p.getZ(i) / p.count;
      }
      // A raised central drum stands in for the fan-shaped roof.
      const ring: [number, number][] = pairs(tata).map(([x, z]) => [cx + (x - cx) * 0.55, cz + (z - cz) * 0.55]);
      gb.add('npRoof', roof);
      const cap = flatPolygon(ring, 17.5);
      gb.add('npRoof', cap);
      gb.add('npRoof', prismWalls(ring.flat(), 13, 17.5, [4, 4]));
      solid(tata, 13);
    }
    const bh = fpOf(NP_LANDMARKS.bhabha);
    if (bh) {
      gb.add('npStone', prismWalls(bh, 0, 19, [4, 4]));
      gb.add('npRoof', flatPolygon(pairs(bh), 19));
      const e = edges(bh).sort((p, q) => q.len - p.len)[0];
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < bh.length; i += 2) {
        cx += bh[i] / (bh.length / 2);
        cz += bh[i + 1] / (bh.length / 2);
      }
      const mx = (e.ax + e.bx) / 2;
      const mz = (e.az + e.bz) / 2;
      let nx = e.bz - e.az;
      let nz = -(e.bx - e.ax);
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      if (nx * (mx - cx) + nz * (mz - cz) < 0) {
        nx = -nx;
        nz = -nz;
      }
      const cols = Math.max(4, Math.floor(e.len / 4));
      for (let i = 0; i <= cols; i++) {
        const t = 0.08 + (0.84 * i) / cols;
        const x = e.ax + (e.bx - e.ax) * t + nx * 2.2;
        const z = e.az + (e.bz - e.az) * t + nz * 2.2;
        gb.add('npStone', new THREE.CylinderGeometry(0.45, 0.5, 13, 12).translate(x, 6.5, z));
      }
      const beam = new THREE.BoxGeometry(e.len * 0.9, 1.6, 3.2).rotateY(-Math.atan2(e.bz - e.az, e.bx - e.ax)).translate(mx + nx * 2.2, 13.8, mz + nz * 2.2);
      gb.add('npStone', beam);
      solid(bh, 19);
    }
  }
  void av;
  group.add(gb.build(M, {}));
  return group;
}

// ---- The street ---------------------------------------------------------------------------------

/**
 * Nariman Point (milestone 3): Marine Drive from the end of the detailed stretch to the Air India
 * junction, Sir Dorab Tata Road to the NCPA loop, the widened promenade with almond trees, the
 * sea wall and tetrapods to the tip, and the landmark towers.
 */
export function buildNarimanPoint(tf: TextureFactory, mats: StationMaterials, col: CollisionWorld, av: AmbientVolume, walk: WalkSurface, buildings: GeoBuilding[]): NarimanResult {
  const group = new THREE.Group();
  group.name = 'nariman-point';
  const cullers: InstanceCuller[] = [];
  const rng = new RNG(1969);
  const a = MD.axis;
  const M = mats.m;
  const gb = new GeoBuilder();
  const s1 = MD.sDetail1;
  const sJ = NP.sJunction;
  const sBox0 = sJ - 20;
  const sBox1 = sJ + 16;
  const sR = NP.sRoadEnd;
  const sE = NP.sEnd;
  const hN = (s: number) => a.heading(s);

  // Carriageway centre lines from OSM as offsets along the Marine Drive arc.
  const proj = (pts: [number, number][]) => pts.map(([x, z]) => {
    const q = a.project(x, z);
    return [q.s, q.o] as [number, number];
  });
  const sb = knots(proj(SB_OSM));
  const nb = knots(proj(NB_OSM));
  const half = NP.half;
  const park = 2.4;
  const blend = (s: number) => THREE.MathUtils.smoothstep(s, sBox1, sBox1 + 14);
  /** Sea-side kerb (promenade edge) and land-side kerb. */
  const kerbSea = (s: number) => (s <= sBox1 ? -MD.kerb : THREE.MathUtils.lerp(-MD.kerb, nb(s) - half - park, blend(s)));
  const kerbLand = (s: number) => (s <= sBox1 ? MD.kerb : THREE.MathUtils.lerp(MD.kerb, sb(s) + half, blend(s)));
  const nbIn = (s: number) => nb(s) + half;
  const sbIn = (s: number) => sb(s) - half;
  const promInner = (s: number) => (s < s1 ? -MD.kerb : s < sR ? kerbSea(s) : kerbSea(sR));

  // ---- Road ---------------------------------------------------------------------------------
  // Marine Drive's last stretch (4+4 lanes) to the junction box.
  gb.add('asphalt', pathStrip(a, s1, sBox1, -MD.kerb, MD.kerb, H.road + 0.004, 2));
  gb.add('grass', pathStrip(a, s1, sBox0 - 1.5, -MD.median, MD.median, H.median, 2));
  gb.add('mdKerb', pathWall(a, s1, sBox0 - 1.5, MD.median, H.road, H.median, 1, 2));
  gb.add('mdKerb', pathWall(a, s1, sBox0 - 1.5, -MD.median, H.road, H.median, -1, 2));
  walk.strip(a, s1, sBox0 - 1.5, -MD.median, MD.median, H.median);
  const laneW = 13.6 / MD.lanes;
  const dash = (o: (s: number) => number, sa: number, sb2: number, len = 3, gap = 5, w = 0.12) => {
    for (let s = sa; s < sb2; s += len + gap) gb.add('marking', vstrip(a, s, Math.min(sb2, s + len), (q) => o(q) - w / 2, (q) => o(q) + w / 2, H.road + 0.009, len));
  };
  const line = (o: (s: number) => number, sa: number, sb2: number, w = 0.12) => gb.add('marking', vstrip(a, sa, sb2, (q) => o(q) - w / 2, (q) => o(q) + w / 2, H.road + 0.009, 3));
  for (const side of [-1, 1]) {
    for (let k = 1; k < MD.lanes; k++) dash(() => side * (MD.median + laneW * k), s1, sBox0 - 4);
    line(() => side * (MD.median + 0.3), s1, sBox0 - 1.5);
    line(() => side * (MD.kerb - 0.35), s1, sBox0);
  }
  // The junction box and the Madame Cama Road mouth (the city draws the road beyond o ≈ 26).
  gb.add('asphalt', pathStrip(a, sBox0, sBox1 + 2, MD.kerb, 27, H.road + 0.003, 2));
  // Sir Dorab Tata Road: two carriageways with a parking lane on the sea side, a median between.
  gb.add('asphalt', vstrip(a, sBox1, sR, kerbSea, (s) => THREE.MathUtils.lerp(-MD.median, nbIn(s), blend(s)), H.road + 0.004, 2));
  gb.add('asphalt', vstrip(a, sBox1, sR, (s) => THREE.MathUtils.lerp(MD.median, sbIn(s), blend(s)), kerbLand, H.road + 0.004, 2));
  const medA = (s: number) => THREE.MathUtils.lerp(-MD.median, nbIn(s), blend(s));
  const medB = (s: number) => THREE.MathUtils.lerp(MD.median, sbIn(s), blend(s));
  const sMed0 = sBox1 + 1.5;
  const sMed1 = sR - 16;
  gb.add('grass', vstrip(a, sMed0, sMed1, medA, medB, H.median, 2));
  gb.add('mdKerb', vwall(a, sMed0, sMed1, medA, H.road, H.median, -1, 2));
  gb.add('mdKerb', vwall(a, sMed0, sMed1, medB, H.road, H.median, 1, 2));
  for (let s = sMed0; s < sMed1; s += 2) walk.strip(a, s, s + 2, medA(s), medB(s), H.median);
  // Lanes and edges.
  dash((s) => nb(s), sBox1 + 4, sR - 18);
  dash((s) => sb(s), sBox1 + 4, sR - 18);
  line((s) => nb(s) - half, sBox1 + 14, sR - 18);
  line(kerbLand, sBox1 + 14, sR - 18);
  // Turning loop at the road's end by the NCPA.
  {
    const o0 = kerbSea(sR);
    const o1 = kerbLand(sR);
    const rr = (o1 - o0) / 2;
    const [cx, cz] = a.point(sR - 2, (o0 + o1) / 2);
    const disc = new THREE.CircleGeometry(rr + 0.5, 28).rotateX(-Math.PI / 2).translate(cx, H.road + 0.004, cz);
    const dp = disc.attributes.position as THREE.BufferAttribute;
    const duv = disc.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < dp.count; i++) duv.setXY(i, dp.getX(i), -dp.getZ(i));
    gb.add('asphalt', disc);
  }
  // Zebras: across Marine Drive north of the junction and across Sir Dorab Tata Road south of it.
  const zebra = (sc: number, oA: number, oB: number) => {
    for (let o = oA + 0.4; o < oB - 0.3; o += 1.0) gb.add('marking', pathStrip(a, sc - 2.0, sc + 2.0, o, o + 0.5, H.road + 0.01, 4));
  };
  const sZN = sBox0 + 2.5;
  const sZS = sBox1 + 7;
  zebra(sZN, -MD.kerb, MD.kerb);
  zebra(sZS, kerbSea(sZS) + park, kerbLand(sZS));
  gb.add('marking', pathStrip(a, sZN - 3.6, sZN - 3.2, MD.median, MD.kerb - 0.2, H.road + 0.009, 1));
  gb.add('marking', pathStrip(a, sZS + 3.2, sZS + 3.6, kerbSea(sZS + 3.4) + park, nbIn(sZS + 3.4), H.road + 0.009, 1));

  // ---- Footpaths ----------------------------------------------------------------------------
  // East side: Marine Drive's footpath to the junction, then a 5 m footpath along the land kerb.
  gb.add('vnFootpath', pathStrip(a, s1, sBox0 - 2, MD.kerb, MD.eastFoot, H.footpath, 2));
  gb.add('mdKerb', pathWall(a, s1, sBox0 - 2, MD.kerb, H.road, H.footpath, -1, 2));
  walk.strip(a, s1, sBox0 - 2, MD.kerb, MD.eastFoot, H.footpath);
  gb.add('vnFootpath', vstrip(a, sBox1 + 4, sR - 14, kerbLand, (s) => kerbLand(s) + 5, H.footpath, 2));
  gb.add('mdKerb', vwall(a, sBox1 + 4, sR - 14, kerbLand, H.road, H.footpath, -1, 2));
  for (let s = sBox1 + 4; s < sR - 14; s += 2) walk.strip(a, s, s + 2, kerbLand(s), kerbLand(s) + 5, H.footpath);

  // ---- Promenade, wall and step ---------------------------------------------------------------
  const promEnd = sE;
  gb.add('mdPromenade', vstrip(a, s1, promEnd, () => MD.promenade, promInner, H.promenade, 2));
  gb.add('mdKerb', vwall(a, s1, sR - 2, promInner, H.road, H.promenade, 1, 2));
  for (let s = s1; s < promEnd; s += 2) walk.strip(a, s, s + 2, MD.promenade, promInner(s), H.promenade);
  // The white band continues; past the junction a second band marks the tree strip.
  line(() => -17.8, s1, promEnd);
  // Beyond the road's end: a paved plaza to the NCPA edge.
  gb.add('mdPromenade', pathStrip(a, sR - 2, promEnd, promInner(sR), 18, H.promenade, 2));
  walk.strip(a, sR - 2, promEnd, promInner(sR), 18, H.promenade);
  const wallStep = (sa: number, sbb: number, st: number) => {
    gb.add('mdSeaWall', pathStrip(a, sa, sbb, MD.stepOuter, MD.promenade, H.step, st));
    gb.add('mdSeaWall', pathWall(a, sa, sbb, MD.promenade, H.promenade, H.step, 1, st));
    gb.add('mdSeaWall', pathStrip(a, sa, sbb, MD.wallOuter, MD.stepOuter, H.wallTop, st));
    gb.add('mdSeaWall', pathWall(a, sa, sbb, MD.stepOuter, H.step, H.wallTop, 1, st));
    gb.add('mdSeaWall', pathWall(a, sa, sbb, MD.wallOuter, H.sea - 1.5, H.wallTop, -1, st));
  };
  wallStep(s1, promEnd, 2);
  walk.strip(a, s1, promEnd, MD.stepOuter, MD.promenade, H.step);
  for (let s = s1; s < promEnd; s += 8) {
    const [x0, z0] = a.point(s, (MD.wallOuter + MD.stepOuter) / 2);
    const [x1, z1] = a.point(Math.min(promEnd, s + 8.2), (MD.wallOuter + MD.stepOuter) / 2);
    col.addWall(x0, z0, x1, z1, 0.8, -5, H.wallTop);
  }
  // End of the promenade at the tip: the wall turns in towards the NCPA gardens.
  {
    const [ex0, ez0] = a.point(promEnd, MD.wallOuter);
    const [ex1, ez1] = a.point(promEnd, 18);
    const len = Math.hypot(ex1 - ex0, ez1 - ez0);
    const g = new THREE.BoxGeometry(0.75, H.wallTop - H.promenade + 0.02, len).translate(0, (H.wallTop + H.promenade) / 2, len / 2);
    g.rotateY(Math.atan2(ex1 - ex0, ez1 - ez0));
    gb.add('mdSeaWall', g.translate(ex0, 0, ez0));
    col.addWall(ex0, ez0, ex1, ez1, 0.8, -5, H.wallTop);
  }
  av.paint(-1200, 300, -560, 900, (x, z, sky, ceil) => {
    const p = a.project(x, z);
    if (p.s > s1 - 10 && p.o < 26 && p.o > MD.tetrapodToe - 20) return [1, 0];
    return [sky, ceil];
  });

  // ---- Tetrapods ----------------------------------------------------------------------------
  {
    const tetraGeo = tetrapodGeometry();
    const tetra: THREE.Matrix4[] = [];
    const band = MD.wallOuter - MD.tetrapodToe;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let s = s1; s < promEnd + 6; s += 1.45) {
      for (let r = 0; r < 5; r++) {
        const t = (r + rng.range(0.1, 0.9)) / 5;
        const o = MD.wallOuter - 0.6 - t * (band - 0.8);
        const [x, z] = a.point(s + rng.range(-0.6, 0.6), o);
        const y = THREE.MathUtils.lerp(0.15, H.sea - 0.9, Math.pow(t, 0.85)) + rng.range(-0.3, 0.2);
        e.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
        q.setFromEuler(e);
        const sc = rng.range(0.85, 1.15);
        tetra.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, sc, sc)));
      }
    }
    const mesh = new THREE.InstancedMesh(tetraGeo, M.mdTetrapod, tetra.length);
    tetra.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    cullers.push(new InstanceCuller([mesh], tetra, 1.6, 95, 25));
  }

  // ---- Street furniture, lamps, trees ----------------------------------------------------------
  const lampHeads: THREE.Vector3[] = [];
  const promLamps: THREE.Matrix4[] = [];
  const medLamps: THREE.Matrix4[] = [];
  for (let s = s1 + 10; s < promEnd - 4; s += 30) {
    // Promenade lights stand at the road edge, their heads reaching over the promenade... and the road.
    const o = s < sR ? promInner(s) - 0.7 : -18;
    const [x, z] = a.point(s, o);
    promLamps.push(at(x, H.promenade, z, hN(s)));
    col.addSolid(x, z, 0.2, 0.2, 0, -1, 6);
    const [hx, hz] = a.point(s, o + 2.3);
    lampHeads.push(new THREE.Vector3(hx, 11.8, hz));
    av.light(hx, hz, 22, 0.8);
    const [px, pz] = a.point(s, o - 7);
    av.light(px, pz, 16, 0.45);
  }
  for (let s = sMed0 + 12; s < sMed1 - 4; s += 32) {
    const w = medB(s) - medA(s);
    if (w < 2.2) continue;
    const [x, z] = a.point(s, (medA(s) + medB(s)) / 2);
    medLamps.push(at(x, H.median, z, hN(s)));
    col.addSolid(x, z, 0.22, 0.22, 0, -1, 6);
    for (const sd of [-1, 1]) {
      const [hx, hz] = a.point(s, (medA(s) + medB(s)) / 2 + sd * 2.3);
      lampHeads.push(new THREE.Vector3(hx, 11.8, hz));
    }
    av.light(x, z, 20, 0.6);
  }
  instanceProps({ geo: twinArmLamp(false), mats: promLamps, cull: { radius: 6, dist: 1800, near: 60 } }, M, group, cullers);
  instanceProps({ geo: twinArmLamp(true), mats: medLamps, cull: { radius: 6, dist: 1800, near: 60 } }, M, group, cullers);

  const trees: TreeSpot[] = [];
  const hoops: THREE.Matrix4[] = [];
  for (let s = sBox1 + 10; s < sR - 16; s += rng.range(11, 14)) {
    const [x, z] = a.point(s, promInner(s) - 2.0);
    trees.push({ x, z, s: rng.range(0.85, 1.1), kind: 'almond', y: H.promenade });
    col.addSolid(x, z, 0.3, 0.3, 0, -1, 5);
  }
  for (let s = sBox1 + 8; s < sR - 16; s += 1.55) {
    const [x, z] = a.point(s, promInner(s) - 0.55);
    hoops.push(at(x, H.promenade, z, hN(s) + Math.PI / 2));
  }
  instanceProps({ geo: uHoop(), mats: hoops, cull: { radius: 0.6, dist: 120, near: 20 } }, M, group, cullers);
  // East footpath trees (palms and almonds) in front of the towers.
  for (let s = sBox1 + 12; s < sR - 20; s += rng.range(12, 18)) {
    const [x, z] = a.point(s, kerbLand(s) + 2.5);
    trees.push({ x, z, s: rng.range(0.85, 1.15), kind: rng.chance(0.5) ? 'palm' : 'almond', y: H.footpath });
    col.addSolid(x, z, 0.3, 0.3, 0, -1, 5);
  }
  // Benches facing the sea, dustbins.
  const benchGeo = ((): PropGeo => {
    // Seat and backrest on two cast legs, facing +z.
    const k = new Kit();
    k.box('paint', 1.9, 0.07, 0.42, 0, 0.45, 0.02, C.whiteDirty);
    k.box('paint', 1.9, 0.36, 0.06, 0, 0.72, -0.2, C.whiteDirty, 0, -0.18);
    for (const x of [-0.78, 0.78]) {
      k.box('metal', 0.07, 0.44, 0.4, x, 0.22, 0.02, C.cast);
      k.box('metal', 0.07, 0.42, 0.05, x, 0.64, -0.19, C.cast);
    }
    return k.build();
  })();
  const benches: THREE.Matrix4[] = [];
  const bins: THREE.Matrix4[] = [];
  const standing: NarimanResult['standing'] = [];
  for (let s = sBox1 + 16; s < sR - 20; s += rng.range(24, 32)) {
    // Between the almond trees at the road edge, facing the sea (⚠ placement estimated).
    const [x, z] = a.point(s, promInner(s) - 3.4);
    benches.push(at(x, H.promenade, z, hN(s) - Math.PI / 2));
    col.addSolid(x, z, 0.95, 0.3, -(hN(s) - Math.PI / 2), -1, 0.9);
    if (rng.chance(0.4)) {
      const [bx, bz] = a.point(s + 3, promInner(s) - 1.2);
      bins.push(at(bx, H.promenade, bz, hN(s)));
    }
  }
  instanceProps({ geo: benchGeo, mats: benches, cull: { radius: 1.2, dist: 160, near: 20 } }, M, group, cullers);
  instanceProps({ geo: dustbin(), mats: bins, cull: { radius: 0.6, dist: 120, near: 20 } }, M, group, cullers);

  // Seats on the wall, standing spots at the tip.
  const wallSeats: NarimanResult['wallSeats'] = [];
  for (let s = s1 + 2; s < promEnd - 2; s += 0.75) {
    const [x, z] = a.point(s, (MD.wallOuter + MD.stepOuter) / 2);
    wallSeats.push({ x, z, ry: hN(s) - Math.PI / 2 });
  }
  for (let i = 0; i < 26; i++) {
    const s = promEnd - rng.range(4, 90);
    const [x, z] = a.point(s, MD.promenade + rng.range(0.3, 0.9));
    standing.push({ x, z, ry: hN(s) - Math.PI / 2 + rng.range(-0.5, 0.3) });
  }

  // Parked taxis and cars in the sea-side parking lane.
  const parked: NarimanResult['parked'] = [];
  const kinds: VehicleKind[] = ['taxi', 'taxi', 'cab', 'car', 'suv'];
  for (let s = sBox1 + 18; s < sR - 20; s += rng.range(5.3, 6.4)) {
    if (rng.chance(0.25)) continue;
    const o = nb(s) - half - park / 2;
    const [x, z] = a.point(s, o);
    const heading = hN(s) + Math.PI; // parked facing north, with the traffic
    parked.push({ x, z, heading, kind: rng.pick(kinds) });
    col.addSolid(x, z, 0.85, 2.0, -heading, -1, 1.6);
  }

  // ---- Signals (Air India junction) ------------------------------------------------------------
  const signals: SignalDef[] = [];
  const stops: NarimanResult['stops'] = [];
  const sig = (s: number, o: number, ry: number, kind: SignalDef['kind'], grp: string, extra?: { ry: number; group: string }[], y = H.footpath) => {
    const [x, z] = a.point(s, o);
    const [ax, az] = a.point(s, 0);
    const dl = Math.hypot(ax - x, az - z) || 1;
    signals.push({ x, z, ry, toRoad: [(ax - x) / dl, (az - z) / dl], kind, group: grp, banded: false, y, extra });
    col.addSolid(x, z, 0.15, 0.15, 0, -1, 6);
  };
  const hJ = hN(sJ);
  sig(sZN - 1.8, MD.kerb + 0.7, hJ + Math.PI, 'both', 'NP_MD', [{ ry: hJ, group: 'NP_MD' }]);
  sig(sZN - 1.8, -MD.kerb - 0.7, hJ + Math.PI, 'post', 'NP_MD', undefined, H.promenade);
  sig(sZS + 1.8, kerbSea(sZS) - 0.7, hJ, 'both', 'NP_MD', [{ ry: hJ + Math.PI, group: 'NP_MD' }], H.promenade);
  sig(sZS + 1.8, kerbLand(sZS) + 0.7, hJ, 'post', 'NP_MD');
  {
    // Madame Cama Road's own head, facing traffic coming down it towards the junction.
    const [x0, z0] = MC_IN[0];
    const [x1, z1] = MC_IN[MC_IN.length - 1];
    const ry = Math.atan2(x0 - x1, z0 - z1);
    const q = a.project(x1, z1);
    sig(q.s + 8, 22, ry, 'vehicle', 'NP_MC');
  }
  // Stop lines: southbound Marine Drive before the north zebra; northbound Sir Dorab Tata Road
  // before the south zebra; Madame Cama Road at its mouth. XING: vehicles through the junction.
  for (const o of [2.95, 6.35, 9.75, 13.15]) {
    const t = a.at(sZN - 3.4);
    const [x, z] = a.point(sZN - 3.4, o);
    stops.push({ x, z, dx: t.tx, dz: t.tz, group: 'NP_MD' });
    const t2 = a.at(sZN + 3.0);
    const [x2, z2] = a.point(sZN + 3.0, -o);
    stops.push({ x: x2, z: z2, dx: -t2.tx, dz: -t2.tz, group: 'NP_XING' });
  }
  for (const d of [-1.6, 1.6]) {
    const t = a.at(sZS + 3.4);
    const [x, z] = a.point(sZS + 3.4, nb(sZS + 3.4) + d);
    stops.push({ x, z, dx: -t.tx, dz: -t.tz, group: 'NP_MD' });
    const t2 = a.at(sZS - 3.0);
    const [x2, z2] = a.point(sZS - 3.0, sb(sZS - 3.0) + d);
    stops.push({ x: x2, z: z2, dx: t2.tx, dz: t2.tz, group: 'NP_XING' });
  }
  {
    const [x0, z0] = MC_IN[1];
    const [x1, z1] = MC_IN[2];
    const dl = Math.hypot(x1 - x0, z1 - z0) || 1;
    const dx = (x1 - x0) / dl;
    const dz = (z1 - z0) / dl;
    for (const d of [-1.65, 1.65]) stops.push({ x: x0 + dz * d, z: z0 - dx * d, dx, dz, group: 'NP_MC' });
  }

  // ---- Landmarks ----------------------------------------------------------------------------
  group.add(buildLandmarks(buildings, tf, mats, col, av));

  const built = gb.build(M, { noShadowKeys: ['asphalt', 'marking', 'mdPromenade', 'grass', 'mdKerb', 'vnFootpath'] });
  group.add(built);
  const tipS = promEnd - 3;
  const [tx, tz] = a.point(tipS, MD.promenade + 1.2);
  // Camera yaw looking back up the promenade, turned a little seaward to the necklace's curve.
  return { group, cullers, lampHeads, wallSeats, trees, signals, stops, parked, standing, promInner, tipView: { x: tx, z: tz, ry: hN(tipS) + 0.3 } };
}
