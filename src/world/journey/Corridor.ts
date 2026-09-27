import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../../core/Random';
import { GeoBuilder, boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { makeCanvas, rgba, type TextureFactory } from '../../gfx/TextureFactory';
import { DEVA, LATIN, SignAtlas, fillFitted, signQuad, type AtlasRect } from '../../gfx/Signage';
import { ballast as ballastSurface, roofSheet } from '../../gfx/Surfaces';
import { oceanNormals } from '../route/RouteTextures';
import { BuildingBatch } from '../city/BuildingGen';
import { FACADE } from '../../gfx/FacadeTextures';
import { buildTrees, type TreeSpot } from '../city/Trees';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { LINES, Railway } from './Railway';

/**
 * The Western Railway corridor the ride passes through (LOCAL_TRAIN.md §4): track formation,
 * rails and sleepers for every line, overhead-line portals and wires, boundary walls, and region
 * dressing — salt pans and mangroves, suburbs with trackside homes, creeks and bridges, mills and
 * towers, and platforms of stations the fast local runs through. Built per stretch around a local
 * anchor (everything relative to it) so geometry keeps full precision 40 km from the origin.
 */

export type Region = 'mira' | 'saltpan' | 'suburb' | 'creek' | 'mills' | 'city';

export interface StretchSpec {
  key: string;
  /** Path range to build (d increases towards Churchgate). */
  dA: number;
  dB: number;
  region: (d: number) => Region;
  seed: number;
  /** Water crossings: centre d and span length (m). */
  bridges?: { d: number; len: number }[];
  /** Road over-bridges at d. */
  robs?: number[];
  /** No ground or buildings: the real city is already there (stretch E). */
  cityBase?: boolean;
  /** Ground level beside the tracks (rail top = 0). */
  groundY?: number;
  /** Ranges of d without boundary walls or overhead portals (a station modelled elsewhere). */
  station?: [number, number];
}

export interface Stretch {
  key: string;
  group: THREE.Group;
  spec: StretchSpec;
  /** Animated water materials. */
  update(time: number): void;
}

const RAIL_HALF = 0.838;
const FORMATION_Y = -0.2;
const CHUNK = 150;
/** Contact wire and messenger heights (m above rail) ⚠. */
const CONTACT_Y = 5.55;
const MESSENGER_Y = 6.75;
const SPAN = 54;

type RGB = [number, number, number];

/** Materials and shared pieces for every stretch. */
export class CorridorKit {
  readonly m: Record<string, THREE.Material>;
  readonly signs: SignAtlas;
  readonly boards = new Map<string, AtlasRect>();
  readonly wallAds: AtlasRect[] = [];
  readonly water: THREE.MeshStandardMaterial;
  readonly sleeperGeo = boxGeo(2.75, 0.2, 0.26);
  private readonly treeCache = new Map<string, THREE.Group>();

  constructor(
    readonly tf: TextureFactory,
    readonly mats: StationMaterials,
    readonly facade: THREE.Material,
  ) {
    const M = mats.m;
    const std = (name: string, p: THREE.MeshStandardMaterialParameters, macro = 0.4) => {
      const mat = new THREE.MeshStandardMaterial(p);
      mat.name = name;
      mats.add(name, mat, macro);
      return mat;
    };
    const soil = soilTexture(tf);
    const bl = ballastSurface(tf);
    const blMap = bl.map.clone();
    blMap.repeat.set(1 / 2.5, 1 / 2.5);
    blMap.needsUpdate = true;
    const rs = roofSheet(tf);
    const tin = rs.map.clone();
    tin.repeat.set(1 / 2, 1 / 2);
    tin.needsUpdate = true;
    this.water = std('creekWater', { color: 0x3b4a3c, roughness: 0.08, metalness: 0.0, normalMap: oceanNormals(tf), normalScale: new THREE.Vector2(0.35, 0.35) }, 0);
    (this.water.normalMap as THREE.Texture).repeat.set(1 / 9, 1 / 9);
    this.signs = new SignAtlas(tf, 2048, 1024);
    const signMat = std('corridorSigns', { map: this.signs.texture, roughness: 0.6 }, 0.15);
    this.m = {
      ballast: std('corrBallast', { map: blMap, normalMap: bl.normalMap, color: 0xdcdcd6, roughness: 0.95 }, 0.5),
      sleeper: std('corrSleeper', { color: 0x75726c, roughness: 0.9 }, 0.5),
      rail: M.rail,
      railTop: M.railTop,
      steel: M.steelGrey,
      cable: M.cable,
      copper: M.copper,
      wall: std('corrWall', { map: soil.plaster, vertexColors: true, roughness: 0.92 }, 0.45),
      ground: std('corrGround', { map: soil.ground, vertexColors: true, roughness: 0.97 }, 0.55),
      concrete: M.concrete,
      coping: M.coping,
      yellow: M.yellowLine,
      tin: std('corrTin', { map: tin, vertexColors: true, roughness: 0.7, metalness: 0.35, side: THREE.DoubleSide }, 0.3),
      shack: std('corrShack', { map: soil.plaster, vertexColors: true, roughness: 0.9 }, 0.4),
      tarp: std('corrTarp', { vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }, 0.2),
      paint: std('corrPaint', { vertexColors: true, roughness: 0.75, metalness: 0.1 }, 0.2),
      canopy: std('corrCanopy', { map: rs.map, color: 0xb8bcbc, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide }, 0.3),
      brick: std('corrBrick', { map: soil.brick, roughness: 0.92 }, 0.3),
      mangrove: std('corrMangrove', { map: soil.leaf, alphaTest: 0.4, vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }, 0.3),
      water: this.water,
      facade,
      cityDetail: M.cityDetail ?? std('corrDetail', { vertexColors: true, roughness: 0.88 }),
      signs: signMat,
      bridgeSleeper: std('corrBridgeSleeper', { color: 0x3a3430, roughness: 0.8, metalness: 0.3 }, 0.3),
    };
  }

  /** Yellow station name board (Marathi / English), cached per station. */
  board(deva: string, en: string): AtlasRect {
    let r = this.boards.get(en);
    if (!r) {
      r = this.signs.add(512, 160, (c, w, h) => drawYellowBoard(c, w, h, deva, en));
      this.boards.set(en, r);
      this.signs.commit();
    }
    return r;
  }

  /** Painted advertisements on trackside walls (fictional brands). */
  ad(rng: RNG): AtlasRect {
    if (!this.wallAds.length) {
      const ads: [string, string, string, string][] = [
        ['#c8281e', '#fff3d6', 'SHUBH GRIH', 'शुभ गृह · 1 & 2 BHK'],
        ['#1f5aa6', '#ffffff', 'VIJAY COACHING', 'विजय क्लासेस · 10th 12th'],
        ['#f0c419', '#1a1a1a', 'KESARI TMT', 'मजबूत सळई'],
        ['#1c7a45', '#ffffff', 'HARI OM TILES', 'हरी ओम टाइल्स'],
        ['#6b2a8c', '#ffe9ff', 'DR. JOSHI CLINIC', 'मुळव्याध · भगंदर'],
        ['#e05a1a', '#ffffff', 'SAI CATERERS', 'साई केटरर्स'],
      ];
      for (const [bg, fg, en, dv] of ads) this.wallAds.push(this.signs.add(384, 96, (c, w, h) => drawWallAd(c, w, h, bg, fg, en, dv)));
      this.signs.commit();
    }
    return rng.pick(this.wallAds);
  }

  /** Trees for a stretch (relative spots), without per-instance culling (the anchor moves them). */
  trees(spots: TreeSpot[], seed: number): THREE.Group {
    return buildTrees(this.tf, this.mats, spots, null, seed);
  }

  cacheTrees(key: string, g: THREE.Group): void {
    this.treeCache.set(key, g);
  }
}

// ---------------------------------------------------------------------------------------------
// Textures

function soilTexture(tf: TextureFactory): { ground: THREE.Texture; plaster: THREE.Texture; brick: THREE.Texture; leaf: THREE.Texture } {
  return tf.memo('corridorSoil', () => {
    const S = 512;
    const rng = new RNG(4401);
    // Dusty earth with sparse grass, litter specks.
    const [g, gc] = makeCanvas(S, S);
    gc.fillStyle = '#9c8a6c';
    gc.fillRect(0, 0, S, S);
    tf.overlayNoise(gc, S, S, 0, 1, 0.5, 'overlay', 11);
    tf.overlayNoise(gc, S, S, 2, 5, 0.35, 'overlay', 12);
    for (let i = 0; i < 5000; i++) {
      gc.fillStyle = rng.chance(0.6) ? rgba(80, 100, 50, rng.range(0.2, 0.5)) : rgba(60, 55, 45, rng.range(0.1, 0.3));
      gc.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 3), rng.range(1, 4));
    }
    for (let i = 0; i < 260; i++) {
      gc.fillStyle = rng.pick(['rgba(230,230,225,0.7)', 'rgba(40,90,160,0.6)', 'rgba(200,40,40,0.5)', 'rgba(30,30,30,0.6)']);
      gc.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 4), rng.range(1, 3));
    }
    // Plaster wall, weathered.
    const [p, pc] = makeCanvas(S, S);
    pc.fillStyle = '#d6cfc1';
    pc.fillRect(0, 0, S, S);
    tf.overlayNoise(pc, S, S, 1, 2, 0.3, 'overlay', 21);
    for (let i = 0; i < 40; i++) {
      const x = rng.range(0, S);
      const len = rng.range(40, 300);
      const gr = pc.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(60,55,45,0.25)');
      gr.addColorStop(1, 'rgba(60,55,45,0)');
      pc.fillStyle = gr;
      pc.fillRect(x, 0, rng.range(3, 14), len);
    }
    for (let i = 0; i < 10; i++) tf.stain(pc, S, S, rng.range(0, S), S - rng.range(0, 90), rng.range(30, 90), 'rgba(70,60,45,1)', 0.25, rng);
    // Exposed brick.
    const [b, bc] = makeCanvas(256, 256);
    bc.fillStyle = '#8a8378';
    bc.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 16; row++)
      for (let col = 0; col < 5; col++) {
        const x = col * 56 + (row % 2) * 28;
        bc.fillStyle = rgba(rng.range(140, 175), rng.range(70, 95), rng.range(55, 70));
        bc.fillRect(x % 256, row * 16 + 1, 52, 14);
      }
    tf.overlayNoise(bc, 256, 256, 1, 2, 0.3, 'overlay', 31);
    // Mangrove leaf clusters (alpha-cut).
    const [l, lc] = makeCanvas(256, 256);
    lc.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      const x = rng.range(10, 246);
      const y = rng.range(10, 246);
      const d = Math.hypot(x - 128, y - 128);
      if (d > 118 * rng.range(0.75, 1)) continue;
      lc.save();
      lc.translate(x, y);
      lc.rotate(rng.range(0, Math.PI * 2));
      lc.fillStyle = rgba(rng.range(40, 80), rng.range(80, 120), rng.range(40, 60));
      lc.beginPath();
      lc.ellipse(0, 0, rng.range(6, 10), rng.range(3, 4.5), 0, 0, Math.PI * 2);
      lc.fill();
      lc.restore();
    }
    const tex = (c: HTMLCanvasElement, rep = true) => tf.tex(c, { wrap: rep });
    const ground = tex(g);
    ground.repeat.set(1 / 6, 1 / 6);
    const plaster = tex(p);
    plaster.repeat.set(1 / 4, 1 / 4);
    const brick = tex(b);
    brick.repeat.set(1 / 1.6, 1 / 1.6);
    return { ground, plaster, brick, leaf: tex(l, false) };
  });
}

