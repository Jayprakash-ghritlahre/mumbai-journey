import * as THREE from 'three';
import { Engine, type Quality } from '../core/Engine';
import { Input } from '../core/Input';
import { TextureFactory } from '../gfx/TextureFactory';
import { PRESET_HOURS, type TimePreset } from '../gfx/TimeOfDay';
import { Churchgate } from '../world/churchgate/Churchgate';
import { ExploreControls } from '../camera/ExploreControls';
import { Hud, type ExploreStart } from '../ui/Hud';
import { IMC, MD, NP, VN } from '../world/route/RouteLayout';
import { CinematicPlayer } from '../camera/Cinematic';
import { churchgateShots } from '../world/churchgate/ChurchgateJourney';
import { rideShots } from '../world/journey/RideJourney';
import { Soundscape } from '../audio/Soundscape';
import { RideAudio } from '../audio/RideAudio';
import { Ride } from '../world/journey/Ride';
import type { StretchKey } from '../world/journey/Journey';
import type { AmbientVolume } from '../gfx/AmbientVolume';
import { CAR } from '../entities/train/Livery';
import { RideControls } from '../camera/RideControls';
import { Y } from '../world/churchgate/Layout';
import { TOP as MIRA_TOP } from '../world/miraroad/MiraCtx';

type Mode = 'loading' | 'menu' | 'explore' | 'cinematic' | 'ride';

/** Hours between Mira Road and the chosen time (the ride's clock, ⚠ an estimate of the journey). */
const JOURNEY_LEAD = 1.05;

interface Params {
  quality: Quality;
  time: TimePreset | number;
  mode: Mode | null;
  cam: number[] | null;
  hud: boolean;
  freeze: boolean;
  stats: boolean;
}

function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const time = q.get('time');
  const t = time && /^[\d.]+$/.test(time) ? parseFloat(time) : ((time as TimePreset) ?? 'golden');
  return {
    quality: (q.get('q') as Quality) ?? 'medium',
    time: t,
    mode: (q.get('mode') as Mode) ?? null,
    cam: q.get('cam')?.split(',').map(Number) ?? null,
    hud: q.get('hud') !== '0',
    freeze: q.get('freeze') === '1',
    stats: q.get('stats') === '1',
  };
}

export class App {
  readonly engine: Engine;
  readonly input: Input;
  readonly hud: Hud;
  readonly params = readParams();
  private world!: Churchgate;
  private ride!: Ride;
  private rideControls!: RideControls;
  /** A dissolve in progress to the next leg (interactive ride). */
  private rideFade: { t: number; to: number } | null = null;
  /** Time-lapse offset (hours) the film's shots may add to its clock. */
  private readonly filmClock: { start: number; warp: number; base?: number } = { start: 0, warp: 0 };
  private litHour = 0;
  private litAt = 0;
  private explore!: ExploreControls;
  private mode: Mode = 'loading';
  private lastT = performance.now();
  private time = 0;
  private hour: number;
  private preset: TimePreset;
  private frames = 0;
  private fixedCam = false;
  private cine!: CinematicPlayer;
  private menuEnded = false;
  private cineStartHour = 0;
  private sound: Soundscape | null = null;
  private rideAudio: RideAudio | null = null;
  private cpu = { update: 0, render: 0 };
  private soundOn = true;
  /** Walking round Mira Road (exploring there, or on PF 4 before boarding the ride). */
  private miraWalk = false;
  /** Game hour at which the next Churchgate fast starts its approach to PF 4 (while walking there). */
  private miraNextRide = 0;
  /** The station's materials read Mira Road's ambient light map (it is 38 km from Churchgate's). */
  private avMira = false;
  /** The halt light map in use (Borivali, Dadar), if any. */
  private avHalt: AmbientVolume | null = null;
  /** Game hour the ride's train is due at PF 4 (shown on the boards). */
  private rideDue = 0;
  private cgBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

