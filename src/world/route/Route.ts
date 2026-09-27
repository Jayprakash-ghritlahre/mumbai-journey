import * as THREE from 'three';
import type { TextureFactory } from '../../gfx/TextureFactory';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import type { CollisionWorld } from '../../core/Collision';
import type { InstanceCuller } from '../../gfx/InstanceCuller';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { SignAtlas } from '../../gfx/Signage';
import type { GeoBuilding, GeoRoad } from '../city/City';
import { buildTrees, type TreeSpot } from '../city/Trees';
import { RNG } from '../../core/Random';
import { flatPolygon } from './Path2';
import { H, IMC, MD, NP, RouteLayout, VN, type BackBayGeo } from './RouteLayout';
import { WalkSurface } from './WalkSurface';
import { at, buildMarineDrive, instanceProps, propMaterials } from './MarineDrive';
import { chowkiBoards, drawChowkiBoard, policeChowki, twinArmLamp } from './Props';
import { buildVNRoad } from './VNRoad';
import { Ocean, ShoreField } from './Ocean';
import { Glows, WaterStreaks, buildFloodlights, buildSkyline, type SkylineResult } from './Skyline';
import { SignalController, SignalVisuals, type Aspect, type SignalDef, type SignalGroup } from './Signals';
import { NP_PHASES, buildNarimanPoint, updateNarimanNight, type NarimanResult } from './NarimanPoint';
import type { VehicleKind } from '../../entities/traffic/VehicleGeometry';
import type { StreetConfig, StreetSpot } from '../../entities/crowd/Crowd';
import type { Path2 } from './Path2';

export interface RouteDeps {
  tf: TextureFactory;
  mats: StationMaterials;
  atlas: SignAtlas;
  col: CollisionWorld;
  av: AmbientVolume;
  buildings: GeoBuilding[];
  heights: Map<number, number>;
  facade: THREE.Material;
  /** The railway north of Churchgate: cut out of the land, kept clear of skyline blocks. */
  rail?: RailCorridor;
}

export interface RailCorridor {
  /** Outline of the railway land (ballast, walls) to cut out of the ground. */
  hole: [number, number][];
  /** Distance outside the railway's boundary walls (negative inside), for x/z. */
  clearance(x: number, z: number): number;
}

export interface SignalStop {
  x: number;
  z: number;
  /** Direction of travel of the traffic that must stop here. */
  dx: number;
  dz: number;
  group: SignalGroup;
}

/** The Churchgate → Marine Drive street route (milestone 2). */
export class Route {
  readonly group = new THREE.Group();
  layout!: RouteLayout;
  walk!: WalkSurface;
  ocean!: Ocean;
  signals = new SignalController();
  /** The Air India junction at Nariman Point (groups prefixed NP_). */
  npSignals = new SignalController(NP_PHASES);
  /** Aspect of any group at either junction (for traffic). */
  readonly signalAspects = { aspect: (g: SignalGroup): Aspect => (g.startsWith('NP_') ? this.npSignals.aspect(g) : this.signals.aspect(g)) };
  np!: NarimanResult;
  private signalVisuals!: SignalVisuals;
  private npSignalVisuals!: SignalVisuals;
  private skyline!: SkylineResult;
  private necklace!: Glows;
  private streaks!: WaterStreaks;
  private cityLights!: Glows;
  readonly cullers: InstanceCuller[] = [];
  parked: { x: number; z: number; heading: number; kind: VehicleKind }[] = [];
  stops: SignalStop[] = [];
  wallSeats: { x: number; z: number; ry: number }[] = [];
  loiter: { x: number; z: number; ry: number; kind: 'queue' | 'shop' | 'vendor' }[] = [];
  busStop = { x: 0, z: 0, ry: 0 };
  /** Policemen on duty (cap: 1 white traffic-police cap, 2 dark cap). */
  guards: { x: number; z: number; y: number; ry: number; cap: 1 | 2 }[] = [];

  constructor(private readonly d: RouteDeps) {
    this.group.name = 'route';
  }

  static async loadGeo(): Promise<BackBayGeo> {
    return (await (await fetch(`${import.meta.env.BASE_URL}data/back-bay.geo.json`)).json()) as BackBayGeo;
  }