function drawYellowBoard(c: CanvasRenderingContext2D, w: number, h: number, deva: string, en: string): void {
  c.fillStyle = '#f2c417';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#141414';
  c.lineWidth = 7;
  c.strokeRect(4, 4, w - 8, h - 8);
  c.fillStyle = '#141414';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  fillFitted(c, deva, w / 2, h * 0.33, '700', DEVA, h * 0.34, w * 0.86);
  fillFitted(c, en, w / 2, h * 0.73, '700', LATIN, h * 0.3, w * 0.86);
}

function drawWallAd(c: CanvasRenderingContext2D, w: number, h: number, bg: string, fg: string, en: string, dv: string): void {
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  fillFitted(c, en, w / 2, h * 0.36, '800', LATIN, h * 0.4, w * 0.9);
  fillFitted(c, dv, w / 2, h * 0.76, '600', DEVA, h * 0.26, w * 0.9);
  // Sun-bleached, flaking paint.
  const rng = new RNG(en.length * 31);
  for (let i = 0; i < 90; i++) {
    c.fillStyle = `rgba(230,225,210,${rng.range(0.05, 0.35)})`;
    c.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 14), rng.range(1, 6));
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry accumulation relative to the stretch anchor.

class Strip {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  private idx: number[] = [];
  private n = 0;

