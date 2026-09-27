import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { CollisionWorld } from '../../core/Collision';
import { AmbientVolume } from '../../gfx/AmbientVolume';
import type { TextureFactory } from '../../gfx/TextureFactory';
import { StationMaterials } from './StationMaterials';
import { buildShed } from './Shed';
import { buildPlatforms } from './Platforms';
import { buildHangings, signMaterials, type Hangings } from './Hangings';
import { SignAtlas } from '../../gfx/Signage';
import { LedAtlas } from '../../gfx/LedBoard';
import { Timetable } from '../../entities/train/Timetable';
import { TrainSystem } from '../../entities/train/TrainSystem';
import { Crowd } from '../../entities/crowd/Crowd';
import type { LightingState } from '../../gfx/TimeOfDay';
import { boxGeo } from '../../gfx/GeoBuilder';
import { City, type GeoData } from '../city/City';
import { buildStationBuilding } from './StationBuilding';
import { Traffic } from '../../entities/traffic/Traffic';
import { LANDMARK_IDS, buildEros, buildWrhqDome } from './Landmarks';
import { Route } from '../route/Route';
import { IMC, RouteLayout } from '../route/RouteLayout';
import { buildDecoDressing, decoBuildings } from '../route/DecoDressing';
import { NP_CITY_AREA, NP_LANDMARKS } from '../route/NarimanPoint';
import { Railway, THROAT_Z } from '../journey/Railway';
import { Journey } from '../journey/Journey';

export type Progress = (label: string, fraction: number) => Promise<void>;

/** Assembles the Churchgate station vertical slice. */
export class Churchgate {
  readonly root = new THREE.Group();
  readonly collision = new CollisionWorld();
  readonly av: AmbientVolume;
  readonly mats: StationMaterials;
  readonly atlas: SignAtlas;
  readonly led: LedAtlas;
  timetable!: Timetable;
  hangings!: Hangings;
  trains!: TrainSystem;
  crowd!: Crowd;
  city!: City;
  private cullers: import('../../gfx/InstanceCuller').InstanceCuller[] = [];
  traffic!: Traffic;
  route!: Route;
  /** The Western Railway from Mira Road to the buffers (OpenStreetMap). */
  railway!: Railway;
  /** The ride's scenery; the Churchgate approach is part of this world. */
  journey!: Journey;
  /** True while the camera is far up the line (the ride): the station and streets are hidden. */
  far = false;
  private decoGroup!: THREE.Group;
  private readonly rng = new RNG(1870);
  private clockHands!: THREE.InstancedMesh;
  private boardQueue: number[] = [];
  private lastBoardMinute = -1;

  constructor(readonly tf: TextureFactory) {
    this.root.name = 'churchgate';
    // Covers the station, its forecourts and the streets down to Veer Nariman Road.
    // Station, Churchgate → Marine Drive and Nariman Point (≈0.8 × 0.9 m cells).
    this.av = new AmbientVolume(-1260, -780, 320, 1130, 2048);
    this.mats = new StationMaterials(tf, this.av);
    this.atlas = new SignAtlas(tf, 2048, 3072);
    this.led = new LedAtlas(tf);
    signMaterials(this.mats, this.atlas);
  }

