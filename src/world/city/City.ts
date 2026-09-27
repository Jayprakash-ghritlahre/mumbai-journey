import * as THREE from 'three';
import { RNG } from '../../core/Random';
import type { TextureFactory } from '../../gfx/TextureFactory';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import type { CollisionWorld } from '../../core/Collision';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { GeoBuilder } from '../../gfx/GeoBuilder';
import { FACADE, buildFacadeArray } from '../../gfx/FacadeTextures';
import { BuildingBatch, createFacadeMaterial, type BuildingSpec } from './BuildingGen';
import { asphalt, grass, kerbStripes, pavers } from '../../gfx/Surfaces';
import { makeCanvas } from '../../gfx/TextureFactory';
import { buildTrees } from './Trees';
import { InstanceCuller as InstanceCullerImpl } from '../../gfx/InstanceCuller';
import type { InstanceCuller } from '../../gfx/InstanceCuller';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const mergeGeo = (g: THREE.BufferGeometry[]) => mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)))!;

export interface GeoBuilding {
  id: number;
  n: string | null;
  lv: number | null;
  h: number | null;
  t: string;
  c: string | null;
  hist: number;
  fp: number[];
}
export interface GeoRoad {
  id: number;
  n: string | null;
  k: string;
  ln: number | null;
  ow: number;
  w: number;
  br: number;
  tun: number;
  lay: number;
  p: number[];
}
export interface GeoData {
  attribution: string;
  buildings: GeoBuilding[];
  roads: GeoRoad[];
  areas: { k: string; n: string | null; p: number[]; sport?: string | null }[];
  coast: { p: number[] }[];
  trees: number[];
  pois: { k: string; n: string | null; x: number; z: number; ref: string | null }[];
}

export interface CityOptions {
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** Further areas built like the main one (Nariman Point). */
  extraBounds?: { x0: number; x1: number; z0: number; z1: number }[];
  detailCenter: { x: number; z: number };
  detailRadius: number;
  /** Further centres of full detail and collision (radius r). */
  extraDetail?: { x: number; z: number; r: number }[];
  /** Buildings whose centroid is inside these rectangles are skipped (modelled by hand). */
  exclude: { x0: number; x1: number; z0: number; z1: number }[];
  /** OSM ids of buildings modelled by hand elsewhere. */
  excludeIds?: number[];
  /** Areas dressed by hand (the Churchgate → Marine Drive route): no generic roads, pavements, trees or lamps. */
  corridor?: (x: number, z: number) => boolean;
  /** Skip the generic ground and sea (the route provides land and ocean). */
  skipGround?: boolean;
  /** Per-building look overrides (the corridor's Art Deco palette). */
  overrides?: Map<number, { wall: [number, number, number]; style: number }>;
}

const DECO_TINTS: [number, number, number][] = [
  [1, 0.98, 0.93],
  [1, 0.95, 0.85],
  [1, 0.93, 0.9],
  [0.95, 0.96, 0.98],
  [1, 0.97, 0.88],
  [0.98, 0.9, 0.86],
  [0.92, 0.95, 0.92],
  [1, 1, 1],
];

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

function area(fp: number[]): number {
  let a = 0;
  const n = fp.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += fp[i * 2] * fp[j * 2 + 1] - fp[j * 2] * fp[i * 2 + 1];
  }
  return Math.abs(a / 2);
}

/** Builds the streets and buildings around the station from OpenStreetMap data. */
export class City {
  readonly group = new THREE.Group();
  private facadeUniforms!: { uNight: { value: number } };
  facadeMaterial!: THREE.MeshStandardMaterial;
  private waterNormal!: THREE.Texture;
  readonly landmarks: { name: string; x: number; z: number; h: number }[] = [];
  readonly cullers: InstanceCuller[] = [];
  /** Generated height of every building (by OSM id), for attaching landmark details. */
  readonly heights = new Map<number, number>();

  constructor(
    private readonly tf: TextureFactory,
    private readonly av: AmbientVolume,
    private readonly mats: StationMaterials,
    private readonly col: CollisionWorld,
    private readonly geo: GeoData,
  ) {
    this.group.name = 'city';
  }

