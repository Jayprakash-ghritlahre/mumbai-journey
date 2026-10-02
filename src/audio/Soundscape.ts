import * as THREE from 'three';
import { AudioEngine } from './AudioEngine';
import { CrowdBed, SeaBed, StreetBed, TrainVoice, babble, chime, crow, footstep, honk, pigeon } from './Synth';
import type { TrainSystem, TrainView } from '../entities/train/TrainSystem';
import type { Service } from '../entities/train/Timetable';
import { fmtTime } from '../entities/train/Timetable';

export interface SoundWorld {
  trains: TrainSystem;
  /** Vehicles near a point (horns). */
  traffic: { nearby(p: THREE.Vector3, r: number): { pos: THREE.Vector3; speed: number; kind: string }[] };
  speakers: THREE.Vector3[];
  /** Positions of people near a point: walking flag and position. */
  peopleNear: (p: THREE.Vector3, r: number) => { pos: THREE.Vector3; walking: boolean }[];
  interior: (p: THREE.Vector3) => number;
  /** How much road traffic is around a point (0 none … 1 a busy street). */
  street: (p: THREE.Vector3) => number;
  /** Nearest point of the Marine Drive sea wall and the distance to it. */
  sea?: (p: THREE.Vector3) => { point: THREE.Vector3; d: number };
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** How far from the nearest of Churchgate's PA speakers an announcement carries (m) ⚠. */
const PA_RANGE = 90;

/** Drives all procedural audio from the world state each frame. */
export class Soundscape {
  readonly audio: AudioEngine;
  private crowd: CrowdBed;
  private street: StreetBed;
  private seaBed: SeaBed;
  private voices: TrainVoice[] = [];
  private tBabble = 0;
  private tStep = 0;
  private tHonk = 2;
  private tBird = 6;
  private tAnnounce = 25;
  private lastState: string[] = [];
  private announced = new Set<number>();
  private walked = 0;
  private lastCam = new THREE.Vector3();
  /** Traffic around the listener (re-sampled twice a second). */
  private streetK = 0;
  private tStreet = 0;
  onSubtitle: (en: string, deva: string) => void = () => {};
  speech = true;

  constructor(private readonly world: SoundWorld) {
    this.audio = new AudioEngine();
    this.crowd = new CrowdBed(this.audio);
    this.street = new StreetBed(this.audio);
    this.seaBed = new SeaBed(this.audio);
    for (let i = 0; i < world.trains.views.length; i++) this.voices.push(new TrainVoice(this.audio));
    world.trains.on((e) => this.onTrain(e.type, e.train));
    this.lastState = world.trains.views.map(() => 'hidden');
  }

  async start(): Promise<void> {
    await this.audio.resume();
  }

  setEnabled(on: boolean): void {
    this.audio.setEnabled(on);
  }

  /** How well Churchgate's PA carries to the listener (0 beyond PA_RANGE of every speaker). */
  private paReach(): number {
    let k = 0;
    for (const s of this.world.speakers) k = Math.max(k, this.audio.reach(s, PA_RANGE));
    return k;
  }

  private onTrain(type: string, v: TrainView): void {
    const i = v.pf - 1;
    if (type === 'departing') this.voices[i]?.horn(1.2);
    if (type === 'approaching') window.setTimeout(() => this.voices[i]?.horn(0.8), 20000);
    if (type === 'arrived' && v.service) window.setTimeout(() => this.announce(v.service!), 9000);
  }

  /**
   * PA chime + trilingual departure announcement (Marathi, Hindi, English), heard only within reach
   * of the station's speakers. Returns false when the listener is out of reach (it is not marked as
   * made, so the periodic call can still make it if they come back while the train stands).
   */
  announce(s: Service): boolean {
    if (!this.audio.enabled || this.announced.has(s.id) || this.paReach() <= 0.001) return false;
    this.announced.add(s.id);
    this.tAnnounce = rnd(70, 110);
    const cam = this.audio.listener;
    const near = [...this.world.speakers].sort((a, b) => a.distanceToSquared(cam) - b.distanceToSquared(cam)).slice(0, 3);
    const wait = chime(this.audio, near);
    const time = fmtTime(s.depart);
    const destEn = s.dest.charAt(0) + s.dest.slice(1).toLowerCase();
    const slowFastMr = s.mode === 'S' ? 'धीमी' : 'जलद';
    const slowFastHi = s.mode === 'S' ? 'धीमी' : 'तेज़';
    const mr = `प्रवाशांनी कृपया लक्ष द्यावे. फलाट क्रमांक ${s.platform} वरून ${time} ची ${s.destDeva} ${slowFastMr} लोकल सुटेल.`;
    const hi = `यात्रीगण कृपया ध्यान दें. प्लेटफॉर्म क्रमांक ${s.platform} से ${time} की ${s.destDeva} ${slowFastHi} लोकल जाएगी.`;
    const en = `Attention please. The ${time} ${destEn} ${s.mode === 'S' ? 'slow' : 'fast'} local will depart from platform number ${s.platform}.`;
    this.onSubtitle(en, hi);
    if (this.speech)
      this.audio.speak(
        [
          [mr, 'mr-IN'],
          [hi, 'hi-IN'],
          [en, 'en-IN'],
        ],
        wait,
        () => this.paReach(),
      );
    return true;
  }

