import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { POSE, makeLook, type Look } from '../../entities/crowd/Looks';
import { closingPose } from '../../entities/crowd/CrowdMaterial';
import { Riders } from '../../entities/crowd/Riders';
import { CAR } from '../../entities/train/Livery';
import type { FreeTrain, TrainSystem } from '../../entities/train/TrainSystem';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import { WEATHER } from '../../gfx/Weather';
import type { Railway } from '../journey/Railway';
import type { MiraTimetable } from './MiraBoards';
import { mat4 } from './MiraCtx';
import { autoRickshaw, carGeo, mbmtBus, tempo, twoWheeler } from './MiraVehicles';

/**
 * Life at Mira Road: the locals calling at PF 1–3 on the timetable (PF 4's Churchgate fast is the
 * ride's own train), the commuters (waiting, boarding, pouring off trains and over the bridges,
 * queueing at the ticket windows, sitting on the arcade steps, crossing the forecourt to the autos
 * and the bus), and the traffic on the approach road and the streets around.
 *
 * Numbers follow the hour ⚠: mornings crowd the Churchgate-bound platforms (2, 4); evenings
 * bring the crowds home on the Virar-bound ones (1, 3).
 */

type Pt = [number, number];
const CARS = 12;
const carBack = (i: number) => CAR.length / 2 + 0.62 + i * CAR.pitch;
const flipped = (i: number) => i === 0 || (i !== CARS - 1 && i % 2 === 1);
const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Platform faces: number → line, the side of the line the platform is on, where trains stop. */
export const FACES: Record<number, { line: number; side: -1 | 1; stop: number; dir: 1 | -1; ref: string }> = {
  1: { line: 3, side: -1, stop: -312, dir: -1, ref: '1' },
  2: { line: 2, side: 1, stop: 46, dir: 1, ref: '2;3' },
  3: { line: 1, side: -1, stop: -283, dir: -1, ref: '2;3' },
  4: { line: 0, side: 1, stop: 0, dir: 1, ref: '4' },
};

// -------------------------------------------------------------------------------------------------
/** The stopping service at PF 1–3: approach, dwell with the doors open, pull out. */
export class MiraService {
  private running: { key: string; pf: number; arrive: number; dwell: number; train: FreeTrain; arrived: boolean; leaving: boolean }[] = [];
  private done = new Set<string>();
  private rng = new RNG(808);
  onArrive: ((pf: number, doors: Pt[]) => void) | null = null;
  onDepart: ((pf: number) => void) | null = null;

  constructor(
    private readonly trains: TrainSystem,
    private readonly rail: Railway,
    private readonly timetable: MiraTimetable,
    private readonly dm: number,
    private readonly anchor: { x: number; z: number },
  ) {}

  private lead(pf: number, tRel: number, dwell: number): number {
    const f = FACES[pf];
    const V = 15;
    const A = 0.55;
    const Tb = V / A;
    const Db = (V * V) / (2 * A);
    let dist: number;
    if (tRel < 0) {
      const tb = -tRel;
      dist = -(tb <= Tb ? 0.5 * A * tb * tb : Db + V * (tb - Tb));
    } else if (tRel <= dwell) dist = 0;
    else {
      const ta = tRel - dwell;
      const Aa = 0.5;
      dist = ta <= V / Aa ? 0.5 * Aa * ta * ta : (V * V) / (2 * Aa) + V * (ta - V / Aa);
    }
    return this.dm + f.stop + f.dir * dist;
  }

  /** Door positions (local to the anchor) on the platform side of a train standing at pf. */
  doors(pf: number): Pt[] {
    const f = FACES[pf];
    const lead = this.dm + f.stop;
    const out: Pt[] = [];
    const o = this.rail.lineOffset(f.line, lead)! + f.side * (CAR.halfW + 0.45);
    for (let i = 0; i < CARS; i++)
      for (const zd of CAR.doors) {
        const [x, z] = this.rail.path.point(lead - f.dir * carBack(i) + zd, o);
        out.push([x - this.anchor.x, z - this.anchor.z]);
      }
    return out;
  }

  /** Which platforms have a train standing now. */
  standing(pf: number): boolean {
    return this.running.some((r) => r.pf === pf && r.arrived && !r.leaving);
  }

  update(hour: number, blockLine1: boolean): void {
    for (const pf of [1, 2, 3]) {
      if (pf === 3 && blockLine1) continue;
      for (const t of this.timetable.between(pf, hour - 2.2 / 60, hour + 1.7 / 60)) {
        const key = `${pf}:${t.time.toFixed(4)}`;
        if (this.done.has(key) || this.running.some((r) => r.key === key)) continue;
        if (this.running.some((r) => r.pf === pf)) continue;
        const rows = Array.from({ length: CARS }, (_, i) => (i === 4 || i === 8 ? 4 : i === 2 || i === 9 ? 3 : this.rng.chance(0.2) ? this.rng.int(5, 7) : this.rng.int(0, 2)));
        const train: FreeTrain = { cars: Array.from({ length: CARS }, () => new THREE.Matrix4()), rows, doorOpen: 0, skip: -1, lead: 'first', visible: false };
        this.trains.free.push(train);
        this.running.push({ key, pf, arrive: t.time, dwell: this.rng.range(22, 34), train, arrived: false, leaving: false });
      }
    }
    const pose = { x: 0, z: 0, heading: 0 };
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const flip = new THREE.Quaternion().setFromAxisAngle(up, Math.PI);
    const one = new THREE.Vector3(1, 1, 1);
    for (let k = this.running.length - 1; k >= 0; k--) {
      const r = this.running[k];
      const f = FACES[r.pf];
      const tRel = (hour - r.arrive) * 3600;
      if (tRel > r.dwell + 110 || tRel < -400) {
        r.train.visible = false;
        const i = this.trains.free.indexOf(r.train);
        if (i >= 0) this.trains.free.splice(i, 1);
        this.running.splice(k, 1);
        this.done.add(r.key);
        continue;
      }
      const lead = this.lead(r.pf, tRel, r.dwell);
      r.train.visible = Math.abs(lead - (this.dm + f.stop)) < 1150;
      r.train.doorOpen = sm(0.8, 2.8, tRel) * (1 - sm(r.dwell - 3.5, r.dwell - 1, tRel));
      for (let i = 0; i < CARS; i++) {
        this.rail.linePose(f.line, lead - f.dir * carBack(i), pose);
        q.setFromAxisAngle(up, pose.heading + (f.dir < 0 ? Math.PI : 0));
        if (flipped(i)) q.multiply(flip);
        r.train.cars[i].compose(new THREE.Vector3(pose.x, 0, pose.z), q, one);
      }
      if (!r.arrived && tRel >= 2.5 && tRel < r.dwell) {
        r.arrived = true;
        this.onArrive?.(r.pf, this.doors(r.pf));
      }
      if (!r.leaving && tRel >= r.dwell - 5) {
        r.leaving = true;
        this.onDepart?.(r.pf);
      }
    }
  }

