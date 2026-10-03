import * as THREE from 'three';
import { WEATHER, WX } from '../../gfx/Weather';
import { RNG } from '../../core/Random';
import type { Input } from '../../core/Input';
import type { ExploreControls } from '../../camera/ExploreControls';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { AUTO, HeroAuto } from '../../entities/auto/HeroAuto';
import { Riders } from '../../entities/crowd/Riders';
import { POSE, youngMan, type Look } from '../../entities/crowd/Looks';
import { bumpHeight } from '../miraroad/MiraProps';
import { ROAD } from '../miraroad/MiraCtx';
import type { MiraRoad } from './MiraRoad';

/**
 * The auto ride to the station (AUTO_RIDE.md): you walk out of your society's gate in Shanti Nagar,
 * wave down an auto, get in, and ride as a passenger (the driver drives) through Sector 2's lanes,
 * west to Poonam Sagar Road and north up it to the junction by the station, round into the approach
 * and up to the forecourt; you pay, get out and walk into Mira Road station.
 *
 * Phases: walk (on foot, the explore controls) → arrive (the auto comes up and stops for you) →
 * board (the camera ducks in through the left doorway onto the bench) → ride → arrived (at the
 * forecourt) → alight (out onto the cobbles; walking again) → away (it drives off).
 */

export type AutoPhase = 'idle' | 'walk' | 'arrive' | 'board' | 'ride' | 'arrived' | 'alight' | 'away';

export interface AutoRideHooks {
  hint(text: string | null): void;
  sub(en: string, deva: string): void;
  hideSub(): void;
  toast(text: string): void;
  title(a: string, b: string, c: string): void;
  hideTitle(): void;
  fade(on: boolean): void;
  /** Out of the auto at the forecourt: walking again from here (world), facing yaw. */
  alight(x: number, z: number, yaw: number): void;
  /** The game clock (hours), for the title card. */
  hour(): number;
  /** Bars top and bottom while a short scene plays (the auto coming for you, getting in). */
  letterbox(on: boolean): void;
}

/** Sounds the ride asks for (the audio reads and clears them). */
export interface AutoCues {
  horn: number;
  beep: number;
  bump: number;
}

const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const GEAR_TOP = [3.4, 6.2, 8.8, 13];
/** Mumbai's minimum auto fare (₹), for the first 1.5 km ⚠ (2025 tariff). */
const MIN_FARE = 26;

export class AutoRide {
  readonly hero: HeroAuto;
  phase: AutoPhase = 'idle';
  /** Along the route (m), speed (m/s), acceleration (m/s²). */
  s = 0;
  v = 0;
  a = 0;
  gear = 0;
  rpm = 900;
  /** Where it means to stop for you (the pickup), and for the drop. */
  private sStop = 0;
  private t = 0;
  private phaseT = 0;
  /** Seat look (relative to the auto's heading). */
  yaw = 0;
  pitch = -0.04;
  private readonly cues: AutoCues = { horn: 0, beep: 0, bump: 0 };
  private crossOK = false;
  private directed = false;
  private redCrowd = 0;
  private crossed = new Set<number>();
  private fare = 0;
  private waitS = 0;
  private hired = false;
  private shift = 0;
  private hailT = 0;
  private stopT = 0;
  private pedWait = 0;
  private skip: { t: number; to: number } | null = null;
  private trans: { t: number; dur: number; out: boolean; from: THREE.Vector3; fromQ: THREE.Quaternion } | null = null;
  private lines: { at: number; en: string; deva: string }[] = [];
  private nextHorn = 8;
  private readonly rng = new RNG(5151);
  // Body on its springs, the passenger's head.
  private heave = 0;
  private heaveV = 0;
  private pitchB = 0;
  private pitchV = 0;
  private rollB = 0;
  private head = new THREE.Vector3();
  private headV = new THREE.Vector3();
  private steer = 0;
  private lastKappa = 0;
  private lastHF = 0;
  private lastHR = 0;
  /** Night (0 … 1), set by the owner: the lamps. */
  night = 0;
  /** What held it back last frame (for testing). */
  readonly dbg = { gap: Infinity, ped: Infinity, target: 0 };
  private lookAt = 0;
  private readonly tmpQ = new THREE.Quaternion();
  /** A short scene with its own cameras: the auto coming up and stopping for you, you getting in. */
  private cine: { kind: 'arrive' | 'board'; t: number; from?: THREE.Vector3; walk?: number } | null = null;
  /** You, seen from outside in those scenes (local frame). */
  private readonly you: Riders;
  private readonly youLook: Look;
  private readonly youAt = new THREE.Vector3();
  private youH = 0;
  private youPhase = 0;
  private readonly camLook = new THREE.Vector3();

  constructor(
    private readonly mira: MiraRoad,
    mats: StationMaterials,
    private readonly input: Input,
    private readonly hooks: AutoRideHooks,
  ) {
    this.hero = new HeroAuto(mats, mira.av);
    this.hero.root.visible = false;
    mira.group.add(this.hero.root);
    this.you = new Riders(mira.av, 1, { lod: 0, shadows: true, indoor: true });
    mira.group.add(this.you.group);
    const look = youngMan(new RNG(2026));
    look.flags = [1, 0, look.flags[2], look.flags[3]];
    this.youLook = look;
  }