  /**
   * Two edge polylines (same length) → quads between them; see buildStretch for facing. u runs
   * across (per edge, constant or per sample), v along; `swap` puts u vertical on walls.
   */
  add(a: number[][], b: number[][], ua: number | number[], ub: number | number[], v: number[], color?: (i: number, side: 0 | 1) => RGB, swap = false): void {
    const base = this.n;
    for (let i = 0; i < a.length; i++) {
      for (const [side, p, uu] of [
        [0, a[i], ua],
        [1, b[i], ub],
      ] as const) {
        const u = typeof uu === 'number' ? uu : uu[i];
        this.pos.push(p[0], p[1], p[2]);
        if (swap) this.uv.push(v[i], u);
        else this.uv.push(u, v[i]);
        const c = color ? color(i, side) : ([1, 1, 1] as RGB);
        this.col.push(c[0], c[1], c[2]);
      }
      this.n += 2;
    }
    for (let i = 0; i < a.length - 1; i++) {
      const a0 = base + i * 2;
      const b0 = a0 + 1;
      const a1 = a0 + 2;
      const b1 = a0 + 3;
      this.idx.push(a0, a1, b0, b0, a1, b1);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g.toNonIndexed();
  }
}

/**
 * Builds one stretch. Strip facing: for horizontal strips edge A must have the smaller offset
 * (faces up); for vertical strips with A at the bottom the face points to −offset.
 */
export function buildStretch(kit: CorridorKit, rail: Railway, spec: StretchSpec): Stretch {
  const path = rail.path;
  const group = new THREE.Group();
  group.name = 'stretch-' + spec.key;
  const dMid = (spec.dA + spec.dB) / 2;
  const anchor = path.at(dMid);
  const AX = anchor.x;
  const AZ = anchor.z;
  group.position.set(AX, 0, AZ);
  const rng = new RNG(spec.seed);
  const GY = spec.groundY ?? -0.6;
  const bridges = spec.bridges ?? [];
  const robs = spec.robs ?? [];
  const tmp = { x: 0, z: 0, tx: 0, tz: 1 };
  /** Relative point at (d, offset, y). */
  const P = (d: number, o: number, y: number): number[] => {
    const a = path.at(d, tmp);
    return [a.x + a.tz * o - AX, y, a.z - a.tx * o - AZ];
  };
  const headingAt = (d: number) => {
    const a = path.at(d, tmp);
    return Math.atan2(a.tx, a.tz);
  };
  const onBridge = (d: number, pad = 0) => bridges.some((b) => Math.abs(d - b.d) < b.len / 2 + pad);
  /** Creek water surface and bank level near bridges. */
  const WATER_Y = -2.6;
  const bankY = (d: number, o: number): number => {
    let y = GY;
    for (const b of bridges) {
      // The creek crosses the line at an angle, meandering; banks slope down to it.
      const along = d - b.d + Math.sin(o * 0.004 + b.d) * 60 + o * 0.25;
      const half = b.len / 2 + 12 + Math.sin(o * 0.011 + b.d * 0.1) * 25;
      const e = Math.abs(along) - half;
      if (e < 0) y = Math.min(y, WATER_Y - 1.2);
      else if (e < 30) y = Math.min(y, WATER_Y - 1.2 + (GY - WATER_Y + 1.2) * (e / 30));
    }
    return y;
  };
  const vRel = (d: number) => d - dMid;

  const chunks: { d0: number; d1: number; gb: GeoBuilder; inst: Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; list: THREE.Matrix4[] }> }[] = [];
  for (let d0 = spec.dA; d0 < spec.dB; d0 += CHUNK) chunks.push({ d0, d1: Math.min(spec.dB, d0 + CHUNK), gb: new GeoBuilder(), inst: new Map() });
  const instance = (ch: (typeof chunks)[number], key: string, geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4) => {
    let e = ch.inst.get(key);
    if (!e) ch.inst.set(key, (e = { geo, mat, list: [] }));
    e.list.push(m);
  };
  const matAt = (d: number, o: number, y: number, rotY = 0, s = 1) => {
    const p = P(d, o, y);
    return new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingAt(d) + rotY), new THREE.Vector3(s, s, s));
  };
  const steps = (d0: number, d1: number, step: number) => {
    const out: number[] = [];
    for (let d = d0; d < d1; d += step) out.push(d);
    out.push(d1);
    return out;
  };
  const strips = new Map<string, Strip>();
  const strip = (ch: number, key: string) => {
    const k = ch + '|' + key;
    let s = strips.get(k);
    if (!s) strips.set(k, (s = new Strip()));
    return s;
  };

  chunks.forEach((ch, ci) => {
    const ds = steps(ch.d0, ch.d1, 3);
    // ---- Track formation (ballast bed, shoulders) and cess to the walls ----------------------
    const runs = splitRuns(ds, (d) => !onBridge(d));
    for (const run of runs) {
      const rv = run.map(vRel);
      const lo = run.map((d) => rail.bundle(d)[0] - 2.3);
      const hi = run.map((d) => rail.bundle(d)[1] + 2.3);
      const foot = run.map((d) => Math.max(GY, bankY(d, 0)));
      strip(ci, 'ballast').add(
        run.map((d, i) => P(d, lo[i], FORMATION_Y)),
        run.map((d, i) => P(d, hi[i], FORMATION_Y)),
        lo,
        hi,
        rv,
      );
      // UVs across in metres: rewrite u with offsets (Strip takes constants, so use two strips per side).
      strip(ci, 'ballast').add(
        run.map((d, i) => P(d, lo[i] - 1.5 - (FORMATION_Y - foot[i]) * 0.8, foot[i])),
        run.map((d, i) => P(d, lo[i], FORMATION_Y)),
        -2,
        0,
        rv,
      );
      strip(ci, 'ballast').add(
        run.map((d, i) => P(d, hi[i], FORMATION_Y)),
        run.map((d, i) => P(d, hi[i] + 1.5 + (FORMATION_Y - foot[i]) * 0.8, foot[i])),
        0,
        2,
        rv,
      );
      if (!spec.cityBase) {
        // Cess: trodden earth between the formation and the walls.
        const wallL = run.map((d) => rail.bounds(d)[0]);
        const wallR = run.map((d) => rail.bounds(d)[1]);
        const dust: (i: number, s: 0 | 1) => RGB = () => [0.82, 0.78, 0.72];
        strip(ci, 'ground').add(
          run.map((d, i) => P(d, wallL[i] - 0.3, foot[i] + 0.02)),
          run.map((d, i) => P(d, lo[i] - 1.5 - (FORMATION_Y - foot[i]) * 0.8, foot[i] + 0.02)),
          0,
          8,
          rv,
          dust,
        );
        strip(ci, 'ground').add(
          run.map((d, i) => P(d, hi[i] + 1.5 + (FORMATION_Y - foot[i]) * 0.8, foot[i] + 0.02)),
          run.map((d, i) => P(d, wallR[i] + 0.3, foot[i] + 0.02)),
          0,
          8,
          rv,
          dust,
        );
      } else {
        // Inside the city: the railway land is a little below the streets.
        const wallL = run.map((d) => rail.bounds(d)[0]);
        const wallR = run.map((d) => rail.bounds(d)[1]);
        const dust: (i: number, s: 0 | 1) => RGB = () => [0.62, 0.6, 0.56];
        strip(ci, 'ballast').add(
          run.map((d, i) => P(d, wallL[i] - 0.45, -0.34)),
          run.map((d, i) => P(d, lo[i] - 1.5, -0.34)),
          0,
          8,
          rv,
          dust,
        );
        strip(ci, 'ballast').add(
          run.map((d, i) => P(d, hi[i] + 1.5, -0.34)),
          run.map((d, i) => P(d, wallR[i] + 0.45, -0.34)),
          0,
          8,
          rv,
          dust,
        );
      }
    }

    // ---- Rails and sleepers for every line ----------------------------------------------------
    for (let id = 0; id < LINES; id++) {
      const live = ds.filter((d) => rail.lineOffset(id, d) !== null);
      if (live.length < 2) continue;
      const lv = live.map(vRel);
      const off = live.map((d) => rail.lineOffset(id, d)!);
      for (const s of [-1, 1]) {
        const c = off.map((o) => o + s * RAIL_HALF);
        strip(ci, 'railTop').add(
          live.map((d, i) => P(d, c[i] - 0.036, 0)),
          live.map((d, i) => P(d, c[i] + 0.036, 0)),
          0,
          0.07,
          lv,
        );
        // Sides: inner faces −offset (bottom → top), outer faces +offset (top → bottom).
        strip(ci, 'rail').add(
          live.map((d, i) => P(d, c[i] - 0.036, -0.165)),
          live.map((d, i) => P(d, c[i] - 0.036, -0.004)),
          0,
          0.16,
          lv,
        );
        strip(ci, 'rail').add(
          live.map((d, i) => P(d, c[i] + 0.036, -0.004)),
          live.map((d, i) => P(d, c[i] + 0.036, -0.165)),
          0,
          0.16,
          lv,
        );
      }
      // Sleepers (concrete on the formation, steel-channel "H-beam" sleepers on bridges ⚠).
      for (let d = Math.ceil(ch.d0 / 0.65) * 0.65; d < ch.d1; d += 0.65) {
        const o = rail.lineOffset(id, d);
        if (o === null) continue;
        const m = matAt(d, o + (rng.next() - 0.5) * 0.02, -0.282, (rng.next() - 0.5) * 0.02);
        instance(ch, onBridge(d) ? 'sleeperB' : 'sleeper', kit.sleeperGeo, onBridge(d) ? kit.m.bridgeSleeper : kit.m.sleeper, m);
      }
    }

    // ---- Overhead line: portals every SPAN metres, contact wire and messenger per line -------
    const first = Math.ceil(ch.d0 / SPAN) * SPAN;
    for (let d = first; d < ch.d1; d += SPAN) {
      if (d > rail.dThroat - 20) continue; // the station has its own portals
      if (spec.station && d > spec.station[0] && d < spec.station[1]) continue;
      const [lo, hi] = rail.bundle(d);
      const pl = rail.platformAt(d).k > 0.5;
      const xL = lo - (pl ? 12.5 : 3.1);
      const xR = hi + (pl ? 12.5 : 3.1);
      const gy = onBridge(d) ? -0.2 : Math.max(GY, bankY(d, 0));
      portal(ch.gb, P, d, xL, xR, gy, rail, rng);
    }
    for (let id = 0; id < LINES; id++) {
      for (let d = first - SPAN; d < ch.d1; d += SPAN) {
        const a = Math.max(ch.d0, d);
        const b = Math.min(ch.d1, d + SPAN);
        if (b <= a || a >= rail.dThroat) continue;
        const oa = rail.lineOffset(id, a);
        const ob = rail.lineOffset(id, b);
        if (oa === null || ob === null) continue;
        // Stagger ±0.2 m alternating at each portal; messenger sags between portals.
        const k = Math.round(d / SPAN);
        const st = (dd: number) => {
          const t = (dd - d) / SPAN;
          return (k % 2 ? 0.2 : -0.2) * (1 - t) + (k % 2 ? -0.2 : 0.2) * t;
        };
        const sag = (dd: number) => {
          const t = (dd - d) / SPAN;
          return MESSENGER_Y - 0.9 * 4 * t * (1 - t);
        };
        const pts = steps(a, b, 9);
        for (let i = 1; i < pts.length; i++) {
          const d0 = pts[i - 1];
          const d1 = pts[i];
          const o0 = rail.lineOffset(id, d0) ?? oa;
          const o1 = rail.lineOffset(id, d1) ?? ob;
          ch.gb.add('copper', wire(P(d0, o0 + st(d0), CONTACT_Y), P(d1, o1 + st(d1), CONTACT_Y), 0.013));
          ch.gb.add('cable', wire(P(d0, o0, sag(d0)), P(d1, o1, sag(d1)), 0.011));
          ch.gb.add('cable', wire(P(d0, o0 + st(d0) * 0.5, CONTACT_Y + 0.01), P(d0, o0, sag(d0)), 0.005));
        }
      }
    }

    // ---- Boundary walls with painted ads -------------------------------------------------------
    {
      for (const side of [-1, 1] as const) {
        const wds = ds.filter((d) => !onBridge(d, 8) && rail.platformAt(d).k < 0.05 && d < rail.dThroat && !(spec.station && d > spec.station[0] && d < spec.station[1]));
        const runsW = splitRuns(wds, () => true, 3.5);
        for (const run of runsW) {
          if (run.length < 2) continue;
          const rv = run.map(vRel);
          const o = run.map((d) => rail.bounds(d)[side < 0 ? 0 : 1]);
          const base = run.map((d) => (spec.cityBase ? -0.34 : Math.max(GY, bankY(d, o[0])) - 0.1));
          const H = spec.cityBase ? 2.7 : 2.3;
          const grime = (i: number, s: 0 | 1): RGB => {
            const n = 0.8 + 0.2 * Math.sin(run[i] * 0.37 + side) * Math.sin(run[i] * 0.11);
            return s === 0 ? [n * 0.72, n * 0.7, n * 0.66] : [n, n * 0.98, n * 0.95];
          };
          // Face towards the tracks, face outward, and a coping on top.
          const inner = (y: (i: number) => number) => run.map((d, i) => P(d, o[i] - side * 0.1, y(i)));
          const outer = (y: (i: number) => number) => run.map((d, i) => P(d, o[i] + side * 0.1, y(i)));
          if (side > 0) {
            strip(ci, 'wall').add(inner((i) => base[i]), inner((i) => base[i] + H), 0, H, rv, grime, true);
            strip(ci, 'wall').add(outer((i) => base[i] + H), outer((i) => base[i]), H, 0, rv, grime, true);
          } else {
            strip(ci, 'wall').add(inner((i) => base[i] + H), inner((i) => base[i]), H, 0, rv, grime, true);
            strip(ci, 'wall').add(outer((i) => base[i]), outer((i) => base[i] + H), 0, H, rv, grime, true);
          }
          const top = (dx: number) => run.map((d, i) => P(d, o[i] + dx, base[i] + H));
          strip(ci, 'wall').add(side < 0 ? top(-0.14) : top(-0.14), side < 0 ? top(0.14) : top(0.14), 0, 0.28, rv);
          // Painted ads on the track-facing side now and then.
          for (let i = 0; i < run.length - 6; i += 6) {
            if (!rng.chance(0.07)) continue;
            const d = run[i] + 4;
            const rect = kit.ad(rng);
            const g = signQuad(rect, 4.4, 1.1);
            // signQuad faces +Z; turn it to face the tracks (−side across).
            g.rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2);
            const m = matAt(d, o[i] - side * 0.115, base[i] + 1.25);
            ch.gb.add('signs', g.applyMatrix4(m));
          }
        }
      }
    }

    // ---- Bridges over creeks -----------------------------------------------------------------
    for (const b of bridges) {
      const a = Math.max(ch.d0, b.d - b.len / 2);
      const e = Math.min(ch.d1, b.d + b.len / 2);
      if (e <= a) continue;
      buildBridge(ch.gb, P, rail, a, e, b, WATER_Y);
    }

    // ---- Road over-bridges ----------------------------------------------------------------------
    for (const d of robs) if (d >= ch.d0 && d < ch.d1) buildRob(ch.gb, P, rail, d, GY, rng, headingAt);

    // ---- Passing station platforms ----------------------------------------------------------------
    for (const st of rail.passing) {
      const a = Math.max(ch.d0, st.d - Railway.PLATFORM_HALF);
      const e = Math.min(ch.d1, st.d + Railway.PLATFORM_HALF);
      if (e <= a) continue;
      buildPlatforms(ch, kit, rail, P, matAt, a, e, st, rng, strip(ci, 'concrete'));
    }
  });

  // ---- Assemble chunks ---------------------------------------------------------------------------
  chunks.forEach((ch, ci) => {
    for (const key of ['ballast', 'railTop', 'rail', 'ground', 'wall', 'concrete']) {
      const s = strips.get(ci + '|' + key);
      const g = s?.geometry();
      if (g) ch.gb.add(key, g);
    }
    const built = ch.gb.build(kit.m, { noShadowKeys: ['ballast', 'ground', 'railTop', 'rail', 'copper', 'cable', 'signs'] });
    group.add(built);
    for (const [key, e] of ch.inst) {
      const mesh = new THREE.InstancedMesh(e.geo, e.mat, e.list.length);
      e.list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key;
      mesh.castShadow = key.startsWith('post');
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  });

  // ---- Ground, water and region dressing -------------------------------------------------------------
  const extra = new GeoBuilder();
  const treeSpots: TreeSpot[] = [];
  const bushes: THREE.Matrix4[] = [];
  const batch = new BuildingBatch();
  if (!spec.cityBase) {
    group.add(buildGround(kit, rail, spec, P, AX, AZ, GY, bankY));
    if (bridges.length) {
      for (const b of bridges) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(4200, b.len + 700, 1, 1).rotateX(-Math.PI / 2), kit.water);
        const p = P(b.d, 0, WATER_Y);
        w.position.set(p[0], WATER_Y, p[2]);
        w.rotation.y = headingAt(b.d) + 0.25;
        w.receiveShadow = true;
        w.name = 'creek';
        group.add(w);
      }
    }
    dressRegions(kit, rail, spec, P, matAt, headingAt, GY, bankY, onBridge, rng, extra, treeSpots, bushes, batch, AX, AZ);
  }
  const ex = extra.build(kit.m, { noShadowKeys: ['water'] });
  group.add(ex);
  if (!batch.empty) {
    const walls = batch.buildWalls(kit.facade);
    walls.castShadow = true;
    group.add(walls);
    group.add(batch.details.build(kit.m as Record<string, THREE.Material>, { castShadow: false }));
  }
  if (treeSpots.length) group.add(kit.trees(treeSpots, spec.seed));
  if (bushes.length) {
    const geo = mangroveGeo();
    for (let i = 0; i < bushes.length; i += 4000) {
      const part = bushes.slice(i, i + 4000);
      const mesh = new THREE.InstancedMesh(geo, kit.m.mangrove, part.length);
      part.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  const water = kit.water;
  return {
    key: spec.key,
    group,
    spec,
    update(time: number) {
      const n = water.normalMap;
      if (n) n.offset.set(time * 0.004, time * 0.0025);
    },
  };
}

/** Splits sorted d samples into runs where `ok` holds (keeps the boundary samples). */
function splitRuns(ds: number[], ok: (d: number) => boolean, minGap = 0): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (const d of ds) {
    if (ok(d)) cur.push(d);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((r) => r.length > 1 && r[r.length - 1] - r[0] > minGap);
}

/** A thin square-section wire between two points. */
function wire(a: number[], b: number[], w: number): THREE.BufferGeometry {
  const A = new THREE.Vector3(a[0], a[1], a[2]);
  const B = new THREE.Vector3(b[0], b[1], b[2]);
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(w, w, len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

/** A w (across) × h (vertical) beam between two points. */
function beam(a: number[], b: number[], w: number, h: number): THREE.BufferGeometry {
  const A = new THREE.Vector3(a[0], a[1], a[2]);
  const B = new THREE.Vector3(b[0], b[1], b[2]);
  const g = new THREE.BoxGeometry(w, h, A.distanceTo(B));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

type Pt = (d: number, o: number, y: number) => number[];
const V3 = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);

/** Overhead-line portal: two H-section masts and a lattice boom with drop tubes and cantilevers. */
function portal(gb: GeoBuilder, P: Pt, d: number, xL: number, xR: number, gy: number, rail: Railway, rng: RNG): void {
  const H = 8.6;
  const a = V3(P(d, 0, 0));
  const b = V3(P(d + 1, 0, 0));
  const heading = Math.atan2(b.x - a.x, b.z - a.z);
  const mast = (o: number) => {
    const p = P(d, o, gy);
    const g = boxGeo(0.34, H - gy, 0.22).rotateY(heading).translate(p[0], (H + gy) / 2, p[2]);
    gb.add('steel', g);
    gb.add('concrete', boxGeo(0.8, 0.5, 0.8).rotateY(heading).translate(p[0], gy + 0.1, p[2]));
  };
  mast(xL);
  mast(xR);
  // Boom: top and bottom chords with lacing.
  for (const y of [H - 0.1, H - 0.8]) gb.add('steel', wire(P(d, xL, y), P(d, xR, y), 0.12));
  const n = Math.max(2, Math.round((xR - xL) / 1.4));
  for (let i = 0; i < n; i++) {
    const o0 = xL + ((xR - xL) * i) / n;
    const o1 = xL + ((xR - xL) * (i + 1)) / n;
    gb.add('steel', wire(P(d, o0, H - 0.8), P(d, (o0 + o1) / 2, H - 0.1), 0.05));
    gb.add('steel', wire(P(d, (o0 + o1) / 2, H - 0.1), P(d, o1, H - 0.8), 0.05));
  }
  // Drop tube, bracket and registration arm per line, with white insulators.
  for (let id = 0; id < LINES; id++) {
    const o = rail.lineOffset(id, d);
    if (o === null) continue;
    gb.add('steel', rodGeo(V3(P(d, o - 0.7, H - 0.8)), V3(P(d, o - 0.7, 6.2)), 0.045, 6));
    gb.add('steel', rodGeo(V3(P(d, o - 0.7, 6.2)), V3(P(d, o + 0.15, CONTACT_Y + 0.05)), 0.025, 5));
    gb.add('steel', rodGeo(V3(P(d, o - 0.7, 7.0)), V3(P(d, o, MESSENGER_Y)), 0.025, 5));
    gb.add('paint', tint(rodGeo(V3(P(d, o - 0.7, 6.25)), V3(P(d, o - 0.7, 6.9)), 0.07, 8), 0.85, 0.35, 0.2));
  }
  void rng;
}

function buildBridge(gb: GeoBuilder, P: Pt, rail: Railway, a: number, e: number, b: { d: number; len: number }, waterY: number): void {
  // Plate-girder spans under each line with open decks, walkways with railings, concrete piers.
  const step = 2;
  for (let id = 0; id < LINES; id++) {
    for (let d = a; d < e; d += step) {
      const d1 = Math.min(e, d + step);
      const o0 = rail.lineOffset(id, d);
      const o1 = rail.lineOffset(id, d1);
      if (o0 === null || o1 === null) continue;
      for (const s of [-1, 1]) {
        gb.add('steel', beam(P(d, o0 + s * 0.9, -1.2), P(d1, o1 + s * 0.9, -1.2), 0.03, 1.5));
        gb.add('paint', tint(beam(P(d, o0 + s * 0.9, -0.43), P(d1, o1 + s * 0.9, -0.43), 0.42, 0.04), 0.26, 0.26, 0.28));
        gb.add('paint', tint(beam(P(d, o0 + s * 0.9, -1.95), P(d1, o1 + s * 0.9, -1.95), 0.42, 0.04), 0.26, 0.26, 0.28));
      }
    }
  }
  const [lo, hi] = rail.bundle(b.d);
  // Walkways and railings on both sides.
  for (const side of [lo - 1.9, hi + 1.9]) {
    for (let d = a; d < e; d += step) {
      const d1 = Math.min(e, d + step);
      gb.add('paint', tint(beam(P(d, side, -0.35), P(d1, side, -0.35), 1.2, 0.08), 0.35, 0.34, 0.32));
      gb.add('paint', tint(wire(P(d, side + Math.sign(side) * 0.6, 0.75), P(d1, side + Math.sign(side) * 0.6, 0.75), 0.05), 0.55, 0.5, 0.2));
      gb.add('paint', tint(wire(P(d, side + Math.sign(side) * 0.6, 0.25), P(d1, side + Math.sign(side) * 0.6, 0.25), 0.04), 0.55, 0.5, 0.2));
      gb.add('paint', tint(rodGeo(V3(P(d, side + Math.sign(side) * 0.6, -0.3)), V3(P(d, side + Math.sign(side) * 0.6, 0.78)), 0.03, 4), 0.55, 0.5, 0.2));
    }
  }
  // Piers every ~12.2 m (span of the plate girders) ⚠.
  for (let d = b.d - b.len / 2; d <= b.d + b.len / 2 + 0.1; d += b.len / Math.max(1, Math.round(b.len / 12.2))) {
    if (d < a - 0.1 || d > e + 0.1) continue;
    const p0 = V3(P(d, lo - 2.5, 0));
    const p1 = V3(P(d, hi + 2.5, 0));
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const len = p0.distanceTo(p1);
    const h = -1.55 - (waterY - 1.5);
    const pier = boxGeo(1.6, h, len).rotateY(Math.atan2(p1.x - p0.x, p1.z - p0.z)).translate(mid.x, waterY - 1.5 + h / 2, mid.z);
    gb.add('concrete', pier);
  }
}

function buildRob(gb: GeoBuilder, P: Pt, rail: Railway, d: number, gy: number, rng: RNG, headingAt: (d: number) => number): void {
  const [L, R] = rail.bounds(d);
  const half = 6.2;
  const Y = 7.6;
  const h = headingAt(d);
  // The deck crosses at right angles; its length spans the railway land plus approaches.
  const o0 = L - 30;
  const o1 = R + 30;
  const p0 = V3(P(d, o0, 0));
  const p1 = V3(P(d, o1, 0));
  const mid = p0.clone().add(p1).multiplyScalar(0.5);
  const len = p0.distanceTo(p1);
  const deck = boxGeo(len, 1.1, half * 2).rotateY(h).translate(mid.x, Y - 0.55, mid.z);
  gb.add('concrete', deck);
  for (const s of [-1, 1]) {
    const q0 = V3(P(d + s * (half - 0.15), o0, 0));
    const q1 = V3(P(d + s * (half - 0.15), o1, 0));
    const m = q0.clone().add(q1).multiplyScalar(0.5);
    gb.add('wall', tint(boxGeo(len, 1.1, 0.25).rotateY(h).translate(m.x, Y + 0.55, m.z), 0.85, 0.83, 0.78));
  }
  // Ramps down to the road on both sides.
  for (const [a, b] of [
    [o0, o0 - 70],
    [o1, o1 + 70],
  ]) {
    for (const s of [-1, 1]) gb.add('wall', tint(beam(P(d + s * (half - 0.15), a, Y + 0.4), P(d + s * (half - 0.15), b, gy + 0.9), 0.25, 1.1), 0.85, 0.83, 0.78));
    gb.add('concrete', beam(P(d, a, Y - 0.55), P(d, b, gy - 0.2), half * 2, 1.1));
  }
  // Piers just outside the walls and bearing shelves.
  for (const o of [L - 1.5, R + 1.5, L - 18, R + 18]) {
    const p = P(d, o, 0);
    gb.add('concrete', boxGeo(1.4, Y - 1.1 - gy, half * 1.7).rotateY(h).translate(p[0], gy + (Y - 1.1 - gy) / 2, p[2]));
  }
  // Something on it: a stalled BEST bus silhouette or a line of autos ⚠ (simple blocks).
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const o = L + ((R - L) * (i + 0.5)) / n + rng.range(-3, 3);
    const p = P(d + rng.pick([-2.6, 2.6]), o, 0);
    const bus = rng.chance(0.3);
    const g = bus ? boxGeo(2.5, 2.9, 11) : boxGeo(1.4, 1.5, 2.6);
    const c: RGB = bus ? [0.72, 0.1, 0.08] : rng.chance(0.6) ? [0.08, 0.08, 0.07] : [0.95, 0.8, 0.1];
    gb.add('paint', tint(g.rotateY(h + Math.PI / 2).translate(p[0], Y + (bus ? 1.45 : 0.75), p[2]), c[0], c[1], c[2]));
  }
}

function buildPlatforms(
  ch: { gb: GeoBuilder },
  kit: CorridorKit,
  rail: Railway,
  P: Pt,
  matAt: (d: number, o: number, y: number, rotY?: number, s?: number) => THREE.Matrix4,
  a: number,
  e: number,
  st: { name: string; deva: string; d: number },
  rng: RNG,
  concrete: Strip,
): void {
  const gb = ch.gb;
  const TOP = 0.92;
  const ds: number[] = [];
  for (let d = a; d < e; d += 3) ds.push(d);
  ds.push(e);
  const v = ds.map((d) => d - st.d);
  for (const side of [-1, 1] as const) {
    const edge = ds.map((d) => (side > 0 ? rail.bundle(d)[1] + 1.68 : rail.bundle(d)[0] - 1.68));
    const back = edge.map((o) => o + side * 8.5);
    const A = side > 0 ? edge : back;
    const B = side > 0 ? back : edge;
    concrete.add(
      ds.map((d, i) => P(d, A[i], TOP)),
      ds.map((d, i) => P(d, B[i], TOP)),
      0,
      8.5,
      v,
    );
    // Platform face towards the track.
    const face = side > 0 ? [ds.map((d, i) => P(d, edge[i], -0.3)), ds.map((d, i) => P(d, edge[i], TOP))] : [ds.map((d, i) => P(d, edge[i], TOP)), ds.map((d, i) => P(d, edge[i], -0.3))];
    concrete.add(face[0], face[1], 0, 1.2, v);
    // Yellow safety line and the white coping edge.
    for (let i = 1; i < ds.length; i++) {
      gb.add('yellow', beam(P(ds[i - 1], edge[i - 1] + side * 0.75, TOP + 0.005), P(ds[i], edge[i] + side * 0.75, TOP + 0.005), 0.12, 0.012));
    }
    // Canopy over the middle 60 %, on columns, with name boards hanging from it and at the ends.
    const c0 = Math.max(a, st.d - Railway.PLATFORM_HALF * 0.6);
    const c1 = Math.min(e, st.d + Railway.PLATFORM_HALF * 0.6);
    for (let d = Math.ceil(c0 / 9) * 9; d <= c1; d += 9) {
      const eo = side > 0 ? rail.bundle(d)[1] + 1.68 : rail.bundle(d)[0] - 1.68;
      const co = eo + side * 5.2;
      gb.add('steel', rodGeo(V3(P(d, co, TOP)), V3(P(d, co, TOP + 4.1)), 0.1, 8));
      // Sloping roof (to the back), corrugated sheet.
      if (d + 9 <= c1) {
        const d1 = d + 9;
        const eo1 = side > 0 ? rail.bundle(d1)[1] + 1.68 : rail.bundle(d1)[0] - 1.68;
        const inner = (dd: number, o: number) => P(dd, o + side * 0.6, TOP + 4.6);
        const outer = (dd: number, o: number) => P(dd, o + side * 8.4, TOP + 3.9);
        const q = [inner(d, eo), outer(d, eo), inner(d1, eo1), outer(d1, eo1)];
        const g = new THREE.BufferGeometry();
        const pos = side > 0 ? [...q[0], ...q[2], ...q[1], ...q[1], ...q[2], ...q[3]] : [...q[0], ...q[1], ...q[2], ...q[1], ...q[3], ...q[2]];
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(side > 0 ? [0, 0, 0, 9, 8, 0, 8, 0, 0, 9, 8, 9] : [0, 0, 8, 0, 0, 9, 8, 0, 8, 9, 0, 9], 2));
        g.computeVertexNormals();
        gb.add('canopy', g);
        gb.add('steel', wire(inner(d, eo), outer(d, eo), 0.14));
      }
    }
    // Name boards: on posts at both ends and hanging mid-platform, facing the tracks.
    const rect = kit.board(st.deva, st.name);
    for (const f of [-0.85, -0.3, 0.3, 0.85]) {
      const d = st.d + f * Railway.PLATFORM_HALF;
      if (d < a || d >= e) continue;
      const eo = side > 0 ? rail.bundle(d)[1] + 1.68 : rail.bundle(d)[0] - 1.68;
      const o = eo + side * 3.2;
      const hang = Math.abs(f) < 0.5;
      const y = hang ? TOP + 3.1 : TOP + 2.3;
      // Facing the tracks, readable from a passing train.
      const face = matAt(d, o, y, -side * Math.PI / 2);
      gb.add('signs', signQuad(rect, 2.9, 0.9).translate(0, 0, 0.035).applyMatrix4(face));
      gb.add('paint', tint(boxGeo(3.0, 1.0, 0.06).applyMatrix4(face), 0.12, 0.12, 0.12));
      if (!hang) for (const s of [-1.3, 1.3]) gb.add('steel', rodGeo(V3(P(d + s, o, TOP)), V3(P(d + s, o, y + 0.5)), 0.04, 6));
      else for (const s of [-1.2, 1.2]) gb.add('steel', rodGeo(V3(P(d + s, o, y + 0.45)), V3(P(d + s, o, TOP + 4.5)), 0.015, 4));
    }
    // Benches and a stall now and then.
    for (let d = Math.ceil(a / 17) * 17; d < e; d += 17) {
      if (!rng.chance(0.55)) continue;
      const eo = side > 0 ? rail.bundle(d)[1] + 1.68 : rail.bundle(d)[0] - 1.68;
      const g = boxGeo(0.5, 0.45, 1.8);
      gb.add('paint', tint(g.applyMatrix4(matAt(d, eo + side * 4.4, TOP + 0.23)), 0.55, 0.57, 0.6));
    }
  }
}

function buildGround(kit: CorridorKit, rail: Railway, spec: StretchSpec, P: Pt, AX: number, AZ: number, GY: number, bankY: (d: number, o: number) => number): THREE.Mesh {
  // A grid 3.6 km square around the anchor; heights dip into the creeks. Vertex colours: dusty
  // earth near the line, greener or saltier further out depending on the region.
  const N = 90;
  const SIZE = 3600;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const dMid = (spec.dA + spec.dB) / 2;
  const span = spec.dB - spec.dA + 2400;
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const x = -SIZE / 2 + (SIZE * i) / N;
      const z = -SIZE / 2 + (SIZE * j) / N;
      const q = rail.path.project(x + AX, z + AZ, dMid - span / 2, dMid + span / 2);
      const y = Math.min(GY - 0.06, bankY(q.s, q.o) - 0.06);
      pos.push(x, y, z);
      uv.push(x, -z);
      const reg = spec.region(q.s);
      const n = 0.85 + 0.15 * Math.sin(x * 0.013 + z * 0.021) * Math.cos(z * 0.017 - x * 0.007);
      let c: RGB = [0.95, 0.9, 0.82];
      if (reg === 'saltpan' || reg === 'creek') c = Math.abs(q.o) > 60 ? [0.62, 0.66, 0.5] : [0.85, 0.8, 0.7];
      else if (reg === 'suburb' || reg === 'mira') c = [0.8, 0.76, 0.7];
      else if (reg === 'mills') c = [0.75, 0.72, 0.68];
      col.push(c[0] * n, c[1] * n, c[2] * n);
    }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, kit.m.ground);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  void P;
  return mesh;
}

