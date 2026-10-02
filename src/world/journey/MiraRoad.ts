import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { CollisionWorld } from '../../core/Collision';
import { AmbientVolume } from '../../gfx/AmbientVolume';
import { GeoBuilder, boxGeo } from '../../gfx/GeoBuilder';
import { SignAtlas } from '../../gfx/Signage';
import { BuildingBatch } from '../city/BuildingGen';
import { FACADE } from '../../gfx/FacadeTextures';
import { flatPolygon } from '../route/Path2';
import { WalkSurface } from '../route/WalkSurface';
import type { Churchgate } from '../churchgate/Churchgate';
import type { CorridorKit } from './Corridor';
import type { Railway } from './Railway';
import { GROUND, PLAZA, TOP, type MiraCtx } from '../miraroad/MiraCtx';
import { buildMiraSigns } from '../miraroad/MiraSigns';
import { miraMaterials } from '../miraroad/MiraMaterials';
import { MiraBoards, MiraTimetable } from '../miraroad/MiraBoards';
import { FRONT, F, buildFront, toFrame } from '../miraroad/MiraFront';
import { PLATFORMS, buildPlatforms } from '../miraroad/MiraPlatforms';
import { buildDeck } from '../miraroad/MiraDeck';
import { buildStreets, type OsmWay } from '../miraroad/MiraStreets';
import { FACES, MiraPeople, MiraService, MiraTraffic } from '../miraroad/MiraLife';
import { buildAutoRoute, type AutoRoute } from '../miraroad/AutoRoute';
import { buildFirstMile, type FirstMile } from '../miraroad/MiraFirstMile';
import { segDist } from '../miraroad/MiraStreets';

/**
 * Mira Road station and its east side (MIRA_ROAD.md), from OpenStreetMap (data/mira-road.osm.json,
 * © OpenStreetMap contributors, ODbL) and the reference photos in assets/miraroad: the arcade and
 * booking hall, the forecourt with the war memorial, the auto stand and the streets round it, the
 * four platforms, the deck, foot-over-bridges and skywalk, the town's buildings; its own walkable
 * collision world and ambient light map (it is 38 km from Churchgate's); the locals calling on
 * the timetable, the commuters and the traffic. Everything is built relative to MIRA_ANCHOR.
 */

export const MIRA_ANCHOR = { x: 9010, z: -37640 };

interface OsmEl {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  /** From the extract south-east of the station (Shanti Nagar, Poonam Sagar Road). */
  ext?: number;
}

const K = Math.PI / 180;
const R = 6378137;
const cosLat = Math.cos(18.93418 * K);
const cb = Math.cos(351 * K);
const sb = Math.sin(351 * K);
/** OSM lat/lon → local frame (as tools/build-geo.mjs), relative to the anchor. */
function local(lat: number, lon: number): [number, number] {
  const x = (lon - 72.82743) * K * R * cosLat;
  const z = -(lat - 18.93418) * K * R;
  return [x * cb + z * sb - MIRA_ANCHOR.x, -x * sb + z * cb - MIRA_ANCHOR.z];
}

/** The Churchgate fast at PF 4 as the ride reports it each frame (null when it is not here). */
export interface RideTrainInfo {
  doorsWorld: () => { x: number; z: number; car: number }[];
  stopped: boolean;
  doorsOpen: boolean;
}

export interface MiraRoad {
  group: THREE.Group;
  crowd: MiraPeople;
  /** Walkable world (world coordinates) and its bounds. */
  collision: CollisionWorld;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Ambient light map (world coordinates); the station's materials switch to it here. */
  av: AmbientVolume;
  timetable: MiraTimetable;
  /** Where to start walking (world x/z, yaw as ExploreControls). */
  spawns: Record<'forecourt' | 'pf4' | 'hall', { x: number; z: number; yaw: number }>;
  /** Establishing view of the east front (world). */
  frontView: { eye: THREE.Vector3; target: THREE.Vector3 };
  /** Set by the ride each frame while its train is at or near PF 4. */
  rideTrain: RideTrainInfo | null;
  /** The ride holds line 1 (PF 3) for its passing down train while it leaves. */
  holdLine1: boolean;
  update(dt: number, hour: number, camera: THREE.Camera): void;
  /** How "indoors" a world position is (0 open … 1 under the hall roof). */
  interiorFactor(p: THREE.Vector3): number;
  /** Place name for the HUD at a world position. */
  placeAt(p: THREE.Vector3): [string, string] | null;
  /** The auto ride to the station (AUTO_RIDE.md): its route, streets, traffic and people. */
  auto: { route: AutoRoute; streets: FirstMile; traffic: MiraTraffic };
}