  async build(progress: Progress, startHour: number): Promise<void> {
    this.timetable = new Timetable(startHour - 0.6, startHour + 3.5, 7);
    await progress('Raising the train shed', 0.2);
    const shed = buildShed(this.mats, this.collision, this.av);
    this.root.add(shed.group);
    await progress('Laying platforms and track', 0.35);
    const pf = buildPlatforms(this.mats, this.collision, this.rng.fork(2));
    this.root.add(pf.group);
    this.cullers.push(...pf.cullers);
    await progress('Hanging signs, lamps and fans', 0.5);
    this.hangings = buildHangings(this.mats, this.atlas, this.led, this.av, this.rng.fork(3));
    this.root.add(this.hangings.group);
    this.atlas.commit();
    this.buildClockHands();
    await progress('Reading the streets of South Mumbai (OpenStreetMap)', 0.55);
    const [geo, backBay, railway] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/south-mumbai.geo.json`).then((r) => r.json() as Promise<GeoData>),
      Route.loadGeo(),
      Railway.load(import.meta.env.BASE_URL),
    ]);
    this.railway = railway;
    const layout = new RouteLayout(backBay);
    const deco = decoBuildings(geo.buildings);
    this.city = new City(this.tf, this.av, this.mats, this.collision, geo);
    this.city.build({
      bounds: { x0: -560, x1: 300, z0: -760, z1: 420 },
      detailCenter: { x: -60, z: 60 },
      detailRadius: 330,
      extraBounds: [NP_CITY_AREA],
      extraDetail: [{ x: -800, z: 640, r: 340 }],
      exclude: [{ x0: -27, x1: 27, z0: -320, z1: 118 }],
      excludeIds: [LANDMARK_IDS.eros, NP_LANDMARKS.airIndia, NP_LANDMARKS.express, NP_LANDMARKS.trident, NP_LANDMARKS.oberoi, NP_LANDMARKS.tata, NP_LANDMARKS.bhabha],
      corridor: Route.corridor(layout),
      skipGround: true,
      overrides: deco,
    });
    this.root.add(this.city.group);
    await progress('Eros Cinema and the Western Railway headquarters', 0.58);
    const erosB = geo.buildings.find((b) => b.id === LANDMARK_IDS.eros);
    if (erosB) this.root.add(buildEros(erosB, this.mats, this.atlas, this.city.facadeMaterial, this.collision, this.av));
    const wrhq = geo.buildings.find((b) => b.id === LANDMARK_IDS.wrhq);
    const wrhqH = wrhq ? this.city.heights.get(wrhq.id) : undefined;
    if (wrhq && wrhqH) this.root.add(buildWrhqDome(wrhq, wrhqH, this.mats));
    await progress('Veer Nariman Road to Marine Drive', 0.59);
    this.route = new Route({
      tf: this.tf,
      mats: this.mats,
      atlas: this.atlas,
      col: this.collision,
      av: this.av,
      buildings: geo.buildings,
      heights: this.city.heights,
      facade: this.city.facadeMaterial,
      rail: { hole: railway.landHole(3300), clearance: (x, z) => railway.clearance(x, z) },
    });
    this.route.build(backBay, layout);
    this.root.add(this.route.group);
    this.decoGroup = buildDecoDressing(geo.buildings, this.city.heights, deco, this.mats);
    this.root.add(this.decoGroup);
    // IMC Road: cars parked along the station wall and the far side (footage frame #02).
    const parked: { x: number; z: number; heading: number; kind: 'taxi' | 'cab' | 'car' | 'suv' }[] = [];
    for (let i = 0; i < 8; i++) parked.push({ x: -26.2, z: 20 + i * 5.6, heading: 0, kind: (['cab', 'suv', 'taxi', 'car'] as const)[i % 4] });
    // The far row follows IMC Road's west kerb (the street slants away from the station wall).
    for (let i = 0; i < 6; i++) {
      const t = IMC.axis.project(-33, 24 + i * 6.2).s;
      const [x, z] = IMC.axis.point(t, -2.45);
      const d = IMC.axis.at(t);
      parked.push({ x, z, heading: Math.atan2(d.tx, d.tz) + Math.PI, kind: i % 2 ? 'taxi' : 'car' });
    }
    for (const p of parked) this.collision.addSolid(p.x, p.z, 0.85, 2.0, -p.heading, -1, 1.6);
    this.traffic = new Traffic(this.mats, geo.roads, {
      center: { x: -420, z: 200 },
      radius: 1000,
      count: 340,
      focus: [
        { x: 40, z: 40, r: 160 },
        { x: -200, z: 60, r: 180 },
        { x: -395, z: 0, r: 160 },
        { x: -300, z: -300, r: 220 },
        { x: -520, z: 200, r: 200 },
        { x: -760, z: 560, r: 220 },
      ],
      parked: [...parked, ...this.route.parked],
      stops: this.route.stops,
      signals: this.route.signalAspects,
      shapeLane: this.route.laneShaper(),
      pedestrianAt: (x, z, r) => this.crowd?.occupied(x, z, r) ?? false,
      blocked: obstacleTest(geo.buildings, this.collision, this.route.walk),
    });
    if (this.traffic.dropped.length) console.info(`traffic: left out ${this.traffic.dropped.length} lanes through buildings or walls`);
    this.root.add(this.traffic.group);
    await progress('Laying the Western Railway to Grant Road', 0.595);
    this.journey = new Journey(this, railway);
    this.root.add(this.journey.buildApproach());
    await progress('Building the station offices', 0.6);
    const sb = buildStationBuilding(this.mats, this.atlas, this.collision, this.av, this.city.facadeMaterial);
    this.root.add(sb.group);
    this.atlas.commit();
    await progress('Assembling Mumbai locals', 0.62);
    this.trains = new TrainSystem(this.tf, this.mats, this.timetable);
    // North of the platforms the roads fan in and follow the real alignment.
    this.trains.approach = (ti, zc, out) => {
      if (zc > THROAT_Z + 8) return false;
      railway.carPose(ti, railway.dOfStationZ(zc), out);
      return true;
    };
    this.root.add(this.trains.group);
    await progress('Filling the platforms with commuters', 0.7);
    this.crowd = new Crowd(this.av, this.trains, pf.seats);
    this.root.add(this.crowd.group);
    // Settle the trains to the start time before the crowd reacts to them.
    this.trains.update(startHour, 0);
    this.crowd.populate(startHour);
    this.crowd.configureStreet(this.route.streetConfig());
    await progress('Baking ambient light', 0.8);
    this.av.commit(2, 3);
    void this.tf;
  }

  private buildClockHands(): void {
    // Instances: for each clock, 2 faces × (hour, minute) hands.
    const g = boxGeo(0.018, 1, 0.006);
    g.translate(0, 0.5, 0);
    const n = this.hangings.clocks.length * 4;
    this.clockHands = new THREE.InstancedMesh(g, this.mats.m.blackPaint, n);
    this.clockHands.castShadow = false;
    this.root.add(this.clockHands);
  }

  private updateClocks(hour: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const hA = ((hour % 12) / 12) * Math.PI * 2;
    const mA = (hour % 1) * Math.PI * 2;
    let i = 0;
    for (const c of this.hangings.clocks) {
      for (const face of [1, -1]) {
        for (const [ang, len, w] of [
          [hA, 0.15, 1.6],
          [mA, 0.24, 1],
        ]) {
          q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), face > 0 ? -ang : ang);
          s.set(w, len, 1);
          p.set(c.x, c.y, c.z + face * 0.075);
          m.compose(p, q, s);
          this.clockHands.setMatrixAt(i++, m);
        }
      }
    }
    this.clockHands.instanceMatrix.needsUpdate = true;
  }

  /** Redraws LED boards incrementally (one per frame) when the minute changes. */
  private updateBoards(hour: number): void {
    const minute = Math.floor(hour * 60);
    if (minute !== this.lastBoardMinute && this.boardQueue.length === 0) {
      this.lastBoardMinute = minute;
      this.boardQueue = [...this.hangings.boards.map((_, i) => i), ...this.hangings.repeaters.map((_, i) => 100 + i)];
    }
    if (!this.boardQueue.length) return;
    const k = this.boardQueue.shift()!;
    const tt = this.timetable;
    if (k < 100) {
      const b = this.hangings.boards[k];
      const list = tt.upcoming(b.pf, hour);
      const now = list[0] ? Timetable.toDeparture(list[0], hour) : null;
      const all = tt.allUpcoming(hour, 8).filter((s) => s !== list[0]);
      this.led.drawBoard(b.slot, { platform: b.pf, now, next: all.slice(0, 3).map((s) => Timetable.toDeparture(s, hour)) });
    } else {
      const r = this.hangings.repeaters[k - 100];
      const s = tt.current(r.pf, hour);
      this.led.drawRepeater(r.slot, r.pf, s ? Timetable.toDeparture(s, hour) : null);
    }
    if (!this.boardQueue.length) this.led.commit();
  }

  /** Hides everything but the trains while the ride is far up the line (and skips its upkeep). */
  setFar(far: boolean): void {
    this.far = far;
    for (const c of this.root.children) c.visible = !far || c === this.trains.group;
  }

  update(dt: number, _time: number, light: LightingState, hour: number, camera: THREE.Camera): void {
    const daylight = light.horizon.clone().lerp(light.zenith, 0.4).multiplyScalar(1.2);
    const level = Math.max(0, Math.min(1, (light.sunElevation + 6) / 30));
    // Lamps and lit signs follow the time of day everywhere (Mira Road shares the materials).
    this.mats.update(light.lamps, daylight, level);
    this.av.setLamps(new THREE.Color(1.0, 0.88, 0.72), 2.1 * light.lamps);
    if (this.far) {
      // Keep the station's clockwork running (trains, crowd) without drawing it.
      this.trains.update(hour, light.lamps, camera.position);
      this.crowd.update(dt, hour, camera);
      this.journey.update(_time, dt, hour, camera);
      return;
    }
    this.journey.update(_time, dt, hour, camera);
    this.hangings.update(dt, hour);
    this.city.update(light.lamps, _time);
    this.traffic.update(dt, light.lamps, camera);
    this.route.update(dt, _time, camera as THREE.PerspectiveCamera, light.lamps, 1);
    // Zone visibility: the shed hides the route; the route is too far to see the shed's interior.
    const cp = camera.position;
    const inShed = cp.x > -24.6 && cp.x < 24.6 && cp.z < 10.5 && cp.z > -300 && cp.y < 17;
    this.route.setVisibleFromStation(inShed);
    const farFromStation = cp.distanceTo(new THREE.Vector3(0, 0, -60)) > 330 && cp.y < 60;
    this.hangings.group.visible = !farFromStation;
    this.trains.group.visible = !farFromStation || this.trains.free.some((f) => f.visible) || this.trains.views.some((v) => v.state !== 'hidden');
    this.decoGroup.visible = !inShed;
    this.updateClocks(hour);
    this.updateBoards(hour);
    this.trains.update(hour, light.lamps, camera.position);
    this.crowd.update(dt, hour, camera);
    for (const c of this.cullers) c.update(camera as THREE.PerspectiveCamera);
    this.city.cull(camera as THREE.PerspectiveCamera);
  }

  /** How "indoors" a camera position is (0 outside … 1 deep under the shed). */
  interiorFactor(pos: THREE.Vector3): number {
    const sky = this.av.sampleSky(pos.x, pos.z);
    const ceil = this.av.sampleCeil(pos.x, pos.z);
    if (ceil > 0 && pos.y > ceil) return 0;
    return Math.max(0, Math.min(1, (1 - sky) / 0.74));
  }
}

/** Where no car can be: inside an OSM building, a wall or post, or up on a kerbed footpath / island. */
function obstacleTest(buildings: GeoData['buildings'], col: CollisionWorld, walk: { sample(x: number, z: number): number }): (x: number, z: number) => boolean {
  const CELL = 24;
  const grid = new Map<number, number[][]>();
  const key = (ix: number, iz: number) => (ix + 1000) * 4000 + (iz + 1000);
  for (const b of buildings) {
    const fp = b.fp;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < fp.length; i += 2) {
      x0 = Math.min(x0, fp[i]);
      x1 = Math.max(x1, fp[i]);
      z0 = Math.min(z0, fp[i + 1]);
      z1 = Math.max(z1, fp[i + 1]);
    }
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++)
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
        const k = key(ix, iz);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(fp);
      }
  }
  const inside = (fp: number[], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = fp.length - 2; i < fp.length; j = i, i += 2) {
      const xi = fp[i];
      const zi = fp[i + 1];
      const xj = fp[j];
      const zj = fp[j + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  return (x, z) => {
    if (walk.sample(x, z) > 0.08) return true;
    if (col.solidAt(x, z, 0.3)) return true;
    const l = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    return !!l && l.some((fp) => inside(fp, x, z));
  };
}
