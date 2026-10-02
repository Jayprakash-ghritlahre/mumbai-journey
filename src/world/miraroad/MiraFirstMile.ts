import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { SignAtlas, signQuad, type AtlasRect } from '../../gfx/Signage';
import type { TextureFactory } from '../../gfx/TextureFactory';
import type { StationMaterials } from '../churchgate/StationMaterials';
import type { TreeSpot } from '../city/Trees';
import { flatPolygon } from '../route/Path2';
import { twinArmLamp } from '../route/Props';
import { offsetLine, type AutoRoute } from './AutoRoute';
import { FOOTPATH, GROUND, ROAD, V3, beam, lamp, mat4, solid, wall, type MiraCtx } from './MiraCtx';
import { coconutCart, gateLeaf, gatePillar, hedge, paniPuriCart, plasticChair, signalHead, signalPole, speedBreaker, teaTapri, vegCart, watchCabin } from './MiraProps';
import { buildFirstMileSigns, type FirstMileSigns } from './MiraSigns';
import { buildStationShops } from './MiraStationShops';
import { BIKES, BODY, busShelter, face, hoarding, inPoly, instanced, prop, segDist, shopfront, type OsmWay } from './MiraStreets';
import { autoRickshaw, carGeo, twoWheeler } from './MiraVehicles';

/**
 * The streets of the auto ride (AUTO_RIDE.md §3), beyond what Mira Road station's own street
 * dressing reaches: Shanti Nagar Sector 2's internal lanes (compound walls painted by each society,
 * their gates with name boards and watchmen, trees over the walls, paved shoulders, two-wheelers
 * parked along them, lamp posts strung with cables, speed breakers), the road west past Sector 1
 * (shops, a tea tapri, handcarts), Poonam Sagar Road (shopfronts both sides, the planted median
 * with its twin lamps, the bus stop, a coconut seller, banners and hoardings), and the signal at
 * the station junction. Also the traffic that uses them, where people walk and wait, and the
 * pedestrians the ride sends across the road in front of you.
 *
 * Lanes, gates, stalls and vendors are placed from the photos' idiom (⚠ not surveyed); the roads,
 * buildings and junctions are OpenStreetMap's.
 */

type Pt = [number, number];
type Spot = { kind: string; x: number; z: number; y: number; h: number; pose?: number };
export type TrafficRouteSpec = { pts: Pt[]; speed: number; lanes: number[]; mix: 'station' | 'city' | 'lane'; count?: number };

/** Road widths as Mira Road's streets draw them (MiraStreets). */
const widthOf = (id: number, hw: string) => (id === 44427767 || id === 1238879349 ? 8 : hw === 'secondary' ? 9.5 : hw === 'tertiary' ? 8 : hw === 'residential' ? 6.5 : hw === 'living_street' ? 5 : 5.5);

const LANE_IDS = [215059080, 215058880];
const LANE_W = 5;
const WALL_OFF = 3.45;
const PS_NB = 788778486;
const PS_SB = 152327598;
const SECTOR1_RD = 99203763;

const WALL_COLS: [number, number, number][] = [
  [0.93, 0.86, 0.66],
  [0.95, 0.8, 0.66],
  [0.9, 0.9, 0.86],
  [0.95, 0.78, 0.76],
  [0.8, 0.88, 0.76],
  [0.96, 0.9, 0.55],
  [0.82, 0.84, 0.9],
];
const GATE_COLS: [number, number, number][] = [
  [0.12, 0.3, 0.18],
  [0.25, 0.27, 0.3],
  [0.38, 0.08, 0.08],
  [0.06, 0.06, 0.07],
  [0.12, 0.22, 0.42],
];

/**
 * The junction's signal (⚠ timings made up): phase 0 lets Poonam Sagar Road's northbound traffic
 * in; phase 1, Mira Road westbound and Shrikant Dhadwe Road southbound. 52 s cycle: green 22,
 * amber 3, all red 2; green 20, amber 3, all red 2.
 */
export class JunctionSignal {
  t = 3;
  static readonly CYCLE = 52;
  readonly group = new THREE.Group();
  /** Stop lines (local), the phase that holds them. */
  readonly stops: { x: number; z: number; h: number; phase: 0 | 1 }[] = [];
  private readonly lens: THREE.MeshStandardMaterial[][] = [];
  private readonly countCanvas: HTMLCanvasElement;
  private readonly countTex: THREE.CanvasTexture;
  private readonly countMat: THREE.MeshStandardMaterial;
  private lastShown = '';

