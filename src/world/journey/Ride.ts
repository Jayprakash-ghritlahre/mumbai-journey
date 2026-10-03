import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { buildHeroCar, cabinLit, type HeroCar } from '../../entities/train/HeroCar';
import { Riders } from '../../entities/crowd/Riders';
import { POSE, makeLook, type Look } from '../../entities/crowd/Looks';
import { CAR } from '../../entities/train/Livery';
import { A_BRAKE, ARRIVAL_SECONDS, FAR, V_IN, type FreeTrain } from '../../entities/train/TrainSystem';
import { fmtTime } from '../../entities/train/Timetable';
import type { Churchgate } from '../churchgate/Churchgate';
import type { StretchKey } from './Journey';
import type { Halt, Railway } from './Railway';
import type { DoorEvent } from './HaltLife';

const CARS = 12;
/** The ridden car: second from the Churchgate end (LOCAL_TRAIN.md §5). */
export const HERO_CAR = 1;
/** Churchgate platform the ride arrives on (view index 2). */
const PF = 3;
/** Station trains: car i centre behind the lead end. */
const carBack = (i: number) => CAR.length / 2 + 0.62 + i * CAR.pitch;
/** Half-turned like the station trains: car 0 and the odd trailers/motors. */
const flipped = (i: number) => i === 0 || (i !== CARS - 1 && i % 2 === 1);

interface Phase {
  dur: number;
  a: number;
}

/** A stop on the way (Borivali, Dadar; HALTS.md): the train stands from leg time `at` for `dwell` s. */
export interface HaltStop {
  halt: Halt;
  at: number;
  dwell: number;
  /** Lead end d while it stands. */
  lead: number;
  /** Next station once it has left. */
  after: [string, string];
}

/** Getting off or on at a stop (index of the leg, the door, τ when crossing the threshold). */
interface Hop {
  leg: number;
  door: number;
  tau: number;
  /** Leavers: where they wait in the vestibule, and when they set off for it. */
  qx: number;
  qz: number;
  t0: number;
}

interface Stander {
  x: number;
  z: number;
  h: number;
  look: Look;
  pose: number;
  came?: Hop;
  gone?: Hop;
}

export interface Leg {
  key: StretchKey;
  /** Place card shown as the leg begins. */
  title: [string, string, string];
  d0: number;
  v0: number;
  phases: Phase[];
  duration: number;
  /** Real seconds between the previous leg's end and this one's start (the dissolve). */
  skip: number;
  /** Next stop on the car's LED display. */
  next: [string, string];
  /** Door leaves (0 closed … 1 open) against leg time. */
  doors: (t: number) => number;
  /** The final leg hands the train to Churchgate's PF 3 arrival (from `handoverAt` seconds). */
  handoverAt?: number;
  stop?: HaltStop;
}

/** Another local on the line: passing the other way, or running alongside. */
interface Passer {
  line: number;
  /** Lead end d at leg time t. */
  lead: (t: number) => number;
  dir: 1 | -1;
  rows: number[];
  train: FreeTrain;
}

const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function motion(leg: Leg, t: number): { d: number; v: number; a: number } {
  let d = leg.d0;
  let v = leg.v0;
  let rest = Math.max(0, t);
  for (const ph of leg.phases) {
    const dt = Math.min(rest, ph.dur);
    d += v * dt + 0.5 * ph.a * dt * dt;
    v += ph.a * dt;
    rest -= dt;
    if (rest <= 0) return { d, v, a: dt < ph.dur ? ph.a : 0 };
  }
  return { d: d + v * rest, v, a: 0 };
}

/**
 * The Churchgate-bound fast local the player rides (LOCAL_TRAIN.md §4–5): a controlled journey
 * along the real alignment in five legs joined by dissolves. Drives the 12-car rake (a free train
 * of the TrainSystem, with car 1 drawn in detail by HeroCar), its sway, doors, LED display and
 * passengers, other locals on the line, and the hand-over to Churchgate's PF 3 arrival.
 */
export class Ride {
  readonly legs: Leg[];
  readonly hero: HeroCar;
  /** World matrix of the ridden car's body, unflipped: +z towards Churchgate, +x to the right of +o. */
  readonly frame = new THREE.Matrix4();
  /** Group placed by `frame` (people and cameras in the car use it). */
  readonly inside = new THREE.Group();
  /** Figures in the ridden car. */
  readonly riders: Riders;
  /** Figures in the other cars and the passing trains (anchored near the train). */
  readonly others: Riders;
  private readonly othersAnchor = new THREE.Group();
  leg = 0;
  t = 0;
  active = false;
  /** Seconds of ride clock before each leg's start (legs and skips), for the clock. */
  private readonly clockAt: number[] = [];
  private rake: FreeTrain;
  private passers: Passer[] = [];
  private readonly rng = new RNG(4040);
  private readonly seated: { x: number; z: number; h: number; look: Look }[] = [];
  private readonly standers: Stander[] = [];
  /** Who gets off and on the ridden car at each stop (by leg index). */
  private readonly exchanges = new Map<number, { out: DoorEvent[]; in: DoorEvent[] }>();
  private readonly hangers: { x: number; z: number; h: number; look: Look; lean: number }[] = [];
  private readonly otherLooks: Look[] = [];
  /** Current state (for cameras, audio, HUD). */
  readonly state = { d: 0, v: 0, a: 0, lat: 0, doors: 0, stopped: false };
  private handedOver = false;
  private lastLed = '';
  private time = 0;