  /** The wiper's sweeps so far (the rain's sound thunks each). */
  get wipes(): number {
    return this.hero.wipes;
  }

  /** The auto's body frame while it is out (its cabin stays dry in the rain), else null. */
  cabin(): THREE.Matrix4 | null {
    if (!this.hero.root.visible || !this.mira.group.visible) return null;
    this.hero.body.updateWorldMatrix(true, false);
    return this.hero.body.matrixWorld;
  }

  /** The camera is the ride's (seated, or a short scene). */
  get ownsCamera(): boolean {
    return this.seated || this.cine !== null;
  }

  private get route() {
    return this.mira.auto.route;
  }

  /** The start of the walk: inside your gate (world), facing the lane. */
  get start(): { x: number; z: number; yaw: number } {
    const st = this.mira.auto.streets.start;
    const g = this.mira.group.position;
    // Traffic heading h faces (sin h, cos h); the walker's yaw faces (−sin y, −cos y).
    return { x: st.x + g.x, z: st.z + g.z, yaw: st.h + Math.PI };
  }

  /** A box round your lane to walk in before the auto comes (world). */
  get walkBounds() {
    const st = this.start;
    return { minX: st.x - 45, maxX: st.x + 45, minZ: st.z - 45, maxZ: st.z + 45 };
  }

  begin(): void {
    this.phase = 'walk';
    this.phaseT = 0;
    this.t = 0;
    this.hero.root.visible = false;
    this.fare = 0;
    this.waitS = 0;
    this.hired = false;
    this.crossed.clear();
    this.directed = false;
    this.crossOK = false;
    this.redCrowd = 0;
    this.lines = [];
    this.skip = null;
    this.trans = null;
    this.hailT = 0;
    this.yaw = 0;
    this.pitch = -0.04;
    this.mira.auto.traffic.obstacles = [];
    this.endCine();
  }

  stop(): void {
    this.phase = 'idle';
    this.hero.root.visible = false;
    this.mira.auto.traffic.obstacles = [];
    this.hooks.hint(null);
    this.endCine();
  }

  private endCine(): void {
    if (this.cine) this.hooks.letterbox(false);
    this.cine = null;
    this.you.begin();
    this.you.end();
  }

  /** Riding (or getting in or out): the camera is the passenger's. */
  get seated(): boolean {
    return this.phase === 'board' || this.phase === 'ride' || this.phase === 'arrived' || this.phase === 'alight';
  }

  takeCues(): AutoCues {
    const c = { ...this.cues };
    this.cues.horn = this.cues.beep = this.cues.bump = 0;
    return c;
  }

  /** Place name for the HUD. */
  placeName(): [string, string] {
    const secs = this.route.sections;
    let k = 0;
    for (let i = 0; i < secs.length; i++) if (this.s >= secs[i].s - 2) k = i;
    if (this.phase === 'walk' || this.phase === 'idle') k = 0;
    return [secs[k].en, secs[k].deva];
  }