  build(o: CityOptions): void {
    const rng = new RNG(1928);
    const boxes = [o.bounds, ...(o.extraBounds ?? [])];
    const inBounds = (x: number, z: number) => boxes.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
    const corridor = o.corridor ?? (() => false);
    const excluded = (x: number, z: number) => o.exclude.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) || corridor(x, z);

    // ---- Materials --------------------------------------------------------------
    const facadeTex = buildFacadeArray(this.tf);
    const fac = createFacadeMaterial(facadeTex, this.av);
    this.facadeUniforms = fac.uniforms;
    this.facadeMaterial = fac.material;
    const M = this.mats;
    const std = (name: string, p: THREE.MeshStandardMaterialParameters, macro = 0) => M.add(name, new THREE.MeshStandardMaterial(p), macro);
    const asp = asphalt(this.tf);
    const aspMap = asp.map.clone();
    aspMap.repeat.set(1 / 6, 1 / 6);
    const aspR = asp.roughnessMap!.clone();
    aspR.repeat.set(1 / 6, 1 / 6);
    std('asphalt', { map: aspMap, roughnessMap: aspR, roughness: 1 }, 0.4);
    const pv = pavers(this.tf);
    const pvMap = pv.map.clone();
    pvMap.repeat.set(1 / 2, 1 / 2);
    const pvN = pv.normalMap!.clone();
    pvN.repeat.set(1 / 2, 1 / 2);
    std('paver', { map: pvMap, normalMap: pvN, roughness: 0.85 }, 0.45);
    const kb = kerbStripes(this.tf).map.clone();
    kb.repeat.set(1, 1);
    std('kerb', { map: kb, roughness: 0.8, side: THREE.DoubleSide });
    const gr = grass(this.tf).map.clone();
    gr.repeat.set(1 / 4, 1 / 4);
    std('grass', { map: gr, roughness: 0.95 }, 0.5);
    // Open ground (compounds, lots, lanes): as in milestone 1.
    std('ground', { map: pvMap, color: 0x9a9288, roughness: 0.95 }, 0.6);
    std('marking', { color: 0xd8d6cc, roughness: 0.7 }, 0.3);
    std('trim', { color: 0xd8d2c2, roughness: 0.85 }, 0.3);
    std('cityDetail', { vertexColors: true, roughness: 0.88 }, 0.4);
    std('roof', { color: 0x6b675f, roughness: 0.95 }, 0.6);
    std('roofBox', { color: 0x9d998f, roughness: 0.9 }, 0.3);
    std('tank', { color: 0x141414, roughness: 0.55 });
    std('trunk', { color: 0x4a3c30, roughness: 0.95 }, 0.4);
    std('leaves', { color: 0x3f5a2a, roughness: 0.9, flatShading: false }, 0.6);