  clear(): void {
    for (const r of this.running) {
      r.train.visible = false;
      const i = this.trains.free.indexOf(r.train);
      if (i >= 0) this.trains.free.splice(i, 1);
    }
    this.running = [];
  }
}

// -------------------------------------------------------------------------------------------------
export interface WalkNet {
  nodes: THREE.Vector3[];
  edges: [number, number][];
  /** Stair feet: graph node and what they stand on ('1', '2;3', '4', 'hall', null = street). */
  feet: { node: number; on: string | null }[];
}

interface Person {
  look: Look;
  x: number;
  y: number;
  z: number;
  h: number;
  pose: number;
  mode: 'idle' | 'walk' | 'board' | 'gone' | 'wait';
  path: THREE.Vector3[];
  pi: number;
  speed: number;
  phase: number;
  /** PF number they wait for (board its trains), 0 none. */
  pf: number;
  board: boolean;
  /** After walking: 'gone', or become a waiter on pf. */
  then: 'gone' | 'wait' | 'idle';
  delay: number;
  target: { x: number; z: number; car: number } | null;
}

export interface CrowdSetup {
  /** Waiting area of a PF face: random spot (local), facing the track. */
  pfSpot: (pf: number, rng: RNG) => { x: number; z: number; h: number };
  /** Walking spots to reach from a stair foot to a platform spot are straight lines. */
  net: WalkNet;
  /** The hall's side of the stair to the FOB, arch positions, windows, ATVMs. */
  arches: Pt[];
  windows: { x: number; z: number; h: number }[];
  atvms: { x: number; z: number; h: number }[];
  /** A point in the hall on the way to PF 4, and PF 4's edge of the hall. */
  hallMid: (rng: RNG) => THREE.Vector3;
  pf4Edge: (rng: RNG) => THREE.Vector3;
  /** Forecourt gates and street walks. */
  gates: Pt[];
  walks: THREE.Vector3[][];
  /** Where people wait or hang about; `pose` fixes how (1 seated on a chair or ledge). */
  spots: { kind: string; x: number; z: number; y: number; h: number; pose?: number }[];
  autoHeads: Pt[];
  seats: { x: number; y: number; z: number; h: number }[];
  stalls: { x: number; z: number; h: number }[];
  /** Arcade steps: seat on step (y of its top) at frame (u) → local. */
  stepSeat: (rng: RNG) => { x: number; y: number; z: number; h: number };
  /** Obstacles on the forecourt to walk round (centre, radius). */
  avoid: { x: number; z: number; r: number }[];
  plazaY: number;
  hallY: number;
}

/** How many people wait on a platform at an hour (⚠ rough peak pattern). */
function waiting(pf: number, hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const morning = sm(6, 8, h) * (1 - sm(10.5, 12, h));
  const evening = sm(16.5, 18, h) * (1 - sm(21, 22.5, h));
  const night = h < 5 || h > 23.3 ? 0.25 : 1;
  const base = pf === 4 ? 70 : pf === 2 ? 45 : 30;
  const toTown = pf === 2 || pf === 4;
  return Math.round(base * night * (1 + (toTown ? 1.1 * morning + 0.3 * evening : 0.25 * morning + 0.5 * evening)));
}

/** People getting off a local at pf (⚠). */
function alighting(pf: number, hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const morning = sm(6, 8, h) * (1 - sm(10.5, 12, h));
  const evening = sm(16.5, 18.5, h) * (1 - sm(21.5, 23, h));
  const fromTown = pf === 1 || pf === 3;
  return Math.round((fromTown ? 26 + 90 * evening + 10 * morning : 18 + 30 * morning + 8 * evening) * (h < 5 ? 0.3 : 1));
}

export class MiraPeople {
  /** Near figures in full detail, the rest in the low-detail model (both in the station's frame). */
  readonly riders: Riders;
  readonly ridersFar: Riders;
  readonly group = new THREE.Group();
  private people: Person[] = [];
  private readonly rng = new RNG(71);
  /** People who boarded the ridden car (the ride picks them up as standing passengers). */
  readonly boardedHero: Look[] = [];
  private adj: number[][] = [];
  private pathCache = new Map<string, number[]>();
  private spawnT = 0;
  private looks: Look[] = [];
  private lookK = 0;
  /** The camera (local) as of the last update: flows start where someone will see them. */
  private cam = new THREE.Vector3();

  constructor(
    av: AmbientVolume,
    private readonly s: CrowdSetup,
  ) {
    this.riders = new Riders(av, 420);
    this.ridersFar = new Riders(av, 1100, { lod: 1, shadows: false });
    this.group.add(this.riders.group, this.ridersFar.group);
    for (let i = 0; i < 160; i++) this.looks.push(makeLook(this.rng, 0.4));
    const n = s.net;
    this.adj = n.nodes.map(() => []);
    for (const [a, b] of n.edges) {
      this.adj[a].push(b);
      this.adj[b].push(a);
    }
  }

  private look(): Look {
    return this.looks[this.lookK++ % this.looks.length];
  }

  private slot(): Person | null {
    for (const p of this.people) if (p.mode === 'gone') return p;
    if (this.people.length >= 1050) return null;
    const p: Person = { look: this.look(), x: 0, y: 0, z: 0, h: 0, pose: 0, mode: 'gone', path: [], pi: 0, speed: 1.3, phase: 0, pf: 0, board: false, then: 'gone', delay: 0, target: null };
    this.people.push(p);
    return p;
  }

