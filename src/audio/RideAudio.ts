import * as THREE from 'three';
import type { AudioEngine } from './AudioEngine';
import { TrainVoice, chime, env } from './Synth';
import type { HaltStop, Ride } from '../world/journey/Ride';
import { CAR } from '../entities/train/Livery';

/** How far the station PA carries at Mira Road (from PF 4's speakers) and at the halts (m) ⚠. */
const STATION_PA_RANGE = 120;
/** The car's own PA: heard in the car and just outside its doors. */
const CAR_PA_RANGE = 25;

/**
 * Sounds of riding the local (procedural, like the rest of the soundscape): the car's own rumble,
 * wheel clatter and traction whine under the floor, wind and the open-door roar that grows with
 * speed near the doorway, the ceiling fans, door leaves sliding, horns, and locals passing on the
 * next line. Mira Road gets a platform announcement for the incoming Churchgate fast; at Borivali
 * and Dadar the car's PA names the next station, the station PA calls the train, and the guard's
 * bell rings before it starts.
 */
export class RideAudio {
  private readonly own: TrainVoice;
  private readonly passing: TrainVoice;
  private readonly wind: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly fans: GainNode;
  private readonly cabin: GainNode;
  private lastDoors = -1;
  private hornDone = new Set<string>();
  private announced = false;
  private lastLeg = -1;
  /** Mira Road PF 4's PA speakers (world), along the platform where the Churchgate fast stands. */
  private pf4: THREE.Vector3[] | null = null;
  onSubtitle: (en: string, deva: string) => void = () => {};

