import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { Riders } from '../../entities/crowd/Riders';
import { makeLook, type Look } from '../../entities/crowd/Crowd';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import { CAR } from '../../entities/train/Livery';
import type { Halt } from './Railway';

const TOP = 0.92;
const FOB_Y = 7.9;
const STRIDE = 1.45;

/** What the station builder tells the crowd about the station. */
export interface HaltPlan {
  plats: { o0: number; o1: number; a: number; b: number; main: boolean; density: number; west: boolean; east: boolean }[];
  /** Stairs to the foot-over-bridges: foot (rd0) on the platform, top (rd1) at the bridge. */
  stairs: { plat: number; rd0: number; rd1: number; o: number; w: number }[];
  /** Track heading at the station centre. */
  heading: number;
}

/** Someone crossing a doorway of the ride's own car (planned by the ride, shown here outside it). */
export interface DoorEvent {
  look: Look;
  /** Door index (car frame z = CAR.doors[door]). */
  door: number;
  /** τ (s after the train stops) when they cross the threshold. */
  tau: number;
}

/** Where and how long the ride's train stands. */
export interface StopPlan {
  /** Lead end at rest, d from the station centre. */
  lead: number;
  dwell: number;
  cars: number;
  heroCar: number;
  carBack: (i: number) => number;
  /** The ride's own car: who gets off, who gets on. */
  heroOut: DoorEvent[];
  heroIn: DoorEvent[];
}

interface Person {
  look: Look;
  /** Where they stand before moving (d from the centre, offset, height) and which way they face. */
  rd: number;
  o: number;
  y: number;
  a: number;
  pose: number;
  /** A walk (flat rd, o, y triples) begun at τ = t0 at speed v. */
  pts: number[] | null;
  cum: number[];
  t0: number;
  v: number;
  hideBefore: boolean;
  hideAfter: boolean;
  /** Pacing up and down the platform instead. */
  pace: { lo: number; hi: number; v: number; ph: number } | null;
}

/**
 * The people at Borivali or Dadar, seen from the train. Everyone is a function of τ (seconds
 * after the ride's train stops), so the film can scrub and the interactive ride replays the same:
 * the waiting crowd bunched where the doors will stop (Mumbai commuters know), the rush off every
 * door the moment it opens, the push on, those left behind, and the platforms' own people
 * standing, pacing and going up to the bridges.
 */
export class HaltLife {
  readonly group = new THREE.Group();
  private readonly near: Riders;
  private readonly far: Riders;
  private readonly ambient: Person[] = [];
  private stopPeople: Person[] = [];
  private stopKey = '';
  private readonly rng: RNG;
  private readonly seen: THREE.Vector3[] = [];
  private seenCount = 0;
  private readonly busy: boolean;

  constructor(
    av: AmbientVolume,
    private readonly P: (rd: number, o: number, y: number) => THREE.Vector3,
    private readonly plan: HaltPlan,
    private readonly halt: Halt,
    seed: number,
  ) {
    this.group.name = 'halt-life';
    this.rng = new RNG(seed);
    this.busy = halt.key === 'DA';
    // No shadows: the platforms are mostly under their canopies, and the crowd is large.
    this.near = new Riders(av, 220, { shadows: false });
    this.far = new Riders(av, 900, { lod: 1, shadows: false });
    this.group.add(this.near.group, this.far.group);
    for (let i = 0; i < 64; i++) this.seen.push(new THREE.Vector3());
    this.populate();
  }

  private inStair(pi: number, rd: number, o: number, pad = 0.5): boolean {
    return this.plan.stairs.some((s) => s.plat === pi && Math.abs(o - s.o) < s.w / 2 + pad && rd > Math.min(s.rd0, s.rd1) - pad && rd < Math.max(s.rd0, s.rd1) + pad);
  }

  private person(look: Look, rd: number, o: number, a: number, pose = 0): Person {
    return { look, rd, o, y: TOP, a, pose, pts: null, cum: [], t0: 0, v: 1.3, hideBefore: false, hideAfter: false, pace: null };
  }