  private add(x: number, y: number, z: number, h: number, mode: Person['mode'], pose = 0, pf = 0): Person | null {
    const p = this.slot();
    if (!p) return null;
    Object.assign(p, { look: this.look(), x, y, z, h, mode, pose, pf, board: pf > 0 && this.rng.chance(0.85), path: [], pi: 0, speed: this.rng.range(1.1, 1.55), phase: this.rng.range(0, 6), then: 'gone', delay: 0, target: null });
    return p;
  }

  private walk(path: THREE.Vector3[], then: Person['then'], pf = 0, delay = 0): Person | null {
    if (path.length < 2) return null;
    const p = this.add(path[0].x, path[0].y, path[0].z, 0, 'walk', 0, pf);
    if (!p) return null;
    p.path = path;
    p.pi = 1;
    p.then = then;
    p.delay = delay;
    return p;
  }

  /** Shortest route over the walking graph (node indices). */
  private route(a: number, b: number): number[] {
    const key = `${a}>${b}`;
    const hit = this.pathCache.get(key);
    if (hit) return hit;
    const N = this.s.net.nodes;
    const dist = new Float64Array(N.length).fill(Infinity);
    const prev = new Int32Array(N.length).fill(-1);
    const done = new Uint8Array(N.length);
    dist[a] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < N.length; i++)
        if (!done[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      if (u < 0 || u === b) break;
      done[u] = 1;
      for (const v of this.adj[u]) {
        const d = best + N[u].distanceTo(N[v]);
        if (d < dist[v]) {
          dist[v] = d;
          prev[v] = u;
        }
      }
    }
    const out: number[] = [];
    if (dist[b] < Infinity) for (let v = b; v >= 0; v = prev[v]) out.unshift(v);
    this.pathCache.set(key, out);
    return out;
  }

  private feetOn(on: string | null, near?: { x: number; z: number }): number[] {
    let list = this.s.net.feet.filter((f) => f.on === on).map((f) => f.node);
    if (near && list.length > 1) {
      const N = this.s.net.nodes;
      list = [...list].sort((a, b) => (N[a].x - near.x) ** 2 + (N[a].z - near.z) ** 2 - ((N[b].x - near.x) ** 2 + (N[b].z - near.z) ** 2));
    }
    return list;
  }

  private graphPath(a: number, b: number): THREE.Vector3[] {
    return this.route(a, b).map((i) => this.s.net.nodes[i].clone());
  }

