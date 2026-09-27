import * as THREE from 'three';
import { RNG } from '../../core/Random';
import type { TextureFactory } from '../../gfx/TextureFactory';
import type { StationMaterials } from '../../world/churchgate/StationMaterials';
import { addShaderPatch } from '../../gfx/AmbientVolume';
import { DOOR_TRAVEL, buildCar, type CarParts, type CarType } from './EmuBuilder';
import { CAR, LIVERY_ROWS, buildCabFront, buildInteriorTex, buildLiveryAtlas } from './Livery';
import type { Service, Timetable } from './Timetable';
import { TRACKS } from '../../world/churchgate/Layout';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Motion profile constants (m, m/s, m/s²). */
export const V_IN = 11.5;
export const A_BRAKE = 0.34;
const A_DEP = 0.55;
const V_OUT = 16;
export const STOP_Z = -2.0;
export const FAR = 1100;
const CARS = 12;

export type TrainState = 'hidden' | 'arriving' | 'dwell' | 'departing';

export interface TrainView {
  pf: number;
  x: number;
  state: TrainState;
  service: Service | null;
  /** z of the southern end of the train. */
  headZ: number;
  speed: number;
  /** Seconds since arrival (dwell) or since departure. */
  phaseTime: number;
  cars: number;
}

export type TrainEvent = { type: 'arrived' | 'departing' | 'approaching'; train: TrainView };

/** A train placed car by car from outside (the rake the player rides, trains passing on the line). */
export interface FreeTrain {
  /** World matrix of each car, including the half-turn of car 0 and the odd cars, as station trains. */
  cars: THREE.Matrix4[];
  /** Livery row per car. */
  rows: number[];
  doorOpen: number;
  /** Car index that is not drawn here (the ridden car is drawn in detail); −1: none. */
  skip: number;
  /** Which cab shows white head lamps (the other shows red tail lamps). */
  lead: 'first' | 'last' | 'none';
  visible: boolean;
}

/** Places a station-road car beyond the straight Churchgate tracks: track index 0–3 (PF 1–4), car centre z. */
export type ApproachFn = (track: number, zc: number, out: { x: number; z: number; heading: number }) => boolean;

const ARR_BRAKE_T = V_IN / A_BRAKE;
const ARR_BRAKE_D = (V_IN * V_IN) / (2 * A_BRAKE);
export const ARRIVAL_SECONDS = ARR_BRAKE_T + (FAR - ARR_BRAKE_D) / V_IN;

/** Distance (north of the stop point) of an arriving train `t` seconds before it stops. */
function arrivalOffset(tBefore: number): { d: number; v: number } {
  if (tBefore <= ARR_BRAKE_T) return { d: 0.5 * A_BRAKE * tBefore * tBefore, v: A_BRAKE * tBefore };
  return { d: ARR_BRAKE_D + V_IN * (tBefore - ARR_BRAKE_T), v: V_IN };
}
function departureOffset(tAfter: number): { d: number; v: number } {
  const tMax = V_OUT / A_DEP;
  if (tAfter <= tMax) return { d: 0.5 * A_DEP * tAfter * tAfter, v: A_DEP * tAfter };
  return { d: 0.5 * A_DEP * tMax * tMax + V_OUT * (tAfter - tMax), v: V_OUT };
}

interface Layer {
  mesh: THREE.InstancedMesh;
  livery?: THREE.InstancedBufferAttribute;
  /** Door leaves: how far open (0 closed … 1 open) per car. */
  doors?: THREE.InstancedBufferAttribute;
}