  constructor(
    private readonly world: Churchgate,
    private readonly railway: Railway,
  ) {
    const r = railway;
    const u = (x: number) => r.dOfU(x);
    const dm = r.dMiraRoad;
    // ---- Legs (distances from OSM; speeds and timings ⚠ estimates) ----------------------------
    const accD = 0.5 * 0.55 * (20 / 0.55) ** 2;
    const endA = u(38250);
    const cruiseA = (endA - (dm + accD)) / 20;
    const arrT = 14 + 24;
    const dwell = 32;
    const depT = arrT + dwell;
    const e1 = r.dChurchgate - FAR - 185.5 - u(2350);
    const tHand = e1 / 15 + 14;
    /**
     * A stop at a halt: running in at 17 m/s, braking hard along the platform ⚠, standing with the
     * lead end near the Churchgate end, then away. Doors: open while running; slid shut coming in,
     * open at the stop, shut to start, pushed open again as soon as it rolls (a stylisation, as at
     * Mira Road: on non-AC locals they mostly stay open).
     */
    const haltLeg = (key: 'BO' | 'DA', title: [string, string, string], dwell: number, after: [string, string]): Leg => {
      const h = r.halts.find((x) => x.key === key)!;
      const vIn = 17;
      const aB = 0.55;
      const lead = h.d + 138;
      const cruise1 = 22;
      const brakeT = vIn / aB;
      const accT = 20 / aB;
      const cruise2 = 12;
      const at = cruise1 + brakeT;
      const dep = at + dwell;
      return {
        key,
        title,
        d0: lead - (vIn * vIn) / (2 * aB) - vIn * cruise1,
        v0: vIn,
        phases: [
          { dur: cruise1, a: 0 },
          { dur: brakeT, a: -aB },
          { dur: dwell, a: 0 },
          { dur: accT, a: aB },
          { dur: cruise2, a: 0 },
        ],
        duration: dep + accT + cruise2,
        skip: 0,
        next: [h.deva, h.name.toUpperCase()],
        doors: (t) => 1 - sm(cruise1 + 2, cruise1 + 4.5, t) + sm(at + 0.6, at + 2.6, t) * (1 - sm(dep - 4, dep - 1.5, t)) + sm(dep + 6, dep + 8.5, t),
        stop: { halt: h, at, dwell, lead, after },
      };
    };
    const BO = haltLeg('BO', ['Borivali', 'बोरीवली', 'Platform 5 · the Churchgate fast stops'], 28, ['अंधेरी', 'ANDHERI']);
    const DA = haltLeg('DA', ['Dadar', 'दादर', 'Platform 4 · change here for the Central line'], 32, ['मुंबई सेंट्रल', 'MUMBAI CENTRAL']);
    this.legs = [
      {
        key: 'A',
        title: ['Mira Road', 'मीरा रोड', 'Churchgate fast · Western Railway'],
        d0: dm - (12 * 14 + 144),
        v0: 12,
        phases: [
          { dur: 14, a: 0 },
          { dur: 24, a: -0.5 },
          { dur: dwell, a: 0 },
          { dur: 20 / 0.55, a: 0.55 },
          { dur: cruiseA, a: 0 },
        ],
        duration: arrT + dwell + 20 / 0.55 + cruiseA,
        skip: 0,
        next: ['दहिसर', 'DAHISAR'],
        // Closed coming in; open at the stop; shut for the start; slid open again once running.
        doors: (t) => sm(arrT + 0.6, arrT + 2.6, t) * (1 - sm(depT - 4, depT - 1.5, t)) + sm(depT + 16, depT + 18.5, t),
      },
      BO,
      {
        key: 'B',
        title: ['Malad', 'मालाड', 'Past Malad · the suburbs'],
        d0: u(30150),
        v0: 21,
        phases: [{ dur: (u(28550) - u(30150)) / 21, a: 0 }],
        duration: (u(28550) - u(30150)) / 21,
        skip: (38250 - 30150) / 10,
        next: ['अंधेरी', 'ANDHERI'],
        doors: () => 1,
      },
      {
        key: 'C',
        title: ['Mahim Creek', 'माहीम खाडी', 'Out of Bandra'],
        d0: u(14330),
        v0: 12,
        phases: [
          { dur: 20, a: 0.4 },
          { dur: (u(13300) - u(14330) - 240) / 20, a: 0 },
        ],
        duration: 20 + (u(13300) - u(14330) - 240) / 20,
        skip: (28550 - 14330) / 10,
        next: ['दादर', 'DADAR'],
        doors: () => 1,
      },
      DA,
      {
        key: 'D',
        title: ['Lower Parel', 'लोअर परळ', 'The old mill lands'],
        d0: u(7950),
        v0: 20,
        phases: [{ dur: (u(6700) - u(7950)) / 20, a: 0 }],
        duration: (u(6700) - u(7950)) / 20,
        skip: (13300 - 7950) / 10,
        next: ['मुंबई सेंट्रल', 'MUMBAI CENTRAL'],
        doors: () => 1,
      },
      {
        key: 'E',
        title: ['Charni Road', 'चर्नी रोड', 'The last stretch to Churchgate'],
        d0: u(2350),
        v0: 15,
        phases: [
          { dur: e1 / 15, a: 0 },
          { dur: 14, a: -0.25 },
          { dur: (FAR - (V_IN * V_IN) / (2 * A_BRAKE)) / V_IN, a: 0 },
          { dur: V_IN / A_BRAKE, a: -A_BRAKE },
          { dur: 40, a: 0 },
        ],
        duration: tHand + ARRIVAL_SECONDS + 40,
        skip: (6700 - 2350) / 10,
        next: ['चर्चगेट', 'CHURCHGATE'],
        doors: () => 1,
        handoverAt: tHand,
      },
    ];
    // The dissolves into and out of the stops skip the real distance at ≈ 10 m/s (stops included) ⚠.
    this.legs.forEach((l, i) => {
      const prev = this.legs[i - 1];
      if (prev && (l.stop || prev.stop)) l.skip = Math.max(30, (r.uOfD(motion(prev, prev.duration).d) - r.uOfD(l.d0)) / 10);
    });
    let acc = 0;
    for (const l of this.legs) {
      acc += l.skip;
      this.clockAt.push(acc);
      acc += l.duration;
    }

    // ---- The rake ----------------------------------------------------------------------------------
    const trains = world.trains;
    trains.setRow(PF - 1, HERO_CAR, 0);
    this.rake = { cars: Array.from({ length: CARS }, () => new THREE.Matrix4()), rows: trains.rowsOf(PF - 1), doorOpen: 0, skip: HERO_CAR, lead: 'first', visible: false };
    trains.free.push(this.rake);
    this.hero = buildHeroCar(world.tf, world.mats);
    this.hero.group.visible = false;
    world.journey.group.add(this.hero.group);
    this.inside.matrixAutoUpdate = false;
    this.inside.visible = false;
    world.journey.group.add(this.inside);
    this.riders = new Riders(world.av, 90, { patch: (m) => cabinLit(m, this.hero.cabin), indoor: true });
    this.inside.add(this.riders.group);
    this.others = new Riders(world.av, 700, { lod: 1, shadows: false });
    this.othersAnchor.add(this.others.group);
    world.journey.group.add(this.othersAnchor);
    for (let i = 0; i < 48; i++) this.otherLooks.push(makeLook(this.rng, 0.35));
    this.seatPassengers();
    this.planExchanges();
  }