  /** Detours round the forecourt's memorial and fountain. */
  private skirt(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    for (const o of this.s.avoid) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / l2));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = Math.hypot(px - o.x, pz - o.z);
      if (d < o.r + 0.8 && t > 0 && t < 1) {
        const nx = (px - o.x) / (d || 1);
        const nz = (pz - o.z) / (d || 1);
        const via = new THREE.Vector3(o.x + nx * (o.r + 1.4), a.y + (b.y - a.y) * t, o.z + nz * (o.r + 1.4));
        return [via];
      }
    }
    return [];
  }

  private join(...parts: THREE.Vector3[][]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const p of parts)
      for (const v of p) {
        const last = out[out.length - 1];
        if (last && last.distanceToSquared(v) < 0.01) continue;
        if (last && last.y === v.y && Math.abs(last.y - this.s.plazaY) < 0.3) out.push(...this.skirt(last, v));
        out.push(v);
      }
    return out;
  }

  // ---- Journeys through the station ----------------------------------------------------------------
  /**
   * From the forecourt out into the town: through a gate in the bollards, then to the autos, the
   * bus stop, or along a footpath near the gate to its far end.
   */
  private streetEnd(): THREE.Vector3[] {
    const s = this.s;
    const r = this.rng;
    const gate = r.pick(s.gates);
    const g = new THREE.Vector3(gate[0] - 0.8, s.plazaY, gate[1]);
    const out = new THREE.Vector3(gate[0] + 1.6, s.plazaY, gate[1] + r.range(-0.8, 0.8));
    const k = r.next();
    if (k < 0.32 && s.autoHeads.length) {
      const [x, z] = r.pick(s.autoHeads);
      return [g, out, new THREE.Vector3(x, -0.42, z + r.range(-0.4, 0.4))];
    }
    if (k < 0.45) {
      const bus = s.spots.filter((p) => p.kind === 'bus');
      if (bus.length) {
        const b = r.pick(bus);
        return [g, out, new THREE.Vector3(b.x + r.range(-2, 2), b.y, b.z)];
      }
    }
    // A footpath passing near this gate; walk along it to one of its ends.
    const near: { w: THREE.Vector3[]; i: number; d: number }[] = [];
    for (const w of s.walks) {
      let bi = 0;
      let bd = Infinity;
      w.forEach((v, i) => {
        const d = (v.x - out.x) ** 2 + (v.z - out.z) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      if (bd < 30 * 30) near.push({ w, i: bi, d: bd });
    }
    if (!near.length) return [g, out];
    const pick = r.pick(near);
    const along = r.chance(0.5) ? pick.w.slice(pick.i) : pick.w.slice(0, pick.i + 1).reverse();
    return [g, out, ...along.map((v) => v.clone())];
  }

  private archPoint(): THREE.Vector3 {
    const [x, z] = this.rng.pick(this.s.arches);
    return new THREE.Vector3(x + this.rng.range(-0.3, 0.3), this.s.hallY, z + this.rng.range(-1.5, 1.5));
  }

  /** From the street, through the hall, to a waiting spot on platform pf. */
  private arrive(pf: number, fromSkywalk = false): void {
    const s = this.s;
    const r = this.rng;
    const spot = s.pfSpot(pf, r);
    const spotV = new THREE.Vector3(spot.x, s.hallY, spot.z);
    let path: THREE.Vector3[];
    if (fromSkywalk) {
      const exits = this.feetOn(null);
      const pfFeet = this.feetOn(FACES[pf].ref, spot);
      if (!exits.length || !pfFeet.length) return;
      path = this.join(this.graphPath(r.pick(exits), pfFeet[0]), [spotV]);
    } else {
      const street = this.streetEnd().reverse();
      const arch = this.archPoint();
      if (pf === 4) path = this.join(street, [arch, s.hallMid(r), s.pf4Edge(r), spotV]);
      else {
        const hallFoot = this.feetOn('hall')[0];
        const pfFeet = this.feetOn(FACES[pf].ref, spot);
        if (hallFoot === undefined || !pfFeet.length) return;
        path = this.join(street, [arch, s.hallMid(r)], this.graphPath(hallFoot, pfFeet[r.int(0, Math.min(1, pfFeet.length - 1))]), [spotV]);
      }
    }
    const p = this.walk(path, 'wait', pf);
    if (p) p.h = spot.h;
  }

  /** From a train's door at pf, over the bridge and out (to the street, the skywalk). */
  private leave(pf: number, door: Pt, delay: number): void {
    const s = this.s;
    const r = this.rng;
    const start = new THREE.Vector3(door[0], s.hallY, door[1]);
    let path: THREE.Vector3[];
    if (pf === 4) path = this.join([start, s.pf4Edge(r), s.hallMid(r), this.archPoint()], this.streetEnd());
    else {
      const feet = this.feetOn(FACES[pf].ref, { x: door[0], z: door[1] });
      if (!feet.length) return;
      const foot = feet[r.chance(0.7) ? 0 : Math.min(1, feet.length - 1)];
      const hallFoot = this.feetOn('hall')[0];
      const streetFeet = this.feetOn(null);
      if (r.chance(0.62) && hallFoot !== undefined) path = this.join([start], this.graphPath(foot, hallFoot), [s.hallMid(r), this.archPoint()], this.streetEnd());
      else if (streetFeet.length) path = this.join([start], this.graphPath(foot, r.pick(streetFeet)));
      else return;
    }
    this.walk(path, 'gone', 0, delay);
  }

  // ---- Setup ---------------------------------------------------------------------------------------
  populate(hour: number): void {
    const s = this.s;
    const r = this.rng;
    for (const p of this.people) p.mode = 'gone';
    for (const pf of [1, 2, 3, 4]) {
      const n = waiting(pf, hour);
      for (let i = 0; i < n; i++) {
        const sp = s.pfSpot(pf, r);
        this.add(sp.x, s.hallY, sp.z, sp.h + r.range(-0.6, 0.6), 'wait', r.chance(0.3) ? 2 : 0, pf);
      }
    }
    for (const seat of s.seats) if (r.chance(0.55)) this.add(seat.x, seat.y, seat.z, seat.h, 'idle', 1);
    for (const st of s.stalls) for (let k = 0; k < r.int(1, 3); k++) this.add(st.x + r.range(-0.8, 0.8), s.hallY, st.z + r.range(-0.3, 0.3), st.h + Math.PI + r.range(-0.3, 0.3), 'idle', r.chance(0.3) ? 2 : 0);
    // Queues at the ticket windows, people at the ATVMs, reading the board.
    s.windows.forEach((w) => {
      const n = r.int(2, 6);
      for (let k = 0; k < n; k++) this.add(w.x - Math.sin(w.h) * k * 0.72 + r.range(-0.08, 0.08), s.hallY, w.z - Math.cos(w.h) * k * 0.72, w.h + r.range(-0.2, 0.2), 'idle', k > 0 && r.chance(0.3) ? 2 : 0);
    });
    s.atvms.forEach((a) => {
      this.add(a.x, s.hallY, a.z, a.h, 'idle', 0);
      if (r.chance(0.6)) this.add(a.x - Math.sin(a.h) * 0.8, s.hallY, a.z - Math.cos(a.h) * 0.8, a.h, 'idle', 2);
    });
    for (let k = 0; k < 10; k++) {
      const p = s.hallMid(r);
      this.add(p.x, s.hallY, p.z, s.windows[0].h + r.range(-0.8, 0.8), 'idle', r.chance(0.4) ? 2 : 0);
    }
    // The arcade steps and the forecourt.
    for (let k = 0; k < 24; k++) {
      const st = s.stepSeat(r);
      this.add(st.x, st.y, st.z, st.h, 'idle', 1);
    }
    for (const sp of s.spots) {
      if (sp.kind === 'steps') {
        if (r.chance(0.35)) this.add(sp.x, sp.y - 0.12, sp.z, Math.PI + r.range(-0.3, 0.3), 'idle', 1);
        continue;
      }
      if (sp.pose === 1) {
        this.add(sp.x, sp.y, sp.z, sp.h, 'idle', 1);
        continue;
      }
      const n = sp.kind === 'forecourt' ? r.int(1, 3) : 1;
      const jit = sp.pose === undefined ? 0.8 : 0.15;
      for (let k = 0; k < n; k++) this.add(sp.x + r.range(-jit, jit), sp.y, sp.z + r.range(-jit, jit), sp.h + r.range(-0.5, 0.5), 'idle', sp.pose ?? (r.chance(0.35) ? 2 : 0));
    }
    // Some already on their way.
    for (let k = 0; k < 40; k++) this.spawnFlow(hour, true);
  }

  /** One more person moving through (street walkers, arrivals). */
  private spawnFlow(hour: number, anywhere = false): void {
    const r = this.rng;
    const k = r.next();
    if (k < 0.45) {
      // Along a footpath, end to end (one near where you are, mostly).
      const w = this.pickWalk();
      const path = r.chance(0.5) ? w : [...w].reverse();
      const start = anywhere ? r.int(0, path.length - 2) : 0;
      this.walk(path.slice(start).map((v) => v.clone()), 'gone');
    } else {
      // Into the station for a train (towards town in the morning, either way later).
      const pf = r.pick([4, 4, 2, 2, 1, 3]);
      if (this.count(pf) < waiting(pf, hour) * 1.1) this.arrive(pf, r.chance(0.2));
    }
    void anywhere;
  }

  private pickWalk(): THREE.Vector3[] {
    const r = this.rng;
    for (let k = 0; k < 8; k++) {
      const w = r.pick(this.s.walks);
      const q = w[Math.floor(w.length / 2)];
      if ((q.x - this.cam.x) ** 2 + (q.z - this.cam.z) ** 2 < 200 * 200 || (w[0].x - this.cam.x) ** 2 + (w[0].z - this.cam.z) ** 2 < 160 * 160) return w;
    }
    return r.pick(this.s.walks);
  }

  /** Someone walks this path now (local points), then goes on their way or stands about. */
  walkPath(path: THREE.Vector3[], then: 'gone' | 'idle' = 'gone', speed = 1.35): boolean {
    const p = this.walk(path, then);
    if (p) p.speed = speed;
    return !!p;
  }

  /**
   * Distance to the nearest person ahead of (x, z, heading h) within `half` of that line, out to
   * `range` (local), for a vehicle that must not run them down.
   */
  blocking(x: number, z: number, h: number, range: number, half: number): number {
    const dx0 = Math.sin(h);
    const dz0 = Math.cos(h);
    let best = Infinity;
    for (const p of this.people) {
      if (p.mode === 'gone' || (p.mode === 'walk' && p.delay > 0)) continue;
      const dx = p.x - x;
      const dz = p.z - z;
      const along = dx * dx0 + dz * dz0;
      if (along <= 0 || along > range) continue;
      // Walkers anywhere across its width; someone standing about only right in its way.
      const lat = Math.abs(dx * dz0 - dz * dx0);
      if (lat > (p.mode === 'idle' || p.mode === 'wait' ? 0.75 : half + 0.3)) continue;
      if (Math.abs(p.y - -0.4) > 0.9) continue;
      best = Math.min(best, along);
    }
    return best;
  }

  private count(pf: number): number {
    let n = 0;
    for (const p of this.people) if (p.pf === pf && (p.mode === 'wait' || (p.mode === 'walk' && p.then === 'wait'))) n++;
    return n;
  }

  // ---- Train events ----------------------------------------------------------------------------------
  trainArrived(pf: number, doors: Pt[], hour: number): void {
    const n = alighting(pf, hour);
    for (let i = 0; i < n; i++) this.leave(pf, this.rng.pick(doors), this.rng.range(0, 7));
    // The waiting board.
    for (const p of this.people) {
      if (p.mode !== 'wait' || p.pf !== pf || !p.board) continue;
      let best: Pt | null = null;
      let bd = 16 * 16;
      for (const d of doors) {
        const dd = (d[0] - p.x) ** 2 + (d[1] - p.z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = d;
        }
      }
      if (best) {
        p.mode = 'board';
        p.target = { x: best[0], z: best[1], car: -1 };
        p.delay = 1.5 + this.rng.range(0, 5);
      }
    }
  }

  peopleNear(p: THREE.Vector3, r: number, anchor: THREE.Vector3): { pos: THREE.Vector3; walking: boolean }[] {
    const out: { pos: THREE.Vector3; walking: boolean }[] = [];
    for (const q of this.people) {
      if (q.mode === 'gone' || q.delay > 0) continue;
      const x = q.x + anchor.x;
      const z = q.z + anchor.z;
      if ((x - p.x) ** 2 + (z - p.z) ** 2 < r * r) out.push({ pos: new THREE.Vector3(x, q.y, z), walking: q.mode === 'walk' || q.mode === 'board' });
    }
    return out;
  }

  get count4(): number {
    return this.count(4);
  }

  // ---- Per frame -------------------------------------------------------------------------------------
  update(dt: number, hour: number, camLocal: THREE.Vector3, ride: { doorsWorld: () => { x: number; z: number; car: number }[]; stopped: boolean; doorsOpen: boolean } | null): void {
    this.cam.copy(camLocal);
    // Keep the flows going.
    this.spawnT += dt;
    while (this.spawnT > 0.55) {
      this.spawnT -= 0.55;
      this.spawnFlow(hour);
    }
    // The ride's train at PF 4: its waiting crowd walks to the nearest doors.
    if (ride && ride.stopped && ride.doorsOpen) {
      const doors = ride.doorsWorld();
      for (const p of this.people) {
        if (p.mode !== 'wait' || p.pf !== 4 || !p.board) continue;
        let best: { x: number; z: number; car: number } | null = null;
        let bd = 14 * 14;
        for (const d of doors) {
          const dd = (d.x - p.x) ** 2 + (d.z - p.z) ** 2;
          if (dd < bd) {
            bd = dd;
            best = d;
          }
        }
        if (best) {
          p.mode = 'board';
          p.target = best;
          p.delay = this.rng.range(0, 3);
        }
      }
    }
    const R = this.riders;
    const RF = this.ridersFar;
    R.begin();
    RF.begin();
    const far2 = 135 * 135;
    const near2 = 24 * 24;
    for (const p of this.people) {
      if (p.mode === 'gone') continue;
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.mode === 'walk') continue;
      }
      let amp = 0;
      if (p.mode === 'walk') {
        let step = p.speed * (1 + 0.12 * WEATHER.amount) * dt;
        let guard = 0;
        while (step > 1e-6 && p.pi < p.path.length && guard++ < 64) {
          const t = p.path[p.pi];
          const dx = t.x - p.x;
          const dz = t.z - p.z;
          const dy = t.y - p.y;
          const dist = Math.hypot(dx, dz, dy * 0.5);
          if (dist < 1e-4) {
            p.pi++;
            continue;
          }
          const k = Math.min(1, step / dist);
          p.x += dx * k;
          p.y += dy * k;
          p.z += dz * k;
          if (Math.hypot(dx, dz) > 0.05) p.h = Math.atan2(dx, dz);
          step -= dist * k;
          if (k >= 1) p.pi++;
        }
        p.phase += (p.speed * dt * Math.PI * 2) / 1.45;
        amp = 1;
        if (p.pi >= p.path.length) {
          if (p.then === 'wait') {
            p.mode = 'wait';
            p.pose = this.rng.chance(0.3) ? 2 : 0;
            p.board = this.rng.chance(0.85);
          } else if (p.then === 'idle') p.mode = 'idle';
          else {
            p.mode = 'gone';
            continue;
          }
        }
      } else if (p.mode === 'board' && p.target) {
        if (p.delay > 0) {
          /* waiting their turn at the door */
        } else {
          const dx = p.target.x - p.x;
          const dz = p.target.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.4) {
            p.mode = 'gone';
            if (p.target.car === 1) this.boardedHero.push(p.look);
            continue;
          }
          const step = Math.min(dist, p.speed * 1.1 * dt);
          p.x += (dx / dist) * step;
          p.z += (dz / dist) * step;
          p.h = Math.atan2(dx, dz);
          p.phase += (step * Math.PI * 2) / 1.45;
          amp = 1;
          if (dist < 1.2) p.y = this.s.hallY + (1 - dist / 1.2) * 0.28;
        }
      }
      const d2 = (p.x - camLocal.x) ** 2 + (p.z - camLocal.z) ** 2;
      if (d2 > far2) continue;
      if (d2 < 0.3 && Math.abs(p.y - camLocal.y + 1.6) < 1) continue;
      // Stepping aboard, the umbrella folds over the last few metres to the door.
      const pose = p.mode === 'board' && p.target ? closingPose(0, 1 - (Math.hypot(p.target.x - p.x, p.target.z - p.z) - 0.6) / 3.4) : p.mode === 'walk' ? 0 : p.pose;
      (d2 < near2 ? R : RF).put(p.look, p.x, p.y, p.z, p.h, p.phase, amp, pose);
    }
    R.end();
    RF.end();
  }
}