  /** Areas the route dresses by hand; the generic city generator stays out of them. */
  static corridor(layout: RouteLayout): (x: number, z: number) => boolean {
    void layout;
    return (x: number, z: number) => {
      if (x > 40 || x < -1260 || z < -760 || z > 1130) return false;
      const v = VN.axis.project(x, z);
      if (v.s > VN.sWest - 30 && v.s < VN.sEast && Math.abs(v.o) < 30) return true;
      const m = MD.axis.project(x, z);
      if (m.s > MD.sDetail1 - 30 && m.o > -60 && m.o < 27) return true;
      return m.s > MD.sDetail0 - 30 && m.s < MD.sDetail1 + 30 && m.o > -60 && m.o < 32;
    };
  }

  build(geo: BackBayGeo, layout: RouteLayout): void {
    const { tf, mats, col, av } = this.d;
    this.layout = layout;
    // The route's shopfronts, plates and boards get their own sign atlas.
    const atlas = new SignAtlas(tf, 2048, 2048);
    const signMat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55, metalness: 0.05, emissiveMap: atlas.texture, emissive: new THREE.Color(1, 1, 1) });
    mats.add('routeSigns', signMat);
    // Shop boards are back-lit after dark.
    mats.lampMats.push({ mat: signMat, color: new THREE.Color(1, 1, 1), intensity: 1.5 });
    this.walk = new WalkSurface(-1260, -730, 20, 1130, 0.4, 0);
    col.surface = this.walk;
    const leafMap = (mats.m.treeLeaves as THREE.MeshStandardMaterial | undefined)?.map ?? null;
    propMaterials(mats, leafMap!);

    // Land ends at the sea wall along Marine Drive; the sea shows beyond it.
    for (const ring of this.layout.land) {
      const pts: [number, number][] = [];
      for (let i = 0; i < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
      const g = flatPolygon(pts, -0.012, this.d.rail ? [this.d.rail.hole] : []);
      const mesh = new THREE.Mesh(g, mats.m.ground);
      mesh.receiveShadow = true;
      mesh.name = 'land';
      this.group.add(mesh);
    }
    const shore = new ShoreField(this.layout.land, -1900, -2800, -150, 1300, 2, 60);
    this.ocean = new Ocean(tf, shore);
    mats.add('ocean', this.ocean.material);
    this.group.add(this.ocean.mesh);

    const md = buildMarineDrive(this.layout, tf, mats, atlas, col, av, this.walk);
    this.group.add(md.group);
    this.cullers.push(...md.cullers);
    this.wallSeats = md.wallSeats;
    const vn = buildVNRoad(tf, mats, atlas, col, av, this.walk, this.d.buildings, this.d.heights);
    this.group.add(vn.group);
    this.cullers.push(...vn.cullers);
    this.parked = vn.parked;
    // Nariman Point: from the end of the detailed Marine Drive stretch to the tip.
    const np = buildNarimanPoint(tf, mats, col, av, this.walk, this.d.buildings);
    this.np = np;
    this.group.add(np.group);
    this.cullers.push(...np.cullers);
    this.parked.push(...np.parked);
    this.wallSeats.push(...np.wallSeats);
    this.stops.push(...np.stops);
    const imcHeads = this.buildImcLights(mats, av);
    // Police chowki on the pavement outside the west exit, right of the steps as you come out
    // (placement from the user's walk-through; exact spot uncertain, see CHURCHGATE_TO_MARINE_DRIVE.md).
    {
      const bx = -30.4;
      const bz = -1.0;
      const m = at(bx, H.footpath, bz, -Math.PI / 2);
      instanceProps({ geo: policeChowki(), mats: [m] }, mats.m, this.group, this.cullers);
      const boards = new THREE.Mesh(chowkiBoards(atlas.add(512, 96, drawChowkiBoard), m), mats.m.routeSigns);
      boards.name = 'chowki-boards';
      this.group.add(boards);
      col.addSolid(bx, bz, 1.15, 1.15, 0, -1, 3.5);
      av.light(bx - 1.6, bz, 6, 0.35);
      this.guards.push({ x: bx - 1.5, z: bz + 1.3, y: H.footpath, ry: -Math.PI / 2 - 0.4, cap: 2 });
    }
    this.loiter = vn.loiter;
    this.busStop = vn.busStop;

    // Signals: Marine Drive heads plus the V.N. Road approach.
    const defs: SignalDef[] = md.signals.map((s) => {
      const p = MD.axis.project(s.x, s.z);
      const [ax, az] = MD.axis.point(p.s, 0);
      const dx = ax - s.x;
      const dz = az - s.z;
      const dl = Math.hypot(dx, dz) || 1;
      const y = Math.abs(p.o) > MD.kerb ? (p.o < 0 ? H.promenade : H.footpath) : H.median;
      return { x: s.x, z: s.z, ry: s.ry, toRoad: [dx / dl, dz / dl], kind: s.kind, group: s.group as SignalGroup, banded: s.banded, y, extra: s.extra?.map((e) => ({ ry: e.ry, group: e.group as SignalGroup })) };
    });
    {
      const s = VN.sWest + 5.5;
      const [x, z] = VN.axis.point(s, -(VN.kerb + 0.6));
      const [ax, az] = VN.axis.point(s, 0);
      const dl = Math.hypot(ax - x, az - z) || 1;
      defs.push({ x, z, ry: VN.axis.heading(s), toRoad: [(ax - x) / dl, (az - z) / dl], kind: 'both', group: 'VN_WB', banded: false, y: H.footpath });
      col.addSolid(x, z, 0.15, 0.15, 0, -1, 6);
    }
    // A traffic policeman at the Marine Drive corner and another at the promenade chowki.
    {
      const [x, z] = MD.axis.point(MD.sNorthCrossing - 7, MD.kerb + 1.4);
      this.guards.push({ x, z, y: H.footpath, ry: MD.axis.heading(MD.sNorthCrossing) + Math.PI / 2 + 0.3, cap: 1 });
      const [x2, z2] = MD.axis.point(MD.sSouthCrossing + 11.6, -19.2);
      this.guards.push({ x: x2, z: z2, y: H.promenade, ry: MD.axis.heading(MD.sSouthCrossing) - Math.PI / 2 + 0.5, cap: 1 });
    }
    atlas.commit();
    this.signalVisuals = new SignalVisuals(defs, mats, tf);
    this.group.add(this.signalVisuals.group);
    this.npSignalVisuals = new SignalVisuals(np.signals, mats, tf, ['NP_MD', 'NP_MC', 'NP_XING', 'NP_PED']);
    this.npSignalVisuals.group.name = 'np-signals';
    this.group.add(this.npSignalVisuals.group);
    // Where traffic must stop on red.
    const a = MD.axis;
    const tan = (s: number) => a.at(s);
    for (const o of [3.2, 6.6, 10.0, 13.2]) {
      const sb = tan(MD.sNorthCrossing - 3.2);
      const [x, z] = a.point(MD.sNorthCrossing - 3.2, o);
      this.stops.push({ x, z, dx: sb.tx, dz: sb.tz, group: 'MD_SB' });
      const nb = tan(MD.sSouthCrossing + 3.2);
      const [x2, z2] = a.point(MD.sSouthCrossing + 3.2, -o);
      this.stops.push({ x: x2, z: z2, dx: -nb.tx, dz: -nb.tz, group: 'MD_NB' });
    }
    // Vehicles already through the junction still give way at the zebras (turners, late amber).
    for (const o of [3.2, 6.6, 10.0, 13.2]) {
      const nb = tan(MD.sNorthCrossing + 3.0);
      const [x, z] = a.point(MD.sNorthCrossing + 3.0, -o);
      this.stops.push({ x, z, dx: -nb.tx, dz: -nb.tz, group: 'XING' });
      const sb = tan(MD.sSouthCrossing - 3.0);
      const [x2, z2] = a.point(MD.sSouthCrossing - 3.0, o);
      this.stops.push({ x: x2, z: z2, dx: sb.tx, dz: sb.tz, group: 'XING' });
    }
    for (const o of [3.4, 6.7, 10.0]) {
      const t = VN.axis.at(VN.sWest + 6.2);
      const [x, z] = VN.axis.point(VN.sWest + 6.2, -o);
      this.stops.push({ x, z, dx: -t.tx, dz: -t.tz, group: 'VN_WB' });
    }

    // Trees: V.N. Road banyans and rain trees, palms along the Marine Drive row, almonds on the promenade.
    const rng = new RNG(77);
    const spots: TreeSpot[] = [...vn.trees, ...np.trees];
    for (let s = MD.sDetail0 + 10; s < MD.sDetail1; s += rng.range(11, 17)) {
      if (Math.abs(s - MD.sJunction) < 40) continue;
      const [x, z] = a.point(s, MD.eastFoot + 1.4);
      spots.push({ x, z, s: rng.range(0.85, 1.15), kind: rng.chance(0.75) ? 'palm' : 'mixed', y: H.footpath });
    }
    for (let s = MD.sSouthCrossing + 60; s < MD.sDetail1; s += rng.range(12, 16)) {
      const [x, z] = a.point(s, -MD.kerb - 1.9);
      spots.push({ x, z, s: rng.range(0.7, 0.9), kind: 'mixed', y: H.promenade });
      col.addSolid(x, z, 0.3, 0.3, 0, -1, 5);
    }
    for (const t of spots) if (t.kind !== 'palm') col.addSolid(t.x, t.z, 0.35 * t.s, 0.35 * t.s, 0, -1, 5);
    this.group.add(buildTrees(tf, mats, spots, this.cullers, 91));

    // Distant skyline, stadium floodlights.
    this.skyline = buildSkyline(geo, tf, mats, this.d.facade, this.d.rail?.clearance);
    this.group.add(this.skyline.group);
    for (const st of geo.stadiums) {
      if (st.n === 'Brabourne Stadium') this.group.add(buildFloodlights(st.p, 4, 48, mats));
      if (st.n === 'Wankhede Stadium') this.group.add(buildFloodlights(st.p, 6, 62, mats));
    }

    // Night: the Queen's Necklace and the city's street lights far away.
    this.necklace = new Glows([...md.lampHeads, ...vn.lampHeads, ...imcHeads, ...np.lampHeads], new THREE.Color(1.0, 0.72, 0.36), 2.6);
    this.group.add(this.necklace.points);
    // One reflection per median lamp pair is enough.
    this.streaks = new WaterStreaks(md.lampHeads.filter((_, i) => i % 3 === 0), H.sea, new THREE.Color(1.0, 0.62, 0.28));
    this.group.add(this.streaks.mesh);
    const far: THREE.Vector3[] = [];
    for (const r of geo.roads) {
      for (let i = 0; i < r.p.length - 2; i += 2) {
        const x0 = r.p[i];
        const z0 = r.p[i + 1];
        const x1 = r.p[i + 2];
        const z1 = r.p[i + 3];
        const len = Math.hypot(x1 - x0, z1 - z0);
        for (let t = 0; t < len; t += 38) {
          const x = x0 + ((x1 - x0) * t) / len;
          const z = z0 + ((z1 - z0) * t) / len;
          if (x > -560 && x < 300 && z > -760 && z < 420) continue;
          far.push(new THREE.Vector3(x, 9, z));
        }
      }
    }
    this.cityLights = new Glows(far, new THREE.Color(1.0, 0.72, 0.42), 0.9);
    this.group.add(this.cityLights.points);
  }

  /**
   * Traffic lanes come from OSM centre lines; inside the modelled corridor they are moved onto the
   * painted lanes of V.N. Road and Marine Drive, and side-street lanes that would drive over a raised
   * footpath are dropped.
   */
  laneShaper(): (pts: THREE.Vector2[], road: GeoRoad, lane: number, lanes: number) => THREE.Vector2[] | null {
    const vnLanes = [0, 1, 2].map((k) => VN.median + ((VN.carriage - VN.median) / 3) * (k + 0.5));
    const mdLanes = [0, 1, 2, 3].map((k) => MD.median + ((MD.kerb - MD.median) / 4) * (k + 0.5));
    // Arc length and offset on a path; past either end the arc length keeps counting along the end tangent.
    const project = (p: Path2, x: number, z: number) => {
      const q = p.project(x, z);
      const atEnd = q.s >= p.length - 0.01;
      if (q.s > 0.01 && !atEnd) return q;
      const e = p.at(atEnd ? p.length : 0);
      const along = (x - e.x) * e.tx + (z - e.z) * e.tz;
      if (atEnd ? along <= 0 : along >= 0) return q;
      return { s: q.s + along, o: (x - e.x) * e.tz - (z - e.z) * e.tx, d: 0 };
    };
    // OSM ways have few vertices; resample so every couple of metres follows the modelled road.
    const densify = (pts: THREE.Vector2[], step = 2) => {
      const out = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const n = Math.max(1, Math.ceil(pts[i - 1].distanceTo(pts[i]) / step));
        for (let k = 1; k <= n; k++) out.push(pts[i - 1].clone().lerp(pts[i], k / n));
      }
      return out;
    };
    /** Moves a lane onto its painted lane between s0 and s1, easing in and out over fade0 / fade1 metres. */
    const snap = (p: Path2, centres: number[], s0: number, s1: number, fade0: number, fade1: number, lane: number, lanes: number, raw: THREE.Vector2[]) => {
      // Lane 0 is the one nearest the median.
      const o = centres[Math.min(centres.length - 1, Math.round((lane / Math.max(1, lanes - 1)) * Math.min(lanes - 1, centres.length - 1)))];
      const reach = centres[centres.length - 1] + 5;
      const pts = densify(raw);
      return pts.map((pt, i) => {
        const q = project(p, pt.x, pt.y);
        if (q.s < s0 - fade0 || q.s > s1 + fade1 || Math.abs(q.o) > reach) return pt;
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const t = p.at(q.s);
        const dot = ((b.x - a.x) * t.tx + (b.y - a.y) * t.tz) / dl;
        if (Math.abs(dot) < 0.85) return pt;
        const [x, z] = p.point(q.s, Math.sign(dot) * o);
        const w = q.s < s0 ? 1 - (s0 - q.s) / fade0 : q.s > s1 ? 1 - (q.s - s1) / fade1 : 1;
        const f = w * w * (3 - 2 * w);
        return new THREE.Vector2(pt.x + (x - pt.x) * f, pt.y + (z - pt.y) * f);
      });
    };
    return (pts, road, lane, lanes) => {
      // V.N. Road's median runs on 30 m past the corridor (east of the IMC Road mouth).
      if (road.n === 'Veer Nariman Road') return snap(VN.axis, vnLanes, VN.sWest + 12, VN.sEast + 34, 8, 30, lane, lanes, pts);
      if (road.n === 'Marine Drive') return snap(MD.axis, mdLanes, MD.sDetail0 - 40, MD.sDetail1 + 40, 30, 30, lane, lanes, pts);
      // Side streets: never across a raised footpath, the promenade or a median.
      let run = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = a.distanceTo(b);
        for (let d = 0; d < len; d += 1) {
          const h = this.walk.sample(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len);
          run = h > 0.08 ? run + 1 : 0;
          if (run >= 2) return null;
        }
      }
      return pts;
    };
  }

  /** Street crowd: walkers along V.N. Road and the promenade, zebra crossers, the sea-wall crowd. */
  streetConfig(): StreetConfig {
    const vn = VN.axis;
    const md = MD.axis;
    const sN = MD.sNorthCrossing;
    const sJ = MD.sJunction;
    const W = (p: Path2, s0: number, s1: number, o: number, step = 7, jitter = 0.35, rng?: RNG) => {
      const out: { x: number; z: number }[] = [];
      const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * i) / n;
        const [x, z] = p.point(s, o + (rng && i > 0 && i < n ? rng.range(-jitter, jitter) : 0));
        out.push({ x, z });
      }
      return out;
    };
    const P = (p: Path2, s: number, o: number) => {
      const [x, z] = p.point(s, o);
      return { x, z };
    };
    const vnCornerN = vn.intersectOffsetAt(VN.kerb, md, MD.kerb, 0, 80) ?? VN.sWest;
    const vnWestEnd = vnCornerN + 9;
    // Down the west side of IMC Road, clear of its carriageway and parked cars.
    const imc = IMC.westWalk.map(([x, z]) => ({ x, z }));
    const cross = (rng: RNG) => {
      const j = rng.range(-1.6, 1.6);
      return [P(md, sN + 1.5 + rng.range(0, 1.5), MD.kerb + 2.6 + rng.range(0, 1.2)), P(md, sN + j * 0.6, MD.kerb + 0.8), P(md, sN + j, 0), P(md, sN + j * 0.8, -MD.kerb - 0.9)];
    };
    const onPromenade = (rng: RNG, fromS: number) => {
      const oP = rng.range(MD.promenade + 1.2, -MD.kerb - 2.4);
      if (rng.chance(0.45)) {
        // Walk to the wall and stand there looking at the sea.
        const s = fromS + rng.range(-40, 40);
        const w = P(md, s, MD.promenade + 0.4);
        return { pts: [P(md, fromS, oP), w], linger: { ry: md.heading(s) - Math.PI / 2, seconds: rng.range(40, 160) } };
      }
      const dir = rng.chance(0.5) ? 1 : -1;
      return { pts: W(md, fromS, fromS + dir * rng.range(120, 320), oP, 9, 0.5, rng) };
    };
    const last = imc[imc.length - 1];
    const sImc = vn.project(last.x, last.z).s - 3;
    const oNorth = (rng: RNG) => rng.range(16.9, 19.1);
    return {
      // Commuters out of the west exit: down IMC Road, then to the sea or on up Marine Drive.
      fromStation: (rng) => {
        const head = imc.map((p, i) => ({ x: p.x + (i > 1 ? rng.range(-1.2, 1.2) : 0), z: p.z }));
        const walk = W(vn, sImc, vnWestEnd, oNorth(rng), 8, 0.4, rng);
        if (rng.chance(0.6)) {
          const x = cross(rng);
          const prom = onPromenade(rng, sN + rng.range(-10, 10));
          return { pts: [...head, ...walk, ...x, ...prom.pts], waitAt: head.length + walk.length + 1, linger: prom.linger };
        }
        const o = rng.range(MD.kerb + 1.6, MD.eastFoot - 0.7);
        return { pts: [...head, ...walk, ...W(md, sN - 4, sN - rng.range(140, 280), o, 9, 0.3, rng)], waitAt: -1 };
      },
      // Commuters heading for their train: from up Marine Drive, across from the promenade, or from
      // along V.N. Road; all end at the foot of the west-exit steps.
      toStation: (rng) => {
        const tail = imc.slice().reverse();
        const walk = W(vn, vnWestEnd, sImc, oNorth(rng), 8, 0.4, rng);
        const k = rng.weighted([
          ['md', 4],
          ['sea', 3],
          ['vn', 3],
        ] as const);
        if (k === 'md') {
          const o = rng.range(MD.kerb + 1.6, MD.eastFoot - 0.7);
          return { pts: [...W(md, sN - rng.range(140, 280), sN - 4, o, 9, 0.3, rng), ...walk, ...tail], waitAt: -1 };
        }
        if (k === 'sea') {
          // Along the promenade to the zebra, then across.
          const along = W(md, sN + (rng.chance(0.5) ? 1 : -1) * rng.range(90, 240), sN, rng.range(MD.promenade + 1.2, -MD.kerb - 2.4), 9, 0.5, rng);
          const x = cross(rng).reverse();
          return { pts: [...along, ...x, ...walk, ...tail], waitAt: along.length };
        }
        const s0 = rng.range(vnWestEnd + 30, sImc - 20);
        return { pts: [...W(vn, s0, sImc, oNorth(rng), 8, 0.4, rng), ...tail], waitAt: -1 };
      },
      leave: (x, z, rng) => {
        const q = md.project(x, z);
        if (q.o > -MD.kerb) return [];
        const o = rng.range(MD.promenade + 1.2, -MD.kerb - 2.4);
        const dir = rng.chance(0.5) ? 1 : -1;
        return [{ x, z }, ...W(md, q.s + dir * 3, q.s + dir * rng.range(160, 320), o, 9, 0.5, rng)];
      },
      ground: (x, z) => this.walk.sample(x, z),
      // About 32 m kerb to kerb at a brisk 1.75 m/s, plus a margin.
      pedWalk: () => this.signals.pedCanStart(21),
      walkers: 170,
      makeRoute: (rng) => {
        const kind = rng.weighted([
          ['toSea', 5],
          ['fromStation', 0.6],
          ['vnEast', 3],
          ['vnSouth', 2],
          ['prom', 5],
          ['fromSea', 2],
          ['mdEast', 1.5],
          ['np', 3],
        ] as const);
        const oN = rng.range(16.9, 19.1);
        switch (kind) {
          case 'toSea':
          case 'fromStation': {
            const head = kind === 'fromStation' ? imc.map((p, i) => ({ x: p.x + (i > 1 ? rng.range(-1.2, 1.2) : 0), z: p.z })) : [];
            const last = imc[imc.length - 1];
            const sStart = kind === 'fromStation' ? vn.project(last.x, last.z).s - 3 : rng.range(vnWestEnd + 40, VN.sEast - 5);
            const walk = W(vn, sStart, vnWestEnd, oN, 8, 0.4, rng);
            const x = cross(rng);
            const prom = onPromenade(rng, sN + rng.range(-10, 10));
            const pts = [...head, ...walk, ...x, ...prom.pts];
            return { pts, waitAt: head.length + walk.length + 1, linger: prom.linger };
          }
          case 'fromSea': {
            // Off the promenade, across, and back up V.N. Road and IMC Road to catch a train.
            const s0 = sN + rng.range(-60, 60);
            const start = P(md, s0, rng.range(MD.promenade + 1.2, -MD.kerb - 2.4));
            const x = cross(rng).reverse();
            const walk = W(vn, vnWestEnd, sImc, oN, 8, 0.4, rng);
            // Wait at the promenade kerb (x[0]) for the green man.
            return { pts: [start, ...x, ...walk, ...imc.slice().reverse()], waitAt: 1, into: rng.chance(0.75) ? 'board' : 'cross' };
          }
          case 'vnEast': {
            const walk = W(vn, vnWestEnd + rng.range(0, 30), sImc, oN, 8, 0.4, rng);
            return { pts: [...walk, ...imc.slice().reverse()], waitAt: -1, into: rng.chance(0.75) ? 'board' : 'cross' };
          }
          case 'vnSouth': {
            const oS = -rng.range(16.9, 19.1);
            const a = VN.sWest + 16;
            const b = VN.sEast - 4;
            const pts = rng.chance(0.5) ? W(vn, a, b, oS, 8, 0.4, rng) : W(vn, b, a, oS, 8, 0.4, rng);
            return { pts, waitAt: -1 };
          }
          case 'prom': {
            const s0 = sJ + rng.range(-340, 260);
            const dir = rng.chance(0.5) ? 1 : -1;
            const s1 = Math.min(NP.sEnd - 4, s0 + dir * rng.range(150, 360));
            return { pts: W(md, s0, s1, rng.range(MD.promenade + 1.2, -MD.kerb - 2.2), 9, 0.5, rng), waitAt: -1 };
          }
          case 'np': {
            // The southern promenade to the tip of Nariman Point and back.
            const s0 = rng.range(MD.sDetail1 - 120, NP.sEnd - 30);
            const dir = rng.chance(0.5) ? 1 : -1;
            const s1 = THREE.MathUtils.clamp(s0 + dir * rng.range(150, 350), MD.sSouthCrossing + 20, NP.sEnd - 4);
            return { pts: W(md, s0, s1, rng.range(MD.promenade + 1.2, -17.5), 9, 0.5, rng), waitAt: -1 };
          }
          case 'mdEast': {
            // Up the east footpath from the corner, or down it and round into V.N. Road.
            const o = rng.range(MD.kerb + 1.6, MD.eastFoot - 0.7);
            const s1 = sN - rng.range(120, 260);
            if (rng.chance(0.5)) return { pts: W(md, sN - rng.range(4, 20), s1, o, 9, 0.3, rng), waitAt: -1 };
            return { pts: [...W(md, s1, sN - 4, o, 9, 0.3, rng), ...W(vn, vnWestEnd, rng.range(vnWestEnd + 60, sImc), oN, 8, 0.4, rng)], waitAt: -1 };
          }
        }
        return { pts: [], waitAt: -1 };
      },
      seats: this.wallSeats.map((w, i): StreetSpot => {
        const toProm = i % 5 === 0;
        return { x: w.x, z: w.z, y: toProm ? H.step : H.wallTop - 0.46, ry: toProm ? w.ry + Math.PI : w.ry };
      }),
      standing: (() => {
        const out: StreetSpot[] = [];
        const rng = new RNG(5);
        for (let i = 0; i < 46; i++) {
          const s = sJ + rng.range(-160, 120);
          const [x, z] = md.point(s, MD.promenade + rng.range(0.3, 0.9));
          out.push({ x, z, y: H.promenade, ry: md.heading(s) - Math.PI / 2 + rng.range(-0.4, 0.4) });
        }
        for (const p of this.np.standing) out.push({ x: p.x, z: p.z, y: H.promenade, ry: p.ry });
        return out;
      })(),
      loiter: this.loiter.map((l) => ({ x: l.x, z: l.z, y: this.walk.sample(l.x, l.z), ry: l.ry })),
      guards: this.guards,
      seatOccupancy: (x, z) => {
        const s = md.project(x, z).s;
        const d = Math.abs(s - sJ);
        // Busy by the V.N. Road junction, quieter along the curve, busy again towards the tip.
        const tip = 0.5 * (1 - THREE.MathUtils.smoothstep(NP.sEnd - s, 20, 260));
        return Math.max(0.62 - 0.42 * THREE.MathUtils.smoothstep(d, 80, 380), tip);
      },
    };
  }

  /** Street lights down the west side of IMC Road, from the station exit to V.N. Road. */
  private buildImcLights(mats: StationMaterials, av: AmbientVolume): THREE.Vector3[] {
    const a = IMC.axis;
    const heads: THREE.Vector3[] = [];
    const poles: THREE.Matrix4[] = [];
    // From just north of the west exit (the axis runs on past its end) down to V.N. Road.
    for (let t = -16; t < a.length - 14; t += 24) {
      const [x, z] = a.point(t, -(IMC.half + 0.9));
      poles.push(at(x, this.walk.sample(x, z), z, a.heading(t)));
      this.d.col.addSolid(x, z, 0.2, 0.2, 0, -1, 6);
      const [lx, lz] = a.point(t, -(IMC.half + 0.9) + 2.1);
      av.light(lx, lz, 16, 0.6);
      heads.push(new THREE.Vector3(lx, 9.3, lz));
    }
    instanceProps({ geo: twinArmLamp(false, 9), mats: poles, cull: { radius: 6, dist: 500, near: 50 } }, mats.m, this.group, this.cullers);
    return heads;
  }

  /** Hides the parts of the route that cannot be seen from inside the train shed. */
  setVisibleFromStation(inside: boolean): void {
    for (const c of this.group.children) {
      if (['marine-drive', 'ocean', 'skyline', 'vn-road', 'trees', 'signals', 'np-signals', 'nariman-point'].includes(c.name)) c.visible = !inside;
    }
    this.necklace.points.visible = !inside && this.necklace.points.visible;
    this.streaks.mesh.visible = !inside && this.streaks.mesh.visible;
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, lamps: number, pixelRatio: number): void {
    this.signals.update(dt);
    this.signalVisuals.update(this.signals, lamps);
    this.npSignals.update(dt);
    this.npSignalVisuals.update(this.npSignals, lamps);
    updateNarimanNight(lamps);
    this.ocean.update(time, camera, lamps);
    this.skyline.update(time, lamps);
    const glow = THREE.MathUtils.smoothstep(lamps, 0.35, 1);
    this.necklace.update(glow * 2.2, pixelRatio);
    const md = MD.axis;
    this.streaks.update(camera, glow * 1.8, time, (x, z) => {
      const q = md.project(x, z);
      return md.point(q.s, MD.wallOuter - 9);
    });
    this.cityLights.update(glow * 0.9, pixelRatio);
    for (const c of this.cullers) c.update(camera);
  }
}