/** Low mangrove bush: crossed leaf cards around a short trunk cluster. */
function mangroveGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rng = new RNG(88);
  for (let i = 0; i < 7; i++) {
    const s = rng.range(1.6, 2.6);
    const g = new THREE.PlaneGeometry(s, s * 0.8);
    g.rotateY(rng.range(0, Math.PI));
    g.rotateX(rng.range(-0.3, 0.3));
    g.translate(rng.range(-0.8, 0.8), rng.range(0.9, 2.0), rng.range(-0.8, 0.8));
    const sh = rng.range(0.55, 0.9);
    parts.push(tint(g.toNonIndexed(), sh * 0.8, sh, sh * 0.75));
  }
  return mergeGeometries(parts)!;
}

function dressRegions(
  kit: CorridorKit,
  rail: Railway,
  spec: StretchSpec,
  P: Pt,
  matAt: (d: number, o: number, y: number, rotY?: number, s?: number) => THREE.Matrix4,
  headingAt: (d: number) => number,
  GY: number,
  bankY: (d: number, o: number) => number,
  onBridge: (d: number, pad?: number) => boolean,
  rng: RNG,
  gb: GeoBuilder,
  trees: TreeSpot[],
  bushes: THREE.Matrix4[],
  batch: BuildingBatch,
  AX: number,
  AZ: number,
): void {
  void kit;
  void AX;
  void AZ;
  const rect = (d: number, o: number, along: number, across: number): number[] => {
    // Footprint (CCW from above) of a block centred at (d, o), aligned with the line.
    const pts = [
      P(d - along / 2, o - across / 2, 0),
      P(d - along / 2, o + across / 2, 0),
      P(d + along / 2, o + across / 2, 0),
      P(d + along / 2, o - across / 2, 0),
    ];
    const fp = pts.flatMap((p) => [p[0], p[2]]);
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      area += fp[i * 2] * fp[j * 2 + 1] - fp[j * 2] * fp[i * 2 + 1];
    }
    if (area > 0) {
      const r: number[] = [];
      for (let i = 3; i >= 0; i--) r.push(fp[i * 2], fp[i * 2 + 1]);
      return r;
    }
    return fp;
  };
  const building = (d: number, o: number, along: number, across: number, floors: number, style: number, tintC: [number, number, number], detail: 0 | 1 = 1) => {
    batch.add({
      fp: rect(d, o, along, across),
      height: floors * 3.1 + 1.2,
      floorH: 3.1,
      groundH: 4,
      style,
      groundStyle: style === FACADE.glass || style === FACADE.office ? style : rng.chance(0.5) ? FACADE.shop : style,
      tint: tintC,
      seed: rng.range(0, 100),
      chajjas: rng.chance(0.5),
      parapet: rng.chance(0.6) ? 1.0 : 0,
      detail,
      baseY: GY - 0.05,
    });
  };
  const TINTS: [number, number, number][] = [
    [1, 0.97, 0.9],
    [0.95, 0.93, 0.88],
    [1, 0.92, 0.84],
    [0.88, 0.9, 0.93],
    [0.98, 0.88, 0.8],
    [0.92, 0.95, 0.9],
    [1, 0.95, 0.75],
    [0.85, 0.92, 0.96],
  ];
  const shanty = (d: number, o: number, side: number, depth: number) => {
    // A trackside home: brick and plaster walls, a tin roof held down with stones or a blue tarp.
    const w = rng.range(2.6, 4.2);
    const h = rng.range(2.3, 3.0) * (rng.chance(0.3) ? 2 : 1);
    const y = GY;
    const m = matAt(d, o + side * depth / 2, y + h / 2);
    const wc: RGB = rng.pick([
      [0.85, 0.82, 0.76],
      [0.7, 0.8, 0.85],
      [0.9, 0.75, 0.7],
      [0.75, 0.85, 0.7],
      [0.95, 0.9, 0.6],
      [0.6, 0.55, 0.5],
    ] as RGB[]);
    gb.add('shack', tint(boxGeo(depth, h, w).applyMatrix4(m), wc[0], wc[1], wc[2]));
    const roof = boxGeo(depth + 0.5, 0.05, w + 0.3);
    roof.rotateZ(side * 0.08);
    const rm = matAt(d, o + side * depth / 2, y + h + 0.1);
    const tarp = rng.chance(0.3);
    const rc: RGB = tarp ? [0.12, 0.3, 0.75] : rng.pick([[0.62, 0.6, 0.56], [0.55, 0.38, 0.25], [0.7, 0.66, 0.6], [0.45, 0.3, 0.22]] as RGB[]);
    gb.add(tarp ? 'tarp' : 'tin', tint(roof.applyMatrix4(rm), rc[0], rc[1], rc[2]));
    if (rng.chance(0.4)) gb.add('paint', tint(boxGeo(0.9, 0.9, 0.9).applyMatrix4(matAt(d + rng.range(-0.8, 0.8), o + side * depth * 0.6, y + h + 0.6)), 0.05, 0.05, 0.05));
    if (rng.chance(0.25)) {
      // Washing line with clothes.
      for (let k = 0; k < 4; k++) {
        const c: RGB = rng.pick([[0.9, 0.2, 0.2], [0.95, 0.95, 0.9], [0.2, 0.4, 0.8], [0.95, 0.7, 0.1], [0.3, 0.6, 0.3]] as RGB[]);
        gb.add('tarp', tint(new THREE.PlaneGeometry(0.5, 0.7).applyMatrix4(matAt(d - 1 + k * 0.6, o - side * 0.4, y + 1.6, Math.PI / 2)), c[0], c[1], c[2]));
      }
    }
  };

  const d0 = spec.dA;
  const d1 = spec.dB;
  // Walk along both sides in plots.
  for (const side of [-1, 1] as const) {
    let d = d0 + rng.range(0, 10);
    while (d < d1) {
      const reg = spec.region(d);
      const [L, R] = rail.bounds(d);
      const wall = side > 0 ? R : L;
      if (onBridge(d, 40)) {
        d += 20;
        continue;
      }
      if (reg === 'mira') {
        // Mira Road's own buildings come from OpenStreetMap (MiraRoad.ts).
        d += 30;
        continue;
      }
      if (reg === 'suburb' || reg === 'mills') {
        // Trackside homes against the wall (not at stations or in Mira Road's forecourts).
        if (reg === 'suburb' && rail.platformAt(d).k === 0 && rail.haltAt(d) === 0 && rng.chance(0.75)) {
          let dd = d;
          const end = d + rng.range(30, 90);
          while (dd < end) {
            const w = rng.range(2.8, 4.0);
            shanty(dd, wall + side * 0.4, side, rng.range(3, 5.5));
            if (rng.chance(0.5)) shanty(dd, wall + side * 6.4, side, rng.range(3, 5));
            dd += w + rng.range(0.1, 0.6);
          }
          d = end;
        }
        // Buildings: 4–8 storeys near, taller further out; mills get sheds and chimneys.
        const along = rng.range(14, 34);
        const across = rng.range(12, 22);
        const setback = reg === 'suburb' ? rng.range(15, 22) : rng.range(8, 14);
        const o = wall + side * (setback + across / 2);
        const floors = reg === 'mills' ? rng.int(2, 5) : rng.int(3, 8);
        const style = rng.weighted([
          [FACADE.grille, 5],
          [FACADE.deco, 2],
          [FACADE.chawl, reg === 'suburb' ? 2 : 1],
          [FACADE.decoBalcony, 2],
        ] as const);
        if (reg === 'mills' && rng.chance(0.35)) millShed(gb, P, d + along / 2, o, along, across, side, GY, rng, headingAt);
        else building(d + along / 2, o, along, across, floors, style, rng.pick(TINTS));
        // Second and third rows.
        for (let row = 1; row < 4; row++) {
          const oo = o + side * row * rng.range(26, 40);
          const f = reg === 'mills' ? (rng.chance(0.35) ? rng.int(25, 45) : rng.int(3, 8)) : rng.int(4, 12);
          const st = f > 20 ? rng.pick([FACADE.glass, FACADE.office, FACADE.grille]) : rng.pick([FACADE.grille, FACADE.deco, FACADE.decoBalcony, FACADE.chawl]);
          if (rng.chance(0.85)) building(d + along / 2 + rng.range(-5, 5), oo, rng.range(14, 30), rng.range(12, 24), f, st, rng.pick(TINTS), f > 20 ? 0 : 1);
        }
        if (reg === 'mills' && rng.chance(0.12)) chimney(gb, P, d, wall + side * rng.range(40, 120), GY, rng);
        if (rng.chance(0.35)) trees.push({ ...xz(P(d + rng.range(0, along), wall + side * rng.range(4, 12), 0)), s: rng.range(0.6, 1.0), y: GY, kind: rng.chance(0.3) ? 'palm' : 'mixed' });
        d += along + rng.range(2, 8);
      } else if (reg === 'saltpan' || reg === 'creek') {
        // Salt pans: shallow rectangular pans between earth bunds, mangrove belts by the water.
        const along = rng.range(45, 90);
        if (reg === 'saltpan' && rng.chance(0.8)) {
          for (let row = 0; row < 5; row++) {
            const across = rng.range(40, 70);
            const o = wall + side * (14 + row * 72 + across / 2);
            saltPan(gb, P, d + along / 2, o, along - 4, across - 4, GY, rng);
          }
        }
        // Mangrove belt near the wall and along creek banks.
        for (let k = 0; k < (reg === 'creek' ? 110 : 14); k++) {
          const dd = d + rng.range(0, along);
          const o = wall + side * (reg === 'creek' ? rng.range(3, 260) : rng.range(3, 14));
          const bank = bankY(dd, o);
          // In the creek, mangroves crowd the banks and the mud flats, not open water.
          if (reg === 'creek' && bank < -3.0 && rng.chance(0.75)) continue;
          const y = Math.max(bank, -2.4);
          const s = rng.range(0.8, 1.6);
          bushes.push(matAt(dd, o, y - 0.3, rng.range(0, Math.PI * 2), s));
        }
        if (rng.chance(0.18)) trees.push({ ...xz(P(d + rng.range(0, along), wall + side * rng.range(20, 60), 0)), s: rng.range(0.5, 0.9), y: GY, kind: rng.chance(0.5) ? 'palm' : 'mixed' });
        d += along;
      } else {
        d += 30;
      }
    }
    // A distant ring of tower blocks (suburban high-rises seen across the salt pans).
    for (let d = d0; d < d1 + 600; d += rng.range(40, 90)) {
      const reg = spec.region(Math.min(d, d1));
      const far = reg === 'saltpan' || reg === 'creek' ? rng.range(420, 900) : reg === 'mira' ? rng.range(650, 1100) : rng.range(260, 700);
      const floors = rng.int(12, 30);
      const style = rng.pick([FACADE.grille, FACADE.glass, FACADE.office, FACADE.grille]);
      building(d, side * far, rng.range(18, 30), rng.range(16, 26), floors, style, rng.pick(TINTS), 0);
    }
  }
}

