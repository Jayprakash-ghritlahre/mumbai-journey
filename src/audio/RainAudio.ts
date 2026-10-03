import * as THREE from 'three';
import type { AudioEngine } from './AudioEngine';
import { env } from './Synth';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Where the listener is, for the rain's sound (App fills it in each frame). */
export interface RainPlace {
  /** The rain falling now (0 … 1) and how far the monsoon has set in. */
  rain: number;
  amount: number;
  /** Wind speed (m/s). */
  wind: number;
  /** Under a roof or canopy (0 open … 1 deep inside). */
  roof: number;
  /** In the coach being ridden, in the auto. */
  inTrain: boolean;
  inAuto: boolean;
  /** Speed of the train or auto you are in (m/s). */
  speed: number;
  /** Near the sea wall (0 far … 1 at it). */
  sea: number;
  /** How heavy the rain is now (bursts), 0 … 1. */
  heavy: number;
  /** Vehicles close by (tyres hiss on the wet road). */
  vehicles: { pos: THREE.Vector3; speed: number }[];
  /** Sweeps of the auto's wiper so far (a soft thunk each). */
  wipes: number;
}

/**
 * The monsoon's sound (MONSOON.md §7), procedural like the rest:
 *
 * - the fall: a broad hiss all round, brighter in the open, muffled indoors;
 * - near splashes: a dense crackle of drops on the ground and puddles round you;
 * - on a roof: the drumming of rain on the station's sheet canopies and the coach's roof, with a
 *   metallic ring; drips from the edges and gutters near the roof line;
 * - in the auto: the close, heavy patter on the rexine hood right over your head;
 * - the wind: the south-west monsoon's gusts, strongest at the sea wall.
 *
 * Each layer is a looped buffer through its own filter and gain on the ambience bus, so the rest of
 * the soundscape (trains, the PA, the streets) carries on as before.
 */
export class RainAudio {
  private readonly out: GainNode;
  private readonly fall: GainNode;
  private readonly fallLp: BiquadFilterNode;
  private readonly splash: GainNode;
  private readonly roof: GainNode;
  private readonly hood: GainNode;
  private readonly wind: GainNode;
  private readonly windBp: BiquadFilterNode;
  private t = 0;
  private nextDrip = 0;
  private nextSwish = 0;
  private nextThunder = 40;
  private wipes = 0;

  constructor(private readonly a: AudioEngine) {
    const ctx = a.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(a.ambienceBus);
    const send = ctx.createGain();
    send.gain.value = 0.25;
    this.out.connect(send).connect(a.reverbSend);
    // The fall: two unrelated sources spread left and right, so it surrounds you.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    this.fallLp = ctx.createBiquadFilter();
    this.fallLp.type = 'lowpass';
    this.fallLp.frequency.value = 8000;
    this.fall = ctx.createGain();
    this.fall.gain.value = 0;
    for (const pan of [-0.7, 0.7]) {
      const src = a.noiseSource('pink');
      const sp = ctx.createStereoPanner();
      sp.pan.value = pan;
      src.connect(sp).connect(hp);
      src.start();
    }
    hp.connect(this.fallLp).connect(this.fall).connect(this.out);
    // Drops landing round you.
    const dense = this.crackle(320, 0.004);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.6;
    this.splash = ctx.createGain();
    this.splash.gain.value = 0;
    dense.connect(bp).connect(this.splash).connect(this.out);
    dense.start();
    // On a roof: drumming with a ring of sheet metal.
    const drum = this.crackle(420, 0.007);
    const rb = ctx.createBiquadFilter();
    rb.type = 'bandpass';
    rb.frequency.value = 650;
    rb.Q.value = 0.7;
    const ring = ctx.createBiquadFilter();
    ring.type = 'peaking';
    ring.frequency.value = 2300;
    ring.Q.value = 5;
    ring.gain.value = 9;
    this.roof = ctx.createGain();
    this.roof.gain.value = 0;
    drum.connect(rb).connect(ring).connect(this.roof).connect(this.out);
    drum.start();
    // The auto's hood: heavy drops on taut rexine, right overhead.
    const heavy = this.crackle(260, 0.012);
    const hl = ctx.createBiquadFilter();
    hl.type = 'lowpass';
    hl.frequency.value = 1300;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 220;
    body.Q.value = 1.2;
    body.gain.value = 8;
    this.hood = ctx.createGain();
    this.hood.gain.value = 0;
    heavy.connect(hl).connect(body).connect(this.hood).connect(this.out);
    heavy.start();
    // The wind.
    const brown = a.noiseSource('brown');
    this.windBp = ctx.createBiquadFilter();
    this.windBp.type = 'bandpass';
    this.windBp.frequency.value = 420;
    this.windBp.Q.value = 0.5;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    brown.connect(this.windBp).connect(this.wind).connect(this.out);
    brown.start();
  }