  /** People standing about and pacing on every platform. */
  private populate(): void {
    const rng = this.rng;
    this.plan.plats.forEach((pl, pi) => {
      const n = Math.round(((pl.o1 - pl.o0) * (pl.b - pl.a) * pl.density) / 100);
      for (let i = 0; i < n; i++) {
        const look = makeLook(rng, 0.35);
        let rd = 0;
        let o = 0;
        for (let k = 0; k < 6; k++) {
          // Half of them bunch towards the Churchgate end, where the front coaches (and the
          // ride's own) stop and the exits are.
          rd = rng.chance(0.5) ? rng.range(pl.a + 5, pl.b - 5) : THREE.MathUtils.clamp(95 + rng.gauss() * 35, pl.a + 5, pl.b - 5);
          // On the main island keep the west edge (the ride's doors) for the waiting crowd.
          o = rng.range(pl.o0 + (pl.main ? 2.6 : 1.2), pl.o1 - 1.2);
          if (!this.inStair(pi, rd, o)) break;
        }
        const r = rng.next();
        if (r < 0.28) {
          const len = rng.range(18, 70);
          const lo = THREE.MathUtils.clamp(rd - len / 2, pl.a + 4, pl.b - 4 - len);
          const p = this.person(look, rd, o, 0);
          p.pace = { lo, hi: lo + len, v: rng.range(0.9, 1.4), ph: rng.range(0, 200) };
          this.ambient.push(p);
        } else {
          // Face a track, up the line for the next train, or someone to talk to.
          const west = pl.west && (!pl.east || o - pl.o0 < pl.o1 - o);
          const a = rng.chance(0.5) ? (west ? -Math.PI / 2 : Math.PI / 2) : rng.chance(0.5) ? Math.PI : rng.range(-Math.PI, Math.PI);
          this.ambient.push(this.person(look, rd, o, a + rng.range(-0.3, 0.3), rng.chance(0.3) ? 2 : 0));
        }
      }
    });
  }