// -------------------------------------------------------------------------------------------------
type Kind = 'auto' | 'bike' | 'scooter' | 'car' | 'suv' | 'cab' | 'bus' | 'tempo';
/** Autos nearer than this (m) get the detailed body; further off, the plain one (AutoShell 'far'). */
const AUTO_NEAR = 60;
const LEN: Record<Kind, number> = { auto: 2.6, bike: 1.9, scooter: 1.8, car: 3.9, suv: 4.4, cab: 4.0, bus: 11, tempo: 5 };
/** Half widths (m). */
const HALF: Record<Kind, number> = { auto: 0.66, bike: 0.36, scooter: 0.36, car: 0.88, suv: 0.95, cab: 0.88, bus: 1.3, tempo: 0.95 };

export type TrafficMix = 'station' | 'city' | 'lane';

interface Route {
  pts: Pt[];
  cum: number[];
  length: number;
  speed: number;
  lanes: number[];
  mix: TrafficMix;
  /** Stop lines on this route (s) and the signal phase that holds them. */
  stops: { s: number; phase: 0 | 1 }[];
}

interface Veh {
  route: number;
  s: number;
  v: number;
  lane: number;
  kind: Kind;
  color: THREE.Color;
  riders: Look[];
  want: number;
  /** Where it was drawn last frame (local), its heading. */
  x: number;
  z: number;
  h: number;
  id: number;
}