  /** `dMira`: path distance of the lead end of the Churchgate fast standing at Mira Road's PF 4. */
  constructor(
    private readonly a: AudioEngine,
    private readonly dMira: number,
  ) {
    const ctx = a.ctx;
    this.own = new TrainVoice(a);
    this.passing = new TrainVoice(a);
    // Wind: low-passed noise, a roar that opens up and grows with speed (not a hiss).
    const n = a.noiseSource('pink');
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windFilter.Q.value = 0.6;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    n.connect(this.windFilter).connect(this.wind).connect(a.dry);
    n.start();
    // Cabin: the low boom of the body on its springs.
    const b = a.noiseSource('brown');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    this.cabin = ctx.createGain();
    this.cabin.gain.value = 0;
    b.connect(lp).connect(this.cabin).connect(a.dry);
    b.start();
    // Fans: a hum and a soft whirr.
    this.fans = ctx.createGain();
    this.fans.gain.value = 0;
    const hum = ctx.createOscillator();
    hum.frequency.value = 100;
    const hg = ctx.createGain();
    hg.gain.value = 0.25;
    hum.connect(hg).connect(this.fans);
    hum.start();
    const w = a.noiseSource('pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.4;
    w.connect(bp).connect(this.fans);
    w.start();
    this.fans.connect(a.dry);
  }

  update(dt: number, camera: THREE.Camera, ride: Ride): void {
    const t = this.a.ctx.currentTime;
    const on = ride.active;
    const cam = camera.position;
    const inCar = on && ride.contains(cam);
    const st = ride.state;
    // Where in the car is the listener: 1 at an open doorway, 0 in the middle.
    const local = cam.clone().applyMatrix4(ride.frame.clone().invert());
    const nearDoor = inCar || Math.abs(local.x) < CAR.halfW + 1 ? Math.min(1, Math.max(0, (Math.abs(local.x) - 0.9) / 1.0)) * (CAR.doors.some((z) => Math.abs(local.z + z) < 1.2) ? 1 : 0.35) : 0;
    const near = on && local.length() < 14;
    const v = st.v;
    // Our train: under the floor when riding, else where it is.
    const pos = near ? cam.clone().add(new THREE.Vector3(0, -1.6, 0)) : ride.toWorld(new THREE.Vector3(0, 1, 0));
    this.own.update(dt, pos, v, on);
    const open = st.doors;
    // In gusts, as the air round the doorway changes.
    const gust = 0.78 + 0.22 * Math.sin(t * 0.73) * Math.sin(t * 1.91 + 1.2);
    this.wind.gain.setTargetAtTime(near ? Math.min(0.3, (v / 22) ** 2 * (0.05 + 0.25 * nearDoor * open)) * gust : 0, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(220 + v * 24, t, 0.3);
    this.cabin.gain.setTargetAtTime(near ? Math.min(0.5, v * 0.022) * (1 - 0.3 * nearDoor) : 0, t, 0.3);
    this.fans.gain.setTargetAtTime(inCar ? 0.018 : 0, t, 0.5);
    // Door leaves sliding.
    if (this.lastDoors >= 0 && near && Math.abs(open - this.lastDoors) > 0.02 && (open < 0.05 || open > 0.95) !== (this.lastDoors < 0.05 || this.lastDoors > 0.95)) this.slide(open > this.lastDoors);
    this.lastDoors = open;
    // Horns: approaching Mira Road, leaving it, and passing trains; the final run into Churchgate.
    const leg = ride.current;
    if (ride.leg !== this.lastLeg) {
      this.lastLeg = ride.leg;
      this.hornDone.clear();
    }
    const once = (key: string, cond: boolean, dur: number) => {
      if (cond && !this.hornDone.has(key)) {
        this.hornDone.add(key);
        this.own.horn(dur);
      }
    };
    if (leg.key === 'A') {
      once('in', ride.t > 3 && ride.t < 8, 1.4);
      once('out', ride.t > 69 && ride.t < 72, 0.9);
      // Platform announcement for the incoming train, for those on and around the station.
      if (on && !this.announced && ride.t < 20 && !near && this.miraReach(ride) > 0.001) this.announce(ride);
    }
    if (leg.handoverAt !== undefined) once('cg', ride.t > leg.handoverAt + 60 && ride.t < leg.handoverAt + 70, 0.8);
    const stop = leg.stop;
    if (stop) {
      const tau = ride.t - stop.at;
      once('in', ride.t > 2 && ride.t < 6, 1.2);
      once('out', tau > stop.dwell - 0.9 && tau < stop.dwell + 2, 0.9);
      const event = (key: string, cond: boolean, fn: () => void) => {
        if (cond && !this.hornDone.has(key)) {
          this.hornDone.add(key);
          fn();
        }
      };
      event('pa-next', tau > -32 && tau < -18 && near, () => this.nextStation(stop, ride));
      event('pa-platform', tau > 6 && tau < 14 && inCar, () => this.platformCall(stop, cam, ride));
      event('bell', tau > stop.dwell - 6.5 && tau < stop.dwell - 3, () => this.bell(ride.toWorld(new THREE.Vector3(0, 3, 0))));
    }
    // Passing locals: the nearest one's rumble and clatter, and its horn.
    const p = ride.nearestPasser(cam);
    this.passing.update(dt, p ? p.pos : cam, p ? p.speed : 0, !!p);
    if (p && p.dist < 160) {
      const key = 'pass' + p.id;
      if (!this.hornDone.has(key)) {
        this.hornDone.add(key);
        this.passing.horn(0.7);
      }
    }
  }

  private slide(opening: boolean): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.02;
    const src = this.a.noiseSource('white', false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(opening ? 500 : 900, t);
    bp.frequency.linearRampToValueAtTime(opening ? 900 : 500, t + 1.2);
    const g = ctx.createGain();
    env(g.gain, t, 0.1, 0.9, 0.3, 0.05);
    src.connect(bp).connect(g).connect(this.a.dry);
    src.start(t);
    src.stop(t + 1.6);
    // The thud as the leaf reaches its stop.
    const o = ctx.createOscillator();
    o.frequency.value = 70;
    const og = ctx.createGain();
    env(og.gain, t + 1.25, 0.005, 0.02, 0.2, 0.14);
    o.connect(og).connect(this.a.dry);
    o.start(t + 1.2);
    o.stop(t + 1.6);
  }

  /** How well Mira Road's PA carries to the listener (0 beyond STATION_PA_RANGE of PF 4's speakers). */
  private miraReach(ride: Ride): number {
    if (!this.pf4) {
      // A horn speaker every 30 m down the middle of PF 4, beside where the rake stands.
      const m = ride.restFrame(this.dMira);
      this.pf4 = [];
      for (let z = -240; z <= 30; z += 30) this.pf4.push(new THREE.Vector3(CAR.halfW + 3.5, 4.2, z).applyMatrix4(m));
    }
    let k = 0;
    for (const s of this.pf4) k = Math.max(k, this.a.reach(s, STATION_PA_RANGE));
    return k;
  }

  /** The PA at Mira Road: chime, then the incoming train in Marathi, Hindi and English. */
  private announce(ride: Ride): void {
    this.announced = true;
    const cam = this.a.listener;
    const near = [...this.pf4!].sort((p, q) => p.distanceToSquared(cam) - q.distanceToSquared(cam)).slice(0, 2);
    const wait = chime(this.a, near);
    const mr = 'प्रवाशांनी कृपया लक्ष द्यावे. फलाट क्रमांक चार वर येणारी गाडी चर्चगेट जलद लोकल आहे.';
    const hi = 'यात्रीगण कृपया ध्यान दें. प्लेटफॉर्म क्रमांक चार पर आने वाली गाड़ी चर्चगेट तेज़ लोकल है.';
    const en = 'Attention please. The train arriving on platform number four is a Churchgate fast local.';
    this.say(mr, hi, en, wait, () => this.miraReach(ride));
  }

  /**
   * The car's own PA coming into a halt ⚠ (the wording of the newer rakes' announcements): next
   * station, and which side the doors open (the platform is on the left, facing Churchgate).
   */
  private nextStation(stop: HaltStop, ride: Ride): void {
    const h = stop.halt;
    const reach = () => this.a.reach(ride.toWorld(new THREE.Vector3(0, CAR.floorY + 1.2, 0)), CAR_PA_RANGE);
    this.say(`पुढील स्टेशन ${h.deva}. दरवाजे डाव्या बाजूला उघडतील.`, `अगला स्टेशन ${h.deva}. दरवाज़े बाईं ओर खुलेंगे.`, `Next station ${h.name}. Doors will open on the left side.`, 0.4, reach);
  }

  /** The station PA calling the train standing at the platform ⚠ (stops as the ride shows them). */
  private platformCall(stop: HaltStop, cam: THREE.Vector3, ride: Ride): void {
    const out = ride.toWorld(new THREE.Vector3(CAR.halfW + 6, 5, 0));
    const wait = chime(this.a, [out, out.clone().add(cam).multiplyScalar(0.5).setY(5)]);
    const reach = () => this.a.reach(out, STATION_PA_RANGE);
    if (stop.halt.key === 'BO')
      this.say(
        'फलाट क्रमांक पाच वरील गाडी चर्चगेट जलद लोकल आहे. ही गाडी अंधेरी, वांद्रे, दादर आणि मुंबई सेंट्रल येथे थांबेल.',
        'प्लेटफॉर्म क्रमांक पाँच पर खड़ी गाड़ी चर्चगेट तेज़ लोकल है. यह गाड़ी अंधेरी, बांद्रा, दादर और मुंबई सेंट्रल पर रुकेगी.',
        'The train on platform number five is a Churchgate fast local, halting at Andheri, Bandra, Dadar and Mumbai Central.',
        wait,
        reach,
      );
    else
      this.say(
        'फलाट क्रमांक चार वरील गाडी चर्चगेट जलद लोकल आहे. मध्य रेल्वेच्या गाड्यांसाठी प्रवाशांनी पुलाचा वापर करावा.',
        'प्लेटफॉर्म क्रमांक चार पर खड़ी गाड़ी चर्चगेट तेज़ लोकल है. मध्य रेल की गाड़ियों के लिए कृपया पुल का उपयोग करें.',
        'The train on platform number four is a Churchgate fast local. For Central Railway trains, please use the foot over bridge.',
        wait,
        reach,
      );
  }

  /** The guard's bell to the motorman before the start: two rings. */
  private bell(pos: THREE.Vector3): void {
    const ctx = this.a.ctx;
    const out = this.a.spatialOut(pos, 6, 0.8, 1.0);
    for (const dt of [0, 0.42]) {
      const t = ctx.currentTime + 0.02 + dt;
      for (const [f, amp] of [
        [1480, 0.12],
        [2960, 0.05],
        [4450, 0.02],
      ]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const g = ctx.createGain();
        env(g.gain, t, 0.003, 0.01, 0.35, amp);
        o.connect(g).connect(out.input);
        o.start(t);
        o.stop(t + 0.5);
      }
    }
  }

  /**
   * Speaks an announcement in Marathi, Hindi and English after `wait` s (with subtitles), for as
   * long as the listener stays within `reach` of where it is made.
   */
  private say(mr: string, hi: string, en: string, wait: number, reach: () => number): void {
    this.onSubtitle(en, hi);
    this.a.speak(
      [
        [mr, 'mr-IN'],
        [hi, 'hi-IN'],
        [en, 'en-IN'],
      ],
      wait,
      reach,
    );
  }

  /** A new ride: announcements and horns again. */
  reset(): void {
    this.announced = false;
    this.hornDone.clear();
    this.lastLeg = -1;
  }
}