  constructor(container: HTMLElement) {
    const p = this.params;
    this.engine = new Engine(container, p.quality);
    this.input = new Input(this.engine.renderer.domElement);
    this.preset = typeof p.time === 'number' ? 'golden' : p.time;
    this.hour = typeof p.time === 'number' ? p.time : PRESET_HOURS[p.time];
    this.hud = new Hud(
      container,
      {
        onStartJourney: () => {
          this.ensureSound();
          this.setMode('cinematic');
        },
        onExplore: (where) => {
          this.ensureSound();
          this.startExplore(where);
        },
        onRide: () => {
          this.ensureSound();
          this.startRide();
        },
        onTime: (t) => this.setPreset(t),
        onQuality: (q) => {
          this.engine.setQuality(q);
          this.hud.setQualitySelected(q);
        },
        onSound: (on) => {
          this.soundOn = on;
          this.sound?.setEnabled(on);
        },
        onSkip: () => this.endCinematic(),
        onBackToMenu: () => this.setMode('menu'),
      },
      { time: this.preset, quality: p.quality },
    );
    if (!p.hud) this.hud.root.style.display = 'none';
    this.hud.showStats(p.stats);
    this.engine.renderer.domElement.addEventListener('click', () => {
      if (this.mode === 'explore' || this.mode === 'ride') this.input.requestLock();
    });
    document.addEventListener('pointerlockchange', () => this.hud.setPointerHint(document.pointerLockElement === this.engine.renderer.domElement));
    (window as unknown as { __mj: unknown }).__mj = this.testApi();
    if (import.meta.env.DEV) Object.assign(window, { __app: this, __route: { MD, VN, IMC, NP } });
  }