export async function buildMiraRoad(kit: CorridorKit, rail: Railway, world: Churchgate, base: string): Promise<MiraRoad> {
  const osm = (await (await fetch(`${base}data/mira-road.osm.json`)).json()) as { elements: OsmEl[] };
  const AX = MIRA_ANCHOR.x;
  const AZ = MIRA_ANCHOR.z;
  const group = new THREE.Group();
  group.name = 'mira-road';
  group.position.set(AX, 0, AZ);
  const rng = new RNG(1990);
  const path = rail.path;
  const dm = rail.dMiraRoad;
  const ways: OsmWay[] = osm.elements.filter((e) => e.type === 'way' && e.geometry).map((e) => ({ id: e.id, tags: e.tags ?? {}, pts: e.geometry!.map((g) => local(g.lat, g.lon)), ext: !!e.ext }));
  const route = buildAutoRoute(ways);
  const proj = (x: number, z: number) => path.project(x + AX, z + AZ, dm - 1500, dm + 1500);
  const railLand = (x: number, z: number) => {
    const m = proj(x, z);
    const [L, Rr] = rail.bounds(m.s);
    return m.o > L - 4 && m.o < Rr + 4;
  };

  // ---- Shared context -------------------------------------------------------------------------
  const tf = world.tf;
  const atlas = new SignAtlas(tf, 2048, 3072);
  const signs = buildMiraSigns(atlas);
  atlas.commit();
  const mm = miraMaterials(tf, world.mats, atlas);
  const timetable = new MiraTimetable();
  const boards = new MiraBoards(tf, timetable);
  const col = new CollisionWorld();
  col.baseHeight = GROUND;
  // Out to Shanti Nagar in the south-east (the auto ride).
  const walk = new WalkSurface(AX - 420, AZ - 440, AX + 640, AZ + 600, 0.5, GROUND);
  col.surface = walk;
  const av = new AmbientVolume(AX - 420, AZ - 440, AX + 640, AZ + 600, 1024);
  const M: Record<string, THREE.Material> = {
    ...world.mats.m,
    ...kit.m,
    ...mm.m,
    led: boards.material,
    corrSigns: kit.m.signs,
    steelGrey: world.mats.m.steelGrey,
    flag: kit.m.tarp,
  };
  const gb = new GeoBuilder();
  const c: MiraCtx = {
    gb,
    M,
    signs,
    col,
    av,
    walk,
    AX,
    AZ,
    rng,
    P: (d, o, y) => {
      const [x, z] = path.point(d, o);
      return new THREE.Vector3(x - AX, y, z - AZ);
    },
    heading: (d) => path.heading(d),
    proj,
    dm,
    kitBoard: kit.board('मीरा रोड', 'MIRA ROAD'),
  };
  const inHall = (x: number, z: number) => {
    const [u, v] = toFrame(x, z);
    return u > FRONT.hallU0 - 0.5 && u < FRONT.hallU1 && v > FRONT.hallV0 - 0.6 && v < 0.35;
  };

  // ---- The station ------------------------------------------------------------------------------
  // The walkway over the hall rests on the booking office's walls at its north end (no columns
  // in front of the ticket windows and the board).
  const deck = buildDeck(c, ways, rail, inHall, (x, z) => inHall(x, z) && toFrame(x, z)[0] > FRONT.officeU0 - 9);
  const hallS: [number, number] = [proj(...F(FRONT.hallU1, FRONT.hallV0)).s - dm, proj(...F(FRONT.hallU0, FRONT.hallV0)).s - dm].sort((a, b) => a - b) as [number, number];
  const pfs = buildPlatforms(c, rail, hallS, deck.stairs, deck.deckAt);
  const front = buildFront(c);

  // ---- Buildings of Mira Road (OSM footprints; heights from the tags, else 4–7 floors ⚠) --------------
  const batch = new BuildingBatch();
  const TINTS: [number, number, number][] = [
    [1, 0.97, 0.9],
    [0.95, 0.93, 0.88],
    [1, 0.9, 0.8],
    [0.9, 0.93, 0.96],
    [0.98, 0.95, 0.8],
    [0.92, 0.96, 0.92],
    [1, 0.88, 0.86],
  ];
  // Along the auto ride: pastel paint, homes on the ground floor of the lanes, shops on the roads.
  const PASTELS: [number, number, number][] = [
    [1, 0.93, 0.78],
    [1, 0.86, 0.74],
    [0.98, 0.84, 0.84],
    [1, 0.95, 0.7],
    [0.86, 0.95, 0.86],
    [0.84, 0.9, 0.98],
    [0.93, 0.92, 0.9],
    [0.95, 0.88, 0.96],
  ];
  const mainSegs: { a: [number, number]; b: [number, number]; hw: number }[] = [];
  for (const e of ways) {
    const hw = e.tags.highway;
    if (hw !== 'secondary' && hw !== 'tertiary' && hw !== 'residential') continue;
    if (!e.pts.some(([x, z]) => route.near(x, z, 120))) continue;
    for (let i = 1; i < e.pts.length; i++) mainSegs.push({ a: e.pts[i - 1], b: e.pts[i], hw: hw === 'secondary' ? 4.75 : hw === 'tertiary' ? 4 : 3.25 });
  }
  const facesRoad = (p: [number, number][]) => p.some((q, i) => {
    const r = p[(i + 1) % p.length];
    const mx = (q[0] + r[0]) / 2;
    const mz = (q[1] + r[1]) / 2;
    return mainSegs.some((s) => segDist(mx, mz, s.a, s.b) < s.hw + 9);
  });
  const rngExt = new RNG(2613);
  // Shanti Shopping Centre facing the approach, and the bank on the junction's corner: dressed as they are (MiraStationShops).
  const SHOPPING_CENTRE = 1063810561;
  const BANK_CORNER = 1393743724;
  let stationBlock: [number, number][] | null = null;
  let bankCorner: [number, number][] | null = null;
  const allPolys: [number, number][][] = [];
  const routePolys: [number, number][][] = [];
  const shopPolys: [number, number][][] = [];
  for (const e of ways) {
    const t = e.tags;
    if (!t.building || t.building === 'train_station' || t.building === 'roof') continue;
    const p = e.pts.map((q) => [...q] as [number, number]);
    if (p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
    if (p.length < 3) continue;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of p) {
      cx += x;
      cz += z;
    }
    cx /= p.length;
    cz /= p.length;
    if (railLand(cx, cz) || inHall(cx, cz)) continue;
    const [u, v] = toFrame(cx, cz);
    if (u > FRONT.hallU0 - 3 && u < FRONT.hallU1 + 8 && v > FRONT.hallV0 - 2 && v < 40) continue;
    allPolys.push(p);
    let fp = p.flatMap(([x, z]) => [x, z]);
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length;
      area += fp[i * 2] * fp[j * 2 + 1] - fp[j * 2] * fp[i * 2 + 1];
    }
    if (area > 0) {
      const r: number[] = [];
      for (let i = p.length - 1; i >= 0; i--) r.push(fp[i * 2], fp[i * 2 + 1]);
      fp = r;
    }
    const lv = parseFloat(t['building:levels'] ?? '');
    const hTag = parseFloat(t.height ?? '');
    // The station's own buildings keep their draws (rng); the extension draws its own.
    const r = e.ext ? rngExt : rng;
    const floors = Number.isFinite(lv) ? lv : Number.isFinite(hTag) ? Math.max(1, Math.round(hTag / 3.1)) : r.int(4, 7);
    const tall = floors > 10;
    const near = Math.hypot(cx - 50, cz + 50) < 280;
    const onRoute = !near && p.some(([x, z]) => route.near(x, z, 55));
    const style = tall ? r.pick([FACADE.grille, FACADE.glass]) : r.pick([FACADE.grille, FACADE.grille, FACADE.deco, FACADE.decoBalcony, FACADE.chawl]);
    const shopGround = r.chance(0.6);
    const tnt = r.pick(TINTS);
    const seed = r.range(0, 100);
    const chajjas = r.chance(0.6);
    const sector = onRoute || !!e.ext;
    batch.add({
      fp,
      height: floors * 3.1 + 1,
      floorH: 3.1,
      groundH: 4,
      // Shanti Nagar's blocks: grilled windows and balconies, rarely the old styles.
      style: sector && !tall && style === FACADE.chawl ? FACADE.decoBalcony : style,
      groundStyle: sector ? (facesRoad(p) ? FACADE.shop : FACADE.grille) : shopGround ? FACADE.shop : FACADE.grille,
      // The shopping centre's weathered salmon-pink plaster (Station Road photos).
      tint: e.id === SHOPPING_CENTRE ? [1.0, 0.74, 0.68] : sector ? PASTELS[e.id % PASTELS.length] : tnt,
      seed,
      chajjas,
      parapet: 1,
      detail: near || onRoute ? 1 : 0,
      baseY: GROUND,
    });
    if (onRoute) {
      routePolys.push(p);
      for (let i = 0; i < p.length; i++) {
        const [x0, z0] = p[i];
        const [x1, z1] = p[(i + 1) % p.length];
        col.addWall(x0 + AX, z0 + AZ, x1 + AX, z1 + AZ, 0.4);
      }
    }
    if (e.id === SHOPPING_CENTRE) stationBlock = p;
    if (e.id === BANK_CORNER) bankCorner = p;
    if (near) {
      if (e.id !== SHOPPING_CENTRE && e.id !== BANK_CORNER) shopPolys.push(p);
      for (let i = 0; i < p.length; i++) {
        const [x0, z0] = p[i];
        const [x1, z1] = p[(i + 1) % p.length];
        col.addWall(x0 + AX, z0 + AZ, x1 + AX, z1 + AZ, 0.4);
      }
    }
  }
  group.add(batch.buildWalls(kit.facade));
  group.add(batch.details.build(kit.m as Record<string, THREE.Material>, { castShadow: false }));

  // ---- Streets, the forecourt and everything on them ----------------------------------------------
  const streets = buildStreets(c, ways, shopPolys, railLand, deck.skywalkCols, (spots) => kit.trees(spots, 77), (x, z) => route.near(x, z, 60));
  for (const m of streets.meshes) group.add(m);
  // ---- The auto ride's streets (AUTO_RIDE.md) ---------------------------------------------------------
  const firstMile = buildFirstMile(c, { ways, route, buildings: allPolys, routeBuildings: routePolys, trees: (spots) => kit.trees(spots, 79), tf, mats: world.mats, stationBlock, bankCorner });
  for (const m of firstMile.meshes) group.add(m);

  // Town ground: between the railway walls and 700 m out, both sides.
  for (const side of [-1, 1]) {
    const pl: [number, number][] = [];
    const pr: [number, number][] = [];
    for (let d = dm - 900; d <= dm + 700; d += 25) {
      const [L, Rr] = rail.bounds(d);
      const a = c.P(d, side > 0 ? Rr + 0.3 : L - 0.3, 0);
      const b = c.P(d, side > 0 ? Rr + 700 : L - 700, 0);
      pl.push([a.x, a.z]);
      pr.push([b.x, b.z]);
    }
    const g = flatPolygon([...pl, ...pr.reverse()], GROUND);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.8), 3));
    const m = new THREE.Mesh(g, kit.m.ground);
    m.receiveShadow = true;
    group.add(m);
  }
  // ---- Clock hands (all the station's analog clocks) -----------------------------------------------
  const clocks = [...front.clocks, ...pfs.clocks];
  const handGeo = boxGeo(0.018, 1, 0.006).translate(0, 0.5, 0);
  const hands = new THREE.InstancedMesh(handGeo, world.mats.m.blackPaint, clocks.length * 2);
  hands.castShadow = false;
  hands.frustumCulled = false;
  group.add(hands);

  group.add(gb.build(M, { noShadowKeys: ['yellowLine', 'coping', 'tactile', 'signs', 'signsLit', 'led', 'corrSigns', 'tube', 'prop_glow', 'hallFloor', 'cobble', 'pavers', 'asphalt', 'kerb', 'jet', 'water', 'cable', 'prop_metal', 'steel', 'stainless', 'shopGlow', 'shutter', 'granite', 'prop_paint', 'paint', 'blackPaint', 'glass', 'roofSheet'] }));
  av.commit(2, 3);

  // ---- Life -----------------------------------------------------------------------------------------
  const service = new MiraService(world.trains, rail, timetable, dm, MIRA_ANCHOR);
  const pfOf = (pf: number) => PLATFORMS.find((p) => p.ref === FACES[pf].ref)!;
  const H = (s: number) => path.heading(dm + s);
  const pfSpot = (pf: number, r: RNG) => {
    const def = pfOf(pf);
    const f = FACES[pf];
    const face = def.faces.find((q) => q.pf === pf)!;
    let s: number;
    if (pf === 4) s = -8 - Math.pow(r.next(), 1.5) * 235;
    else s = def.s0 + 18 + r.next() * (def.s1 - def.s0 - 36);
    const lo = face.o + f.side * 1.3;
    const width = Math.abs((f.side > 0 ? def.o1(s) : def.o0(s)) - face.o);
    const hi = face.o + f.side * Math.min(pf === 4 ? 6.5 : 3.6, Math.max(1.6, width * (def.faces.length > 1 ? 0.42 : 0.8)));
    const o = lo + r.next() * (hi - lo);
    const p = c.P(dm + s, o, 0);
    const h = H(s);
    // Facing the track (most), or along the platform.
    const toTrack = f.side > 0 ? Math.atan2(-Math.cos(h), Math.sin(h)) : Math.atan2(Math.cos(h), -Math.sin(h));
    return { x: p.x, z: p.z, h: r.chance(0.7) ? toTrack : h + (r.chance(0.5) ? Math.PI : 0) };
  };
  const nSteps = 5;
  const rise = (TOP - PLAZA) / (nSteps + 1);
  const tread = (FRONT.stepsV - 0.3) / nSteps;
  const people = new MiraPeople(av, {
    pfSpot,
    net: { nodes: deck.nodes, edges: deck.edges, feet: deck.feet },
    arches: front.arches.map((a) => [a.x, a.z] as [number, number]),
    windows: front.windows,
    atvms: front.atvms,
    hallMid: (r) => {
      const [x, z] = F(r.range(-20, 19), r.range(-11.5, -2.5));
      return new THREE.Vector3(x, TOP, z);
    },
    pf4Edge: (r) => {
      const [x, z] = F(r.range(-24, 20), FRONT.hallV0 + 0.4);
      return new THREE.Vector3(x, TOP, z);
    },
    gates: streets.gates,
    walks: [...streets.walks, ...firstMile.walks],
    spots: [...streets.spots, ...firstMile.spots],
    autoHeads: streets.autoHeads,
    seats: pfs.seats,
    stalls: pfs.stalls,
    stepSeat: (r) => {
      const i = r.int(2, 4);
      const top = TOP - i * rise;
      const [x, z] = F(r.range(-22.5, 22.5), 0.3 + (i - 0.35) * tread);
      return { x, y: top - 0.45, z, h: FRONT.angle + r.range(-0.4, 0.4) };
    },
    avoid: [
      { x: 47.5, z: -57.5, r: 6.4 },
      { x: 57.8, z: -64.8, r: 4.0 },
      { x: 45.5, z: -31.5, r: 2.8 },
    ],
    plazaY: PLAZA,
    hallY: TOP,
  });
  group.add(people.group);
  const traffic = new MiraTraffic(av, M.prop_paint, [...streets.routes, ...firstMile.routes]);
  traffic.signal = firstMile.signal;
  traffic.setStops(firstMile.signal.stops);
  group.add(traffic.group);
  let lastHour = -1;
  let populated = false;
  const camLocal = new THREE.Vector3();

  const [fx, fz] = [62 + AX, -46 + AZ];
  const pf4 = c.P(dm - 60, 4.2, 0);
  const [hx, hz] = F(0, -3);
  const mira: MiraRoad = {
    group,
    crowd: people,
    collision: col,
    bounds: { minX: AX - 380, maxX: AX + 600, minZ: AZ - 420, maxZ: AZ + 420 },
    av,
    timetable,
    spawns: {
      forecourt: { x: fx, z: fz, yaw: Math.PI / 2 - 0.12 },
      pf4: { x: pf4.x + AX, z: pf4.z + AZ, yaw: H(-60) },
      hall: { x: hx + AX, z: hz + AZ, yaw: FRONT.angle + Math.PI / 2 },
    },
    frontView: { eye: new THREE.Vector3(9092, 1.2, -37668), target: new THREE.Vector3(9050, 7.5, -37694) },
    rideTrain: null,
    holdLine1: false,
    update(dt, hour, camera) {
      camLocal.copy(camera.position).sub(group.position);
      if (!populated || Math.abs(hour - lastHour) > 0.2) {
        people.populate(hour);
        populated = true;
      }
      lastHour = hour;
      const near = camLocal.lengthSq() < 420 * 420;
      const onRoute = route.near(camLocal.x, camLocal.z, 160);
      firstMile.signal.update(dt);
      if (near) boards.update(hour);
      // Clock hands.
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const hA = ((hour % 12) / 12) * Math.PI * 2;
      const mA = (hour % 1) * Math.PI * 2;
      let i = 0;
      for (const ck of clocks) {
        const nx = Math.sin(ck.h);
        const nz = Math.cos(ck.h);
        for (const [ang, len, w] of [
          [hA, 0.14, 1.6],
          [mA, 0.23, 1],
        ]) {
          q.setFromEuler(new THREE.Euler(0, ck.h, -ang, 'YXZ'));
          m.compose(new THREE.Vector3(ck.p.x + nx * 0.075, ck.p.y, ck.p.z + nz * 0.075), q, new THREE.Vector3(w, len, 1));
          hands.setMatrixAt(i++, m);
        }
      }
      hands.instanceMatrix.needsUpdate = true;
      service.update(hour, mira.holdLine1);
      people.update(dt, hour, camLocal, mira.rideTrain);
      traffic.update(dt, camLocal, near || onRoute);
    },
    interiorFactor(p) {
      const sky = av.sampleSky(p.x, p.z);
      const ceil = av.sampleCeil(p.x, p.z);
      if (ceil > 0 && p.y > ceil) return 0;
      return Math.max(0, Math.min(1, (1 - sky) / 0.74));
    },
    placeAt(p) {
      const lx = p.x - AX;
      const lz = p.z - AZ;
      if (Math.abs(lx - 60) > 420 || Math.abs(lz + 40) > 420) return null;
      const q = proj(lx, lz);
      const s = q.s - dm;
      if (p.y > DECK_Y - 1) return ['Mira Road · foot-over-bridge', 'मिरा रोड · पादचारी पूल'];
      for (const pf of PLATFORMS)
        if (s > pf.s0 - 2 && s < pf.s1 + 2 && q.o > pf.o0(s) - 0.3 && q.o < pf.o1(s) + 0.3) {
          if (pf.ref === '2;3') return [`Mira Road · platform ${q.o < -10.7 ? 2 : 3}`, `मिरा रोड · फलाट ${q.o < -10.7 ? '२' : '३'}`];
          return [`Mira Road · platform ${pf.ref}`, `मिरा रोड · फलाट ${pf.ref === '1' ? '१' : '४'}`];
        }
      if (inHall(lx, lz)) return ['Mira Road · booking hall', 'मिरा रोड · तिकीट घर'];
      return ['Mira Road (East)', 'मिरा रोड (पूर्व)'];
    },
    auto: { route, streets: firstMile, traffic },
  };
  service.onArrive = (pf, doors) => people.trainArrived(pf, doors, lastHour);
  return mira;
}

const DECK_Y = 7.3;