  update(dt: number, camera: THREE.Camera, hour: number): void {
    if (this.audio.ctx.state !== 'running') return;
    const a = this.audio;
    const t = a.ctx.currentTime;
    const cam = camera.position;
    a.updateListener(camera);
    a.updateSpeech();
    const interior = this.world.interior(cam);
    a.setSpace(interior);
    const people = this.world.peopleNear(cam, 16);
    const density = Math.min(1, people.length / 45);
    this.crowd.update((0.06 + 0.5 * density) * (0.45 + 0.55 * interior));
    this.tStreet -= dt;
    if (this.tStreet <= 0) {
      this.tStreet = 0.5;
      this.streetK = this.world.street(cam);
    }
    this.street.update((0.03 + 0.4 * this.streetK) * (1 - 0.6 * interior), t);
    if (this.world.sea) {
      const sea = this.world.sea(cam);
      this.seaBed.update(dt, sea.point, sea.d);
    }

    // Voices around the listener.
    this.tBabble -= dt;
    if (this.tBabble <= 0 && people.length) {
      this.tBabble = rnd(0.12, 0.5) / (0.3 + density);
      const p = people[Math.floor(Math.random() * people.length)].pos.clone();
      p.y += 1.5;
      babble(a, p, 0.8);
    }
    // Other people's footsteps.
    this.tStep -= dt;
    const walkers = people.filter((p) => p.walking && p.pos.distanceToSquared(cam) < 64);
    if (this.tStep <= 0 && walkers.length) {
      this.tStep = rnd(0.04, 0.2) / Math.min(4, walkers.length * 0.4);
      const w = walkers[Math.floor(Math.random() * walkers.length)];
      footstep(a, w.pos, 0.35, interior > 0.3);
    }
    // Our own footsteps (walking camera in explore or cinematic).
    const moved = this.lastCam.distanceTo(cam);
    if (moved < 1.2) this.walked += moved;
    if (this.walked > 0.72) {
      this.walked = 0;
      footstep(a, cam.clone().add(new THREE.Vector3(0, -1.5, 0)), 0.9, interior > 0.3);
    }
    this.lastCam.copy(cam);

    // Trains.
    const views = this.world.trains.views;
    views.forEach((v, i) => {
      const pos = new THREE.Vector3(v.x, 2, THREE.MathUtils.clamp(cam.z, v.headZ - 250, v.headZ));
      this.voices[i].update(dt, pos, v.speed, v.state !== 'hidden');
      this.lastState[i] = v.state;
    });

    // Horns on the street.
    this.tHonk -= dt;
    if (this.tHonk <= 0) {
      this.tHonk = rnd(0.8, 3.2) / (0.4 + (1 - interior));
      const cars = this.world.traffic.nearby(cam, 90).filter((c) => c.speed > 0.5 || Math.random() < 0.3);
      if (cars.length) {
        const c = cars[Math.floor(Math.random() * cars.length)];
        honk(a, c.pos.clone().setY(1), c.kind === 'bus' || c.kind === 'doubleDecker');
      }
    }
    // Crows outside, pigeons in the roof.
    this.tBird -= dt;
    if (this.tBird <= 0) {
      this.tBird = rnd(6, 16);
      const dir = new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)).normalize();
      if (interior > 0.5) pigeon(a, cam.clone().add(dir.multiplyScalar(rnd(6, 20))).setY(rnd(10, 14)));
      else crow(a, cam.clone().add(dir.multiplyScalar(rnd(10, 40))).setY(rnd(6, 18)));
    }
    // Periodic announcements for upcoming departures when nothing else triggers one.
    this.tAnnounce -= dt;
    if (this.tAnnounce <= 0 && interior > 0.4) {
      const v = views.find((x) => x.state === 'dwell' && x.service && !this.announced.has(x.service.id));
      if (!v?.service || !this.announce(v.service)) this.tAnnounce = 20;
    }
    void hour;
  }
}