  /** Waiting crowd and the exchange at every door of the ride's train (once per stop plan). */
  configure(s: StopPlan): void {
    const key = `${s.lead.toFixed(2)}:${s.dwell}:${s.heroOut.length}:${s.heroIn.length}`;
    if (key === this.stopKey) return;
    this.stopKey = key;
    const rng = new RNG(this.halt.key === 'DA' ? 9091 : 9073);
    const out: Person[] = [];
    const pi = this.plan.plats.findIndex((p) => p.main);
    const pl = this.plan.plats[pi];
    const busy = this.busy;
    const stairs = this.plan.stairs.filter((st) => st.plat === pi);
    const lane = () => rng.range(pl.o0 + 2.4, pl.o1 - 1.4);
    const exitPath = (dr: number): number[] => {
      const pts = [dr, 1.5, CAR.floorY, dr + rng.range(-0.4, 0.4), 2.3, TOP];
      // Off to the nearest bridge (most at Dadar, for the Central line) or out at the platform ends.
      const near = stairs.slice().sort((a, b) => Math.abs(a.rd0 - dr) - Math.abs(b.rd0 - dr))[0];
      if (near && Math.abs(near.rd0 - dr) < 90 && rng.chance(busy ? 0.8 : 0.55)) {
        const side = near.rd0 > near.rd1 ? 1 : -1;
        const o = near.o + rng.range(-near.w / 2 + 0.4, near.w / 2 - 0.4);
        const l = lane();
        pts.push(dr + (near.rd0 + side * 2 - dr) * 0.35, l, TOP, near.rd0 + side * 1.2, o, TOP, near.rd0, o, TOP, near.rd1, o, FOB_Y, near.rd1 - side * 3, o, FOB_Y);
      } else {
        const end = dr > (pl.a + pl.b) / 2 ? pl.b : pl.a;
        const s = Math.sign(end - dr);
        const l = lane();
        pts.push(dr + s * 6, l, TOP, end - s * 1, l, TOP, end + s * 8, l, -0.25);
      }
      return pts;
    };
    const walker = (look: Look, pts: number[], t0: number, v: number, hideBefore: boolean, hideAfter: boolean, a: number, pose = 0): Person => {
      const p = this.person(look, pts[0], pts[1], a, pose);
      p.y = pts[2];
      p.pts = pts;
      p.t0 = t0;
      p.v = v;
      p.hideBefore = hideBefore;
      p.hideAfter = hideAfter;
      p.cum = [0];
      for (let i = 3; i < pts.length; i += 3) p.cum.push(p.cum[p.cum.length - 1] + Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]));
      return p;
    };
    const closeBy = s.dwell - 4.6;
    for (let i = 0; i < s.cars; i++) {
      const centre = s.lead - s.carBack(i);
      for (let j = 0; j < CAR.doors.length; j++) {
        const dr = centre + CAR.doors[j];
        if (dr < pl.a + 2 || dr > pl.b - 2) continue;
        const hero = i === s.heroCar;
        // Off first...
        const offs = hero ? s.heroOut.filter((e) => e.door === j).map((e) => ({ look: e.look, tau: e.tau })) : Array.from({ length: rng.int(busy ? 4 : 1, busy ? 9 : 3) }, (_, k) => ({ look: makeLook(rng, 0.35), tau: 2.0 + k * 0.85 + rng.range(0, 0.25) }));
        for (const e of offs) out.push(walker(e.look, exitPath(dr), e.tau, rng.range(1.3, 1.6), true, true, 0));
        // ...then the push on. Spots either side of the doorway, rows behind.
        const ons = hero ? s.heroIn.filter((e) => e.door === j) : Array.from({ length: rng.int(busy ? 5 : 2, busy ? 11 : 6) }, () => ({ look: makeLook(rng, 0.35), door: j, tau: -1 }));
        ons.forEach((e, r) => {
          const side = r % 2 ? 1 : -1;
          const m = r >> 1;
          const sr = dr + side * (0.75 + (m % 3) * 0.42) + rng.range(-0.12, 0.12);
          const so = pl.o0 + 0.75 + Math.floor(m / 3) * 0.5 + rng.range(-0.08, 0.08);
          const pts = [sr, so, TOP, dr + side * 0.3, 2.05, TOP, dr, 1.45, CAR.floorY];
          const v = 1.2;
          let len = 0;
          for (let k = 3; k < pts.length; k += 3) len += Math.hypot(pts[k] - pts[k - 3], pts[k + 1] - pts[k - 2], pts[k + 2] - pts[k - 1]);
          const tIn = e.tau >= 0 ? e.tau : 2.2 + offs.length * 0.85 + r * 0.8 + rng.range(0, 0.4) + len / v;
          const a = rng.chance(0.65) ? -Math.PI / 2 : rng.chance(0.5) ? Math.PI : -Math.PI / 2 + side * 0.6;
          if (tIn > closeBy && !hero) {
            // Left behind: they'll wait for the next one.
            out.push(this.person(e.look, sr, so, a, rng.chance(0.3) ? 2 : 0));
            return;
          }
          out.push(walker(e.look, pts, tIn - len / v, v, false, true, a, rng.chance(0.25) ? 2 : 0));
        });
      }
    }
    this.stopPeople = out;
  }

  /** Per frame while the ride is at this station: τ (s after the stop), leg time for pacing. */
  update(tau: number, time: number, camera: THREE.Camera): void {
    const origin = this.group.getWorldPosition(new THREE.Vector3());
    const cam = camera.position.clone().sub(origin);
    const N = this.near;
    const F = this.far;
    N.begin();
    F.begin();
    this.seenCount = 0;
    const H = this.plan.heading;
    let idx = 0;
    const put = (p: Person, rd: number, o: number, y: number, a: number, phase: number, amp: number, pose: number) => {
      const w = this.P(rd, o, y);
      const d2 = (w.x - cam.x) ** 2 + (w.z - cam.z) ** 2;
      // Far people are small from the train: thin them out beyond 60 m, none beyond 125 m.
      if (d2 > 125 * 125) return;
      if (d2 > 60 * 60 && idx++ % (d2 > 100 * 100 ? 3 : 2)) return;
      if (d2 < 20 * 20) {
        N.put(p.look, w.x, w.y, w.z, H + a, phase, amp, pose);
        if (this.seenCount < this.seen.length) this.seen[this.seenCount++].copy(w).add(origin);
      } else F.put(p.look, w.x, w.y, w.z, H + a, phase, amp, pose);
    };
    for (const p of this.ambient) {
      if (p.pace) {
        const L = p.pace.hi - p.pace.lo;
        const s = (time * p.pace.v + p.pace.ph) % (2 * L);
        const fwd = s < L;
        const rd = p.pace.lo + (fwd ? s : 2 * L - s);
        put(p, rd, p.o, TOP, fwd ? 0 : Math.PI, (time * p.pace.v * Math.PI * 2) / STRIDE, 1, 0);
      } else put(p, p.rd, p.o, p.y, p.a, 0, 0, p.pose);
    }
    for (const p of this.stopPeople) this.eval(p, tau, put);
    N.end();
    F.end();
  }

  private eval(p: Person, tau: number, put: (p: Person, rd: number, o: number, y: number, a: number, phase: number, amp: number, pose: number) => void): void {
    if (!p.pts) {
      put(p, p.rd, p.o, p.y, p.a, 0, 0, p.pose);
      return;
    }
    const pts = p.pts;
    if (tau < p.t0) {
      if (!p.hideBefore) put(p, pts[0], pts[1], pts[2], p.a, 0, 0, p.pose);
      return;
    }
    const s = (tau - p.t0) * p.v;
    const total = p.cum[p.cum.length - 1];
    if (s >= total) {
      if (!p.hideAfter) put(p, pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1], p.a, 0, 0, 0);
      return;
    }
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const k = (s - p.cum[i - 1]) / Math.max(1e-6, p.cum[i] - p.cum[i - 1]);
    const a0 = (i - 1) * 3;
    const b0 = i * 3;
    const rd = pts[a0] + (pts[b0] - pts[a0]) * k;
    const o = pts[a0 + 1] + (pts[b0 + 1] - pts[a0 + 1]) * k;
    const y = pts[a0 + 2] + (pts[b0 + 2] - pts[a0 + 2]) * k;
    const a = Math.atan2(pts[b0 + 1] - pts[a0 + 1], pts[b0] - pts[a0]);
    put(p, rd, o, y, a, (s * Math.PI * 2) / STRIDE, 1, 0);
  }

  /** People near a world point (voices and footsteps). */
  peopleNear(p: THREE.Vector3, r: number): { pos: THREE.Vector3; walking: boolean }[] {
    const out: { pos: THREE.Vector3; walking: boolean }[] = [];
    for (let i = 0; i < this.seenCount; i++) if (this.seen[i].distanceToSquared(p) < r * r) out.push({ pos: this.seen[i].clone(), walking: false });
    return out;
  }
}