const xz = (p: number[]) => ({ x: p[0], z: p[2] });

function saltPan(gb: GeoBuilder, P: Pt, d: number, o: number, along: number, across: number, gy: number, rng: RNG): void {
  const y = gy + 0.08;
  const q = [P(d - along / 2, o - across / 2, y), P(d - along / 2, o + across / 2, y), P(d + along / 2, o - across / 2, y), P(d + along / 2, o + across / 2, y)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...q[0], ...q[2], ...q[1], ...q[1], ...q[2], ...q[3]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, along, across, 0, across, 0, 0, along, across, along], 2));
  g.computeVertexNormals();
  // Brine: pale where it has dried, milky green where it is fresh.
  const dry = rng.chance(0.35);
  gb.add('water', g);
  // Earth bunds around the pan.
  for (const [a, b] of [
    [P(d - along / 2, o - across / 2, gy + 0.25), P(d + along / 2, o - across / 2, gy + 0.25)],
    [P(d - along / 2, o + across / 2, gy + 0.25), P(d + along / 2, o + across / 2, gy + 0.25)],
    [P(d - along / 2, o - across / 2, gy + 0.25), P(d - along / 2, o + across / 2, gy + 0.25)],
    [P(d + along / 2, o - across / 2, gy + 0.25), P(d + along / 2, o + across / 2, gy + 0.25)],
  ])
    gb.add('ground', tint(beam(a, b, 2.2, 0.3), 0.8, 0.72, 0.62));
  // Heaps of harvested salt.
  if (dry || rng.chance(0.3)) {
    const n = rng.int(2, 6);
    for (let i = 0; i < n; i++) {
      const p = P(d + rng.range(-along / 2.5, along / 2.5), o + rng.range(-across / 3, across / 3), gy);
      const r = rng.range(1.2, 2.4);
      gb.add('paint', tint(new THREE.ConeGeometry(r, r * 0.8, 9).translate(p[0], gy + r * 0.4, p[2]).toNonIndexed(), 0.96, 0.95, 0.92));
    }
  }
}