    // ---- Buildings --------------------------------------------------------------
    const tiles = new Map<string, BuildingBatch>();
    const tileOf = (x: number, z: number) => {
      const k = `${Math.floor(x / 180)},${Math.floor(z / 180)}`;
      let b = tiles.get(k);
      if (!b) tiles.set(k, (b = new BuildingBatch()));
      return b;
    };
    for (const b of this.geo.buildings) {
      if (b.t === 'roof' || b.t === 'part' || b.t === 'construction' || b.t === 'train_station') continue;
      if (o.excludeIds?.includes(b.id)) continue;
      const [cx, cz] = centroid(b.fp);
      if (!inBounds(cx, cz) || o.exclude.some((r) => cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1)) continue;
      const ar = area(b.fp);
      if (ar < 12) continue;
      const brng = rng.fork(b.id % 100000);
      const t = b.t;
      const heritage = b.hist === 1 || ['university', 'college', 'government', 'civic', 'public', 'church', 'cathedral', 'service'].includes(t);
      let style: number = FACADE.deco;
      if (heritage) style = FACADE.stone;
      else if (t === 'office' || t === 'commercial') style = brng.weighted([
        [FACADE.office, 3],
        [FACADE.grille, 3],
        [FACADE.deco, 3],
        [FACADE.glass, 1],
      ] as const);
      else if (t === 'apartments' || t === 'residential') style = brng.weighted([
        [FACADE.deco, 5],
        [FACADE.decoBalcony, 4],
        [FACADE.grille, 2],
        [FACADE.chawl, 1],
      ] as const);
      else if (t === 'hotel') style = brng.chance(0.6) ? FACADE.decoBalcony : FACADE.glass;
      else if (t === 'retail' || t === 'kiosk' || t === 'shed') style = FACADE.shop;
      else style = brng.weighted([
        [FACADE.deco, 4],
        [FACADE.grille, 4],
        [FACADE.chawl, 2],
        [FACADE.decoBalcony, 2],
      ] as const);
      const defLv = t === 'retail' || t === 'kiosk' || t === 'shed' || t === 'garage' ? 1 : t === 'office' || t === 'hotel' ? 7 : t === 'apartments' ? 6 : ar < 80 ? 2 : 5;
      let levels = b.lv && b.lv < 40 ? b.lv : defLv;
      if (!b.lv && b.h && b.h < 120) levels = Math.max(1, Math.round(b.h / 3.4));
      const floorH = heritage ? 4.6 : 3.35;
      const groundH = heritage ? 5.5 : 4.3;
      const height = groundH + Math.max(0, levels - 1) * floorH;
      this.heights.set(b.id, height);
      // Distance to the nearest detail centre, measured against its radius (main centre first).
      let d = Math.hypot(cx - o.detailCenter.x, cz - o.detailCenter.z);
      for (const e of o.extraDetail ?? []) d = Math.min(d, Math.hypot(cx - e.x, cz - e.z) * (o.detailRadius / e.r));
      const detail: 0 | 1 = d < o.detailRadius ? 1 : 0;
      const ov = o.overrides?.get(b.id);
      if (ov) style = ov.style;
      const tint = ov ? ov.wall : heritage ? ([1, 1, 1] as [number, number, number]) : brng.pick(DECO_TINTS);
      const spec: BuildingSpec = {
        fp: b.fp,
        height,
        floorH,
        groundH,
        style,
        groundStyle: heritage ? FACADE.stone : levels <= 1 ? FACADE.shop : brng.chance(0.75) ? FACADE.shop : style,
        tint,
        seed: brng.range(0, 100),
        chajjas: !ov && (style === FACADE.deco || style === FACADE.decoBalcony || style === FACADE.chawl),
        parapet: 1.0,
        detail,
      };
      tileOf(cx, cz).add(spec);
      if (b.n && (heritage || levels >= 6)) this.landmarks.push({ name: b.n, x: cx, z: cz, h: height });
      // Collision: walls along the footprint.
      if (d < 700) {
        const n = b.fp.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          this.col.addWall(b.fp[i * 2], b.fp[i * 2 + 1], b.fp[j * 2], b.fp[j * 2 + 1], 0.4, -2, height);
        }
      }
    }
    for (const batch of tiles.values()) {
      if (batch.empty) continue;
      this.group.add(batch.buildWalls(fac.material));
      const det = batch.details.build(M.m);
      det.children.forEach((c) => (c as THREE.Mesh).geometry.computeBoundingSphere());
      this.group.add(det);
    }

    // ---- Ground, sea, parks -----------------------------------------------------
    if (!o.skipGround) this.buildGroundAndSea(o);
    const gb = new GeoBuilder();
    for (const a of this.geo.areas) {
      if (!['park', 'garden', 'grass', 'pitch', 'recreation_ground', 'stadium', 'common', 'playground'].includes(a.k)) continue;
      const [cx, cz] = centroid(a.p);
      if (!inBounds(cx, cz)) continue;
      const contour: THREE.Vector2[] = [];
      for (let i = 0; i < a.p.length; i += 2) contour.push(new THREE.Vector2(a.p[i], a.p[i + 1]));
      if (contour.length < 3) continue;
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const pos: number[] = [];
      const uv: number[] = [];
      const y = a.k === 'pitch' || a.k === 'stadium' ? 0.035 : 0.03;
      for (const t of tris) {
        const [p, q, r] = t.map((k) => contour[k]);
        const cross = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        for (const v of cross < 0 ? [p, q, r] : [p, r, q]) {
          pos.push(v.x, y, v.y);
          uv.push(v.x, -v.y);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      gb.add('grass', g);
    }

    // ---- Roads, pavements, kerbs, markings -----------------------------------------
    this.buildRoads(gb, o, inBounds, excluded, rng);
    this.group.add(gb.build(M.m, { castShadow: false }));

    // ---- Street trees -------------------------------------------------------------
    this.buildTrees(o, inBounds, excluded, rng);
    this.buildStreetLamps(inBounds, excluded, rng);
  }

  private roadGrid: Map<number, { ax: number; az: number; bx: number; bz: number; hw: number }[]> | null = null;

  /**
   * True if (x, z) is on a drivable carriageway (within half its width plus `pad` of an OSM centre
   * line). Avenue trees and lamp posts offset from one carriageway of a dual road would otherwise
   * land on the other one.
   */
  private onCarriageway(x: number, z: number, pad: number): boolean {
    const CELL = 16;
    const key = (ix: number, iz: number) => (ix + 2000) * 5000 + (iz + 2000);
    if (!this.roadGrid) {
      const grid = new Map<number, { ax: number; az: number; bx: number; bz: number; hw: number }[]>();
      const drivable = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk']);
      for (const r of this.geo.roads) {
        if (!drivable.has(r.k) || r.tun) continue;
        for (let i = 0; i < r.p.length - 2; i += 2) {
          const seg = { ax: r.p[i], az: r.p[i + 1], bx: r.p[i + 2], bz: r.p[i + 3], hw: r.w / 2 };
          const m = seg.hw + 2;
          for (let ix = Math.floor((Math.min(seg.ax, seg.bx) - m) / CELL); ix <= Math.floor((Math.max(seg.ax, seg.bx) + m) / CELL); ix++)
            for (let iz = Math.floor((Math.min(seg.az, seg.bz) - m) / CELL); iz <= Math.floor((Math.max(seg.az, seg.bz) + m) / CELL); iz++) {
              const k = key(ix, iz);
              let l = grid.get(k);
              if (!l) grid.set(k, (l = []));
              l.push(seg);
            }
        }
      }
      this.roadGrid = grid;
    }
    for (const g of this.roadGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const dx = g.bx - g.ax;
      const dz = g.bz - g.az;
      const t = THREE.MathUtils.clamp(((x - g.ax) * dx + (z - g.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      if (Math.hypot(g.ax + dx * t - x, g.az + dz * t - z) < g.hw + pad) return true;
    }
    return false;
  }

  /** Tall street lights along the main roads; their light is baked into the ambient volume. */
  private buildStreetLamps(inBounds: (x: number, z: number) => boolean, excluded: (x: number, z: number) => boolean, rng: RNG): void {
    const poleParts = [new THREE.CylinderGeometry(0.07, 0.11, 8.6, 6).translate(0, 4.3, 0), new THREE.CylinderGeometry(0.045, 0.045, 1.9, 5).rotateZ(Math.PI / 2 - 0.25).translate(0.9, 8.75, 0)];
    const poleGeo = mergeGeo(poleParts);
    const headGeo = new THREE.BoxGeometry(0.75, 0.14, 0.32).translate(1.8, 8.95, 0);
    const poles: THREE.Matrix4[] = [];
    const seen: THREE.Vector2[] = [];
    for (const r of this.geo.roads) {
      if (!['primary', 'secondary', 'tertiary'].includes(r.k)) continue;
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < r.p.length; i += 2) pts.push(new THREE.Vector2(r.p[i], r.p[i + 1]));
      const seg = subdivide(pts, 30);
      for (let i = 1; i < seg.length - 1; i++) {
        const a = seg[i - 1];
        const b = seg[i + 1];
        const d = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
        const n = new THREE.Vector2(-d.y, d.x);
        const side = i % 2 ? 1 : -1;
        const x = seg[i].x + n.x * side * (r.w / 2 + 0.7);
        const z = seg[i].y + n.y * side * (r.w / 2 + 0.7);
        if (!inBounds(x, z) || excluded(x, z) || this.onCarriageway(x, z, 0.5)) continue;
        if (seen.some((v) => (v.x - x) ** 2 + (v.y - z) ** 2 < 144)) continue;
        seen.push(new THREE.Vector2(x, z));
        // Arm reaches out over the carriageway.
        const yaw = Math.atan2(-n.y * -side, n.x * -side);
        const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
        poles.push(m);
        this.av.light(x - n.x * side * 1.8, z - n.y * side * 1.8, 16, 0.5);
        void rng;
      }
    }
    const pole = new THREE.InstancedMesh(poleGeo, this.mats.m.steelGrey, poles.length);
    const head = new THREE.InstancedMesh(headGeo, this.mats.m.lampSodium, poles.length);
    poles.forEach((m, i) => {
      pole.setMatrixAt(i, m);
      head.setMatrixAt(i, m);
    });
    pole.castShadow = true;
    head.castShadow = false;
    this.group.add(pole, head);
    this.cullers.push(new InstanceCullerImpl([pole, head], poles, 6, 420, 40));
  }

  private buildGroundAndSea(o: CityOptions): void {
    const { x0, x1, z0, z1 } = o.bounds;
    // Coastline (land on the left of the way direction): ways 7 and 8 trace Marine Drive.
    const coastPts: THREE.Vector2[] = [];
    for (const c of this.geo.coast) {
      for (let i = 0; i < c.p.length; i += 2) {
        const x = c.p[i];
        const z = c.p[i + 1];
        if (z > z0 - 400 && z < z1 + 400 && x < x1 && x > x0 - 800) coastPts.push(new THREE.Vector2(x, z));
      }
    }
    coastPts.sort((a, b) => a.y - b.y);
    const zA = z0 - 300;
    const zB = z1 + 300;
    const coastX = (z: number) => {
      if (!coastPts.length) return x0 - 50;
      let best = coastPts[0];
      for (const p of coastPts) if (Math.abs(p.y - z) < Math.abs(best.y - z)) best = p;
      return best.x;
    };
    const land: THREE.Vector2[] = [new THREE.Vector2(coastX(zA), zA), ...coastPts.filter((p) => p.y > zA && p.y < zB), new THREE.Vector2(coastX(zB), zB), new THREE.Vector2(x1 + 400, zB), new THREE.Vector2(x1 + 400, zA)];
    const shape = new THREE.Shape(land);
    const lg = new THREE.ShapeGeometry(shape);
    lg.rotateX(Math.PI / 2);
    const uv = lg.attributes.uv as THREE.BufferAttribute;
    const pp = lg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i), -pp.getZ(i));
    // ShapeGeometry faces +Z; rotated by +π/2 about X it faces -Y, so flip.
    lg.scale(1, -1, 1);
    lg.translate(0, -0.005, 0);
    const idx = lg.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    lg.computeVertexNormals();
    const ground = new THREE.Mesh(lg, this.mats.m.ground);
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.group.add(ground);
    // Sea: a large plane below the promenade level, west of the coast.
    this.waterNormal = this.makeWaterNormal();
    const wm = new THREE.MeshStandardMaterial({ color: 0x1f3a44, roughness: 0.12, metalness: 0.0, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.6, 0.6) });
    this.mats.add('sea', wm);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), wm);
    sea.position.set(x0 - 3000 + 250, -1.6, (z0 + z1) / 2);
    sea.receiveShadow = false;
    this.group.add(sea);
  }

  private makeWaterNormal(): THREE.Texture {
    const S = 256;
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    hx.fillStyle = '#808080';
    hx.fillRect(0, 0, S, S);
    this.tf.overlayNoise(hx, S, S, 1, 2, 0.7, 'overlay', 90);
    this.tf.overlayNoise(hx, S, S, 2, 4, 0.5, 'overlay', 91);
    void c;
    void ctx;
    const t = this.tf.normalFromHeight(h, 3);
    t.repeat.set(1 / 18, 1 / 18);
    return t;
  }

  private buildRoads(gb: GeoBuilder, o: CityOptions, inBounds: (x: number, z: number) => boolean, excluded: (x: number, z: number) => boolean, rng: RNG): void {
    const major = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
    const drivable = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'residential', 'unclassified', 'service', 'living_street']);
    // Junction points (shared vertices) of drivable roads: pavements stop short of them.
    const counts = new Map<string, number>();
    const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;
    for (const r of this.geo.roads) {
      if (!drivable.has(r.k)) continue;
      for (let i = 0; i < r.p.length; i += 2) counts.set(key(r.p[i], r.p[i + 1]), (counts.get(key(r.p[i], r.p[i + 1])) ?? 0) + 1);
    }
    const junctions: [number, number][] = [];
    counts.forEach((c, k) => {
      if (c >= 2) {
        const [x, z] = k.split(',').map(Number);
        junctions.push([x, z]);
      }
    });
    const nearJunction = (x: number, z: number, r: number) => junctions.some(([jx, jz]) => (jx - x) ** 2 + (jz - z) ** 2 < r * r);

    for (const r of this.geo.roads) {
      if (r.tun) continue;
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < r.p.length; i += 2) pts.push(new THREE.Vector2(r.p[i], r.p[i + 1]));
      if (pts.length < 2) continue;
      if (!pts.some((p) => inBounds(p.x, p.y))) continue;
      const isFoot = r.k === 'footway' || r.k === 'pedestrian' || r.k === 'path' || r.k === 'steps' || r.k === 'cycleway';
      if (isFoot && pts.some((p) => excluded(p.x, p.y))) continue;
      if (!isFoot && !drivable.has(r.k)) continue;
      if (!isFoot && o.corridor) {
        // Keep only the parts of the way outside the hand-built corridor (with a small overlap).
        const dense = subdivide(pts, 3);
        const runs: THREE.Vector2[][] = [];
        let run: THREE.Vector2[] = [];
        for (const p of dense) {
          if (o.corridor(p.x, p.y)) {
            if (run.length) {
              run.push(p);
              runs.push(run);
              run = [];
            }
          } else {
            if (!run.length && runs.length === 0 && dense.indexOf(p) > 0) run.push(dense[dense.indexOf(p) - 1]);
            run.push(p);
          }
        }
        if (run.length) runs.push(run);
        const drawn = runs.filter((rr) => rr.length >= 2);
        if (!drawn.length) continue;
        if (drawn.length !== 1 || drawn[0].length !== dense.length) {
          for (const rr of drawn) {
            const y = major.has(r.k) ? 0.012 : 0.008;
            gb.add('asphalt', ribbon(rr, r.w, y, 0));
          }
          continue;
        }
      }
      const w = isFoot ? Math.max(2, r.w) : r.w;
      const y = isFoot ? 0.15 : major.has(r.k) ? 0.012 : 0.008;
      gb.add(isFoot ? 'paver' : 'asphalt', ribbon(pts, w, y, 0));
      if (isFoot) continue;
      // Lane markings.
      const lanes = r.ln ?? (r.w >= 9 ? 3 : r.w >= 6 ? 2 : 1);
      if (major.has(r.k) && lanes >= 2) {
        for (let l = 1; l < lanes; l++) {
          const off = -w / 2 + (w * l) / lanes;
          if (!r.ow && l !== Math.floor(lanes / 2)) continue;
          gb.add('marking', dashed(pts, off, 0.12, y + 0.004, r.ow ? 3 : 4, r.ow ? 5 : 3));
        }
        for (const s of [-1, 1]) gb.add('marking', dashed(pts, s * (w / 2 - 0.35), 0.1, y + 0.004, 1000, 0));
      }
      // Raised pavements with painted kerbs along major roads.
      if (major.has(r.k)) {
        const sw = r.k === 'tertiary' ? 2.4 : 3.4;
        for (const s of [-1, 1]) {
          const segs = subdivide(pts, 4);
          let run: THREE.Vector2[] = [];
          const flush = () => {
            if (run.length >= 2) {
              gb.add('paver', ribbon(run, sw, 0.16, s * (w / 2 + sw / 2)));
              gb.add('kerb', kerbFace(run, s * (w / 2), 0.16, s));
            }
            run = [];
          };
          for (const p of segs) {
            if (nearJunction(p.x, p.y, w / 2 + 7) || excluded(p.x, p.y)) flush();
            else run.push(p);
          }
          flush();
        }
      }
      void rng;
      void o;
    }
  }

  private buildTrees(o: CityOptions, inBounds: (x: number, z: number) => boolean, excluded: (x: number, z: number) => boolean, rng: RNG): void {
    const spots: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < this.geo.trees.length; i += 2) {
      const x = this.geo.trees[i];
      const z = this.geo.trees[i + 1];
      if (inBounds(x, z) && !excluded(x, z) && !this.onCarriageway(x, z, 0.9)) spots.push({ x, z, s: rng.range(0.8, 1.3) });
    }
    // Avenue trees along the main roads (rain trees and gulmohars shade most South Mumbai streets).
    for (const r of this.geo.roads) {
      if (!['primary', 'secondary', 'tertiary'].includes(r.k)) continue;
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < r.p.length; i += 2) pts.push(new THREE.Vector2(r.p[i], r.p[i + 1]));
      const seg = subdivide(pts, rng.range(11, 16));
      for (let i = 1; i < seg.length - 1; i++) {
        const a = seg[i - 1];
        const b = seg[i + 1];
        const d = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
        const n = new THREE.Vector2(-d.y, d.x);
        for (const s of [-1, 1]) {
          if (!rng.chance(0.55)) continue;
          const off = r.w / 2 + 1.9;
          const x = seg[i].x + n.x * off * s;
          const z = seg[i].y + n.y * off * s;
          if (!inBounds(x, z) || excluded(x, z) || this.onCarriageway(x, z, 0.9)) continue;
          spots.push({ x, z, s: rng.range(0.85, 1.35) });
        }
      }
    }
    // Trees around the maidans.
    for (const a of this.geo.areas) {
      if (!['park', 'garden', 'recreation_ground'].includes(a.k)) continue;
      for (let i = 0; i < a.p.length; i += 6) {
        const x = a.p[i];
        const z = a.p[i + 1];
        if (inBounds(x, z) && rng.chance(0.7)) spots.push({ x, z, s: rng.range(0.9, 1.4) });
      }
    }
    for (const t of spots) this.col.addSolid(t.x, t.z, 0.3, 0.3, 0, -1, 6);
    this.group.add(buildTrees(this.tf, this.mats, spots, this.cullers));
    void o;
  }

  cull(camera: THREE.PerspectiveCamera): void {
    for (const c of this.cullers) c.update(camera);
  }

  update(night: number, time: number): void {
    this.facadeUniforms.uNight.value = THREE.MathUtils.smoothstep(night, 0.55, 1.0);
    if (this.waterNormal) this.waterNormal.offset.set(time * 0.004, time * 0.0025);
  }
}