  async start(): Promise<void> {
    const progress = async (label: string, f: number) => {
      this.hud.setProgress(label, f);
      await new Promise((r) => setTimeout(r, 0));
    };
    await progress('Loading fonts', 0.02);
    await Promise.all([
      document.fonts.load('700 48px "Noto Sans Devanagari"'),
      document.fonts.load('400 48px "Noto Sans Devanagari"'),
      document.fonts.load('700 48px "Noto Sans"'),
      document.fonts.load('400 16px "Inter"'),
    ]).catch(() => undefined);
    await progress('Generating textures', 0.08);
    const tf = new TextureFactory(this.engine.maxAnisotropy);
    this.world = new Churchgate(tf);
    await this.world.build(progress, this.hour);
    this.engine.scene.add(this.world.root);
    this.engine.scene.add(this.world.journey.group);
    this.ride = new Ride(this.world, this.world.railway);
    this.rideControls = new RideControls(this.input);
    this.rideControls.onHint = (t) => this.hud.hint(t);
    this.rideControls.onAlight = (p, yaw, pitch) => this.alight(p, yaw, pitch);
    await progress('Mira Road station', 0.88);
    await this.world.journey.loadMira();
    // The line between: salt pans, Borivali, the suburbs, Mahim Creek, Dadar, the mill lands.
    for (const [k, f] of [
      ['A', 0.9],
      ['BO', 0.905],
      ['B', 0.91],
      ['C', 0.92],
      ['DA', 0.925],
      ['D', 0.93],
    ] as const) {
      await progress('Laying the line to Mira Road', f);
      this.world.journey.stretch(k).group.visible = false;
    }
    if (import.meta.env.DEV) {
      const w = this.world;
      const ride = this.ride;
      const F = CAR.floorY;
      const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      const presets: Record<string, [THREE.Vector3, THREE.Vector3]> = {
        seat: [V(-1.45, F + 1.12, 3.4), V(-7, F + 0.9, 8)],
        seatL: [V(1.45, F + 1.12, 3.4), V(7, F + 0.9, 8)],
        door: [V(CAR.halfW + 0.12, F + 1.56, 0.3), V(CAR.halfW + 1.1, F + 1.2, 30)],
        doorIn: [V(CAR.halfW - 0.3, F + 1.6, 0.3), V(CAR.halfW + 5, F + 0.9, 14)],
        doorBack: [V(CAR.halfW - 0.12, F + 1.62, -0.25), V(CAR.halfW + 3.0, F + 1.0, -25)],
        aisle: [V(0.1, F + 1.66, -7), V(0, F + 1.45, 8)],
        aisleBack: [V(0.1, F + 1.66, 7), V(0, F + 1.5, -8)],
      };
      Object.assign(window, {
        __ride: {
          ride,
          go: (leg: number, t: number, cam = 'seat', hour?: number) => {
            if (hour !== undefined) {
              ride.startHour = hour - ride.clock(leg, t) / 3600;
              this.hour = hour;
              this.engine.setHour(hour);
              ride.start();
            } else if (!ride.active) ride.start();
            ride.set(leg, t);
            this.fixedCam = true;
            const p = presets[cam];
            ride.camRequest = p ? (c, r) => r.placeCamera(c, p[0], p[1]) : null;
          },
          outside: (o: number, y: number, ahead: number) => {
            ride.camRequest = (c, r) => {
              const d = r.state.d + ahead;
              const [x, z] = w.railway.path.point(d, o);
              const [tx, tz] = w.railway.path.point(r.state.d - 30, 0);
              c.position.set(x, y, z);
              c.lookAt(tx, 2.2, tz);
            };
          },
        },
      });
      Object.assign(window, {
        __journey: {
          show: (k: StretchKey | null) => {
            w.journey.show(k);
            w.setFar(k !== null && k !== 'E');
          },
          /** Camera at path distance d (or u km-post when d < 0: −u), offset o, height y; yaw 0 looks towards Churchgate. */
          cam: (d: number, o: number, y: number, yaw = 0, pitch = 0) => {
            const r = w.railway;
            const dd = d < 0 ? r.dOfU(-d) : d;
            const [x, z] = r.path.point(dd, o);
            const h = r.path.heading(dd);
            const cam = this.engine.camera;
            cam.position.set(x, y, z);
            cam.quaternion.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(pitch), h + Math.PI + THREE.MathUtils.degToRad(yaw), 0, 'YXZ'));
            this.fixedCam = true;
          },
          railway: w.railway,
        },
      });
    }
    this.engine.avSource = { map: this.world.av.texture, bounds: this.world.av.uniforms.uAVBounds.value };
    this.explore = new ExploreControls(this.engine.camera, this.input, this.world.collision);
    this.cgBounds = { ...this.explore.bounds };
    this.cine = new CinematicPlayer(this.engine.camera);
    this.cine.onTitle = (t) => (t ? this.hud.title(t[0], t[1], t[2]) : this.hud.hideTitle());
    this.cine.onSub = (s) => (s ? this.hud.sub(s[0], s[1]) : this.hud.hideSub());
    this.cine.onFade = (b) => this.hud.fade(b);
    this.cine.onEnd = () => this.endCinematic();
    this.engine.setHour(this.hour);

    await progress('Compiling shaders', 0.95);
    this.placeDefaultCamera();
    // Compile with every part of the journey shown (stretches, Mira Road, the ridden car).
    const j = this.world.journey;
    const hidden: THREE.Object3D[] = [];
    this.engine.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    // One frame first: it builds the sky's environment map, which every lit program depends on.
    this.engine.render(0.016, 0);
    this.engine.precompile();
    for (const o of hidden) o.visible = false;
    void j;
    this.hud.hideLoading();
    if (new URLSearchParams(location.search).get('sound') === '1') this.ensureSound();
    const where = new URLSearchParams(location.search).get('mode');
    if (where === 'mira') {
      this.setMode('menu');
      this.startMiraWalk('forecourt', false);
    } else this.setMode(this.params.mode ?? 'menu');
    if (this.params.cam) {
      const [x, y, z, yaw, pitch] = this.params.cam;
      this.setCamera(x, y, z, yaw ?? 0, pitch ?? 0);
    }
    this.lastT = performance.now();
    this.loop();
  }

  private placeDefaultCamera(): void {
    // A slow establishing view from the concourse looking up the platforms.
    this.setCamera(-2, 3.2, 9, 0, -2);
    this.fixedCam = false;
  }

  setCamera(x: number, y: number, z: number, yawDeg: number, pitchDeg: number): void {
    const cam = this.engine.camera;
    cam.position.set(x, y, z);
    cam.quaternion.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ'));
    this.fixedCam = true;
    if (this.explore) this.explore.enabled = false;
  }

  private setPreset(t: TimePreset): void {
    this.preset = t;
    this.hour = PRESET_HOURS[t];
    this.engine.setHour(this.hour);
    this.hud.setTimeSelected(t);
  }

  /** Audio needs a user gesture; create the soundscape on the first Start/Explore click. */
  private ensureSound(): void {
    if (this.sound) {
      void this.sound.start();
      return;
    }
    const w = this.world;
    this.sound = new Soundscape({
      trains: w.trains,
      traffic: w.traffic,
      speakers: w.hangings.speakers,
      peopleNear: (p, r) => {
        const mira = w.journey.mira;
        if (!w.far) return [...w.crowd.peopleNear(p, r), ...this.ride.peopleNear(p, r)];
        const extra = mira && this.avMira && !(this.ride.active && this.ride.current.key === 'A') ? mira.crowd.peopleNear(p, r, mira.group.position) : [];
        return [...this.ride.peopleNear(p, r), ...extra];
      },
      interior: (p) => (this.ride.contains(p) ? 0.55 : w.far ? (this.avMira && w.journey.mira ? w.journey.mira.interiorFactor(p) : 0) : w.interiorFactor(p)),
      sea: (p) => {
        const md = MD.axis;
        const q = md.project(p.x, p.z);
        const [x, z] = md.point(q.s, MD.wallOuter);
        return { point: new THREE.Vector3(x, 0, z), d: Math.hypot(p.x - x, p.z - z) };
      },
    });
    this.sound.onSubtitle = (en, deva) => {
      this.hud.sub(en, deva);
      window.setTimeout(() => this.hud.hideSub(), 9000);
    };
    this.rideAudio = new RideAudio(this.sound.audio);
    this.rideAudio.onSubtitle = this.sound.onSubtitle;
    void this.sound.start().then(() => this.sound?.setEnabled(this.soundOn));
  }

  /** Explore from the concourse, from the Marine Drive sea wall, or from wherever the camera is. */
  private startExplore(where: ExploreStart): void {
    if (where === 'mira-road') {
      this.startMiraWalk('forecourt', false);
      return;
    }
    const here = this.engine.camera.position.clone();
    const q = this.engine.camera.quaternion.clone();
    this.setMode('explore');
    if (where === 'marine-drive') {
      const md = MD.axis;
      const s = MD.sNorthCrossing - 6;
      const [x, z] = md.point(s, -20.5);
      const t = md.at(s);
      // Face the sea (−normal) and slightly towards the sun.
      const dx = -t.tz;
      const dz = t.tx;
      this.explore.place(x, z, Math.atan2(-dx, -dz) - 0.3, 0);
    } else if (where === 'nariman-point') {
      // At the tip, looking back north along the Queen's Necklace.
      const v = this.world.route.np.tipView;
      this.explore.place(v.x, v.z, v.ry, 0);
    } else if (where === 'here') {
      this.engine.camera.position.copy(here);
      this.engine.camera.quaternion.copy(q);
      // Step down to the nearest walkable spot below the (possibly airborne) cinematic camera.
      if (here.y > 4 || this.world.route.walk.sample(here.x, here.z) < -0.5) {
        const md = MD.axis;
        const [x, z] = md.point(MD.sNorthCrossing - 3, MD.promenade + 0.8);
        this.engine.camera.position.set(x, 2, z);
      }
      this.explore.takeOverFromCamera();
    }
  }

  /** "Ride the local": on Mira Road's PF 4 as the Churchgate fast comes in; walk aboard. */
  private startRide(): void {
    this.hour = (typeof this.params.time === 'number' ? this.params.time : PRESET_HOURS[this.preset]) - JOURNEY_LEAD;
    this.engine.setHour(this.hour);
    this.litHour = this.hour;
    this.startMiraWalk('pf4', true);
  }

  /**
   * Walk round Mira Road station (explore mode with its own collision world). The Churchgate fast
   * comes into PF 4 on its timetable; walk in through an open door of the second coach to ride.
   */
  private startMiraWalk(spawn: 'forecourt' | 'pf4', rideNow: boolean): void {
    const mira = this.world.journey.mira;
    if (!mira) return;
    if (this.ride.active) this.ride.stop();
    this.setMode('explore');
    this.world.journey.show('A');
    this.world.setFar(true);
    this.miraWalk = true;
    this.explore.world = mira.collision;
    this.explore.bounds = mira.bounds;
    const sp = mira.spawns[spawn];
    this.explore.place(sp.x, sp.z, sp.yaw, 0, spawn === 'pf4' ? MIRA_TOP : undefined);
    this.litHour = -1;
    if (rideNow) this.startRideAtMira();
    else this.miraNextRide = this.hour + 2.5 / 60;
    this.hud.toast('Mira Road · मिरा रोड');
  }

  /** The Churchgate fast starts its approach (it stops at PF 4 about 38 s later). */
  private startRideAtMira(): void {
    this.ride.startHour = this.hour;
    this.ride.start();
    this.ride.camRequest = null;
    this.rideAudio?.reset();
    this.rideControls.begin(this.ride, this.ride.restFrame(this.world.railway.dMiraRoad));
  }

  /** Back from Mira Road to the Churchgate world (menu, other explore starts). */
  private leaveMira(): void {
    if (!this.miraWalk) return;
    this.miraWalk = false;
    if (this.ride.active) this.ride.stop();
    else {
      this.world.journey.show(null);
      this.world.setFar(false);
    }
    this.explore.world = this.world.collision;
    this.explore.bounds = { ...this.cgBounds };
    this.hud.hint(null);
  }

  /** Walking at Mira Road: the ride's train comes, waits for you on PF 4, and you step aboard. */
  private updateMiraWalk(dt: number): void {
    const mira = this.world.journey.mira!;
    const ride = this.ride;
    if (!ride.active) {
      mira.timetable.rideAt = this.miraNextRide + 45 / 3600;
      if (this.hour >= this.miraNextRide) this.startRideAtMira();
      return;
    }
    // Where the player stands in the car's frame (+x towards PF 4, +z towards Churchgate).
    const lp = this.explore.feet.clone().applyMatrix4(ride.frame.clone().invert());
    const onPf4 = Math.abs(this.explore.feet.y - MIRA_TOP) < 0.3 && lp.x > CAR.halfW - 0.4 && lp.x < 24 && lp.z > -260 && lp.z < 45;
    const st = ride.state;
    const open = st.stopped && st.doors > 0.9;
    // It waits while you are on the platform beside it (the clock keeps going).
    if (ride.t > 62 && onPf4 && st.stopped) ride.startHour += dt / 3600;
    else ride.t += dt;
    const door = CAR.doors.find((d) => Math.abs(lp.z + d) < CAR.doorW / 2 - 0.1);
    if (open && door !== undefined && lp.x < CAR.halfW + 0.75) {
      const frameYaw = new THREE.Euler().setFromRotationMatrix(ride.frame, 'YXZ').y;
      this.rideControls.boardAt(new THREE.Vector3(CAR.halfW - 0.3, 0, lp.z), this.explore.yaw - frameYaw, this.explore.pitch);
      this.miraWalk = false;
      this.mode = 'ride';
      this.explore.enabled = false;
      this.explore.world = this.world.collision;
      this.explore.bounds = { ...this.cgBounds };
      ride.camRequest = (cam, r) => this.rideControls.apply(cam, r);
      this.hud.setHints('ride');
      this.hud.hint(null);
      this.hud.toast('On board · Churchgate fast');
      return;
    }
    // A door of another coach: they are packed.
    const other = open && Math.abs(this.explore.feet.y - MIRA_TOP) < 0.3 && lp.x < CAR.halfW + 0.5 && lp.x > CAR.halfW - 0.5 && (lp.z < -CAR.length / 2 || lp.z > CAR.length / 2);
    if (ride.t < 36) this.hud.hint(onPf4 || lp.z > -300 ? 'Platform 4 · the Churchgate fast is coming in' : null);
    else if (open && other) this.hud.hint('This coach is packed · the second coach from the Churchgate end has room');
    else if (open) this.hud.hint('Churchgate fast on platform 4 · board the second coach from the front (south end)');
    else this.hud.hint(null);
    // It left without you: the next one in a few minutes.
    if (ride.t > 128) {
      ride.park();
      this.miraNextRide = this.hour + 7 / 60;
      this.hud.hint(null);
      this.hud.toast('Missed it · next Churchgate fast in 7 min');
    }
  }

  /** Stepped off at Churchgate: carry on on foot. */
  private alight(p: THREE.Vector3, yaw: number, pitch: number): void {
    this.explore.world = this.world.collision;
    this.explore.bounds = { ...this.cgBounds };
    this.ride.camRequest = null;
    this.hud.hint(null);
    this.hud.setHints('explore');
    this.mode = 'explore';
    this.explore.enabled = true;
    this.explore.place(p.x, p.z, yaw, pitch, Y.platform);
    this.hud.toast('Churchgate · चर्चगेट');
  }

  /** Interactive ride: advance the schedule, dissolve between legs, hold for boarding. */
  private updateRide(dt: number): void {
    const ride = this.ride;
    const rc = this.rideControls;
    rc.update(dt, ride);
    const leg = ride.current;
    const last = ride.leg === ride.legs.length - 1;
    if (this.rideFade) {
      this.rideFade.t += dt;
      if (this.rideFade.t > 0.9 && this.rideFade.to >= 0) {
        ride.set(this.rideFade.to, 0);
        this.rideFade.to = -1;
        this.hour = ride.hourAt(ride.leg, ride.t);
        this.engine.setHour(this.hour);
        this.litHour = this.hour;
        this.hud.fade(false);
        this.hud.title(ride.current.title[0], ride.current.title[1], ride.current.title[2]);
        window.setTimeout(() => this.hud.hideTitle(), 4000);
      }
      if (this.rideFade.t > 1.6) this.rideFade = null;
      return;
    }
    // The train waits at Mira Road until the player is aboard.
    const holding = leg.key === 'A' && rc.where === 'platform' && ride.t > 62;
    if (!holding) ride.t += dt;
    const end = ride.t >= leg.duration && !last;
    const skip = this.input.hit('KeyN') && rc.where !== 'platform' && !last && !(leg.key === 'A' && ride.t < 90);
    if (end || skip) {
      this.rideFade = { t: 0, to: ride.leg + 1 };
      this.hud.fade(true);
    }
    // The game clock follows the ride's.
    this.hour = ride.hourAt(ride.leg, ride.t);
  }

  private endCinematic(): void {
    this.cine.stop();
    this.ride.camRequest = null;
    if (this.ride.active) this.ride.stop();
    this.world.crowd.setPlayer(null);
    this.hud.cinematic(false);
    this.hud.fade(false);
    this.hud.showEnd(true);
    this.menuEnded = true;
    this.mode = 'menu';
    this.fixedCam = false;
  }

  private setMode(mode: Mode): void {
    if (mode !== 'ride') this.leaveMira();
    this.mode = mode;
    if (mode === 'cinematic') {
      this.hud.showMenu(false);
      this.hud.showHud(false);
      this.hud.showEnd(false);
      this.hud.cinematic(true);
      this.explore.enabled = false;
      this.fixedCam = false;
      this.input.releaseLock();
      // The film starts at Mira Road about an hour before the chosen time, so it reaches
      // Churchgate and Marine Drive at that time (the ride skips most of the hour).
      this.hour -= JOURNEY_LEAD;
      this.engine.setHour(this.hour);
      this.cineStartHour = this.hour;
      this.filmClock.start = this.hour;
      this.filmClock.warp = 0;
      this.filmClock.base = 0;
      this.litHour = this.hour;
      this.ride.startHour = this.hour;
      const ride = rideShots({ ride: this.ride, railway: this.world.railway, clock: this.filmClock });
      const arrive = this.ride.hourAt(this.ride.legs.length - 1, this.ride.legs[this.ride.legs.length - 1].duration);
      const cg = churchgateShots({ trains: this.world.trains, crowd: this.world.crowd, timetable: this.world.timetable, startHour: arrive, route: this.world.route, clock: this.filmClock, byTrain: true });
      // Leaving the ride's cameras: the station shots place the camera themselves.
      const enter0 = cg[0].enter;
      cg[0].enter = () => {
        this.ride.camRequest = null;
        enter0?.();
      };
      this.cine.play([...ride, ...cg]);
      return;
    }
    this.hud.showMenu(mode === 'menu');
    this.hud.showHud(mode === 'explore' || mode === 'ride');
    if (mode !== 'ride') {
      this.hud.hint(null);
      this.hud.setHints('explore');
      this.rideFade = null;
      if (this.ride?.active && mode === 'menu') this.ride.stop();
    }
    this.hud.showEnd(false);
    this.hud.cinematic(false);
    this.menuEnded = false;
    if (mode === 'explore') {
      this.fixedCam = false;
      this.explore.enabled = true;
      // Start on the concourse by the platform 3 buffer stop, facing up the platforms.
      this.explore.place(0, 6, 0);
      this.hud.setPointerHint(false);
    } else if (mode === 'ride') {
      this.fixedCam = false;
      this.explore.enabled = false;
      this.hud.setPointerHint(false);
    } else {
      this.explore.enabled = false;
      this.input.releaseLock();
    }
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    if (!this.params.freeze) this.time += dt;
    const t0 = performance.now();
    this.update(dt);
    const t1 = performance.now();
    this.engine.render(dt, this.time);
    const t2 = performance.now();
    this.cpu.update = this.cpu.update * 0.95 + (t1 - t0) * 0.05;
    this.cpu.render = this.cpu.render * 0.95 + (t2 - t1) * 0.05;
    this.input.endFrame();
    this.frames++;
    if (this.params.stats || this.frames % 30 === 0) {
      const s = this.engine.stats;
      this.hud.setStats(`${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms  ${s.drawCalls} draws  ${(s.triangles / 1000).toFixed(0)}k tris  pr ${s.pixelRatio.toFixed(2)}`);
    }
  };

  private update(dt: number): void {
    if (this.mode === 'ride') {
      this.updateRide(dt);
      if (this.input.hit('Escape')) this.setMode('menu');
      if (this.input.hit('Backquote')) this.hud.showStats(!this.hud.statsVisible);
    } else if (this.mode === 'explore' && !this.fixedCam) {
      this.explore.update(dt);
      if (this.miraWalk) this.updateMiraWalk(dt);
      if (this.input.hit('Escape')) this.setMode('menu');
      if (this.input.hit('Backquote')) this.hud.showStats(!this.hud.statsVisible);
      if (this.input.hit('KeyT')) {
        const order: TimePreset[] = ['morning', 'afternoon', 'golden', 'night'];
        this.setPreset(order[(order.indexOf(this.preset) + 1) % order.length]);
        this.hud.toast(this.preset === 'golden' ? 'Golden hour' : this.preset[0].toUpperCase() + this.preset.slice(1));
        if (this.miraWalk) {
          // A new time: the next train is a couple of minutes off.
          this.ride.park();
          this.miraNextRide = this.hour + 1.5 / 60;
        }
      }
    } else if (this.mode === 'cinematic') {
      this.cine.update(dt);
      // The film's clock: real time from the start, plus any time-lapse the shots ask for. The
      // lighting follows it (re-lit at most a few times a second).
      this.hour = this.cineStartHour + this.cine.T / 3600 + this.filmClock.warp;
      const nowMs = performance.now();
      if (Math.abs(this.hour - this.litHour) > 0.004 && nowMs - this.litAt > 250) {
        this.engine.setHour(this.hour);
        this.litHour = this.hour;
        this.litAt = nowMs;
      }
      if (this.input.hit('Escape')) this.endCinematic();
    } else if (this.mode === 'menu' && !this.fixedCam && !this.menuEnded) {
      // Gentle drift for the menu backdrop.
      const t = this.time * 0.02;
      const cam = this.engine.camera;
      cam.position.set(-2 + Math.sin(t) * 1.5, 3.2 + Math.sin(t * 0.7) * 0.2, 9 - t * 2 % 30);
      cam.quaternion.setFromEuler(new THREE.Euler(-0.03, Math.sin(t * 0.5) * 0.08, 0, 'YXZ'));
    }
    // The game clock runs in real time from the chosen preset (the ride sets its own).
    if (!this.params.freeze && this.mode !== 'ride') this.hour += dt / 3600;
    if (this.mode === 'ride') {
      const nowMs = performance.now();
      if (Math.abs(this.hour - this.litHour) > 0.004 && nowMs - this.litAt > 250) {
        this.engine.setHour(this.hour);
        this.litHour = this.hour;
        this.litAt = nowMs;
      }
    }
    const light = this.engine.lighting;
    this.world.update(dt, this.time, light, this.hour, this.engine.camera);
    this.ride.update(dt, this.time, light.lamps, this.engine.camera);
    this.sound?.update(dt, this.engine.camera, this.hour);
    if (this.sound && this.sound.audio.ctx.state === 'running') this.rideAudio?.update(dt, this.engine.camera, this.ride);
    // Mira Road has its own ambient light map; the materials read it while the scenery is there.
    const mira = this.world.journey.mira;
    const wantMira = !!mira && this.world.far && this.world.journey.current === 'A';
    // Borivali and Dadar have their own light maps too (HALTS.md).
    const haltAV = this.world.far ? this.world.journey.haltAV() : null;
    if (wantMira !== this.avMira || haltAV !== this.avHalt) {
      this.avMira = wantMira;
      this.avHalt = haltAV;
      const src = wantMira ? mira!.av : haltAV;
      this.world.av.useSource(src);
      this.engine.avSource = { map: (src ?? this.world.av).texture, bounds: this.world.av.uniforms.uAVBounds.value };
    }
    // The Churchgate fast on PF 4's boards: its time is fixed when it sets off (it may wait for you).
    if (mira && this.ride.active && this.ride.current.key === 'A') {
      if (this.ride.t < 1 || !this.rideDue) this.rideDue = this.ride.hourAt(0, 45);
      mira.timetable.rideAt = this.rideDue;
    } else if (!this.ride.active) this.rideDue = 0;
    const inCar = this.ride.contains(this.engine.camera.position);
    const interior = inCar ? 0.62 : this.world.far ? (wantMira ? mira!.interiorFactor(this.engine.camera.position) : 0) : this.world.interiorFactor(this.engine.camera.position);
    this.engine.sunVisibleFromCamera = 1 - 0.85 * interior;
    this.engine.interior = interior;
    // Eyes adapt to the dimmer shed by day; at night the lamp-lit shed is the bright place.
    this.engine.exposureBias = 1 + interior * 0.65 * (1 - light.lamps) - interior * 0.12 * light.lamps;
    const cp = this.engine.camera.position;
    const zone = this.world.far ? null : this.world.route.layout.zoneAt(cp.x, cp.z, cp.y);
    const miraPlace = wantMira && !inCar ? mira!.placeAt(cp) : null;
    if (miraPlace) this.hud.setLocation(miraPlace[0], miraPlace[1]);
    else if (this.ride.active && (this.world.far || !zone)) this.hud.setLocation(this.ride.current.title[0], this.ride.current.title[1]);
    else if (zone) this.hud.setLocation(zone.en, zone.deva);
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    this.hud.setClock(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} IST`);
  }

  private testApi() {
    return {
      ready: () => this.mode !== 'loading' && this.frames > 5,
      frames: () => this.frames,
      stats: () => ({ ...this.engine.stats, cpuUpdate: this.cpu.update, cpuRender: this.cpu.render, mode: this.mode, people: this.world?.crowd?.count ?? 0, shot: this.cine?.currentShot ?? '', T: this.cine?.T ?? 0 }),
      setCamera: (x: number, y: number, z: number, yaw: number, pitch: number) => this.setCamera(x, y, z, yaw, pitch),
      setHour: (h: number) => {
        this.hour = h;
        this.engine.setHour(h);
      },
      setQuality: (q: Quality) => this.engine.setQuality(q),
      cam: () => this.engine.camera.position.toArray().map((v) => +v.toFixed(2)),
      profile: () => {
        const out: Record<string, number> = {};
        this.world.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.visible) return;
          const g = m.geometry;
          const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
          const inst = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : 1;
          let top: THREE.Object3D = m;
          while (top.parent && top.parent !== this.world.root) top = top.parent;
          const k = top.name || m.name || 'anon';
          out[k] = (out[k] ?? 0) + Math.round(tris * inst);
        });
        return out;
      },
      seek: (T: number) => {
        if (this.mode !== 'cinematic') return;
        this.hour = this.cineStartHour + T / 3600;
        this.cine.seek(T);
        this.hour = this.cineStartHour + T / 3600 + this.filmClock.warp;
        this.engine.setHour(this.hour);
        this.litHour = this.hour;
      },
      audio: () => (this.sound ? { state: this.sound.audio.ctx.state, time: this.sound.audio.ctx.currentTime } : null),
    };
  }
}