  constructor() {
    this.group.name = 'junction-signal';
    const cols = [0xff2a1a, 0xffa500, 0x22e05a];
    for (let p = 0; p < 2; p++) this.lens.push(cols.map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.18), emissive: c, emissiveIntensity: 0, roughness: 0.3 })));
    this.countCanvas = document.createElement('canvas');
    this.countCanvas.width = 128;
    this.countCanvas.height = 64;
    this.countTex = new THREE.CanvasTexture(this.countCanvas);
    this.countTex.colorSpace = THREE.SRGBColorSpace;
    this.countMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: this.countTex, emissiveIntensity: 1.6, roughness: 0.4 });
  }

  /** 0 red, 1 amber, 2 green. */
  state(phase: 0 | 1, t = this.t): 0 | 1 | 2 {
    const c = ((t % JunctionSignal.CYCLE) + JunctionSignal.CYCLE) % JunctionSignal.CYCLE;
    const g0 = phase === 0 ? 0 : 27;
    if (c >= g0 && c < g0 + 22 - (phase === 1 ? 2 : 0)) return 2;
    if (c >= g0 + 22 - (phase === 1 ? 2 : 0) && c < g0 + 25 - (phase === 1 ? 2 : 0)) return 1;
    return 0;
  }

  /** Seconds until this phase's light changes. */
  remaining(phase: 0 | 1): number {
    const s = this.state(phase);
    let dt = 0;
    while (dt < JunctionSignal.CYCLE && this.state(phase, this.t + dt) === s) dt += 0.25;
    return dt;
  }

  /** Lit lenses (per phase, per colour: red, amber, green) and the countdown faces. */
  build(geos: THREE.BufferGeometry[][][], countdown: THREE.Matrix4[]): void {
    for (let p = 0; p < 2; p++)
      for (let i = 0; i < 3; i++) {
        if (!geos[p][i].length) continue;
        const g = geos[p][i].length > 1 ? mergeAll(geos[p][i]) : geos[p][i][0];
        const mesh = new THREE.Mesh(g, this.lens[p][i]);
        mesh.castShadow = false;
        this.group.add(mesh);
      }
    for (const m of countdown) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.23).applyMatrix4(m), this.countMat);
      mesh.castShadow = false;
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    this.t = (this.t + dt) % JunctionSignal.CYCLE;
    for (const p of [0, 1] as const) {
      const s = this.state(p);
      this.lens[p][0].emissiveIntensity = s === 0 ? 3.2 : 0.02;
      this.lens[p][1].emissiveIntensity = s === 1 ? 3.0 : 0.02;
      this.lens[p][2].emissiveIntensity = s === 2 ? 3.0 : 0.02;
    }
    // The countdown faces the northbound traffic (phase 0).
    const s = this.state(0);
    const left = Math.ceil(this.remaining(0));
    const text = s === 1 ? '' : String(Math.min(99, left)).padStart(2, '0');
    const key = `${s}${text}`;
    if (key !== this.lastShown) {
      this.lastShown = key;
      const c = this.countCanvas.getContext('2d')!;
      c.fillStyle = '#050505';
      c.fillRect(0, 0, 128, 64);
      c.fillStyle = s === 2 ? '#2bff6a' : '#ff3322';
      c.font = '700 54px "Noto Sans", monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, 64, 34);
      this.countTex.needsUpdate = true;
    }
  }
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.attributes.position.array as Float32Array));
    nor.push(...(ng.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

export interface FirstMile {
  routes: TrafficRouteSpec[];
  walks: THREE.Vector3[][];
  spots: Spot[];
  meshes: THREE.Object3D[];
  signal: JunctionSignal;
  /** Where you start, inside your society's gate (local), facing h (as the traffic's headings). */
  start: { x: number; z: number; h: number };
  /** The kerb outside the gate, where you wave the auto down. */
  kerb: { x: number; z: number };
  /** Your society's gate on the lane (local): its centre, inward normal n (into the compound), u along the lane. */
  gate: { x: number; z: number; nx: number; nz: number; ux: number; uz: number };
  /** Where the auto stops for you (its centre, along the route). */
  sPickup: number;
  /** People who cross in front of the auto (route s where they should meet it; from a to b, local). */
  crossings: { s: number; a: Pt; b: Pt }[];
  /** The zebra at the junction: people cross it while the northbound side waits at red. */
  zebra: { a: Pt; b: Pt };
}

export interface FirstMileInput {
  ways: OsmWay[];
  route: AutoRoute;
  /** Every building footprint (local). */
  buildings: Pt[][];
  /** Footprints along the route beyond the station's streets (shopfronts on the main roads). */
  routeBuildings: Pt[][];
  trees: (spots: TreeSpot[]) => THREE.Group;
  tf: TextureFactory;
  mats: StationMaterials;
  /** Shanti Shopping Centre and the bank on the junction's corner (OSM), dressed as they are. */
  stationBlock: Pt[] | null;
  bankCorner: Pt[] | null;
}

export function buildFirstMile(c0: MiraCtx, inp: FirstMileInput): FirstMile {
  const { ways, route } = inp;
  const rng = new RNG(2611);
  const c: MiraCtx = { ...c0, rng };
  const gb = c.gb;
  const way = (id: number) => ways.find((w) => w.id === id)!;

  // ---- Own sign atlas and materials --------------------------------------------------------------
  const atlas = new SignAtlas(inp.tf, 2048, 2048);
  const fs: FirstMileSigns = buildFirstMileSigns(atlas);
  atlas.commit();
  const lit = new THREE.MeshStandardMaterial({ map: atlas.texture, emissiveMap: atlas.texture, emissive: 0xffffff, emissiveIntensity: 0.04, roughness: 0.6 });
  inp.mats.add('fmSignsLit', lit);
  inp.mats.lampMats.push({ mat: lit, color: new THREE.Color(1, 1, 1), intensity: 0.55 });
  c.M.fmSignsLit = lit;
  c.M.fmSigns = inp.mats.add('fmSigns', new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.65 }));
  // Poonam Sagar Road's median kerb is painted black and white (the Street View capture).
  {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 32;
    const k2 = cv.getContext('2d')!;
    k2.fillStyle = '#e8e6df';
    k2.fillRect(0, 0, 64, 32);
    k2.fillStyle = '#1b1b1a';
    k2.fillRect(64, 0, 64, 32);
    const kr = new RNG(97);
    for (let i = 0; i < 70; i++) {
      k2.fillStyle = `rgba(110,100,90,${kr.range(0.15, 0.45)})`;
      k2.fillRect(kr.range(0, 128), kr.range(0, 32), kr.range(2, 9), kr.range(1, 4));
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    c.M.kerbBW = inp.mats.add('fmKerbBW', new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }), 0.3);
  }
  // Painted plaster (compound walls, the median's kerb top): the concrete texture under a colour.
  const conc = c.M.concrete as THREE.MeshStandardMaterial;
  c.M.plaster = inp.mats.add('fmPlaster', new THREE.MeshStandardMaterial({ color: new THREE.Color(1.7, 1.7, 1.7), map: conc.map, normalMap: conc.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 0.95 }), 0.3);
  const board = (rect: AtlasRect, w: number, h: number, m: THREE.Matrix4, opts: { lit?: boolean; back?: boolean; plate?: [number, number, number] } = {}) => {
    const key = opts.lit ? 'fmSignsLit' : 'fmSigns';
    gb.add(key, signQuad(rect, w, h).translate(0, 0, 0.029).applyMatrix4(m));
    if (opts.back) gb.add(key, signQuad(rect, w, h).rotateY(Math.PI).translate(0, 0, -0.029).applyMatrix4(m));
    const p = opts.plate ?? [0.15, 0.15, 0.16];
    gb.add('paint', tint(boxGeo(w + 0.06, h + 0.06, 0.05), p[0], p[1], p[2]).applyMatrix4(m));
  };

  // ---- Indices: roads and buildings ---------------------------------------------------------------
  const CELL = 20;
  const key = (i: number, j: number) => i * 100003 + j;
  const roadGrid = new Map<number, { a: Pt; b: Pt; hw: number; id: number }[]>();
  for (const e of ways) {
    const hw = e.tags.highway;
    if (!hw || e.tags.bridge || ['footway', 'steps', 'path', 'pedestrian', 'track', 'cycleway', 'corridor'].includes(hw)) continue;
    const w = widthOf(e.id, hw);
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1];
      const b = e.pts[i];
      const s = { a, b, hw: w / 2, id: e.id };
      const [x0, x1] = [Math.min(a[0], b[0]) - 8, Math.max(a[0], b[0]) + 8];
      const [z0, z1] = [Math.min(a[1], b[1]) - 8, Math.max(a[1], b[1]) + 8];
      for (let gi = Math.floor(x0 / CELL); gi <= Math.floor(x1 / CELL); gi++)
        for (let gj = Math.floor(z0 / CELL); gj <= Math.floor(z1 / CELL); gj++) {
          const k = key(gi, gj);
          let l = roadGrid.get(k);
          if (!l) roadGrid.set(k, (l = []));
          l.push(s);
        }
    }
  }
  /** On a road other than `skip` (within its half width + pad). */
  const onRoad = (x: number, z: number, pad: number, skip: number[] = []) => {
    const l = roadGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    return !!l && l.some((s) => !skip.includes(s.id) && segDist(x, z, s.a, s.b) < s.hw + pad);
  };
  const bGrid = new Map<number, number[]>();
  const bBox = inp.buildings.map((p) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of p) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    return [x0, z0, x1, z1];
  });
  bBox.forEach(([x0, z0, x1, z1], bi) => {
    for (let gi = Math.floor((x0 - 3) / CELL); gi <= Math.floor((x1 + 3) / CELL); gi++)
      for (let gj = Math.floor((z0 - 3) / CELL); gj <= Math.floor((z1 + 3) / CELL); gj++) {
        const k = key(gi, gj);
        let l = bGrid.get(k);
        if (!l) bGrid.set(k, (l = []));
        l.push(bi);
      }
  });
  /** Inside a building, or within pad of one. */
  const inBuilding = (x: number, z: number, pad: number) => {
    const l = bGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) return false;
    for (const bi of l) {
      const [x0, z0, x1, z1] = bBox[bi];
      if (x < x0 - pad || x > x1 + pad || z < z0 - pad || z > z1 + pad) continue;
      const p = inp.buildings[bi];
      if (inPoly(p, x, z)) return true;
      for (let i = 0; i < p.length; i++) if (segDist(x, z, p[i], p[(i + 1) % p.length]) < pad) return true;
    }
    return false;
  };
  /** Distance to the nearest building (0 inside one), looked for out to 12 m. */
  const buildingDist = (x: number, z: number) => {
    let best = 12;
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++) {
        const l = bGrid.get(key(i, j));
        if (!l) continue;
        for (const bi of l) {
          const [x0, z0, x1, z1] = bBox[bi];
          if (x < x0 - best || x > x1 + best || z < z0 - best || z > z1 + best) continue;
          const p = inp.buildings[bi];
          if (inPoly(p, x, z)) return 0;
          for (let k = 0; k < p.length; k++) best = Math.min(best, segDist(x, z, p[k], p[(k + 1) % p.length]));
        }
      }
    return best;
  };
  /** Clear of the auto's path by at least r. */
  const offPath = (x: number, z: number, r: number) => route.project(x, z).d > r;

  const out: FirstMile = {
    routes: [],
    walks: [],
    spots: [],
    meshes: [],
    signal: new JunctionSignal(),
    start: { x: 0, z: 0, h: 0 },
    kerb: { x: 0, z: 0 },
    gate: { x: 0, z: 0, nx: 1, nz: 0, ux: 0, uz: 1 },
    sPickup: route.sPickup,
    crossings: [],
    zebra: { a: [0, 0], b: [0, 0] },
  };
  const trees: TreeSpot[] = [];
  const bikes: { x: number; y: number; z: number; h: number; c?: THREE.Color }[] = [];
  const scooters: typeof bikes = [];
  const parkedAutos: typeof bikes = [];
  const cars: typeof bikes = [];
  const lampPosts: { p: THREE.Vector3; h: number }[] = [];
  const singleLamp = twinArmLamp(false, 8.2);
  const ryX = (dx: number, dz: number) => Math.atan2(-dz, dx);
  const ryZ = (dx: number, dz: number) => Math.atan2(dx, dz);

  const parkRow = (x: number, z: number, along: Pt, n: number, angle: number, step: number) => {
    for (let k = 0; k < n; k++) {
      const px = x + along[0] * k * step;
      const pz = z + along[1] * k * step;
      const h = ryZ(along[0], along[1]) + angle + rng.range(-0.12, 0.12);
      const v = { x: px, y: ROAD, z: pz, h, c: rng.pick(BIKES) };
      (rng.chance(0.5) ? scooters : bikes).push(v);
      solid(c, px, pz, 0.35, 0.95, h, -1, 1.2);
    }
  };

  // ---- Your gate: the society by the pickup, on the auto's left ---------------------------------
  // Sector 2's slab blocks stand right at the lane: the gate goes where the gap between them is
  // widest near the pickup, with room behind it to start from and a clear way out.
  let gate: { x: number; z: number; nx: number; nz: number; ux: number; uz: number; s: number } | null = null;
  let best = -Infinity;
  for (let ds = -18; ds <= 18; ds += 1) {
    const s = route.sPickup + ds;
    const a = route.at(s);
    // Left of the heading (sin h, cos h) is (cos h, −sin h).
    const lx = Math.cos(a.h);
    const lz = -Math.sin(a.h);
    const gx = a.x + lx * (WALL_OFF - 0.85);
    const gz = a.z + lz * (WALL_OFF - 0.85);
    if (onRoad(gx, gz, 0.7, [LANE_IDS[0]]) || !offPath(gx, gz, 1.9)) continue;
    let room = Infinity;
    for (let d = 0; d <= 7; d += 1) room = Math.min(room, buildingDist(gx + lx * d, gz + lz * d));
    if (room < 1.3) continue;
    const score = Math.min(room, 3.5) - Math.abs(ds) * 0.04;
    if (score > best) {
      best = score;
      gate = { x: gx, z: gz, nx: lx, nz: lz, ux: Math.sin(a.h), uz: Math.cos(a.h), s };
    }
  }
  if (!gate) {
    const a = route.at(route.sPickup);
    gate = { x: a.x + Math.cos(a.h) * 2.6, z: a.z - Math.sin(a.h) * 2.6, nx: Math.cos(a.h), nz: -Math.sin(a.h), ux: Math.sin(a.h), uz: Math.cos(a.h), s: route.sPickup };
  }
  // The auto's centre stops 0.6 m past the gate (its doorway, just behind the centre, by the gate).
  out.sPickup = gate.s + 0.4;
  out.kerb = { x: gate.x - gate.nx * 0.9, z: gate.z - gate.nz * 0.9 };
  // Where you start: well inside, never in a building, with a straight clear line out to the gate.
  {
    let st: Pt = [gate.x + gate.nx * 3, gate.z + gate.nz * 3];
    search: for (const d of [6, 5.5, 5, 4.5, 4, 3.5, 3]) {
      for (const u of [0, 0.6, -0.6, 1.2, -1.2]) {
        const x = gate.x + gate.nx * d + gate.ux * u;
        const z = gate.z + gate.nz * d + gate.uz * u;
        if (buildingDist(x, z) < 1.0) continue;
        let clear = true;
        for (let k = 1; k < 10 && clear; k++) clear = buildingDist(x + (gate.x - x) * (k / 10), z + (gate.z - z) * (k / 10)) > 0.7;
        if (clear) {
          st = [x, z];
          break search;
        }
      }
    }
    out.start = { x: st[0], z: st[1], h: ryZ(gate.x - st[0], gate.z - st[1]) };
  }
  out.gate = { x: gate.x, z: gate.z, nx: gate.nx, nz: gate.nz, ux: gate.ux, uz: gate.uz };
  // Your way out: from where you start, through the gate, across the shoulder onto the lane. Nothing
  // solid (trees, bikes, posts, the cabin) is put on it.
  const way1: [Pt, Pt] = [
    [out.start.x, out.start.z],
    [gate.x + gate.nx * 0.5, gate.z + gate.nz * 0.5],
  ];
  const way2: [Pt, Pt] = [
    [gate.x + gate.nx * 1.2, gate.z + gate.nz * 1.2],
    [gate.x - gate.nx * 2.8, gate.z - gate.nz * 2.8],
  ];
  const onYourWay = (x: number, z: number, r = 1.15) => segDist(x, z, way1[0], way1[1]) < r || segDist(x, z, way2[0], way2[1]) < r;

  // ---- Sector 2's lanes: walls, gates, shoulders, trees, parked bikes, lamps --------------------
  type Sample = { x: number; z: number; ux: number; uz: number; nx: number; nz: number; t: number; ok: boolean };
  const gateSpots: { x: number; z: number; nx: number; nz: number; ux: number; uz: number; mine: boolean }[] = [];
  for (const id of LANE_IDS) {
    const P = way(id).pts;
    for (const side of [1, -1]) {
      const line = offsetLine(P, side * WALL_OFF);
      // Samples every metre along the wall line.
      const S: Sample[] = [];
      let t = 0;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.01) continue;
        const ux = (b[0] - a[0]) / len;
        const uz = (b[1] - a[1]) / len;
        // Outward (into the compound): the wall line's left normal × side.
        const nx = uz * side;
        const nz = -ux * side;
        for (let d = 0; d < len; d += 1) {
          const x = a[0] + ux * d;
          const z = a[1] + uz * d;
          // Your gate: a gap cut in the wall (4 m between its pillars).
          const mine = id === LANE_IDS[0] && side === 1 && Math.hypot(x - gate.x, z - gate.z) < 2.05;
          const ok = !mine && !onRoad(x, z, 0.7, [id]) && !inBuilding(x, z, 0.35) && offPath(x, z, 1.9) && x > -20;
          S.push({ x, z, ux, uz, nx, nz, t: t + d, ok });
        }
        t += len;
      }
      // Spans of wall (straight runs of accepted samples).
      const spans: Sample[][] = [];
      let cur: Sample[] = [];
      for (const q of S) {
        const last = cur[cur.length - 1];
        if (!q.ok || (last && (last.ux * q.ux + last.uz * q.uz < 0.98 || Math.hypot(q.x - last.x, q.z - last.z) > 1.6))) {
          if (cur.length >= 3) spans.push(cur);
          cur = q.ok ? [q] : [];
          continue;
        }
        cur.push(q);
      }
      if (cur.length >= 3) spans.push(cur);
      // Cut gates into the longer spans: a 4 m gap between pillars (not too near yours).
      const pieces: Sample[][] = [];
      if (id === LANE_IDS[0] && side === 1) gateSpots.push({ x: gate.x, z: gate.z, nx: gate.nx, nz: gate.nz, ux: gate.ux, uz: gate.uz, mine: true });
      for (const sp of spans) {
        const cuts: { i: number; mine: boolean }[] = [];
        let next = rng.range(14, 30);
        for (let i = 0; i < sp.length - 6; i++) {
          if (i < next) continue;
          if (Math.hypot(sp[i].x - gate.x, sp[i].z - gate.z) < 9) {
            next = i + 4;
            continue;
          }
          cuts.push({ i, mine: false });
          next = i + rng.range(20, 38);
        }
        cuts.sort((a, b) => a.i - b.i);
        let i0 = 0;
        for (const cut of cuts) {
          const g0 = cut.i - 2;
          const g1 = Math.min(sp.length - 1, cut.i + 2);
          if (g0 <= i0) continue;
          pieces.push(sp.slice(i0, g0 + 1));
          const A = sp[g0];
          const B = sp[g1];
          gateSpots.push({ x: (A.x + B.x) / 2, z: (A.z + B.z) / 2, nx: A.nx, nz: A.nz, ux: A.ux, uz: A.uz, mine: cut.mine });
          i0 = g1;
        }
        pieces.push(sp.slice(i0));
      }
      // Build each piece of wall.
      for (const pc of pieces) {
        if (pc.length < 2) continue;
        const A = pc[0];
        const B = pc[pc.length - 1];
        const len = Math.hypot(B.x - A.x, B.z - A.z);
        if (len < 0.8) continue;
        const col = rng.pick(WALL_COLS);
        const y0 = GROUND;
        gb.add('plaster', tint(beam(V3(A.x, y0 + 0.78, A.z), V3(B.x, y0 + 0.78, B.z), 0.2, 1.56), col[0], col[1], col[2]));
        gb.add('plaster', tint(beam(V3(A.x, y0 + 0.2, A.z), V3(B.x, y0 + 0.2, B.z), 0.23, 0.4), col[0] * 0.62, col[1] * 0.58, col[2] * 0.56));
        gb.add('plaster', tint(beam(V3(A.x, y0 + 1.6, A.z), V3(B.x, y0 + 1.6, B.z), 0.28, 0.07), 0.78, 0.76, 0.72));
        for (let d = 0; d <= len; d += 3.2) {
          const x = A.x + (B.x - A.x) * (d / len);
          const z = A.z + (B.z - A.z) * (d / len);
          gb.add('plaster', tint(boxGeo(0.32, 1.72, 0.32).translate(x, y0 + 0.86, z), col[0] * 0.92, col[1] * 0.9, col[2] * 0.88));
        }
        wall(c, A.x, A.z, B.x, B.z, 0.25, -1, 2.2);
        // The paved shoulder between the lane and the wall.
        const iA: Pt = [A.x - A.nx * 0.95, A.z - A.nz * 0.95];
        const iB: Pt = [B.x - B.nx * 0.95, B.z - B.nz * 0.95];
        gb.add('pavers', tint(flatPolygon([iA, iB, [B.x - B.nx * 0.1, B.z - B.nz * 0.1], [A.x - A.nx * 0.1, A.z - A.nz * 0.1]], ROAD + 0.006), 0.76, 0.73, 0.68));
        // Trees inside the compound, leaning over the wall.
        for (let d = rng.range(2, 8); d < len - 1; d += rng.range(7, 14)) {
          const x = A.x + (B.x - A.x) * (d / len) + A.nx * rng.range(1.3, 3.2);
          const z = A.z + (B.z - A.z) * (d / len) + A.nz * rng.range(1.3, 3.2);
          if (inBuilding(x, z, 1.4) || onRoad(x, z, 1.5) || onYourWay(x, z, 1.6) || gateSpots.some((g) => Math.hypot(g.x - x, g.z - z) < 3.2)) continue;
          trees.push({ x, z, s: rng.range(0.62, 1.02), y: GROUND, kind: rng.chance(0.2) ? 'almond' : 'mixed' });
          solid(c, x, z, 0.3, 0.3, 0, -1, 3);
        }
        // Two-wheelers parked along the wall, nosed in at an angle.
        for (let d = rng.range(3, 12); d < len - 3; d += rng.range(12, 26)) {
          const x = A.x + (B.x - A.x) * (d / len) - A.nx * 0.62;
          const z = A.z + (B.z - A.z) * (d / len) - A.nz * 0.62;
          const sx = route.project(x, z);
          if (sx.d < 1.7 || Math.abs(sx.s - out.sPickup) < 9 || route.humps.some((h) => Math.abs(h - sx.s) < 3) || onYourWay(x, z, 3)) continue;
          parkRow(x, z, [A.ux, A.uz], rng.int(2, 6), side * 0.55 + Math.PI * (rng.chance(0.5) ? 0 : 1), 0.78);
        }
      }
      // Lamp posts on the shoulder (every other one on this side), cables between them.
      for (let i = side > 0 ? 6 : 22; i < S.length - 4; i += 32) {
        const q = S[i];
        if (!q.ok) continue;
        const x = q.x - q.nx * 0.55;
        const z = q.z - q.nz * 0.55;
        if (gateSpots.some((g) => Math.hypot(g.x - x, g.z - z) < 3) || onYourWay(x, z, 1.5)) continue;
        const h = ryX(-q.nx, -q.nz);
        lampPosts.push({ p: V3(x, GROUND, z), h });
        solid(c, x, z, 0.2, 0.2, 0);
      }
      // Pedestrians walk the lane's edge.
      const walk = offsetLine(P, side * (LANE_W / 2 - 0.3)).map(([x, z]) => V3(x, ROAD, z));
      if (walk.length >= 2) out.walks.push(side > 0 ? walk : walk.reverse());
    }
  }
  // Gates: pillars, the two steel leaves (one open), the society's board, a lamp, sometimes a cabin.
  let soc = 0;
  for (const g of gateSpots) {
    const col = rng.pick(WALL_COLS);
    const gc = rng.pick(GATE_COLS);
    const hw = 1.85;
    const p0: Pt = [g.x - g.ux * hw, g.z - g.uz * hw];
    const p1: Pt = [g.x + g.ux * hw, g.z + g.uz * hw];
    const pil = gatePillar(col);
    for (const p of [p0, p1]) {
      prop(c, pil, mat4(p[0], GROUND, p[1]));
      solid(c, p[0], p[1], 0.25, 0.25, 0, -1, 2.3);
      lamp(c, p[0], p[1], 6, 0.3);
    }
    const leaf = gateLeaf(1.6, 1.7, gc);
    // One leaf shut along the wall, the other swung in (yours: both wide open).
    if (g.mine) {
      const dx0 = g.ux * Math.cos(1.4) + g.nx * Math.sin(1.4);
      const dz0 = g.uz * Math.cos(1.4) + g.nz * Math.sin(1.4);
      prop(c, leaf, mat4(p0[0] + g.ux * 0.24, GROUND, p0[1] + g.uz * 0.24, ryX(dx0, dz0)));
    } else prop(c, leaf, mat4(p0[0] + g.ux * 0.24, GROUND, p0[1] + g.uz * 0.24, ryX(g.ux, g.uz)));
    const open = g.mine ? 1.4 : rng.range(0.4, 1.4);
    const dx = -g.ux * Math.cos(open) + g.nx * Math.sin(open);
    const dz = -g.uz * Math.cos(open) + g.nz * Math.sin(open);
    prop(c, leaf, mat4(p1[0] - g.ux * 0.24, GROUND, p1[1] - g.uz * 0.24, ryX(dx, dz)));
    if (!g.mine) wall(c, p0[0], p0[1], g.x + g.ux * 0.1, g.z + g.uz * 0.1, 0.12, -1, 1.9);
    // The society's board on the wall beside the gate, facing the lane.
    const bx = p0[0] - g.ux * 1.25 - g.nx * 0.14;
    const bz = p0[1] - g.uz * 1.25 - g.nz * 0.14;
    board(fs.societies[soc++ % fs.societies.length], 1.38, 0.46, mat4(bx, GROUND + 1.18, bz, ryZ(-g.nx, -g.nz)), { plate: [0.85, 0.84, 0.8] });
    // Paved apron inside.
    gb.add('pavers', tint(flatPolygon([p0, p1, [p1[0] + g.nx * 5, p1[1] + g.nz * 5], [p0[0] + g.nx * 5, p0[1] + g.nz * 5]], GROUND + 0.02), 0.82, 0.8, 0.76));
    if (g.mine || rng.chance(0.45)) {
      const cx = p1[0] + g.ux * 1.2 + g.nx * 1.3;
      const cz = p1[1] + g.uz * 1.2 + g.nz * 1.3;
      if (!inBuilding(cx, cz, 0.9) && !onYourWay(cx, cz, 1.9)) {
        prop(c, watchCabin(), mat4(cx, GROUND, cz, ryZ(-g.nx, -g.nz)));
        solid(c, cx, cz, 0.7, 0.7, 0, -1, 2.3);
        const chx = cx - g.ux * 1.05 - g.nx * 0.4;
        const chz = cz - g.uz * 1.05 - g.nz * 0.4;
        prop(c, plasticChair(rng.pick([[0.75, 0.1, 0.08], [0.15, 0.3, 0.7], [0.88, 0.88, 0.86]] as [number, number, number][])), mat4(chx, GROUND, chz, ryZ(-g.nx, -g.nz)));
        out.spots.push({ kind: 'gate', x: chx, z: chz, y: GROUND + 0.02, h: ryZ(-g.nx, -g.nz), pose: 1 });
      }
    }
    if (!g.mine && rng.chance(0.35)) out.spots.push({ kind: 'gate', x: g.x - g.nx * 0.35 + g.ux * rng.range(-1, 1), z: g.z - g.nz * 0.35 + g.uz * rng.range(-1, 1), y: ROAD, h: ryZ(g.ux, g.uz) + rng.range(-0.6, 0.6), pose: rng.chance(0.4) ? 2 : 0 });
    // A scooter or a car inside.
    const ix = g.x + g.nx * rng.range(3.2, 5);
    const iz = g.z + g.nz * rng.range(3.2, 5);
    if (!g.mine && !inBuilding(ix, iz, 1.4) && !onYourWay(ix, iz, 3)) {
      if (rng.chance(0.4)) {
        cars.push({ x: ix, y: GROUND, z: iz, h: ryZ(g.nx, g.nz) + rng.range(-0.2, 0.2), c: rng.pick(BODY) });
        solid(c, ix, iz, 0.95, 2.2, ryZ(g.nx, g.nz), -1, 1.6);
      } else parkRow(ix, iz, [g.ux, g.uz], rng.int(1, 3), Math.PI / 2, 0.8);
    }
  }
  // Your gate: a parked scooter of yours inside, a neighbour chatting with the watchman.
  {
    const g = gateSpots.find((q) => q.mine);
    if (g) {
      const bx = g.x + g.nx * 3.4 - g.ux * 2.3;
      const bz = g.z + g.nz * 3.4 - g.uz * 2.3;
      if (buildingDist(bx, bz) > 1.4 && !onYourWay(bx, bz, 1.6)) parkRow(bx, bz, [-g.ux, -g.uz], 2, Math.PI / 2, 0.85);
      out.spots.push({ kind: 'gate', x: g.x + g.nx * 2.2 + g.ux * 2.6, z: g.z + g.nz * 2.2 + g.uz * 2.6, y: GROUND, h: ryZ(g.ux, g.uz) });
    }
  }

  // ---- Lamp posts and their cables -----------------------------------------------------------------
  for (const L of lampPosts) {
    prop(c, singleLamp, mat4(L.p.x, L.p.y, L.p.z, L.h));
    const ax = L.p.x + Math.cos(L.h) * 2.3;
    const az = L.p.z - Math.sin(L.h) * 2.3;
    lamp(c, ax, az, 15, 0.75);
  }
  const cable = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    let prev = a;
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const p = a.clone().lerp(b, t).add(V3(0, -sag * 4 * t * (1 - t), 0));
      gb.add('cable', rodGeo(prev, p, 0.012, 3));
      prev = p;
    }
  };
  for (let i = 0; i < lampPosts.length; i++)
    for (let j = i + 1; j < lampPosts.length; j++) {
      const a = lampPosts[i].p;
      const b = lampPosts[j].p;
      const d = a.distanceTo(b);
      if (d > 40 || d < 12) continue;
      // Cable TV and internet lines strung post to post, a bundle across the lane now and then.
      for (const [dy, sag] of [
        [6.0, 0.7],
        [6.25, 0.85],
        [5.6, 1.1],
      ] as [number, number][])
        cable(V3(a.x, a.y + dy, a.z), V3(b.x, b.y + dy, b.z), sag);
    }

  // ---- Speed breakers --------------------------------------------------------------------------------
  for (const s of route.humps) {
    const a = route.at(s);
    // Centred on the road (the auto keeps left of the centre line).
    const w = s > route.legStart[2] ? 6.6 : LANE_W + 0.1;
    const off = s > route.legStart[2] ? 1.5 : 0.85;
    const cx = a.x - Math.cos(a.h) * off;
    const cz = a.z + Math.sin(a.h) * off;
    prop(c, speedBreaker(w), mat4(cx, ROAD, cz, a.h));
  }

  // ---- The road west past Sector 1 (99203763): trees on the footpaths, bikes, stalls ----------------
  const s1 = way(SECTOR1_RD).pts;
  for (const side of [1, -1]) {
    const fp = offsetLine(s1, side * (6.5 / 2 + 0.95));
    let acc = rng.range(0, 10);
    for (let i = 1; i < fp.length; i++) {
      const a = fp[i - 1];
      const b = fp[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      for (let d = 0; d < len; d += 1) {
        const x = a[0] + ux * d;
        const z = a[1] + uz * d;
        if (!route.near(x, z, 60)) continue;
        acc += 1;
        if (acc > 16 && !onRoad(x, z, 0.6, [SECTOR1_RD]) && !inBuilding(x, z, 1.0)) {
          acc = rng.range(-4, 4);
          trees.push({ x, z, s: rng.range(0.6, 0.95), y: FOOTPATH });
          solid(c, x, z, 0.3, 0.3, 0, -1, 3);
        } else if (acc > 6 && acc < 7 && rng.chance(0.5) && !onRoad(x, z, 0.4, [SECTOR1_RD])) {
          const sx = route.project(x, z);
          if (sx.d > 2.6) parkRow(x - side * uz * 1.35, z + side * ux * 1.35, [ux, uz], rng.int(3, 7), side > 0 ? 1.0 : -1.0, 0.75);
        }
      }
    }
  }
  // A tea tapri at the corner by Poonam Sagar Road, a pani-puri cart further along.
  const stall = (pr: ReturnType<typeof teaTapri>, s: number, off: number, hx: number, hz: number, kind: string, n: number) => {
    const a = route.at(s);
    const lx = Math.cos(a.h);
    const lz = -Math.sin(a.h);
    const x = a.x + lx * off;
    const z = a.z + lz * off;
    if (inBuilding(x, z, 0.4)) return;
    const h = ryZ(-lx * Math.sign(off), -lz * Math.sign(off));
    prop(c, pr, mat4(x, FOOTPATH, z, h));
    solid(c, x, z, hx, hz, h, -1, 2.4);
    for (let k = 0; k < n; k++) out.spots.push({ kind, x: x - lx * Math.sign(off) * rng.range(1.0, 1.8) + Math.sin(a.h) * rng.range(-1.2, 1.2), z: z - lz * Math.sign(off) * rng.range(1.0, 1.8) + Math.cos(a.h) * rng.range(-1.2, 1.2), y: FOOTPATH, h: h + rng.range(-0.8, 0.8), pose: rng.chance(0.3) ? 2 : 0 });
    out.spots.push({ kind: 'hawker', x: x + lx * Math.sign(off) * 0.4, z: z + lz * Math.sign(off) * 0.4, y: FOOTPATH, h });
  };
  stall(teaTapri(), route.legStart[3] - 34, -8.6, 1.2, 0.9, 'tea', 4);
  stall(paniPuriCart(), route.legStart[2] + 120, 5.2, 0.7, 0.45, 'hawker', 3);
  // Vegetables at the lane corner near your gate, across the lane.
  {
    // On the far shoulder, against the wall (the auto runs 0.85 left of the lane's centre).
    const a = route.at(out.sPickup + 26);
    const lx = Math.cos(a.h);
    const lz = -Math.sin(a.h);
    const ux = Math.sin(a.h);
    const uz = Math.cos(a.h);
    const x = a.x - lx * 3.8;
    const z = a.z - lz * 3.8;
    if (!inBuilding(x, z, 0.5)) {
      const ry = ryX(ux, uz);
      prop(c, vegCart(1), mat4(x, ROAD, z, ry));
      solid(c, x, z, 0.9, 0.5, ry, -1, 1.5);
      out.spots.push({ kind: 'hawker', x: x + ux * 1.35, z: z + uz * 1.35, y: ROAD, h: ryZ(-ux, -uz) });
      out.spots.push({ kind: 'shop', x: x + lx * 0.95 - ux * 0.3, z: z + lz * 0.95 - uz * 0.3, y: ROAD, h: ryZ(-lx, -lz), pose: 0 });
    }
  }

  // ---- Poonam Sagar Road: the median, its lamps, trees, the bus stop, a coconut cart --------------
  const nb = way(PS_NB).pts;
  const sb = way(PS_SB).pts;
  const nearestOn = (p: Pt, line: Pt[]): Pt => {
    let best: Pt = line[0];
    let bd = Infinity;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
      const q: Pt = [a[0] + dx * t, a[1] + dz * t];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  };
  const medTop = ROAD + 0.2;
  {
    const samples: { m: Pt; w: number; ux: number; uz: number }[] = [];
    for (let i = 15; i < nb.length; i++) {
      const a = nb[i - 1];
      const b = nb[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      for (let d = 0; d < len; d += 2) {
        const p: Pt = [a[0] + ux * d, a[1] + uz * d];
        if (p[1] > 300 || p[1] < -2) continue;
        // Gaps: the crossing at Sector 1's road, the turn by Sector 1's internal road.
        if ((p[1] > 262 && p[1] < 294) || (p[1] > 96 && p[1] < 114)) continue;
        const q = nearestOn(p, sb);
        const gap = Math.hypot(q[0] - p[0], q[1] - p[1]) - 9.5;
        samples.push({ m: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], w: Math.max(0.75, Math.min(2.4, gap + 0.5)), ux, uz });
      }
    }
    let k = 0;
    for (let i = 1; i < samples.length; i++) {
      const A = samples[i - 1];
      const B = samples[i];
      if (Math.hypot(B.m[0] - A.m[0], B.m[1] - A.m[1]) > 2.6) continue;
      const nA: Pt = [A.uz, -A.ux];
      const nB: Pt = [B.uz, -B.ux];
      const q: Pt[] = [
        [A.m[0] + nA[0] * A.w * 0.5, A.m[1] + nA[1] * A.w * 0.5],
        [B.m[0] + nB[0] * B.w * 0.5, B.m[1] + nB[1] * B.w * 0.5],
        [B.m[0] - nB[0] * B.w * 0.5, B.m[1] - nB[1] * B.w * 0.5],
        [A.m[0] - nA[0] * A.w * 0.5, A.m[1] - nA[1] * A.w * 0.5],
      ];
      gb.add('plaster', tint(flatPolygon(q, medTop), 0.42, 0.36, 0.28));
      gb.add('kerbBW', face(q[1], q[0], ROAD - 0.02, medTop));
      gb.add('kerbBW', face(q[3], q[2], ROAD - 0.02, medTop));
      const w = (A.w + B.w) / 2;
      if (w > 0.95) prop(c, hedge(2.0, 0.85, Math.min(1.2, w - 0.15), k), mat4((A.m[0] + B.m[0]) / 2, medTop, (A.m[1] + B.m[1]) / 2, ryX(A.ux, A.uz)));
      else {
        // A steel railing on the narrow stretches.
        const a3 = V3(A.m[0], medTop + 0.95, A.m[1]);
        const b3 = V3(B.m[0], medTop + 0.95, B.m[1]);
        gb.add('prop_metal', tint(rodGeo(a3, b3, 0.03, 5), 0.58, 0.6, 0.58));
        gb.add('prop_metal', tint(rodGeo(a3.clone().setY(medTop + 0.45), b3.clone().setY(medTop + 0.45), 0.025, 5), 0.58, 0.6, 0.58));
        gb.add('prop_metal', tint(rodGeo(a3.clone().setY(medTop), a3, 0.025, 5), 0.5, 0.52, 0.5));
      }
      wall(c, A.m[0], A.m[1], B.m[0], B.m[1], Math.min(A.w, 0.8), -1, 1.0);
      // Twin-armed lights on the median (the reference photo), every 34 m.
      if (k % 17 === 8) {
        prop(c, twinArmLamp(true, 10), mat4(A.m[0], medTop, A.m[1], ryX(nA[0], nA[1])));
        solid(c, A.m[0], A.m[1], 0.2, 0.2, 0);
        lamp(c, A.m[0] + nA[0] * 3, A.m[1] + nA[1] * 3, 18, 0.85);
        lamp(c, A.m[0] - nA[0] * 3, A.m[1] - nA[1] * 3, 18, 0.85);
      }
      k++;
    }
  }
  // Trees along both outer footpaths, bikes at the kerb by the shops.
  for (const [pts, i0] of [
    [nb, 13],
    [sb, 0],
  ] as [Pt[], number][]) {
    const line = offsetLine(pts.slice(i0), 9.5 / 2 + 1.45);
    let acc = rng.range(0, 12);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      for (let d = 0; d < len; d += 1) {
        const x = a[0] + ux * d;
        const z = a[1] + uz * d;
        if (z > 320 || z < 4) continue;
        acc += 1;
        if (acc > 17 && !onRoad(x, z, 0.5, [PS_NB, PS_SB]) && !inBuilding(x, z, 1.2)) {
          acc = rng.range(-5, 3);
          trees.push({ x, z, s: rng.range(0.75, 1.1), y: FOOTPATH });
          solid(c, x, z, 0.3, 0.3, 0, -1, 3);
        } else if (acc > 7 && acc < 8 && rng.chance(0.55)) {
          // Bikes parked at the kerb (in the carriageway's edge).
          const bx = x - uz * 1.75;
          const bz = z + ux * 1.75;
          if (!onRoad(bx, bz, -1.5, [PS_NB, PS_SB])) parkRow(bx, bz, [ux, uz], rng.int(3, 8), 0.9, 0.72);
        }
      }
    }
  }
  // Open plots behind the footpaths (no building in OSM): a boundary wall, trees behind it.
  for (const [pts, i0, ids] of [
    [nb, 13, [PS_NB, PS_SB]],
    [sb, 0, [PS_NB, PS_SB]],
    [s1, 0, [SECTOR1_RD]],
  ] as [Pt[], number, number[]][]) {
    const w = ids[0] === SECTOR1_RD ? 6.5 : 9.5;
    const fw = ids[0] === SECTOR1_RD ? 1.7 : 2.6;
    for (const side of ids[0] === SECTOR1_RD ? [1, -1] : [1]) {
      const line = offsetLine(pts.slice(i0), side * (w / 2 + fw + 0.35));
      let run: Pt[] = [];
      const flush = () => {
        if (run.length >= 4) {
          const col = rng.pick(WALL_COLS);
          for (let k = 1; k < run.length; k++) {
            const a = run[k - 1];
            const b = run[k];
            gb.add('plaster', tint(beam(V3(a[0], GROUND + 1.0, a[1]), V3(b[0], GROUND + 1.0, b[1]), 0.22, 2.0), col[0], col[1], col[2]));
            gb.add('plaster', tint(beam(V3(a[0], GROUND + 2.04, a[1]), V3(b[0], GROUND + 2.04, b[1]), 0.3, 0.08), 0.75, 0.73, 0.7));
            wall(c, a[0], a[1], b[0], b[1], 0.25, -1, 2.4);
            if (k % 3 === 0) gb.add('plaster', tint(boxGeo(0.34, 2.15, 0.34).translate(a[0], GROUND + 1.07, a[1]), col[0] * 0.9, col[1] * 0.88, col[2] * 0.86));
            if (k % 9 === 4) {
              const nx = (b[1] - a[1]) * side;
              const nz = -(b[0] - a[0]) * side;
              const l = Math.hypot(nx, nz) || 1;
              const tx = a[0] + (nx / l) * rng.range(2, 5);
              const tz = a[1] + (nz / l) * rng.range(2, 5);
              if (!inBuilding(tx, tz, 2)) trees.push({ x: tx, z: tz, s: rng.range(0.8, 1.15), y: GROUND, kind: rng.chance(0.25) ? 'palm' : 'mixed' });
            }
          }
        }
        run = [];
      };
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d < len; d += 2) {
          const x = a[0] + ((b[0] - a[0]) * d) / len;
          const z = a[1] + ((b[1] - a[1]) * d) / len;
          const nx = ((b[1] - a[1]) / len) * side;
          const nz = (-(b[0] - a[0]) / len) * side;
          let open = route.near(x, z, 50) && z > 6 && !onRoad(x, z, 1.2, ids) && !inBuilding(x, z, 0.5);
          for (let k = 2; k <= 14 && open; k += 3) open = !inBuilding(x + nx * k, z + nz * k, 0.5);
          if (open) run.push([x, z]);
          else flush();
        }
      }
      flush();
    }
  }
  // Cables strung across the roads on concrete poles (cable TV, internet), as everywhere here.
  const pole = (x: number, z: number) => {
    gb.add('concrete', tint(new THREE.CylinderGeometry(0.09, 0.15, 8.2, 8).translate(x, FOOTPATH + 4.1, z), 0.72, 0.7, 0.66));
    gb.add('prop_metal', tint(boxGeo(1.1, 0.07, 0.07).translate(x, FOOTPATH + 7.7, z), 0.3, 0.3, 0.3));
    solid(c, x, z, 0.18, 0.18, 0);
  };
  /** Poles either side of a road every so often (`far`: the far pole's spot, given the near one), cables between. */
  const across = (pts: Pt[], halfW: number, s0: number, s1: number, every: number, ids: number[], far?: (L: Pt) => Pt) => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      for (let d = 0; d < len; d += 1) {
        acc += 1;
        if (acc < every) continue;
        const x = a[0] + ux * d;
        const z = a[1] + uz * d;
        const sp = route.project(x, z).s;
        if (sp < s0 || sp > s1) continue;
        const L: Pt = [x + uz * halfW, z - ux * halfW];
        const Rr: Pt = far ? far(L) : [x - uz * halfW, z + ux * halfW];
        if (inBuilding(L[0], L[1], 0.3) || inBuilding(Rr[0], Rr[1], 0.3) || onRoad(L[0], L[1], 0.2, ids) || onRoad(Rr[0], Rr[1], 0.2, ids)) continue;
        acc = rng.range(-8, 8);
        pole(L[0], L[1]);
        pole(Rr[0], Rr[1]);
        for (const [y, sag] of [
          [7.6, 0.9],
          [7.3, 1.2],
          [6.9, 1.5],
          [6.6, 1.1],
        ] as [number, number][])
          cable(V3(L[0], FOOTPATH + y, L[1]), V3(Rr[0], FOOTPATH + y - rng.range(0, 0.4), Rr[1]), sag);
      }
    }
  };
  across(s1, 6.5 / 2 + 1.5, route.legStart[2], route.legStart[3], 34, [SECTOR1_RD]);
  // Poonam Sagar Road: from the west footpath to the far side of the southbound carriageway.
  across(nb.slice(14), 9.5 / 2 + 1.4, route.legStart[3] + 10, route.sSignal - 25, 46, [PS_NB, PS_SB], (L) => {
    const q = nearestOn(L, sb);
    const dx = q[0] - L[0];
    const dz = q[1] - L[1];
    const l = Math.hypot(dx, dz) || 1;
    return [q[0] + (dx / l) * (9.5 / 2 + 1.4), q[1] + (dz / l) * (9.5 / 2 + 1.4)];
  });
  // Bus stop on the northbound side (people waiting; buses pass).
  {
    const i = nb.findIndex((p) => p[1] < 160);
    const a = nb[i - 1];
    const b = nb[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const t = (160 - a[1]) / (b[1] - a[1]);
    const px = a[0] + (b[0] - a[0]) * t + uz * (4.75 + 1.65);
    const pz = a[1] + (b[1] - a[1]) * t - ux * (4.75 + 1.65);
    const ry = ryZ(-uz, ux);
    busShelter(c, px, pz, ry);
    for (let k = 0; k < 5; k++) out.spots.push({ kind: 'busPS', x: px + ux * rng.range(-2.6, 2.6) - uz * 0.6, z: pz + uz * rng.range(-2.6, 2.6) + ux * 0.6, y: FOOTPATH, h: ry + rng.range(-0.5, 0.5), pose: rng.chance(0.4) ? 2 : 0 });
    lamp(c, px, pz, 8, 0.5);
  }
  // Coconuts on the west footpath; a road name board; hoardings and banners.
  {
    const s = route.legStart[3] + 70;
    const a = route.at(s);
    const lx = Math.cos(a.h);
    const lz = -Math.sin(a.h);
    const x = a.x + lx * (4.75 - 1.55 + 1.6);
    const z = a.z + lz * (4.75 - 1.55 + 1.6);
    if (!inBuilding(x, z, 0.5)) {
      prop(c, coconutCart(), mat4(x, FOOTPATH, z, a.h));
      solid(c, x, z, 0.5, 0.85, a.h, -1, 1.4);
      out.spots.push({ kind: 'hawker', x: x + lx * 0.9, z: z + lz * 0.9, y: FOOTPATH, h: ryZ(-lx, -lz) });
      out.spots.push({ kind: 'shop', x: x - Math.sin(a.h) * 1.3 + lx * 0.3, z: z - Math.cos(a.h) * 1.3 + lz * 0.3, y: FOOTPATH, h: a.h + Math.PI, pose: 0 });
    }
  }
  /** A board on two posts at a route s, `off` left of the auto's path: across the footpath, or along the road facing it. */
  const postBoard = (rect: AtlasRect, s: number, off: number, w: number, h: number, y: number, along = false) => {
    const a = route.at(s);
    const lx = Math.cos(a.h);
    const lz = -Math.sin(a.h);
    const ux = Math.sin(a.h);
    const uz = Math.cos(a.h);
    const x = a.x + lx * off;
    const z = a.z + lz * off;
    const ex = along ? ux : lx;
    const ez = along ? uz : lz;
    for (const e of [-w * 0.42, w * 0.42]) gb.add('prop_metal', tint(rodGeo(V3(x + ex * e, FOOTPATH, z + ez * e), V3(x + ex * e, FOOTPATH + y + 0.1, z + ez * e), 0.04, 6), 0.3, 0.3, 0.3));
    const ry = along ? ryZ(lx * -Math.sign(off), lz * -Math.sign(off)) : a.h + Math.PI;
    board(rect, w, h, mat4(x, FOOTPATH + y - h / 2 + 0.1, z, ry), { back: true, plate: [0.85, 0.85, 0.82] });
    solid(c, x, z, w / 2, 0.1, ryX(ex, ez), -1, 2.5);
  };
  postBoard(fs.poonamSagar, route.legStart[3] + 22, 4.75 - 1.55 + 0.9, 1.5, 0.47, 2.7);
  postBoard(fs.sector, out.sPickup + 70, -3.85, 1.5, 0.47, 2.3, true);
  postBoard(fs.toStation, route.sSignal - 44, 4.75 - 1.55 + 0.9, 1.6, 0.5, 3.0);
  // Banners: along a footpath between two posts, or strung across a lane (fictional greetings and notices).
  const banner = (rect: AtlasRect, s: number, off: number, across = false) => {
    const a = route.at(s);
    const lx = Math.cos(a.h);
    const lz = -Math.sin(a.h);
    const ux = Math.sin(a.h);
    const uz = Math.cos(a.h);
    const x = a.x + lx * off;
    const z = a.z + lz * off;
    if (inBuilding(x, z, 0.3)) return;
    const ex = across ? lx : ux;
    const ez = across ? lz : uz;
    const half = across ? 3.05 : 2.4;
    for (const e of [-half, half]) gb.add('prop_metal', tint(rodGeo(V3(x + ex * e, ROAD, z + ez * e), V3(x + ex * e, ROAD + 4.6, z + ez * e), 0.035, 5), 0.42, 0.4, 0.36));
    const ry = across ? a.h + Math.PI : ryZ(-lx * Math.sign(off), -lz * Math.sign(off));
    board(rect, across ? 4.9 : 4.6, 0.8, mat4(x, ROAD + 4.0, z, ry), { back: true, plate: [0.92, 0.92, 0.9] });
    for (const e of [-half, half]) solid(c, x + ex * e, z + ez * e, 0.1, 0.1, 0);
  };
  banner(fs.banners[0], out.sPickup + 95, -0.85, true);
  banner(fs.banners[1], route.legStart[2] + 60, 4.1 - 1.5);
  banner(fs.banners[2], route.legStart[3] + 150, 6.05 - 1.55);
  hoarding(c, [143, 222], 7, 9, 4.2, 0.35, c.signs.hoardings[0], GROUND, true);
  hoarding(c, [215, 70], 8, 10, 4.4, -0.2, c.signs.hoardings[4], GROUND, true);

  // ---- The station junction's signal --------------------------------------------------------------
  const sig = out.signal;
  const lensBuckets: THREE.BufferGeometry[][][] = [
    [[], [], []],
    [[], [], []],
  ];
  const head = signalHead();
  const countdowns: THREE.Matrix4[] = [];
  const headAt = (phase: 0 | 1, x: number, y: number, z: number, faceH: number) => {
    const m = mat4(x, y, z, faceH);
    prop(c, head, m);
    [0.27, 0, -0.27].forEach((dy, i) => lensBuckets[phase][i].push(new THREE.CircleGeometry(0.105, 14).translate(0, dy, 0.116).applyMatrix4(m)));
    return m;
  };
  {
    // Northbound stop line, the zebra beyond it, a pole on the footpath and one on the median with an arm.
    const L = route.stopLine;
    const ux = Math.sin(L.h);
    const uz = Math.cos(L.h);
    const lx = Math.cos(L.h);
    const lz = -Math.sin(L.h);
    // The way's centre line at the stop line (the auto drives 1.55 left of it).
    const cx = L.x - lx * 1.55;
    const cz = L.z - lz * 1.55;
    const paint = (g: THREE.BufferGeometry) => gb.add('prop_paint', tint(g, 0.88, 0.88, 0.84));
    paint(boxGeo(9.3, 0.012, 0.35).applyMatrix4(mat4(cx, ROAD + 0.013, cz, L.h)));
    for (let k = 0; k < 9; k++) paint(boxGeo(0.5, 0.012, 3.0).translate(-4.2 + k * 1.05, 0, 0).applyMatrix4(mat4(cx + ux * 2.6, ROAD + 0.013, cz + uz * 2.6, L.h)));
    out.zebra = { a: [cx + ux * 2.6 + lx * 6.4, cz + uz * 2.6 + lz * 6.4], b: [cx + ux * 2.6 - lx * 5.6, cz + uz * 2.6 - lz * 5.6] };
    sig.stops.push({ x: cx, z: cz, h: L.h, phase: 0 });
    const fh = L.h + Math.PI;
    const p1x = cx + lx * 5.6 - ux * 0.6;
    const p1z = cz + lz * 5.6 - uz * 0.6;
    prop(c, signalPole(0), mat4(p1x, FOOTPATH, p1z, fh));
    solid(c, p1x, p1z, 0.2, 0.2, 0);
    headAt(0, p1x - ux * 0.0, FOOTPATH + 3.3, p1z, fh);
    countdowns.push(mat4(p1x, FOOTPATH + 2.62, p1z, fh).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.13)));
    prop(c, head, mat4(p1x, FOOTPATH + 2.62, p1z, fh).multiply(new THREE.Matrix4().makeScale(1.5, 0.32, 0.6)));
    // On the median, an arm out over the lanes with a second head.
    const p2x = cx - lx * 5.25 - ux * 0.6;
    const p2z = cz - lz * 5.25 - uz * 0.6;
    const armRy = ryX(lx, lz);
    prop(c, signalPole(4.6), mat4(p2x, medTop, p2z, armRy));
    solid(c, p2x, p2z, 0.2, 0.2, 0);
    headAt(0, p2x + lx * 4.4, medTop + 5.05, p2z + lz * 4.4, fh);
    headAt(0, p2x, medTop + 3.2, p2z, fh);
    // Far side, across the junction (for the queue to see).
    const fx = cx + ux * 21 + lx * 6.4;
    const fz = cz + uz * 21 + lz * 6.4;
    if (!inBuilding(fx, fz, 0.4) && !onRoad(fx, fz, 0.2)) {
      prop(c, signalPole(0), mat4(fx, FOOTPATH, fz, fh));
      solid(c, fx, fz, 0.2, 0.2, 0);
      headAt(0, fx, FOOTPATH + 3.3, fz, fh);
    }
  }
  // The cross traffic's stop lines and heads: Mira Road westbound, Shrikant Dhadwe Road southbound.
  for (const [id, back] of [
    [788778489, 14],
    [44427829, 16],
  ] as [number, number][]) {
    const pts = way(id).pts;
    const n = pts.length;
    const a = pts[n - 2];
    const b = pts[n - 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const x = b[0] - ux * back;
    const z = b[1] - uz * back;
    const h = ryZ(ux, uz);
    sig.stops.push({ x, z, h, phase: 1 });
    gb.add('prop_paint', tint(boxGeo(9.0, 0.012, 0.35).applyMatrix4(mat4(x, ROAD + 0.013, z, h)), 0.88, 0.88, 0.84));
    const px = x + Math.cos(h) * 5.9;
    const pz = z - Math.sin(h) * 5.9;
    prop(c, signalPole(0), mat4(px, FOOTPATH, pz, h + Math.PI));
    solid(c, px, pz, 0.2, 0.2, 0);
    headAt(1, px, FOOTPATH + 3.3, pz, h + Math.PI);
  }
  // Lenses as their own meshes (lit per phase); the countdown face.
  sig.build(lensBuckets, countdowns);
  out.meshes.push(sig.group);

  // ---- Shopfronts on the route's buildings facing its roads ---------------------------------------
  const mainIds = new Set<number>([SECTOR1_RD, PS_NB, PS_SB, 788778489, 788778487, 1396502702]);
  const onMain = (x: number, z: number, pad: number) => {
    const l = roadGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    return !!l && l.some((s) => mainIds.has(s.id) && segDist(x, z, s.a, s.b) < s.hw + pad);
  };
  let shopK = 7;
  let upperK = 2;
  const shopRng = new RNG(2612);
  const sc: MiraCtx = { ...c, rng: shopRng };
  for (const poly of inp.routeBuildings) {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i];
      const [x1, z1] = poly[(i + 1) % poly.length];
      area += x0 * z1 - x1 * z0;
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 4.5) continue;
      let nx = (b[1] - a[1]) / len;
      let nz = -(b[0] - a[0]) / len;
      if (area < 0) {
        nx = -nx;
        nz = -nz;
      }
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      if (!route.near(mx, mz, 70) || !onMain(mx + nx * 7, mz + nz * 7, 3.5)) continue;
      const units = Math.max(1, Math.round(len / 4.6));
      const uw = len / units;
      const h = Math.atan2(nx, nz);
      for (let k = 0; k < units; k++) {
        const t = (k + 0.5) / units;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        shopfront(sc, x, z, h, uw - 0.25, shopK++, { awning: shopRng.chance(0.72) ? 'tin' : 'none' });
        if (shopRng.chance(0.5)) out.spots.push({ kind: 'shop', x: x + nx * 1.4, z: z + nz * 1.4, y: FOOTPATH, h: h + Math.PI + shopRng.range(-0.6, 0.6), pose: shopRng.chance(0.3) ? 2 : 0 });
        // Classes, clinics and agents on the floor above, as all along Mira Road's shopping streets.
        if (shopRng.chance(0.3)) board(fs.upper[upperK++ % fs.upper.length], Math.min(uw - 0.3, 4.2), Math.min(uw - 0.3, 4.2) / 5.33, mat4(x + nx * 0.1, FOOTPATH + (shopRng.chance(0.6) ? 5.3 : 8.3), z + nz * 0.1, h), { lit: true });
      }
    }
  }

  // ---- The shops round the station's approach (MiraStationShops) ----------------------------------
  {
    const st = buildStationShops(c, { centre: inp.stationBlock, bank: inp.bankCorner, signs: fs, board });
    out.spots.push(...st.spots);
    out.meshes.push(...st.meshes);
  }

  // Nobody stands about in the auto's way (spots near its path move off it, towards the side they are on).
  for (const sp of out.spots) {
    const q = route.project(sp.x, sp.z);
    if (q.d > 2.0 || q.s > route.sDrop + 10) continue;
    const a = route.at(q.s);
    const lx = Math.cos(a.h);
    const lz = -Math.sin(a.h);
    const lat = (sp.x - a.x) * lx + (sp.z - a.z) * lz;
    const side = lat >= 0 ? 1 : -1;
    sp.x += lx * (side * 2.05 - lat);
    sp.z += lz * (side * 2.05 - lat);
  }

  // ---- Static vehicles, trees ---------------------------------------------------------------------
  if (bikes.length) out.meshes.push(instanced(twoWheeler(false), c.M.prop_paint, bikes, false));
  if (scooters.length) out.meshes.push(instanced(twoWheeler(true), c.M.prop_paint, scooters, false));
  if (parkedAutos.length) out.meshes.push(instanced(autoRickshaw(), c.M.prop_paint, parkedAutos));
  if (cars.length) out.meshes.push(instanced(carGeo('car', [0.9, 0.9, 0.9]), c.M.prop_paint, cars));
  out.meshes.push(inp.trees(trees));

  // ---- Who crosses in front of you ----------------------------------------------------------------
  const crossAt = (s: number, from: number, to: number) => {
    const a = route.at(s);
    const lx = Math.cos(a.h);
    const lz = -Math.sin(a.h);
    out.crossings.push({ s, a: [a.x + lx * from, a.z + lz * from], b: [a.x + lx * to, a.z + lz * to] });
  };
  crossAt(out.sPickup + 52, -2.9, 2.9);
  crossAt(route.legStart[2] + 92, 4.6, -4.4);
  crossAt(route.legStart[3] + 128, -4.4, 6.4);

  // ---- Traffic on these streets -------------------------------------------------------------------
  const cat = (...parts: Pt[][]) => {
    const o: Pt[] = [];
    for (const p of parts) for (const q of p) if (!o.length || Math.hypot(o[o.length - 1][0] - q[0], o[o.length - 1][1] - q[1]) > 0.5) o.push(q);
    return o;
  };
  const loop = way(LANE_IDS[0]).pts.slice(4);
  out.routes.push({ pts: loop, speed: 4.6, lanes: [0.85], mix: 'lane', count: 3 });
  out.routes.push({ pts: [...loop].reverse(), speed: 4.6, lanes: [0.85], mix: 'lane', count: 4 });
  const s1w = way(SECTOR1_RD).pts;
  out.routes.push({ pts: cat(nb.slice(0, 16), s1w.slice(1)), speed: 7.5, lanes: [1.5], mix: 'city', count: 20 });
  out.routes.push({ pts: cat([...s1w.slice(1)].reverse(), sb.slice(7)), speed: 7.5, lanes: [1.5], mix: 'city', count: 20 });
  out.routes.push({ pts: cat(nb, way(1238879349).pts, way(44427767).pts.slice(0, 4), way(1238879348).pts, way(788778487).pts), speed: 8, lanes: [-0.6, 0.5], mix: 'station', count: 20 });
  return out;
}