  // ---------------------------------------------------------------------------------------------
  /** Ride clock (s) at leg time t: legs and dissolves so far. */
  clock(leg = this.leg, t = this.t): number {
    return this.clockAt[leg] + t;
  }

  get current(): Leg {
    return this.legs[this.leg];
  }

  /** Where the ride stands in the film/interactive schedule. */
  set(leg: number, t: number): void {
    const changed = leg !== this.leg || !this.active;
    this.leg = leg;
    this.t = t;
    if (changed) this.enterLeg();
  }

  start(): void {
    this.active = true;
    this.handedOver = false;
    const trains = this.world.trains;
    trains.held.add(PF);
    trains.skipCar.delete(PF);
    trains.doorsOpen.delete(PF);
    trains.scripted.delete(PF);
    this.hero.group.visible = true;
    this.inside.visible = true;
    this.rake.visible = true;
    this.set(0, 0);
    this.enterLeg();
  }

  /** The train has gone: hide the car and give PF 3 back to the timetable. */
  private finish(): void {
    this.active = false;
    const mira = this.world.journey.mira;
    if (mira) {
      mira.rideTrain = null;
      mira.holdLine1 = false;
    }
    for (const p of this.passers) p.train.visible = false;
    this.hero.group.visible = false;
    this.inside.visible = false;
    this.rake.visible = false;
    this.camRequest = null;
    const trains = this.world.trains;
    trains.skipCar.delete(PF);
    trains.doorsOpen.delete(PF);
    trains.scripted.delete(PF);
    trains.held.delete(PF);
  }

  /**
   * The train left Mira Road without the player (exploring the station): put it away but leave
   * the scenery as it is.
   */
  park(): void {
    if (this.active) this.finish();
  }

  /** Ends the ride now (menu, end of film); at Churchgate the station's timetable takes over. */
  stop(): void {
    this.finish();
    this.world.journey.show(null);
    this.world.setFar(false);
    this.others.begin();
    this.others.end();
  }