/** Something on the road the traffic must not drive through (the ridden auto). */
export interface RoadObstacle {
  x: number;
  z: number;
  h: number;
  len: number;
  half: number;
}

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Is b in front of a, within a's lane (reach: b's sideways extent as seen by a, plus a's half width)? */
function inFront(ax: number, az: number, ah: number, aHalf: number, bx: number, bz: number, bh: number, bHalf: number, bLen: number, range: number): number {
  const dx0 = Math.sin(ah);
  const dz0 = Math.cos(ah);
  const dx = bx - ax;
  const dz = bz - az;
  const along = dx * dx0 + dz * dz0;
  if (along <= 0 || along > range) return -1;
  const dh = Math.abs(Math.sin(wrapA(bh - ah)));
  const reach = bHalf * (1 - dh) + (bLen / 2) * dh;
  if (Math.abs(dx * dz0 - dz * dx0) > reach + aHalf + 0.2) return -1;
  return along;
}

/**
 * Vehicles on the streets round the station and along the auto ride, with riders on the
 * two-wheelers and in the autos. Each keeps its lane on its route and follows whatever is ahead of
 * it in that lane (on any route), stops at the junction's stop lines on red, and does not drive
 * through the ridden auto.
 */
export class MiraTraffic {
  readonly group = new THREE.Group();
  readonly riders: Riders;
  private routes: Route[] = [];
  private vehicles: Veh[] = [];
  private meshes = new Map<Kind, THREE.InstancedMesh>();
  private autoFar: THREE.InstancedMesh | null = null;
  private readonly rng = new RNG(4242);
  private readonly m = new THREE.Matrix4();
  /** Obstacles this frame (set by the ride). */
  obstacles: RoadObstacle[] = [];
  /** The junction's lights (0 red, 1 amber, 2 green per phase). */
  signal: { state(phase: 0 | 1): 0 | 1 | 2 } | null = null;
  private grid = new Map<number, Veh[]>();