  /** The auto's world position (for sound), or null when it is not about. */
  heroWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.hero.root.visible) return null;
    return out.copy(this.hero.root.position).add(this.mira.group.position).setY(0.8);
  }

  /** Dev: put the auto at s, riding. */
  jump(s: number): void {
    if (this.phase === 'idle' || this.phase === 'walk') {
      this.phase = 'ride';
      this.hired = true;
      this.fare = MIN_FARE;
    }
    this.s = s;
    this.v = Math.min(this.route.profile(s), 6);
    this.hero.root.visible = true;
    this.crossOK = s > this.route.sGive;
    this.place(0);
  }

  // ---- Per frame --------------------------------------------------------------------------------------
  /**
   * `feet`: the walker's feet (world) while on foot. Returns true while the ride owns the camera.
   */
  update(dt: number, camera: THREE.PerspectiveCamera, explore: ExploreControls): boolean {
    this.t += dt;
    this.phaseT += dt;
    const r = this.route;
    const g = this.mira.group.position;
    const inp = this.input;
    // Subtitles in turn.
    while (this.lines.length && this.lines[0].at <= this.t) {
      const l = this.lines.shift()!;
      if (l.en) this.hooks.sub(l.en, l.deva);
      else this.hooks.hideSub();
    }

    if (this.phase === 'walk') {
      const fx = explore.feet.x - g.x;
      const fz = explore.feet.z - g.z;
      // Out on the lane (not behind a compound wall), anywhere along Sector 2's lanes.
      const p = r.project(fx, fz);
      const at = r.at(p.s);
      const lat = (fx - at.x) * Math.cos(at.h) - (fz - at.z) * Math.sin(at.h);
      const onLane = p.s > 24 && p.s < r.legStart[2] - 14 && lat > -4.0 && lat < 2.3;
      if (onLane) {
        this.hailT += dt;
        this.hooks.hint('Wait at the roadside for an auto · E — wave one down');
        // One comes along anyway after a few seconds at the roadside.
        if (inp.hit('KeyE') || this.hailT > 6) this.hail(p.s, fx, fz);
      } else {
        this.hailT = 0;
        this.hooks.hint('Walk out through your gate to the lane · wait there for an auto');
      }
      return false;
    }

    if (this.phase === 'arrive') {
      this.drive(dt, this.sStop);
      this.place(dt);
      const stopped = this.v < 0.05 && this.sStop - this.s < 0.4;
      if (stopped) this.stopT += dt;
      else this.stopT = 0;
      // The driver looks for you as he comes up, at you when he stops.
      this.lookAt = stopped || this.sStop - this.s < 14 ? 1.1 : 0;
      if (stopped && !this.lines.length && this.hailT >= 0) {
        this.hailT = -1;
        this.say(0.3, 'Driver: “Where to?”', 'किधर?');
        this.say(1.9, 'You: “Station. Mira Road station.”', 'स्टेशन. मीरा रोड स्टेशन.');
        this.say(3.6, 'Driver: “Get in.”', 'बैठो.');
        this.say(6.0, '', '');
      }
      if (this.cine?.kind === 'arrive') {
        this.arriveScene(dt, camera, explore, stopped);
        return true;
      }
      this.keepOut(explore);
      // Into the auto from beside its doorway (the left side): E, or step right up to it.
      const door = this.toLocalAuto(explore.feet);
      const d = Math.hypot(door.x - (AUTO.half + 0.35), door.z - AUTO.doorOut.z);
      const beside = door.x > AUTO.half - 0.1 && d < 1.7;
      if (stopped) this.hooks.hint(beside ? 'Get in: E' : 'Walk up to the auto’s left side to get in');
      else this.hooks.hint('Your auto is pulling up…');
      if (stopped && this.stopT > 0.8 && beside && (inp.hit('KeyE') || (d < 0.6 && this.stopT > 3.8))) this.board(camera, explore);
      return false;
    }

    if (this.phase === 'board' && this.cine?.kind === 'board') {
      this.place(dt);
      this.boardScene(dt, camera);
      return true;
    }

    if (this.phase === 'board' || this.phase === 'alight') {
      this.place(dt);
      this.transition(dt, camera);
      return true;
    }

    if (this.phase === 'ride') {
      this.look(dt);
      if (this.skip) {
        this.skip.t += dt;
        if (this.skip.t > 0.75 && this.skip.to >= 0) {
          this.s = this.skip.to;
          this.v = Math.min(r.profile(this.s), 7);
          this.skip.to = -1;
          this.crossOK = this.s > r.sGive;
          this.hooks.fade(false);
          const st = r.stretches.find((q) => Math.abs(q.s - this.s) < 1);
          if (st) {
            this.hooks.title(st.title[0], st.title[1], st.title[2]);
            window.setTimeout(() => this.hooks.hideTitle(), 3800);
          }
        }
        if (this.skip.t > 1.4) this.skip = null;
      }
      if (this.phaseT > 1.6) this.drive(dt, r.sDrop);
      this.events(dt);
      this.place(dt);
      this.seatCamera(dt, camera);
      if (!this.skip && inp.hit('KeyN')) {
        const next = r.stretches.find((q) => q.s > this.s + 20);
        if (next) {
          this.skip = { t: 0, to: next.s };
          this.hooks.fade(true);
        }
      }
      this.hooks.hint(this.phaseT < 6 ? 'Mouse — look around · N — skip ahead · Esc — menu' : null);
      if (this.v < 0.05 && r.sDrop - this.s < 0.5) {
        this.phase = 'arrived';
        this.phaseT = 0;
        this.say(0.4, 'Driver: “Station. Twenty-six rupees.”', 'स्टेशन आ गया. छब्बीस रुपये.');
        this.say(5, '', '');
      }
      return true;
    }

    if (this.phase === 'arrived') {
      this.look(dt);
      this.v = 0;
      this.place(dt);
      this.seatCamera(dt, camera);
      this.lookAt = this.phaseT > 0.5 && this.phaseT < 3 ? -2.2 : 0.3;
      this.hooks.hint('Mira Road station · E — pay ₹26 and get out');
      if (inp.hit('KeyE') || this.phaseT > 25) {
        this.hooks.toast('Paid ₹26 by UPI');
        this.cues.beep++;
        this.hired = false;
        this.phase = 'alight';
        this.phaseT = 0;
        this.trans = { t: 0, dur: 1.5, out: true, from: camera.position.clone(), fromQ: camera.quaternion.clone() };
        this.hooks.hint(null);
      }
      return true;
    }

    if (this.phase === 'away') {
      this.lookAt = 0;
      if (this.phaseT > 2.5) this.drive(dt, r.length);
      this.place(dt);
      this.keepOut(explore);
      // Gone round the corner (or stuck in the queue out of the forecourt): it leaves the scene.
      if (this.s > r.length - 3 || this.phaseT > 22 || (this.v < 0.05 && this.phaseT > 12)) this.stop();
      return false;
    }
    return false;
  }

  // ---- Driving --------------------------------------------------------------------------------------
  /** An auto comes along the lane and stops with its doorway by you (a short scene shows it). */
  private hail(sPlayer: number, fx: number, fz: number): void {
    const r = this.route;
    this.sStop = Math.max(36, Math.min(r.legStart[2] - 16, sPlayer + 0.35));
    this.s = Math.max(0, this.sStop - 36);
    this.v = 5;
    this.phase = 'arrive';
    this.phaseT = 0;
    this.hailT = 0;
    this.stopT = 0;
    this.hero.root.visible = true;
    this.cues.horn++;
    this.place(0);
    this.youAt.set(fx, ROAD, fz);
    this.cine = { kind: 'arrive', t: 0 };
    this.hooks.letterbox(true);
    this.hooks.hint(null);
  }

  private board(camera: THREE.PerspectiveCamera, explore: ExploreControls): void {
    this.phase = 'board';
    this.lookAt = 0;
    this.phaseT = 0;
    this.yaw = 0;
    this.pitch = -0.04;
    this.hooks.hint(null);
    this.hooks.hideSub();
    this.lines = [];
    // Seen from outside: you step up to the doorway, duck in and sit.
    const g = this.mira.group.position;
    this.youAt.set(explore.feet.x - g.x, ROAD, explore.feet.z - g.z);
    this.cine = { kind: 'board', t: 0, from: this.youAt.clone() };
    this.hooks.letterbox(true);
    void camera;
  }

  // ---- The short scenes -------------------------------------------------------------------------------
  /** Auto frame (on the ground, its heading) → Mira Road's local frame. */
  private autoToLocal(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const rt = this.hero.root;
    const h = rt.rotation.y;
    return out.set(rt.position.x + Math.cos(h) * x + Math.sin(h) * z, rt.position.y + y, rt.position.z - Math.sin(h) * x + Math.cos(h) * z);
  }

  /** A world point in the auto's frame (ground level). */
  private toLocalAuto(world: THREE.Vector3): THREE.Vector3 {
    const g = this.mira.group.position;
    const rt = this.hero.root;
    const h = rt.rotation.y;
    const dx = world.x - g.x - rt.position.x;
    const dz = world.z - g.z - rt.position.z;
    return new THREE.Vector3(dx * Math.cos(h) - dz * Math.sin(h), 0, dx * Math.sin(h) + dz * Math.cos(h));
  }

  /** You cannot walk through the auto. */
  private keepOut(explore: ExploreControls): void {
    if (!this.hero.root.visible) return;
    const l = this.toLocalAuto(explore.feet);
    const hx = AUTO.half + 0.32;
    const hz = AUTO.length / 2 + 0.3;
    if (Math.abs(l.x) >= hx || Math.abs(l.z) >= hz) return;
    const px = hx - Math.abs(l.x);
    const pz = hz - Math.abs(l.z);
    if (px < pz) l.x = Math.sign(l.x || 1) * hx;
    else l.z = Math.sign(l.z || 1) * hz;
    const w = new THREE.Vector3();
    this.autoToLocal(l.x, 0, l.z, w).add(this.mira.group.position);
    explore.feet.x = w.x;
    explore.feet.z = w.z;
  }

  private putYou(pose: number, amp: number): void {
    this.you.begin();
    this.you.put(this.youLook, this.youAt.x, this.youAt.y, this.youAt.z, this.youH, this.youPhase, amp, pose);
    this.you.end();
  }

  private aimCamera(camera: THREE.PerspectiveCamera, eye: THREE.Vector3, target: THREE.Vector3, dt: number, fov: number, snap: boolean): void {
    const g = this.mira.group.position;
    camera.position.copy(eye).add(g);
    if (snap) this.camLook.copy(target);
    else this.camLook.lerp(target, Math.min(1, dt * 5));
    camera.lookAt(this.camLook.clone().add(g));
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  /** The auto coming up the lane (over your shoulder), then pulling up beside you (from across the lane). */
  private arriveScene(dt: number, camera: THREE.PerspectiveCamera, explore: ExploreControls, stopped: boolean): void {
    const cine = this.cine!;
    const t0 = cine.t;
    cine.t += dt;
    const r = this.route;
    const autoP = this.hero.root.position;
    // You stand at the roadside, turned to watch it come.
    const want = Math.atan2(autoP.x - this.youAt.x, autoP.z - this.youAt.z);
    this.youH += Math.atan2(Math.sin(want - this.youH), Math.cos(want - this.youH)) * Math.min(1, dt * 3);
    this.putYou(0, 0);
    const near = this.sStop - this.s < 11;
    const firstShot = cine.t < 2.6 && !near;
    if (firstShot) {
      const dx = autoP.x - this.youAt.x;
      const dz = autoP.z - this.youAt.z;
      const l = Math.hypot(dx, dz) || 1;
      const eye = new THREE.Vector3(this.youAt.x - (dx / l) * 2.3 + (dz / l) * 0.85, ROAD + 1.62, this.youAt.z - (dz / l) * 2.3 - (dx / l) * 0.85);
      this.aimCamera(camera, eye, new THREE.Vector3(autoP.x, ROAD + 1.0, autoP.z), dt, 46, t0 === 0);
    } else {
      // Across the lane, a little ahead of where it stops, looking back at it and at you.
      const at = r.at(this.sStop + 5.2);
      const eye = new THREE.Vector3(at.x - Math.cos(at.h) * 2.9, ROAD + 1.3, at.z + Math.sin(at.h) * 2.9);
      const mid = new THREE.Vector3((autoP.x + this.youAt.x) / 2, ROAD + 1.0, (autoP.z + this.youAt.z) / 2);
      const was = cine.walk ?? 0;
      cine.walk = 1;
      this.aimCamera(camera, eye, mid, dt, 50, was === 0);
    }
    // Back to your own eyes once it has stopped and he has asked.
    if ((stopped && this.stopT > 2.1) || cine.t > 14) {
      this.endCine();
      camera.fov = 55;
      camera.updateProjectionMatrix();
      const g = this.mira.group.position;
      const door = this.autoToLocal(AUTO.half + 0.2, 0, AUTO.doorOut.z, new THREE.Vector3()).add(g);
      explore.yaw = Math.atan2(-(door.x - explore.feet.x), -(door.z - explore.feet.z));
      explore.pitch = -0.12;
    }
  }

  /** You step up to the doorway, duck in and sit (from outside), then the view from the bench. */
  private boardScene(dt: number, camera: THREE.PerspectiveCamera): void {
    const cine = this.cine!;
    const t0 = cine.t;
    cine.t += dt;
    const from = cine.from!;
    const door = this.autoToLocal(AUTO.half + 0.42, 0, AUTO.doorOut.z, new THREE.Vector3());
    door.y = ROAD;
    const inside = this.autoToLocal(0.12, 0.27, -0.66, new THREE.Vector3());
    const walkT = Math.max(0.5, Math.min(1.8, from.distanceTo(door) / 1.25));
    const h = this.hero.root.rotation.y;
    if (cine.t < walkT) {
      const u = cine.t / walkT;
      this.youAt.copy(from).lerp(door, u);
      this.youH = Math.atan2(door.x - from.x, door.z - from.z);
      this.youPhase += (1.25 * dt * Math.PI * 2) / 1.45;
      this.putYou(0, 1);
    } else if (cine.t < walkT + 0.75) {
      // Up onto the floor and in, turning to face forward.
      const u = sm(0, 1, (cine.t - walkT) / 0.75);
      this.youAt.copy(door).lerp(inside, u);
      this.youAt.y = ROAD + 0.35 * Math.min(1, u * 2) + (inside.y - ROAD - 0.35) * Math.max(0, u * 2 - 1);
      this.youH = h - Math.PI / 2 + (Math.PI / 2) * u;
      this.youPhase += (dt * Math.PI * 2) / 1.45;
      this.putYou(u > 0.7 ? POSE.sit : 0, u > 0.7 ? 0 : 0.6);
    } else {
      this.youAt.copy(inside);
      this.youH = h;
      this.putYou(POSE.sit, 0);
    }
    if (cine.t > walkT + 0.25 && cine.t - dt <= walkT + 0.25) this.heaveV -= 0.3;
    // On the lane's left edge, ahead of the auto, looking back along its side at the doorway.
    const eye = this.autoToLocal(1.55, 1.45, 4.6, new THREE.Vector3());
    eye.y = ROAD + 1.5;
    const tgt = this.autoToLocal(0.75, 0, -0.5, new THREE.Vector3());
    tgt.y = ROAD + 1.05;
    this.aimCamera(camera, eye, tgt, dt, 48, t0 === 0);
    if (cine.t > walkT + 1.35) {
      // Now from the bench: a short settle into the seat.
      this.endCine();
      const inQ = this.seatQuat(new THREE.Quaternion(), 0.5, -0.12, 0);
      this.trans = { t: 0, dur: 0.9, out: false, from: this.toWorld(AUTO.doorIn, new THREE.Vector3()), fromQ: inQ };
      camera.fov = 62;
      camera.updateProjectionMatrix();
    }
  }

  private say(dt: number, en: string, deva: string): void {
    this.lines.push({ at: this.t + dt, en, deva });
    this.lines.sort((a, b) => a.at - b.at);
  }

  /** Speed control: the route's profile, stops, the vehicle and the people ahead. */
  private drive(dt: number, sEnd: number): void {
    const r = this.route;
    const at = r.at(this.s);
    // In the rain the driver takes it easier: slower, braking earlier on the wet road.
    const wet = WEATHER.amount;
    const brake = 1.5 * (1 - 0.25 * wet);
    const stopCurve = (d: number) => (d <= 0.12 ? 0 : Math.sqrt(2 * brake * (d - 0.12)));
    let target = r.profile(this.s) * (1 - 0.16 * wet - 0.06 * WEATHER.heavy);
    target = Math.min(target, stopCurve(sEnd - this.s));
    if (this.phase === 'ride') {
      // Give way before crossing Poonam Sagar Road's southbound side.
      const cross = r.cross;
      if (!this.crossOK) {
        if (this.s > r.sGive - 40 && this.mira.auto.traffic.clear(cross[0], cross[1], 5, 4.2)) {
          if (this.s > r.sGive - 1.5 || this.v > 1.5) this.crossOK = true;
        }
        if (!this.crossOK) target = Math.min(target, stopCurve(r.sGive - this.s));
      }
      // The signal at the junction.
      const sig = this.mira.auto.streets.signal;
      const dSig = r.sSignal - this.s;
      if (dSig > -0.5 && dSig < 70) {
        const light = sig.state(0);
        if (light === 0 || (light === 1 && dSig > (this.v * this.v) / 6 + 1.5)) target = Math.min(target, stopCurve(dSig));
      }
    }
    // Following: vehicles ahead in its path (not those crossing it), people stepping out.
    const traffic = this.mira.auto.traffic;
    const gap = traffic.ahead(at.x, at.z, at.h, 30, AUTO.half, AUTO.length);
    if (gap < 30) target = Math.min(target, Math.max(0, (gap - 1.8) / 1.3));
    // Held up by someone for long, the driver honks and squeezes past (people step aside).
    const ped = this.pedWait > 10 && this.pedWait < 14 ? Infinity : this.mira.crowd.blocking(at.x, at.z, at.h, 13, AUTO.half + 0.25);
    if (ped < 4 && this.v < 0.1) {
      this.pedWait += dt;
      if (this.pedWait > 10 && this.pedWait - dt <= 10) this.cues.horn++;
      if (this.pedWait > 14) this.pedWait = 0;
    } else if (this.v > 1) this.pedWait = 0;
    this.dbg.gap = gap;
    this.dbg.ped = ped;
    if (ped < 13) {
      target = Math.min(target, Math.max(0, (ped - AUTO.length / 2 - 1.4) / 1.2));
      if (ped < 9 && this.v > 1.5 && this.t > this.nextHorn - 6) {
        this.cues.horn++;
        this.nextHorn = this.t + 6;
      }
    }
    // Speed breakers: right down to a crawl.
    for (const h of r.humps) {
      const d = h - this.s;
      if (d > -1.5 && d < 18) target = Math.min(target, Math.max(1.6, d > 2 ? Math.sqrt(1.6 * 1.6 + 2 * 1.4 * (d - 2)) : 1.6));
    }
    // Gears: a moment off the throttle at each change.
    let g = 0;
    while (g < 3 && this.v > GEAR_TOP[g] * 0.92) g++;
    if (g !== this.gear) {
      if (g > this.gear) this.shift = 0.32;
      this.gear = g;
    }
    this.shift = Math.max(0, this.shift - dt);
    this.dbg.target = target;
    const dv = target - this.v;
    let a: number;
    if (dv > 0) a = Math.min(dv / 0.5, (this.gear === 0 ? 1.45 : this.gear === 1 ? 1.2 : 0.8) * (this.shift > 0 ? 0.15 : 1));
    else a = Math.max(dv / 0.35, target < 0.05 && this.v < 2 ? -3.2 : -2.6);
    // A firm, quick stop when something steps out.
    if (dv < -3) a = -4.2;
    this.a += (a - this.a) * Math.min(1, dt * 6);
    this.v = Math.max(0, this.v + this.a * dt);
    if (this.v === 0 && this.a < 0) this.a = 0;
    const ds = this.v * dt;
    this.s = Math.min(r.length, this.s + ds);
    if (this.hired && this.v < 1.2) this.waitS += dt;
    // Engine speed.
    const lo = this.gear === 0 ? 0 : GEAR_TOP[this.gear - 1] * 0.75;
    const f = Math.max(0, Math.min(1.1, (this.v - lo) / (GEAR_TOP[this.gear] - lo)));
    const want = this.v < 0.3 ? 1050 : 1800 + 2600 * f;
    this.rpm += (want - this.rpm) * Math.min(1, dt * (this.shift > 0 ? 14 : 5));
  }

  /** Crossers in front of the auto, the junction's light and the people at it, horns now and then. */
  private events(dt: number): void {
    const r = this.route;
    const streets = this.mira.auto.streets;
    const people = this.mira.crowd;
    streets.crossings.forEach((c, i) => {
      if (this.crossed.has(i) || this.s < c.s - 24 || this.s > c.s - 15) return;
      this.crossed.add(i);
      // From one side to the other, then on along the road.
      const a = r.at(c.s);
      const ux = Math.sin(a.h);
      const uz = Math.cos(a.h);
      const y = ROAD;
      const path = [new THREE.Vector3(c.a[0], y, c.a[1]), new THREE.Vector3(c.b[0], y, c.b[1]), new THREE.Vector3(c.b[0] + ux * 14, y, c.b[1] + uz * 14), new THREE.Vector3(c.b[0] + ux * 30, y, c.b[1] + uz * 30)];
      people.walkPath(path, 'gone', 1.25);
    });
    // The light turns as you come up to it (you wait through the cross traffic's green).
    const sig = streets.signal;
    const dSig = r.sSignal - this.s;
    if (!this.directed && dSig < 95 && dSig > 60) {
      this.directed = true;
      if (sig.state(0) === 2) sig.t = 20.2;
      else if (sig.state(0) === 0) sig.t = Math.max(sig.t, 27.5);
    }
    // While it is red: people cross the zebra in front, a hawker works the queue.
    if (dSig < 4 && dSig > -1 && this.v < 0.2 && sig.state(0) === 0) {
      this.redCrowd += dt;
      const z = streets.zebra;
      if (this.redCrowd > 1.2 && this.redCrowd < 13 && this.rng.chance(dt * 0.55)) {
        const back = this.rng.chance(0.5);
        const [a, b] = back ? [z.b, z.a] : [z.a, z.b];
        const j = this.rng.range(-0.7, 0.7);
        const ux = Math.sin(r.stopLine.h) * j;
        const uz = Math.cos(r.stopLine.h) * j;
        people.walkPath([new THREE.Vector3(a[0] + ux, ROAD, a[1] + uz), new THREE.Vector3(b[0] + ux, ROAD, b[1] + uz), new THREE.Vector3(b[0] + ux * 3 - uz * 4, ROAD, b[1] + uz * 3 + ux * 4)], 'gone', this.rng.range(1.1, 1.5));
      }
      if (this.redCrowd > 3 && this.redCrowd - dt <= 3) {
        // Down the line of waiting vehicles on the left, past your doorway.
        const at = r.at(this.s);
        const lx = Math.cos(at.h);
        const lz = -Math.sin(at.h);
        const ux = Math.sin(at.h);
        const uz = Math.cos(at.h);
        const P = (along: number, side: number) => new THREE.Vector3(at.x + ux * along + lx * side, ROAD, at.z + uz * along + lz * side);
        people.walkPath([P(9, 2.6), P(2, 1.5), P(-0.3, 1.25), P(-4, 1.6), P(-14, 2.3), P(-30, 3.2)], 'gone', 0.9);
      }
    } else if (dSig < -2) this.redCrowd = 0;
    // A horn now and then, as everyone does.
    if (this.t > this.nextHorn && this.v > 2) {
      this.nextHorn = this.t + this.rng.range(10, 24);
      if (this.rng.chance(0.6)) this.cues.horn++;
    }
    // The meter: the minimum fare covers this ride; waiting time ticks at the light.
    this.fare = MIN_FARE;
  }

  /** Sets the auto's transform: on the route, on its springs, wheels and steering. */
  private place(dt: number): void {
    const r = this.route;
    const at = r.at(this.s);
    const root = this.hero.root;
    root.position.set(at.x, ROAD, at.z);
    root.rotation.set(0, at.h, 0);
    // Bumps under the front and rear wheels.
    let hF = 0;
    let hR = 0;
    for (const h of r.humps) {
      hF += bumpHeight(this.s + AUTO.wheelbase / 2 - h);
      hR += bumpHeight(this.s - AUTO.wheelbase / 2 - h);
    }
    // A thump as each axle goes over a breaker.
    if ((hF > 0.03 && this.lastHF <= 0.03) || (hR > 0.03 && this.lastHR <= 0.03)) this.cues.bump++;
    this.lastHF = hF;
    this.lastHR = hR;
    // Springs: heave and pitch chase the road and the braking; roll leans out of turns.
    const k = at.k;
    this.lastKappa = k;
    const pitchT = Math.atan2(hF - hR, AUTO.wheelbase) - this.a * 0.011;
    const heaveT = (hF + hR) / 2;
    const idle = this.v < 0.3 && (this.phase === 'ride' || this.phase === 'arrive' || this.phase === 'arrived' || this.phase === 'board') ? 1 : 0;
    const shake = idle * 0.0016 * Math.sin(this.t * 71) + (0.0014 + 0.00045 * this.v) * Math.sin(this.t * 37.3 + Math.sin(this.t * 5.1) * 3) * Math.min(1, this.v);
    if (dt > 0) {
      const st = Math.min(dt, 1 / 30);
      this.heaveV += (110 * (heaveT - this.heave) - 9 * this.heaveV) * st;
      this.heave += this.heaveV * st;
      this.pitchV += (90 * (pitchT - this.pitchB) - 8 * this.pitchV) * st;
      this.pitchB += this.pitchV * st;
      const rollT = this.v * this.v * k * 0.022;
      this.rollB += (rollT - this.rollB) * Math.min(1, dt * 4);
    }
    // Steering: the front wheel turns into the curve.
    this.steer += (Math.atan(AUTO.wheelbase * k) - this.steer) * Math.min(1, dt * 6);
    // The driver looks into the turns coming up, otherwise mostly ahead.
    const ahead = wrap(r.at(this.s + 14).h - at.h);
    const want = this.lookAt !== 0 ? this.lookAt : Math.abs(ahead) > 0.55 ? Math.sign(ahead) * 0.7 : Math.sin(this.t * 0.31) > 0.93 ? -0.35 : 0;
    this.hero.driverHead += (want - this.hero.driverHead) * Math.min(1, dt * 3);
    this.hero.setLights(this.night, this.a < -0.9 || (this.v < 0.3 && this.phase !== 'away'));
    this.hero.setMeter(this.fare, this.waitS, this.hired);
    this.hero.update(this.v * dt, this.steer, this.pitchB, this.rollB, this.heave + shake, this.t);
    this.hero.updateWiper(dt, WX.uRainTime.value);
    this.mira.auto.traffic.obstacles = [{ x: at.x, z: at.z, h: at.h, len: AUTO.length, half: AUTO.half }];
  }

  /** Mouse look from the seat. */
  private look(dt: number): void {
    const inp = this.input;
    this.yaw -= inp.mouseDX * 0.0022;
    this.pitch -= inp.mouseDY * 0.0022;
    if (inp.down('ArrowLeft')) this.yaw += dt * 1.4;
    if (inp.down('ArrowRight')) this.yaw -= dt * 1.4;
    if (inp.down('ArrowUp')) this.pitch += dt * 0.8;
    if (inp.down('ArrowDown')) this.pitch -= dt * 0.8;
    this.yaw = THREE.MathUtils.clamp(this.yaw, -2.1, 2.1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.55, 0.42);
  }

  /** The passenger's eye in the world (body frame + the head's sway). */
  private eyeWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.toWorld(new THREE.Vector3(AUTO.eye.x + this.head.x, AUTO.eye.y + this.head.y, AUTO.eye.z + this.head.z), out);
  }

  private toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.hero.root.updateMatrixWorld(true);
    return out.copy(local).applyMatrix4(this.hero.body.matrixWorld);
  }

  private seatQuat(out: THREE.Quaternion, yaw: number, pitch: number, roll: number): THREE.Quaternion {
    this.hero.body.matrixWorld.decompose(new THREE.Vector3(), out, new THREE.Vector3());
    return out.multiply(this.tmpQ.setFromEuler(new THREE.Euler(pitch, Math.PI + yaw, roll, 'YXZ')));
  }

  private seatCamera(dt: number, camera: THREE.PerspectiveCamera): void {
    // The head sways against the accelerations (out of turns, forward when braking).
    const aLat = this.v * this.v * this.lastKappa;
    const target = new THREE.Vector3(-aLat * 0.011, 0, -this.a * 0.011).clampLength(0, 0.07);
    const st = Math.min(dt, 1 / 30);
    this.headV.addScaledVector(target.sub(this.head).multiplyScalar(38).sub(this.headV.clone().multiplyScalar(8)), st);
    this.head.addScaledVector(this.headV, st);
    this.eyeWorld(camera.position);
    this.seatQuat(camera.quaternion, this.yaw, this.pitch, -aLat * 0.006);
    const fov = 70;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
  }

  /** Getting in (ducking in at the doorway onto the bench) or out (back out onto the ground). */
  private transition(dt: number, camera: THREE.PerspectiveCamera): void {
    const tr = this.trans!;
    tr.t += dt;
    const u = Math.min(1, tr.t / tr.dur);
    const doorOut = this.toWorld(AUTO.doorOut, new THREE.Vector3());
    const doorIn = this.toWorld(AUTO.doorIn, new THREE.Vector3());
    const seat = this.eyeWorld(new THREE.Vector3());
    const seatQ = this.seatQuat(new THREE.Quaternion(), 0, -0.04, 0);
    // Facing in through the doorway (the auto's right), ducking.
    const inQ = this.seatQuat(new THREE.Quaternion(), -Math.PI / 2 + 0.25, -0.2, 0);
    const pts = tr.out ? [seat, doorIn, doorOut.clone().setY(doorOut.y - 0.25), doorOut] : [tr.from, tr.from.clone().lerp(seat, 0.5).setY(seat.y - 0.08), seat];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const e = u * u * (3 - 2 * u);
    camera.position.copy(curve.getPoint(e));
    if (!tr.out) {
      camera.quaternion.copy(tr.fromQ.clone().slerp(seatQ, sm(0, 1, e)));
    } else {
      // Out on the left, turning to the station (west of the forecourt's gate: the auto's left).
      const outQ = this.seatQuat(new THREE.Quaternion(), Math.PI / 2 - 0.1, -0.05, 0);
      camera.quaternion.copy(e < 0.5 ? seatQ.clone().slerp(inQ, sm(0, 0.5, e)) : inQ.clone().slerp(outQ, sm(0.5, 1, e)));
    }
    const fov = tr.out ? 70 + (55 - 70) * e : 62 + (70 - 62) * e;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    if (u >= 1) {
      this.trans = null;
      this.phaseT = 0;
      if (!tr.out) {
        this.phase = 'ride';
        this.hired = true;
        this.fare = MIN_FARE;
        this.waitS = 0;
        this.cues.beep++;
        this.hooks.toast('Meter on · ₹26 minimum fare');
        const h = this.hooks.hour();
        const hh = Math.floor(h);
        const mm = Math.floor((h - hh) * 60);
        this.hooks.title('Shanti Nagar', 'शांती नगर · सेक्टर २', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · by auto to Mira Road station`);
        window.setTimeout(() => this.hooks.hideTitle(), 4200);
      } else {
        this.phase = 'away';
        const e2 = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        this.hooks.alight(camera.position.x, camera.position.z, e2.y);
      }
    }
  }
}