/** Evenly re-samples a polyline every `step` metres. */
export function subdivide(pts: THREE.Vector2[], step: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [pts[0].clone()];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}

/** Flat ribbon along a polyline (offset sideways by `off`), with metre UVs (u across, v along). */
export function ribbon(pts: THREE.Vector2[], w: number, y: number, off: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const d = new THREE.Vector2(next.x - prev.x, next.y - prev.y).normalize();
    const n = new THREE.Vector2(-d.y, d.x);
    if (i > 0) v += pts[i].distanceTo(pts[i - 1]);
    const cx = pts[i].x + n.x * off;
    const cz = pts[i].y + n.y * off;
    pos.push(cx - n.x * w * 0.5, y, cz - n.y * w * 0.5, cx + n.x * w * 0.5, y, cz + n.y * w * 0.5);
    uv.push(0, v, w, v);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Make sure the ribbon faces up.
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  if (nrm.count && nrm.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

function dashed(pts: THREE.Vector2[], off: number, w: number, y: number, dash: number, gap: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const seg = subdivide(pts, 1);
  let run: THREE.Vector2[] = [];
  let t = 0;
  for (let i = 0; i < seg.length; i++) {
    const on = gap === 0 || t % (dash + gap) < dash;
    if (on) run.push(seg[i]);
    else if (run.length) {
      if (run.length >= 2) parts.push(ribbon(run, w, y, off));
      run = [];
    }
    if (i > 0) t += seg[i].distanceTo(seg[i - 1]);
  }
  if (run.length >= 2) parts.push(ribbon(run, w, y, off));
  if (!parts.length) return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  const merged = parts.length === 1 ? parts[0] : mergeRibbons(parts);
  return merged;
}

function mergeRibbons(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const p of parts) {
    const pa = p.attributes.position.array as Float32Array;
    const ua = p.attributes.uv.array as Float32Array;
    const na = p.attributes.normal.array as Float32Array;
    pos.push(...pa);
    uv.push(...ua);
    nor.push(...na);
    const ia = p.index!.array;
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + base);
    base += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Vertical kerb face along a road edge, textured with painted black/yellow stripes. */
function kerbFace(pts: THREE.Vector2[], off: number, h: number, side: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const d = new THREE.Vector2(next.x - prev.x, next.y - prev.y).normalize();
    const n = new THREE.Vector2(-d.y, d.x);
    if (i > 0) v += pts[i].distanceTo(pts[i - 1]);
    const x = pts[i].x + n.x * off;
    const z = pts[i].y + n.y * off;
    pos.push(x, 0, z, x, h, z);
    uv.push(v, 0, v, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      if (side > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