  constructor(av: AmbientVolume, mat: THREE.Material, routes: { pts: Pt[]; speed: number; lanes: number[]; mix: TrafficMix; count?: number }[]) {
    this.group.name = 'mira-traffic';
    this.riders = new Riders(av, 260, { lod: 1, shadows: false });
    this.group.add(this.riders.group);
    const geos: Record<Kind, THREE.BufferGeometry> = {
      auto: autoRickshaw(),
      bike: twoWheeler(false),
      scooter: twoWheeler(true),
      car: carGeo('car'),
      suv: carGeo('suv'),
      cab: carGeo('cab'),
      bus: mbmtBus(),
      tempo: tempo(),
    };
    for (const r of routes) {
      const cum = [0];
      for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      this.routes.push({ pts: r.pts, speed: r.speed, lanes: r.lanes, mix: r.mix, cum, length: cum[cum.length - 1], stops: [] });
    }
    const rng = this.rng;
    const looks: Look[] = [];
    for (let i = 0; i < 60; i++) looks.push(makeLook(rng, 0.5));
    const BODY = ['#f2f2ef', '#c9ccce', '#8e9296', '#2a2d31', '#7a1d1d', '#1d3f7a', '#b7b09e', '#e8e4da'].map((c) => new THREE.Color(c));
    const BIKE = ['#161616', '#7a1414', '#1b3d8a', '#5a5f63', '#dcdcd6', '#20262e'].map((c) => new THREE.Color(c));
    this.routes.forEach((r, ri) => {
      const spec = routes[ri];
      const n = spec.count ?? Math.round(r.length / (r.mix === 'station' ? 26 : 34));
      for (let k = 0; k < n; k++) {
        const x = rng.next();
        const kind: Kind =
          r.mix === 'lane'
            ? x < 0.42 ? 'auto' : x < 0.72 ? 'bike' : 'scooter'
            : r.mix === 'station'
              ? x < 0.5 ? 'auto' : x < 0.66 ? 'bike' : x < 0.76 ? 'scooter' : x < 0.88 ? 'car' : x < 0.93 ? 'cab' : x < 0.97 ? 'bus' : 'tempo'
              : x < 0.44 ? 'auto' : x < 0.58 ? 'bike' : x < 0.68 ? 'scooter' : x < 0.82 ? 'car' : x < 0.88 ? 'suv' : x < 0.92 ? 'cab' : x < 0.96 ? 'bus' : 'tempo';
        const riders: Look[] = [];
        if (kind === 'bike' || kind === 'scooter') {
          riders.push(rng.pick(looks));
          if (rng.chance(0.3)) riders.push(rng.pick(looks));
        } else if (kind === 'auto') {
          riders.push(rng.pick(looks));
          for (let q = 0; q < rng.int(0, 2); q++) riders.push(rng.pick(looks));
        }
        const want = r.speed * (kind === 'bus' ? 0.8 : kind === 'bike' || kind === 'scooter' ? 1.15 : kind === 'tempo' ? 0.85 : 1) * rng.range(0.85, 1.1);
        const v: Veh = { id: this.vehicles.length, route: ri, s: ((k + rng.range(0, 0.6)) / n) * r.length, v: want, lane: rng.pick(r.lanes) + rng.range(-0.3, 0.3), kind, color: kind === 'bike' || kind === 'scooter' ? rng.pick(BIKE) : kind === 'cab' ? new THREE.Color('#e8e4da') : kind === 'auto' ? new THREE.Color().setScalar(rng.range(0.85, 1.05)) : rng.pick(BODY), riders, want, x: 0, z: 0, h: 0 };
        const p = this.at(r, v.s, v.lane);
        v.x = p.x;
        v.z = p.z;
        v.h = p.h;
        this.vehicles.push(v);
      }
    });
    const counts = new Map<Kind, number>();
    for (const v of this.vehicles) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
    for (const k of Object.keys(geos) as Kind[]) {
      const n = counts.get(k) ?? 0;
      if (!n) continue;
      const mesh = new THREE.InstancedMesh(geos[k], mat, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < n; i++) mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      this.meshes.set(k, mesh);
      this.group.add(mesh);
    }
    // Autos further off than AUTO_NEAR are drawn plainer.
    const na = counts.get('auto') ?? 0;
    if (na) {
      this.autoFar = new THREE.InstancedMesh(autoRickshaw('far'), mat, na);
      this.autoFar.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.autoFar.castShadow = true;
      this.autoFar.receiveShadow = true;
      this.autoFar.frustumCulled = false;
      for (let i = 0; i < na; i++) this.autoFar.setColorAt(i, new THREE.Color(1, 1, 1));
      this.group.add(this.autoFar);
    }
  }