  /** Called whenever the leg changes: scenery, far mode, other trains, the PF 3 script. */
  private enterLeg(): void {
    const leg = this.current;
    const w = this.world;
    const far = leg.key !== 'E';
    w.journey.show(far ? leg.key : null);
    w.setFar(far);
    // Anchor the other trains' figures near the leg (float precision).
    const a = this.railway.path.at(leg.d0 + 600);
    this.othersAnchor.position.set(a.x, 0, a.z);
    this.setupPassers();
    const trains = w.trains;
    if (leg.handoverAt !== undefined) {
      // Churchgate: PF 3's arrival is this train. Script it from the ride clock.
      const hourNow = this.hourAt(this.leg, this.t);
      const arrive = hourNow + (leg.handoverAt + ARRIVAL_SECONDS - this.t) / 3600;
      trains.script(PF, arrive, arrive + 420 / 3600);
      trains.held.delete(PF);
      trains.doorsOpen.add(PF);
      trains.skipCar.set(PF, HERO_CAR);
    } else {
      trains.held.add(PF);
      trains.skipCar.delete(PF);
    }
    // At a halt: the station's crowd and indicators for this stop.
    const stop = leg.stop;
    const station = stop ? w.journey.halt(leg.key) : null;
    if (stop && station) {
      const ex = this.exchanges.get(this.leg) ?? { out: [], in: [] };
      station.life.configure({ lead: stop.lead - stop.halt.d, dwell: stop.dwell, cars: CARS, heroCar: HERO_CAR, carBack, heroOut: ex.out, heroIn: ex.in });
      const hr = this.hourAt(this.leg, stop.at);
      const bo = leg.key === 'BO';
      station.setIndicators([
        [String(stop.halt.pf), `C  ${fmtTime(hr)}  F 12`],
        [bo ? '6' : '5', bo ? `A  ${fmtTime(hr + 3 / 60)}  S 12` : `C  ${fmtTime(hr + 6 / 60)}  F 15`],
      ]);
    }
  }

  /** Game hour the ride shows at (leg, t); set by the owner at start. */
  startHour = 17.2;
  hourAt(leg: number, t: number): number {
    return this.startHour + this.clock(leg, t) / 3600;
  }