  /** A looping buffer of random drop impacts (`rate` a second, each decaying over `tau` s). */
  private crackle(rate: number, tau: number): AudioBufferSourceNode {
    const ctx = this.a.ctx;
    const sr = ctx.sampleRate;
    const len = sr * 4;
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const n = Math.round(rate * 4);
    const decay = Math.max(1, Math.round(tau * sr));
    for (let i = 0; i < n; i++) {
      const at = Math.floor(Math.random() * len);
      const amp = Math.pow(Math.random(), 2.2) * (Math.random() < 0.5 ? -1 : 1);
      for (let k = 0; k < decay * 5 && at + k < len; k++) d[at + k] += amp * Math.exp(-k / decay) * (Math.random() * 2 - 1);
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < len; i++) d[i] /= peak || 1;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random() * 3;
    return s;
  }

  /** A drip from a roof edge or gutter: a short falling "plink" and a splat. */
  private drip(pos: THREE.Vector3, loud: number): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = rnd(1300, 2600);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.06);
    const g = ctx.createGain();
    env(g.gain, t, 0.002, 0.01, 0.07, 0.05 * loud);
    const out = this.a.spatialOut(pos, 2, 1.2, 0.3);
    o.connect(g).connect(out.input);
    o.start(t);
    o.stop(t + 0.15);
    o.onended = () => out.panner.disconnect();
  }

  /** Tyres on the wet road going by: a rising and falling hiss of spray. */
  private swish(pos: THREE.Vector3, speed: number, wet: number): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.01;
    const src = this.a.noiseSource('white', false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(rnd(1400, 2200), t);
    bp.frequency.linearRampToValueAtTime(rnd(2600, 3800), t + 0.35);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    const dur = THREE.MathUtils.clamp(9 / Math.max(speed, 3), 0.5, 1.6);
    env(g.gain, t, dur * 0.45, 0.05, dur * 0.55, 0.12 * wet * Math.min(1, speed / 9));
    const out = this.a.spatialOut(pos, 4, 1.1, 0.15);
    src.connect(bp).connect(g).connect(out.input);
    src.start(t);
    src.stop(t + dur + 0.2);
    src.onended = () => out.panner.disconnect();
  }

  /** The auto's wiper at the end of a sweep: a soft rubbery thunk on the glass. */
  private thunk(): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const g = ctx.createGain();
    env(g.gain, t, 0.004, 0.02, 0.09, 0.05);
    const squeak = this.a.noiseSource('white', false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rnd(2400, 3200);
    bp.Q.value = 6;
    const sg = ctx.createGain();
    env(sg.gain, t, 0.05, 0.05, 0.12, 0.015);
    o.connect(g).connect(this.out);
    squeak.connect(bp).connect(sg).connect(this.out);
    o.start(t);
    o.stop(t + 0.2);
    squeak.start(t);
    squeak.stop(t + 0.3);
  }

  /** Thunder far off over the sea in a heavy burst: a long low roll, never a crack overhead. */
  private thunder(level: number): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.05;
    const src = this.a.noiseSource('brown', false);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(220, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * level, t + rnd(0.8, 1.6));
    g.gain.setTargetAtTime(0.09 * level, t + 2, 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + rnd(6, 8));
    src.connect(lp).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + 8.5);
  }

  update(dt: number, p: RainPlace, listener: THREE.Vector3): void {
    const ctx = this.a.ctx;
    const now = ctx.currentTime;
    this.t += dt;
    const r = p.rain;
    const open = p.inTrain || p.inAuto ? 0.35 : 1 - 0.75 * p.roof;
    // The fall: brighter and fuller outside, rushing past faster from a moving coach or auto.
    const rush = Math.min(1, p.speed / 20);
    this.fall.gain.setTargetAtTime(r * (0.1 + 0.16 * r) * (0.45 + 0.55 * open) * (1 + 0.5 * rush), now, 0.6);
    this.fallLp.frequency.setTargetAtTime(p.inTrain ? 3200 : p.inAuto ? 5200 : 2600 + 6400 * open, now, 0.4);
    this.splash.gain.setTargetAtTime(r * 0.12 * open * (p.inTrain ? 0.4 : 1), now, 0.5);
    // Drumming overhead: the canopies, the coach's roof.
    const roof = p.inTrain ? 0.7 : p.inAuto ? 0 : p.roof;
    this.roof.gain.setTargetAtTime(r * r * 0.32 * roof, now, 0.5);
    this.hood.gain.setTargetAtTime(p.inAuto ? r * (0.22 + 0.25 * r) : 0, now, 0.3);
    // The wind: gusting, strongest at the sea wall, quieter inside.
    const gust = 0.65 + 0.35 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.11 + 1.7);
    const w = Math.min(1, p.wind / 9) * p.amount;
    this.wind.gain.setTargetAtTime(w * (0.05 + 0.13 * p.sea) * gust * (p.inTrain || p.inAuto ? 0.5 : 1 - 0.6 * p.roof), now, 0.8);
    this.windBp.frequency.setTargetAtTime(320 + 260 * gust, now, 0.8);
    // Tyres hissing through the wet on the road beside you.
    if (p.amount > 0.2 && this.t > this.nextSwish) {
      const moving = p.vehicles.filter((v) => v.speed > 3 && v.pos.distanceTo(listener) < 28);
      this.nextSwish = this.t + rnd(0.3, 0.9) / Math.max(0.4, Math.min(3, moving.length * 0.5));
      if (moving.length) {
        const v = moving[Math.floor(Math.random() * moving.length)];
        this.swish(v.pos.clone().setY(0.3), v.speed, p.amount * (p.inTrain ? 0.3 : 1));
      }
    }
    // The wiper (in the auto).
    if (p.wipes !== this.wipes) {
      if (p.inAuto && p.wipes > this.wipes) this.thunk();
      this.wipes = p.wipes;
    }
    // Now and then in a heavy burst, thunder far off.
    if (p.heavy > 0.5 && this.t > this.nextThunder) {
      this.nextThunder = this.t + rnd(60, 150);
      this.thunder(0.6 + 0.4 * Math.random());
    } else if (p.heavy < 0.2 && this.nextThunder < this.t + 20) this.nextThunder = this.t + 20;
    // Drips near roof edges (half under cover), now and then.
    if (r > 0.1 && p.roof > 0.15 && p.roof < 0.85 && !p.inTrain && !p.inAuto && this.t > this.nextDrip) {
      this.nextDrip = this.t + rnd(0.25, 1.4) / (0.4 + r);
      const dir = new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)).normalize().multiplyScalar(rnd(1.5, 6));
      this.drip(listener.clone().add(dir).setY(listener.y - 1.2), 0.6 + r);
    }
  }
}