/** Slides door leaves along the car by aDoorOpen (per car) × travel; leaves with aLeaf < 0.4 never close. */
export function patchDoors(m: THREE.Material): void {
  addShaderPatch(m, 'door-leaves', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSlide;\nattribute float aLeaf;\nattribute float aDoorOpen;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float doorOpen = aLeaf < 0.4 ? 1.0 : aDoorOpen;
        transformed.z += aSlide * ${DOOR_TRAVEL.toFixed(3)} * doorOpen;`);
  });
}

/**
 * Runs the four platform roads at Churchgate from the timetable and renders every car
 * with instancing (one draw per car type and material).
 */
export class TrainSystem {
  readonly group = new THREE.Group();
  readonly views: TrainView[];
  private layers: Record<CarType, Layer[]> = { cab: [], motor: [], trailer: [] };
  /** Cheap far-away versions (shell + dark interior core). */
  private farLayers: Record<CarType, Layer[]> = { cab: [], motor: [], trailer: [] };
  private headLamps!: THREE.InstancedMesh;
  private tailLamps!: THREE.InstancedMesh;
  private liveryOf: number[][] = [];
  private listeners: ((e: TrainEvent) => void)[] = [];
  private prevState: TrainState[] = [];
  readonly free: FreeTrain[] = [];
  /** North of the straight station tracks, cars follow the real alignment (set by the journey). */
  approach: ApproachFn | null = null;
  /** Platform roads whose timetable train is kept away (the ridden train uses them). */
  readonly held = new Set<number>();
  /** Per platform road: a car index drawn elsewhere (the ridden car, after arrival). */
  readonly skipCar = new Map<number, number>();
  /** Platform roads whose arriving train already runs with its doors open (the ridden train). */
  readonly doorsOpen = new Set<number>();
  /**
   * World position the instance matrices are relative to (the group sits there), so trains far
   * from the origin (Mira Road, 38 km away) keep full float precision on the GPU.
   */
  readonly origin = new THREE.Vector3();
  /** Optional overrides so the cinematic director can script a specific arrival. */
  scripted: Map<number, { arriveAt: number; departAt: number }> = new Map();

  constructor(
    tf: TextureFactory,
    private readonly mats: StationMaterials,
    private readonly timetable: Timetable,
  ) {
    this.group.name = 'trains';
    const rng = new RNG(5129);
    const livery = buildLiveryAtlas(tf);
    const cabTex = buildCabFront(tf, '5013', 'VIRAR');
    const interiorTex = buildInteriorTex(tf);
    const M = {
      body: this.patchLivery(this.lit('emuBody', { map: livery, roughness: 0.55, metalness: 0.08 })),
      roof: this.lit('emuRoof', { color: 0x6c6b67, roughness: 0.85 }, 0.5),
      interior: this.lit('emuInterior', { map: interiorTex, vertexColors: true, roughness: 0.62, emissive: new THREE.Color(0.05, 0.05, 0.048), emissiveMap: interiorTex }),
      metal: this.lit('emuMetal', { color: 0x3a3a3a, vertexColors: true, roughness: 0.6, metalness: 0.45 }),
      steel: this.lit('emuSteel', { color: 0xb9bcbe, vertexColors: true, roughness: 0.34, metalness: 0.9 }),
      lights: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.6, 2.7) }),
      doors: this.lit('emuDoors', { vertexColors: true, roughness: 0.5, metalness: 0.35 }),
      cab: this.lit('emuCab', { map: cabTex, roughness: 0.45, metalness: 0.1 }),
      glass: this.lit('emuGlass', { color: 0x0c0f12, roughness: 0.06, metalness: 0.9 }),
      core: this.lit('emuCore', { color: 0x1d1d1f, roughness: 0.9 }),
      metalLite: this.lit('emuMetalLite', { color: 0x2a2a2a, roughness: 0.7, metalness: 0.4 }),
    };
    patchDoors(M.doors);
    const types: CarType[] = ['cab', 'motor', 'trailer'];
    const perTrain: Record<CarType, number> = { cab: 2, motor: 3, trailer: CARS - 5 };
    // The four platform roads, the ridden rake, the trains passing on the line or standing at
    // Borivali and Dadar (up to four), and up to three locals calling at Mira Road.
    const maxTrains = TRACKS.length + 8;
    for (const type of types) {
      const parts: CarParts = buildCar(type, types.indexOf(type) + 1);
      const count = perTrain[type] * maxTrains;
      const add = (geo: THREE.BufferGeometry | undefined, mat: THREE.Material, livery = false, shadow = true, far = false, doors = false) => {
        if (!geo) return;
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        mesh.count = 0;
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        const layer: Layer = { mesh };
        if (livery) {
          layer.livery = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
          layer.livery.setUsage(THREE.DynamicDrawUsage);
          geo.setAttribute('aLivery', layer.livery);
        }
        if (doors) {
          layer.doors = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
          layer.doors.setUsage(THREE.DynamicDrawUsage);
          geo.setAttribute('aDoorOpen', layer.doors);
        }
        (far ? this.farLayers : this.layers)[type].push(layer);
        this.group.add(mesh);
      };
      add(parts.body, M.body, true);
      add(parts.roof, M.roof);
      add(parts.interior, M.interior, false, false);
      add(parts.metal, M.metal, false, false);
      add(parts.steel, M.steel, false, false);
      add(parts.lights, M.lights, false, false);
      add(parts.cab, M.cab);
      add(parts.glass, M.glass, false, false);
      add(parts.doors, M.doors, false, false, false, true);
      // Far LOD: exterior shell, a dark interior core and blocky running gear.
      add(parts.body.clone(), M.body, true, true, true);
      add(parts.roof, M.roof, false, true, true);
      add(parts.cab, M.cab, false, true, true);
      add(parts.glass, M.glass, false, false, true);
      const core = new THREE.BoxGeometry(3.5, 2.2, CAR.length - 0.6).translate(0, 2.3, 0);
      add(core, M.core, false, false, true);
      const gear = mergeGeometries([new THREE.BoxGeometry(2.6, 0.75, 3.2).translate(0, 0.5, -7.25), new THREE.BoxGeometry(2.6, 0.75, 3.2).translate(0, 0.5, 7.25), new THREE.BoxGeometry(3.3, 0.5, 11).translate(0, 0.75, 0)])!;
      add(gear, M.metalLite, false, false, true);
      if (type === 'cab') {
        const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.headLamps = new THREE.InstancedMesh(parts.headLamps!, lampMat, count);
        this.tailLamps = new THREE.InstancedMesh(parts.tailLamps!, lampMat, count);
        for (const m of [this.headLamps, this.tailLamps]) {
          m.count = 0;
          m.frustumCulled = false;
          m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
          this.group.add(m);
        }
      }
    }
    this.views = TRACKS.map((t) => ({ pf: t.pf, x: t.x, state: 'hidden' as TrainState, service: null, headZ: STOP_Z - FAR, speed: 0, phaseTime: 0, cars: CARS }));
    this.prevState = this.views.map(() => 'hidden');
    // Livery rows per train (cars 4 and 9 are sometimes the ladies coach / ad wraps).
    for (let t = 0; t < maxTrains; t++) {
      const rows: number[] = [];
      for (let c = 0; c < CARS; c++) {
        // Second class (rows 0–2), first class (row 3) as cars 3 and 10, ladies (row 4) as cars 5 and 9,
        // and now and then a car with vinyl ad panels (rows 5–7).
        let r = rng.int(0, 2);
        if (c === 4 || c === 8) r = 4;
        else if (c === 2 || c === 9) r = 3;
        else if (rng.chance(0.18)) r = rng.int(5, LIVERY_ROWS - 1);
        rows.push(r);
      }
      this.liveryOf.push(rows);
    }
  }

  private lit(name: string, params: THREE.MeshStandardMaterialParameters, macro = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(params);
    this.mats.add(name, m, macro);
    return m;
  }

  private patchLivery(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    addShaderPatch(m, 'livery-row', (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLivery;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2(uv.x, (${(LIVERY_ROWS - 1).toFixed(1)} - aLivery + clamp(uv.y, 0.004, 0.996)) / ${LIVERY_ROWS.toFixed(1)});`);
    });
    return m;
  }

  /** Livery rows of the train on platform road ti (also used by free trains matching it). */
  rowsOf(ti: number): number[] {
    return this.liveryOf[ti];
  }

  setRow(ti: number, car: number, row: number): void {
    this.liveryOf[ti][car] = row;
  }

  /** Car type of car i in a 12-car rake. */
  static typeOf(i: number): CarType {
    return TrainSystem.carType(i);
  }

  on(fn: (e: TrainEvent) => void): void {
    this.listeners.push(fn);
  }

  /** Car type sequence for a 12-car Siemens rake: cabs at the ends, motors with pantographs. */
  private static carType(i: number): CarType {
    if (i === 0 || i === CARS - 1) return 'cab';
    if (i === 2 || i === 5 || i === 9) return 'motor';
    return 'trailer';
  }

  /** Centre z of car i for a train whose southern end is at headZ. */
  static carZ(headZ: number, i: number): number {
    return headZ - (CAR.length / 2 + 0.62) - i * CAR.pitch;
  }

  /** World positions of every doorway of a stopped train (both sides). */
  doorways(v: TrainView): { x: number; z: number; side: -1 | 1 }[] {
    const out: { x: number; z: number; side: -1 | 1 }[] = [];
    for (let i = 0; i < v.cars; i++) {
      const cz = TrainSystem.carZ(v.headZ, i);
      for (const d of CAR.doors) for (const side of [-1, 1] as const) out.push({ x: v.x + side * CAR.halfW, z: cz + d, side });
    }
    return out;
  }

  private stateFor(v: TrainView, index: number, hour: number): void {
    const sc = this.scripted.get(v.pf);
    let svc: Service | null = null;
    let arrive = 0;
    let depart = 0;
    if (sc) {
      arrive = sc.arriveAt;
      depart = sc.departAt;
      svc = this.timetable.current(v.pf, hour);
    } else {
      // The service that is approaching, standing, or has just left this platform.
      const list = this.timetable.services.filter((s) => s.platform === v.pf && hour >= s.arrive - ARRIVAL_SECONDS / 3600 && hour <= s.depart + 80 / 3600);
      svc = list[0] ?? null;
      if (svc) {
        arrive = svc.arrive;
        depart = svc.depart;
      }
    }
    v.service = svc;
    if (!svc && !sc) {
      v.state = 'hidden';
      return;
    }
    const tRel = (hour - arrive) * 3600;
    const tDep = (hour - depart) * 3600;
    if (tRel < -ARRIVAL_SECONDS) {
      v.state = 'hidden';
    } else if (tRel < 0) {
      const o = arrivalOffset(-tRel);
      v.state = 'arriving';
      v.headZ = STOP_Z - o.d;
      v.speed = o.v;
      v.phaseTime = tRel;
    } else if (tDep < 0) {
      v.state = 'dwell';
      v.headZ = STOP_Z;
      v.speed = 0;
      v.phaseTime = tRel;
    } else {
      const o = departureOffset(tDep);
      v.state = o.d > FAR ? 'hidden' : 'departing';
      v.headZ = STOP_Z - o.d;
      v.speed = -o.v;
      v.phaseTime = tDep;
    }
    void index;
  }

  update(hour: number, lamps: number, cam?: THREE.Vector3): void {
    const counts: Record<CarType, number> = { cab: 0, motor: 0, trailer: 0 };
    const farCounts: Record<CarType, number> = { cab: 0, motor: 0, trailer: 0 };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let lampCount = 0;
    const white = new THREE.Color(3.5, 3.4, 3.1);
    const red = new THREE.Color(3.2, 0.25, 0.15);
    const off = new THREE.Color(0.06, 0.06, 0.06);
    const up = new THREE.Vector3(0, 1, 0);
    const ap = { x: 0, z: 0, heading: 0 };
    const cp = new THREE.Vector3();
    this.group.position.copy(this.origin);
    const o = this.origin;
    const rel = new THREE.Matrix4();
    const place = (world: THREE.Matrix4, type: CarType, row: number, doorOpen: number, head: THREE.Color, tail: THREE.Color) => {
      cp.setFromMatrixPosition(world);
      const far = cam ? (cp.x - cam.x) ** 2 + (cp.z - cam.z) ** 2 > 72 * 72 : false;
      const cm = rel.copy(world);
      cm.elements[12] -= o.x;
      cm.elements[13] -= o.y;
      cm.elements[14] -= o.z;
      const idx = far ? farCounts[type]++ : counts[type]++;
      for (const layer of (far ? this.farLayers : this.layers)[type]) {
        if (idx >= layer.mesh.instanceMatrix.count) continue;
        layer.mesh.setMatrixAt(idx, cm);
        if (layer.livery) layer.livery.setX(idx, row);
        if (layer.doors) layer.doors.setX(idx, doorOpen);
      }
      if (type === 'cab' && lampCount < this.headLamps.instanceMatrix.count) {
        this.headLamps.setMatrixAt(lampCount, cm);
        this.tailLamps.setMatrixAt(lampCount, cm);
        this.headLamps.setColorAt(lampCount, head);
        this.tailLamps.setColorAt(lampCount, tail);
        lampCount++;
      }
    };
    this.views.forEach((v, ti) => {
      this.stateFor(v, ti, hour);
      const prev = this.prevState[ti];
      if (prev !== v.state) {
        if (v.state === 'arriving') this.emit({ type: 'approaching', train: v });
        if (v.state === 'dwell') this.emit({ type: 'arrived', train: v });
        if (v.state === 'departing') this.emit({ type: 'departing', train: v });
        this.prevState[ti] = v.state;
      }
      if (this.held.has(v.pf)) v.state = 'hidden';
      if (v.state === 'hidden') return;
      // Doors open as the train stops and close as it pulls out.
      const doorOpen = v.state === 'dwell' || (v.state === 'arriving' && this.doorsOpen.has(v.pf)) ? 1 : v.state === 'arriving' ? THREE.MathUtils.smoothstep(v.phaseTime, -3, 0) : 1 - THREE.MathUtils.smoothstep(v.phaseTime, 0.5, 3.5);
      const skip = this.skipCar.get(v.pf) ?? -1;
      for (let i = 0; i < CARS; i++) {
        if (i === skip) continue;
        const type = TrainSystem.carType(i);
        const zc = TrainSystem.carZ(v.headZ, i);
        pos.set(v.x, 0, zc);
        // Lead cab faces south (+z), so rotate car 0 by π; the rear cab faces north.
        q.identity();
        if (this.approach && this.approach(ti, zc, ap)) {
          pos.set(ap.x, 0, ap.z);
          q.setFromAxisAngle(up, ap.heading);
        }
        if (i === 0 || (type !== 'cab' && i % 2 === 1)) q.multiply(flip);
        m.compose(pos, q, one);
        // The leading end shows white head lamps, the trailing end red tail lamps.
        const leading = (i === 0 && v.state !== 'departing') || (i === CARS - 1 && v.state === 'departing');
        const lit = v.state !== 'dwell' || (lamps > 0.8 && v.phaseTime < 20);
        place(m, type, this.liveryOf[ti][i], doorOpen, leading && lit ? white : off, !leading && lit ? red : off);
      }
    });
    // Free trains (the ridden rake, trains passing on the line).
    this.free.forEach((f, fi) => {
      if (!f.visible) return;
      f.cars.forEach((cm, i) => {
        if (i === f.skip) return;
        const type = TrainSystem.carType(i);
        const leading = (f.lead === 'first' && i === 0) || (f.lead === 'last' && i === CARS - 1);
        const tail = f.lead !== 'none' && !leading;
        place(cm, type, f.rows[i] ?? this.liveryOf[fi % this.liveryOf.length][i], f.doorOpen, leading ? white : off, tail ? red : off);
      });
    });
    for (const [set, cnt] of [
      [this.layers, counts],
      [this.farLayers, farCounts],
    ] as [Record<CarType, Layer[]>, Record<CarType, number>][])
      for (const type of Object.keys(set) as CarType[])
        for (const layer of set[type]) {
          layer.mesh.count = Math.min(cnt[type], layer.mesh.instanceMatrix.count);
          layer.mesh.instanceMatrix.needsUpdate = true;
          if (layer.livery) layer.livery.needsUpdate = true;
          if (layer.doors) layer.doors.needsUpdate = true;
        }
    for (const lm of [this.headLamps, this.tailLamps]) {
      lm.count = lampCount;
      lm.instanceMatrix.needsUpdate = true;
      if (lm.instanceColor) lm.instanceColor.needsUpdate = true;
    }
  }

  private emit(e: TrainEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Makes platform `pf` receive a train at a chosen game hour (used by the cinematic). */
  script(pf: number, arriveAt: number, departAt: number): void {
    this.scripted.set(pf, { arriveAt, departAt });
  }
}