  private setupPassers(): void {
    for (const p of this.passers) {
      p.train.visible = false;
      const i = this.world.trains.free.indexOf(p.train);
      if (i >= 0) this.world.trains.free.splice(i, 1);
    }
    this.passers = [];
    const leg = this.current;
    const mk = (line: number, dir: 1 | -1, lead: (t: number) => number) => {
      const rows = Array.from({ length: CARS }, (_, i) => (i === 4 || i === 8 ? 4 : i === 2 || i === 9 ? 3 : this.rng.chance(0.2) ? this.rng.int(5, 7) : this.rng.int(0, 2)));
      const train: FreeTrain = { cars: Array.from({ length: CARS }, () => new THREE.Matrix4()), rows, doorOpen: 1, skip: -1, lead: 'first', visible: false };
      this.world.trains.free.push(train);
      this.passers.push({ line, dir, lead, rows, train });
    };
    const heroAt = (t: number) => motion(leg, t).d - carBack(HERO_CAR);
    // A down local meets the car at leg time tm (closing at v + 20 m/s).
    const meet = (line: number, tm: number, v = 20) => {
      const dm = heroAt(tm);
      mk(line, -1, (t) => dm - v * (t - tm));
    };
    switch (leg.key) {
      case 'A':
        meet(1, 112);
        break;
      case 'B':
        meet(1, 20);
        // A slow local alongside on the next line: slowly overtaken (the classic race).
        mk(2, 1, (t) => motion(leg, 0).d + 60 + 19 * t);
        meet(3, 58, 22);
        break;
      case 'C':
        meet(1, 34);
        break;
      case 'D':
        meet(2, 22);
        mk(1, 1, (t) => motion(leg, 0).d - 40 + 18.4 * t);
        break;
      case 'E':
        meet(1, 40, 14);
        break;
      case 'BO': {
        const st = leg.stop!;
        const h = st.halt.d;
        // An Andheri slow standing at PF 6; a Virar fast running into PF 4 while we stand.
        mk(5, 1, () => h + 146);
        mk(1, -1, (t) => stopMotion(t, h - 142, st.at + 9, st.at + st.dwell + 30, -1));
        meet(2, st.at + st.dwell + 30, 22);
        break;
      }
      case 'DA': {
        const st = leg.stop!;
        const h = st.halt.d;
        // A 15-car fast at PF 5; a Virar fast pulling out of PF 3 while we stand ("are we moving?");
        // on the Central side, a local coming in.
        mk(5, 1, () => h + 146);
        mk(1, -1, (t) => stopMotion(t, h - 142, -1e4, st.at + 11, -1));
        mk(6, -1, (t) => stopMotion(t, h - 145, st.at + 14, st.at + 90, -1));
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  private seatPassengers(): void {
    const rng = this.rng;
    const hero = this.hero;
    // Evening, towards Churchgate (against the peak): the seats mostly taken, a few standing, a
    // couple of people at each open doorway ⚠.
    for (const s of hero.seats) {
      if (!rng.chance(0.78)) continue;
      // HeroCar is built flipped on the rake: convert to the ride frame.
      this.seated.push({ x: -s.x, z: -s.z, h: -s.face > 0 ? 0 : Math.PI, look: makeLook(rng, 0.35) });
    }
    for (const p of hero.standing) {
      if (!rng.chance(0.3)) continue;
      // Keep the middle doorways free: that is where the camera stands.
      if (Math.abs(p.x) > 0.3 && Math.abs(p.z) < 1.4) continue;
      this.standers.push({ x: -p.x, z: -p.z, h: rng.chance(0.5) ? 0 : Math.PI, look: makeLook(rng, 0.4), pose: rng.chance(0.7) ? 3 : 2 });
    }
    // Door hangers: both sides, not the middle doorway on the right (the camera's place).
    for (const d of CAR.doors)
      for (const side of [-1, 1]) {
        if (d === CAR.doors[1]) continue;
        const n = rng.int(0, 2);
        for (let k = 0; k < n; k++) {
          const z = -d + (k ? 0.45 : -0.35);
          this.hangers.push({ x: side * (CAR.halfW - 0.3 - k * 0.35), z, h: side > 0 ? Math.PI / 2 : -Math.PI / 2, look: makeLook(rng, 0.6), lean: k ? 0 : rng.range(0.05, 0.2) });
        }
      }
  }

  /**
   * Who gets off and on the ridden car at each stop (deterministic, so the film can scrub): a few
   * standers make for the platform-side doorways before the stop and step off first; boarders
   * push in after them and take free standing room. Borivali boards more than it sets down;
   * at Dadar many change to the Central line ⚠.
   */
  private planExchanges(): void {
    const used = this.standers.map((s) => [s.x, s.z]);
    const free = this.hero.standing.map((p) => ({ x: -p.x, z: -p.z })).filter((p) => !(Math.abs(p.x) > 0.3 && Math.abs(p.z) < 1.4));
    this.legs.forEach((leg, li) => {
      if (!leg.stop) return;
      const rng = new RNG(leg.key === 'BO' ? 515 : 404);
      const busy = leg.key === 'DA';
      const out: DoorEvent[] = [];
      const inn: DoorEvent[] = [];
      const doorOf = (z: number) => CAR.doors.reduce((b, d, j) => (Math.abs(z - d) < Math.abs(z - CAR.doors[b]) ? j : b), 0);
      const aboard = this.standers.filter((s) => (!s.came || s.came.leg < li) && !s.gone);
      const perDoor = [0, 0, 0];
      const nOut = Math.min(aboard.length, busy ? 8 : 4);
      for (let k = 0; k < nOut; k++) {
        const s = aboard.splice(rng.int(0, aboard.length - 1), 1)[0];
        const door = doorOf(s.z);
        const rank = perDoor[door]++;
        const tau = 2.0 + rank * 0.85 + rng.range(0, 0.2);
        s.gone = { leg: li, door, tau, qx: Math.max(0.2, 1.1 - rank * 0.38), qz: CAR.doors[door] + (rank % 2 ? 0.4 : -0.4), t0: -18 + k * 1.4 };
        out.push({ look: s.look, door, tau });
      }
      const nIn = busy ? 7 : 8;
      const inPer = [0, 0, 0];
      for (let k = 0; k < nIn; k++) {
        const door = k % 3;
        const rank = inPer[door]++;
        const tau = 2.2 + perDoor[door] * 0.85 + rank * 0.8 + 2.3 + rng.range(0, 0.3);
        // The free spot nearest the door.
        let best = -1;
        let bd = Infinity;
        free.forEach((p, i) => {
          if (used.some(([x, z]) => (x - p.x) ** 2 + (z - p.z) ** 2 < 0.5 * 0.5)) return;
          const dd = Math.abs(p.z - CAR.doors[door]) + Math.abs(p.x) * 0.3 + rng.range(0, 1.5);
          if (dd < bd) {
            bd = dd;
            best = i;
          }
        });
        if (best < 0) break;
        const spot = free[best];
        used.push([spot.x, spot.z]);
        const look = makeLook(rng, 0.4);
        this.standers.push({ x: spot.x, z: spot.z, h: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, look, pose: 3, came: { leg: li, door, tau, qx: 0, qz: 0, t0: 0 } });
        inn.push({ look, door, tau });
      }
      this.exchanges.set(li, { out, in: inn });
    });
  }

  /** Where a stander is at (leg, τ): walking to the door to get off, coming in, or in their place. */
  private standerAt(p: Stander, li: number, tau: number, out: { x: number; z: number; h: number; phase: number; amp: number; pose: number }): boolean {
    const walk = (ax: number, az: number, bx: number, bz: number, s: number) => {
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const k = Math.min(1, s / len);
      out.x = ax + (bx - ax) * k;
      out.z = az + (bz - az) * k;
      out.h = Math.atan2(bx - ax, bz - az);
      out.phase = (s * Math.PI * 2) / 1.45;
      out.amp = 1;
      out.pose = 0;
    };
    out.x = p.x;
    out.z = p.z;
    out.h = p.h;
    out.phase = 0;
    out.amp = 0;
    out.pose = p.pose;
    const c = p.came;
    if (c) {
      if (li < c.leg || (li === c.leg && tau < c.tau)) return false;
      if (li === c.leg) {
        const tx = CAR.halfW - 0.15;
        const tz = CAR.doors[c.door];
        const s = (tau - c.tau) * 1.0;
        if (s < Math.hypot(p.x - tx, p.z - tz)) walk(tx, tz, p.x, p.z, s);
      }
    }
    const g = p.gone;
    if (g) {
      if (li > g.leg || (li === g.leg && tau >= g.tau)) return false;
      if (li === g.leg) {
        const tx = CAR.halfW - 0.1;
        const tz = CAR.doors[g.door];
        const l1 = Math.hypot(g.qx - p.x, g.qz - p.z);
        const l2 = Math.hypot(tx - g.qx, tz - g.qz);
        const t2 = g.tau - l2 / 1.1;
        const t0 = Math.min(g.t0, t2 - l1 / 0.9 - 0.5);
        if (tau >= t2) walk(g.qx, g.qz, tx, tz, (tau - t2) * 1.1);
        else if (tau >= t0 + l1 / 0.9) {
          out.x = g.qx;
          out.z = g.qz;
          out.h = Math.PI / 2;
          out.pose = 3;
        } else if (tau >= t0) walk(p.x, p.z, g.qx, g.qz, (tau - t0) * 0.9);
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  /** Per frame, after the world (and its trains) have updated. */
  update(dt: number, time: number, lamps: number, camera: THREE.Camera): void {
    if (!this.active) return;
    this.time = time;
    const leg = this.current;
    const r = this.railway;
    const m = motion(leg, this.t);
    const trains = this.world.trains;
    // After the hand-over the station's PF 3 view is the train: follow it.
    const view = trains.views[PF - 1];
    let lead = m.d;
    let v = m.v;
    let a = m.a;
    let doors = leg.doors(this.t);
    if (leg.handoverAt !== undefined && this.t >= leg.handoverAt && view.state !== 'hidden') {
      lead = r.dChurchgate + (view.headZ + 2);
      v = Math.abs(view.speed);
      a = m.a;
      this.handedOver = true;
      if (view.state === 'departing') doors = 1 - sm(0.5, 3.5, view.phaseTime);
    } else if (this.handedOver && view.state === 'hidden') {
      // PF 3's train has left Churchgate with the car: the ride is over.
      this.finish();
      return;
    }
    Object.assign(this.state, { d: lead, v, a, doors, stopped: v < 0.05 });
    // Rake cars.
    const pose = { x: 0, z: 0, heading: 0 };
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const flip = new THREE.Quaternion().setFromAxisAngle(up, Math.PI);
    this.rake.visible = !this.handedOver;
    this.rake.doorOpen = doors;
    for (let i = 0; i < CARS; i++) {
      r.linePose(0, lead - carBack(i), pose);
      q.setFromAxisAngle(up, pose.heading);
      if (flipped(i)) q.multiply(flip);
      this.rake.cars[i].compose(new THREE.Vector3(pose.x, 0, pose.z), q, one);
    }
    // The ridden car: pose, curve lean and sway.
    const dc = lead - carBack(HERO_CAR);
    r.linePose(0, dc, pose);
    const lat = (v * v * wrapAngle(r.path.heading(dc + 12) - r.path.heading(dc - 12))) / 24;
    this.state.lat = lat;
    const vs = Math.min(1, v / 20);
    const tt = time;
    const roll = (0.006 * Math.sin(tt * 1.3) + 0.0035 * Math.sin(tt * 2.9 + 1) + 0.0015 * Math.sin(tt * 7.3)) * vs - lat * 0.004;
    const pitch = 0.0012 * Math.sin(tt * 1.9 + 0.4) * vs + a * 0.0012;
    const yaw = 0.0018 * Math.sin(tt * 0.9) * vs;
    const bounce = (0.004 * Math.sin(tt * 8.3) + 0.0025 * Math.sin(tt * 13.1 + 2)) * vs;
    const body = new THREE.Matrix4().compose(new THREE.Vector3(pose.x, 0, pose.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, pose.heading + yaw, roll, 'YXZ')), one);
    // Sway pivots about a point 1 m above the rail.
    const pivot = new THREE.Matrix4().makeTranslation(0, 1, 0);
    const back = new THREE.Matrix4().makeTranslation(0, -1 + bounce, 0);
    this.frame.copy(body).multiply(pivot).multiply(back);
    this.inside.matrix.copy(this.frame);
    this.inside.matrixWorldNeedsUpdate = true;
    this.hero.group.matrix.copy(this.frame).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    this.hero.group.matrixWorldNeedsUpdate = true;
    this.hero.setDoors(doors);
    const stop = leg.stop;
    const [deva, en] = stop && this.t > stop.at + stop.dwell - 3 ? stop.after : leg.next;
    const atHalt = stop && v < 0.1 && this.t > stop.at - 1 && this.t < stop.at + stop.dwell;
    const led =
      v < 0.1 && leg.key === 'E' && this.t > (leg.handoverAt ?? 0)
        ? `चर्चगेट   CHURCHGATE   ·   गाडी येथे संपते   THIS TRAIN TERMINATES HERE`
        : atHalt
          ? `${stop.halt.deva}   ${stop.halt.name.toUpperCase()}   ·   चर्चगेट जलद   CHURCHGATE FAST`
          : `चर्चगेट जलद   CHURCHGATE FAST   ·   पुढील स्टेशन ${deva}   NEXT STATION ${en}`;
    if (led !== this.lastLed) this.lastLed = led;
    this.hero.update(dt, time, { lat: -lat, lon: -a }, lamps, led);

    // Other locals on the line.
    for (const p of this.passers) {
      const ld = p.lead(this.t);
      const near = Math.abs(ld - lead) < 900;
      p.train.visible = near && r.lineOffset(p.line, ld) !== null;
      if (!p.train.visible) continue;
      for (let i = 0; i < CARS; i++) {
        const dcar = ld - p.dir * carBack(i);
        r.linePose(p.line, dcar, pose);
        q.setFromAxisAngle(up, pose.heading + (p.dir < 0 ? Math.PI : 0));
        if (flipped(i)) q.multiply(flip);
        p.train.cars[i].compose(new THREE.Vector3(pose.x, 0, pose.z), q, one);
      }
    }
    // Mira Road's platform crowd boards through the doors on the PF 4 side (Mira Road reads this
    // in its own update); line 1 stays clear for the down local the train meets on the way out.
    const mira = this.world.journey.mira;
    if (mira) {
      mira.holdLine1 = leg.key === 'A' && this.t < 260;
      const A = mira.group.position;
      mira.rideTrain =
        leg.key === 'A' && this.t < 120
          ? {
              stopped: v < 0.05,
              doorsOpen: doors > 0.9,
              doorsWorld: () => {
                const out: { x: number; z: number; car: number }[] = [];
                for (let i = 0; i < CARS; i++)
                  for (const zd of CAR.doors) {
                    const [x, z] = r.path.point(lead - carBack(i) + zd, CAR.halfW + 0.25);
                    out.push({ x: x - A.x, z: z - A.z, car: i });
                  }
                return out;
              },
            }
          : null;
    }
    if (mira && leg.key === 'A') {
      for (const look of mira.crowd.boardedHero.splice(0)) {
        const door = this.rng.pick(CAR.doors);
        this.standers.push({ x: this.rng.range(-0.9, 0.9), z: -door + this.rng.range(-0.7, 0.7), h: this.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, look, pose: 3 });
      }
    }
    if (stop) this.world.journey.halt(leg.key)?.life.update(this.t - stop.at, this.t, camera);
    this.renderPeople(camera);
    if (this.camRequest) this.camRequest(camera as THREE.PerspectiveCamera, this);
  }

  /** Set by the film or the player each frame: places the camera once the car has moved. */
  camRequest: ((cam: THREE.PerspectiveCamera, ride: Ride) => void) | null = null;

  // ---------------------------------------------------------------------------------------------
  private renderPeople(camera: THREE.Camera): void {
    const R = this.riders;
    R.begin();
    const F = CAR.floorY;
    // Nobody stands where the camera is (the player or the film's eye).
    const eye = camera.position.clone().applyMatrix4(this.frame.clone().invert());
    const clear = (x: number, z: number) => (x - eye.x) ** 2 + (z - eye.z) ** 2 > 0.5 * 0.5;
    for (const p of this.seated) if (clear(p.x, p.z) || eye.y > F + 1.4) R.put(p.look, p.x, F, p.z, p.h, 0, 0, 1);
    const stop = this.current.stop;
    const tau = stop ? this.t - stop.at : 0;
    const at = { x: 0, z: 0, h: 0, phase: 0, amp: 0, pose: 0 };
    for (const p of this.standers) if (this.standerAt(p, this.leg, tau, at) && clear(at.x, at.z)) R.put(p.look, at.x, F, at.z, at.h, at.phase, at.amp, at.pose);
    // Door hangers: in the doorway while it is open, leaning out as the train runs; they step
    // back into the vestibule when it is shut, and aside at a stop to let people by.
    const k = sm(0.3, 0.95, this.state.doors);
    const aside = !!stop && tau > -6 && tau < stop.dwell + 1;
    for (const p of this.hangers) {
      const side = Math.sign(p.x);
      const out = p.lean * Math.min(1, this.state.v / 10) * k;
      let x = side * (0.85 + (Math.abs(p.x) - 0.85) * k) + side * out;
      let z = p.z;
      if (aside && side > 0) {
        const d = CAR.doors.reduce((b, dd) => (Math.abs(p.z + dd) < Math.abs(p.z + b) ? dd : b), CAR.doors[0]);
        x = 0.95;
        z = -d + (p.z + d >= 0 ? 0.85 : -0.85);
      }
      if (clear(x, z)) R.put(p.look, x, F, z, p.h, 0, 0, 3);
    }
    R.end();

    // People in the other cars and trains near the camera: door hangers and heads at the windows.
    const O = this.others;
    O.begin();
    const anchor = this.othersAnchor.position;
    const cam = camera.position;
    const tmp = new THREE.Vector3();
    const put = (cm: THREE.Matrix4, seed: number, doorsOpen: boolean) => {
      tmp.setFromMatrixPosition(cm);
      if ((tmp.x - cam.x) ** 2 + (tmp.z - cam.z) ** 2 > 170 * 170) return;
      const yaw = Math.atan2(cm.elements[8], cm.elements[10]);
      for (let k = 0; k < 14; k++) {
        const h = (seed * 131 + k * 71) % 97;
        const look = this.otherLooks[(seed * 7 + k) % this.otherLooks.length];
        let x: number;
        let z: number;
        let heading: number;
        let pose: number;
        if (k < 6) {
          if (!doorsOpen) continue;
          // Door hangers at the three doorways, both sides.
          const door = CAR.doors[k % 3];
          const side = k < 3 ? 1 : -1;
          if (h % 3 === 0) continue;
          x = side * (CAR.halfW - 0.28);
          z = door + ((h % 5) - 2) * 0.18;
          heading = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          pose = 3;
        } else {
          // Seated by the windows.
          const side = k % 2 ? 1 : -1;
          x = side * (CAR.halfW - 0.55);
          z = -8.5 + ((k - 6) >> 1) * 4.2 + (h % 3) * 0.4;
          heading = h % 2 ? 0 : Math.PI;
          pose = 1;
        }
        tmp.set(x, CAR.floorY, z).applyMatrix4(cm);
        O.put(look, tmp.x - anchor.x, CAR.floorY, tmp.z - anchor.z, yaw + heading, 0, 0, pose + POSE.inside);
      }
    };
    if (this.rake.visible)
      this.rake.cars.forEach((cm, i) => {
        if (i !== HERO_CAR) put(cm, i, this.state.doors > 0.8);
      });
    this.passers.forEach((p, pi) => {
      if (p.train.visible) p.train.cars.forEach((cm, i) => put(cm, 100 + pi * 20 + i, true));
    });
    O.end();
  }

  /** The car's frame (no sway) with its lead end at path distance `lead`. */
  restFrame(lead: number): THREE.Matrix4 {
    const pose = { x: 0, z: 0, heading: 0 };
    this.railway.linePose(0, lead - carBack(HERO_CAR), pose);
    return new THREE.Matrix4().compose(new THREE.Vector3(pose.x, 0, pose.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.heading), new THREE.Vector3(1, 1, 1));
  }

  /** The nearest empty seat to a point in the car (ride frame), within reach. */
  freeSeat(p: THREE.Vector3): { x: number; z: number; h: number } | null {
    let best: { x: number; z: number; h: number } | null = null;
    let bd = 2.2 * 2.2;
    for (const s of this.hero.seats) {
      const x = -s.x;
      const z = -s.z;
      if (this.seated.some((q) => Math.abs(q.x - x) < 0.1 && Math.abs(q.z - z) < 0.1)) continue;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = { x, z, h: -s.face > 0 ? 0 : Math.PI };
      }
    }
    return best;
  }

  /** People in the car and on Mira Road's platforms near a point (for voices and footsteps). */
  peopleNear(p: THREE.Vector3, r: number): { pos: THREE.Vector3; walking: boolean }[] {
    const out: { pos: THREE.Vector3; walking: boolean }[] = [];
    if (!this.active) return out;
    const tmp = new THREE.Vector3();
    for (const q of [...this.seated, ...this.standers]) {
      const s = q as Stander;
      if ((s.came && s.came.leg > this.leg) || (s.gone && s.gone.leg < this.leg)) continue;
      this.toWorld(tmp.set(q.x, CAR.floorY + 1, q.z));
      if (tmp.distanceToSquared(p) < r * r) out.push({ pos: tmp.clone(), walking: false });
    }
    const mira = this.world.journey.mira;
    if (mira && this.current.key === 'A') out.push(...mira.crowd.peopleNear(p, r, mira.group.position));
    if (this.current.stop) {
      const st = this.world.journey.halt(this.current.key);
      if (st) out.push(...st.life.peopleNear(p, r));
    }
    return out;
  }

  /** The passing train nearest to a point (for its sound). */
  nearestPasser(p: THREE.Vector3): { id: number; pos: THREE.Vector3; speed: number; dist: number } | null {
    let best: { id: number; pos: THREE.Vector3; speed: number; dist: number } | null = null;
    const tmp = new THREE.Vector3();
    this.passers.forEach((ps, id) => {
      if (!ps.train.visible) return;
      for (const cm of ps.train.cars) {
        tmp.setFromMatrixPosition(cm);
        const d = tmp.distanceTo(p);
        if (!best || d < best.dist) best = { id: id + this.leg * 10, pos: tmp.clone().setY(1.5), speed: 20, dist: d };
      }
    });
    return best;
  }

  /** Is a world point inside the ridden car's body? */
  contains(p: THREE.Vector3): boolean {
    if (!this.active) return false;
    const l = p.clone().applyMatrix4(new THREE.Matrix4().copy(this.frame).invert());
    return Math.abs(l.x) < CAR.halfW + 0.05 && Math.abs(l.z) < CAR.length / 2 && l.y > CAR.floorY && l.y < CAR.floorY + 2.4;
  }

  /** A pose inside the car (ride frame) → world. */
  toWorld(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.frame);
  }

  /** Places a camera in the car: eye position and look target in the ride frame. */
  placeCamera(cam: THREE.PerspectiveCamera, eye: THREE.Vector3, target: THREE.Vector3, roll = 0): void {
    const e = this.toWorld(eye);
    const t = this.toWorld(target);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(this.frame));
    const m = new THREE.Matrix4().lookAt(e, t, up);
    cam.position.copy(e);
    cam.quaternion.setFromRotationMatrix(m);
    if (roll) cam.rotateZ(roll);
  }

  get seconds(): number {
    return this.time;
  }
}

/**
 * Lead end of another train that runs in, stands and leaves: at rest at `at` between tArr and
 * tDep, running towards +d (dir 1) or −d.
 */
function stopMotion(t: number, at: number, tArr: number, tDep: number, dir: 1 | -1): number {
  const vIn = 16;
  const aIn = 0.6;
  const aOut = 0.55;
  const vMax = 20;
  if (t < tArr) {
    const dt = tArr - t;
    const tb = vIn / aIn;
    return at - dir * (dt > tb ? (vIn * vIn) / (2 * aIn) + vIn * (dt - tb) : 0.5 * aIn * dt * dt);
  }
  if (t < tDep) return at;
  const dt = t - tDep;
  const ta = vMax / aOut;
  return at + dir * (dt < ta ? 0.5 * aOut * dt * dt : (vMax * vMax) / (2 * aOut) + vMax * (dt - ta));
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export { motion };