function millShed(gb: GeoBuilder, P: Pt, d: number, o: number, along: number, across: number, side: number, gy: number, rng: RNG, headingAt: (d: number) => number): void {
  // An old textile mill shed: brick walls with a saw-tooth north-light roof.
  const h = rng.range(7, 10);
  const p = P(d, o, 0);
  const r = headingAt(d);
  gb.add('brick', boxGeo(across, h, along).rotateY(r).translate(p[0], gy + h / 2, p[2]));
  const teeth = Math.max(2, Math.floor(along / 6));
  for (let i = 0; i < teeth; i++) {
    const dd = d - along / 2 + (i + 0.5) * (along / teeth);
    const q = P(dd, o, 0);
    const g = boxGeo(across, 0.08, along / teeth + 0.3);
    g.rotateX(0.5);
    gb.add('tin', tint(g.rotateY(r).translate(q[0], gy + h + 1.2, q[2]), 0.5, 0.45, 0.4));
  }
  void side;
}

function chimney(gb: GeoBuilder, P: Pt, d: number, o: number, gy: number, rng: RNG): void {
  // Brick mill chimney (Lower Parel's mill lands) ⚠ placed generically.
  const h = rng.range(35, 55);
  const p = P(d, o, 0);
  const g = new THREE.CylinderGeometry(1.2, 2.4, h, 14, 1, true).translate(p[0], gy + h / 2, p[2]);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 11, uv.getY(i) * h);
  gb.add('brick', g);
  gb.add('paint', tint(new THREE.CylinderGeometry(1.45, 1.45, 1.4, 14).translate(p[0], gy + h - 0.7, p[2]), 0.25, 0.22, 0.2));
}