  /** Puts the stop lines on the routes that cross them (within 4 m, running the same way). */
  setStops(stops: { x: number; z: number; h: number; phase: 0 | 1 }[]): void {
    for (const r of this.routes) {
      r.stops = [];
      for (const st of stops) {
        for (let i = 1; i < r.pts.length; i++) {
          const a = r.pts[i - 1];
          const b = r.pts[i];
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((st.x - a[0]) * dx + (st.z - a[1]) * dz) / l2));
          const d = Math.hypot(a[0] + dx * t - st.x, a[1] + dz * t - st.z);
          if (d < 4 && Math.abs(wrapA(Math.atan2(dx, dz) - st.h)) < 0.6) {
            r.stops.push({ s: r.cum[i - 1] + (r.cum[i] - r.cum[i - 1]) * t, phase: st.phase });
            break;
          }
        }
      }
    }
  }

  private at(r: Route, s: number, lane: number): { x: number; z: number; h: number } {
    const S = ((s % r.length) + r.length) % r.length;
    let lo = 0;
    let hi = r.cum.length - 1;
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1;
      if (r.cum[m] <= S) lo = m;
      else hi = m;
    }
    const a = r.pts[lo];
    const b = r.pts[hi];
    const seg = r.cum[hi] - r.cum[lo] || 1;
    const t = (S - r.cum[lo]) / seg;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    // Heading from a chord across the corner, so turns are smooth.
    const p0 = this.raw(r, S - 3);
    const p1 = this.raw(r, S + 3);
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const l = Math.hypot(dx, dz) || 1;
    return { x: x + (dz / l) * lane, z: z - (dx / l) * lane, h: Math.atan2(dx, dz) };
  }

  private raw(r: Route, s: number): Pt {
    const S = Math.max(0, Math.min(r.length, s));
    let i = 1;
    while (i < r.cum.length - 1 && r.cum[i] < S) i++;
    const a = r.pts[i - 1];
    const b = r.pts[i];
    const t = (S - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  private cell(x: number, z: number): number {
    return Math.floor(x / 24) * 100003 + Math.floor(z / 24);
  }

  /**
   * Distance to the nearest vehicle ahead of (x, z, heading h) within a corridor of half width
   * `half` (local), leaving out those that are giving way to it (it is in front of them).
   */
  ahead(x: number, z: number, h: number, range: number, half: number, len = 2.6): number {
    let best = Infinity;
    for (const u of this.vehicles) {
      const dx = u.x - x;
      const dz = u.z - z;
      if (dx * dx + dz * dz > (range + 12) ** 2) continue;
      const along = inFront(x, z, h, half, u.x, u.z, u.h, HALF[u.kind], LEN[u.kind], range + LEN[u.kind] / 2);
      if (along < 0) continue;
      if (inFront(u.x, u.z, u.h, HALF[u.kind], x, z, h, half, len, 32) >= 0) continue;
      const dh = Math.abs(Math.sin(wrapA(u.h - h)));
      best = Math.min(best, along - (LEN[u.kind] / 2) * (1 - dh) - HALF[u.kind] * dh - len / 2);
    }
    return best;
  }

  /** No vehicle within r of the point now or (going as they go) in the next `t` seconds. */
  clear(x: number, z: number, r: number, t: number): boolean {
    for (const u of this.vehicles) {
      const dx = u.x - x;
      const dz = u.z - z;
      if (dx * dx + dz * dz > (r + u.v * t + 12) ** 2) continue;
      for (let k = 0; k <= 4; k++) {
        const tt = (k / 4) * t;
        const px = u.x + Math.sin(u.h) * u.v * tt;
        const pz = u.z + Math.cos(u.h) * u.v * tt;
        if (Math.hypot(px - x, pz - z) < r + LEN[u.kind] / 2) return false;
      }
    }
    return true;
  }

  /** Vehicles near a point (local), for the street sounds. */
  nearby(p: { x: number; z: number }, r: number): { x: number; z: number; speed: number; kind: string }[] {
    const out: { x: number; z: number; speed: number; kind: string }[] = [];
    for (const u of this.vehicles) if ((u.x - p.x) ** 2 + (u.z - p.z) ** 2 < r * r) out.push({ x: u.x, z: u.z, speed: u.v, kind: u.kind });
    return out;
  }

  update(dt: number, camLocal: THREE.Vector3, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    // Who is where (last frame's positions), for following across routes.
    this.grid.clear();
    for (const v of this.vehicles) {
      const k = this.cell(v.x, v.z);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(v);
    }
    for (const v of this.vehicles) {
      const r = this.routes[v.route];
      const dx0 = Math.sin(v.h);
      const dz0 = Math.cos(v.h);
      let gap = Infinity;
      const ci = Math.floor(v.x / 24);
      const cj = Math.floor(v.z / 24);
      for (let i = ci - 1; i <= ci + 1; i++)
        for (let j = cj - 1; j <= cj + 1; j++) {
          const l = this.grid.get(i * 100003 + j);
          if (!l) continue;
          for (const u of l) {
            if (u === v || Math.abs(wrapA(u.h - v.h)) > 0.9) continue;
            const dx = u.x - v.x;
            const dz = u.z - v.z;
            const along = dx * dx0 + dz * dz0;
            if (along <= 0 || along > 32) continue;
            if (Math.abs(dx * dz0 - dz * dx0) > HALF[u.kind] + HALF[v.kind] + 0.2) continue;
            // Converging, each in front of the other: the one with the higher number gives way.
            if (v.id < u.id && inFront(u.x, u.z, u.h, HALF[u.kind], v.x, v.z, v.h, HALF[v.kind], LEN[v.kind], 32) >= 0) continue;
            gap = Math.min(gap, along - (LEN[u.kind] + LEN[v.kind]) / 2);
          }
        }
      for (const o of this.obstacles) {
        const dx = o.x - v.x;
        const dz = o.z - v.z;
        const along = dx * dx0 + dz * dz0;
        if (along <= 0 || along > 32) continue;
        const dh = Math.abs(Math.sin(wrapA(o.h - v.h)));
        const reach = o.half * (1 - dh) + (o.len / 2) * dh;
        if (Math.abs(dx * dz0 - dz * dx0) > reach + HALF[v.kind] + 0.25) continue;
        gap = Math.min(gap, along - LEN[v.kind] / 2 - (o.len / 2) * (1 - dh) - o.half * dh);
      }
      // Red (or amber, when there is room to stop) at a stop line ahead.
      if (this.signal)
        for (const st of r.stops) {
          const ds = (((st.s - v.s) % r.length) + r.length) % r.length;
          if (ds > 45 || ds < LEN[v.kind] / 2 - 0.5) continue;
          const light = this.signal.state(st.phase);
          if (light === 0 || (light === 1 && ds - LEN[v.kind] / 2 > (v.v * v.v) / 7 + 1)) gap = Math.min(gap, ds - LEN[v.kind] / 2 - 0.5 + 2.5);
        }
      const h0 = this.at(r, v.s, 0).h;
      const h1 = this.at(r, v.s + 12, 0).h;
      let dh = Math.abs(h1 - h0);
      if (dh > Math.PI) dh = Math.PI * 2 - dh;
      // Slower on the wet road in the rain (two-wheelers most of all).
      const rain = WEATHER.amount * (v.kind === 'bike' || v.kind === 'scooter' ? 0.24 : 0.15) + WEATHER.heavy * 0.06;
      let target = v.want * (1 - rain) * Math.max(0.3, 1 - dh * 0.9);
      if (gap < 2.5) target = 0;
      else if (gap < 2.5 + v.v * 1.6) target = Math.min(target, (gap - 2.5) / 1.6);
      const acc = target > v.v ? 1.6 : 4.5;
      v.v += Math.sign(target - v.v) * Math.min(Math.abs(target - v.v), acc * dt);
      v.s += v.v * dt;
      if (v.s > r.length) v.s -= r.length;
    }
    const idx = new Map<Kind, number>();
    let nFar = 0;
    const R = this.riders;
    R.begin();
    for (const v of this.vehicles) {
      const r = this.routes[v.route];
      const p = this.at(r, v.s, v.lane);
      v.x = p.x;
      v.z = p.z;
      v.h = p.h;
      const d2 = (p.x - camLocal.x) ** 2 + (p.z - camLocal.z) ** 2;
      const far = v.kind === 'auto' && this.autoFar && d2 > AUTO_NEAR * AUTO_NEAR;
      const mesh = far ? this.autoFar! : this.meshes.get(v.kind)!;
      const i = far ? nFar++ : (idx.get(v.kind) ?? 0);
      if (!far) idx.set(v.kind, i + 1);
      this.m.copy(mat4(p.x, -0.42, p.z, p.h));
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, v.color);
      if (d2 > 150 * 150) continue;
      const s = Math.sin(p.h);
      const c = Math.cos(p.h);
      const put = (lx: number, y: number, lz: number, look: Look, pose: number) => R.put(look, p.x + c * lx + s * lz, -0.42 + y, p.z - s * lx + c * lz, p.h, 0, 0, pose);
      if (v.kind === 'bike' || v.kind === 'scooter') {
        put(0, 0.36, -0.15, v.riders[0], POSE.drive);
        if (v.riders[1]) put(0, 0.4, -0.62, v.riders[1], POSE.sit);
      } else if (v.kind === 'auto') {
        put(0, 0.27, 0.36, v.riders[0], POSE.drive);
        v.riders.slice(1).forEach((l, k) => put(k ? 0.3 : -0.3, 0.24, -0.76, l, POSE.sit));
      }
    }
    R.end();
    for (const [k, mesh] of this.meshes) {
      mesh.count = idx.get(k) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (this.autoFar) {
      this.autoFar.count = nFar;
      this.autoFar.instanceMatrix.needsUpdate = true;
      if (this.autoFar.instanceColor) this.autoFar.instanceColor.needsUpdate = true;
    }
  }
}
