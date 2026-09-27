import * as THREE from 'three';
import type { AudioEngine } from './AudioEngine';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** One-shot envelope helper. */
export function env(g: AudioParam, t: number, attack: number, hold: number, release: number, peak: number): void {
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
  g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
}

/** Continuous crowd murmur: pink noise through slowly breathing speech-band filters. */
export class CrowdBed {
  private bands: { f: BiquadFilterNode; g: GainNode }[] = [];
  readonly out: GainNode;
  private next = 0;

  constructor(private readonly a: AudioEngine) {
    const ctx = a.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(a.ambienceBus);
    const send = ctx.createGain();
    send.gain.value = 0.8;
    this.out.connect(send).connect(a.reverbSend);
    for (const [freq, q] of [
      [320, 1.2],
      [760, 1.6],
      [1500, 1.8],
      [2700, 2.2],
    ]) {
      const src = a.noiseSource('pink');
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      src.connect(f).connect(g).connect(this.out);
      src.start();
      this.bands.push({ f, g });
    }
  }

  update(level: number): void {
    const t = this.a.ctx.currentTime;
    this.out.gain.setTargetAtTime(level, t, 0.8);
    if (t < this.next) return;
    this.next = t + rnd(0.15, 0.45);
    for (const b of this.bands) {
      b.g.gain.setTargetAtTime(rnd(0.12, 0.5), t, rnd(0.08, 0.3));
      b.f.frequency.setTargetAtTime(b.f.frequency.value * rnd(0.93, 1.07), t, 0.2);
    }
  }
}

/** A short burst of voice-like babble (formant-filtered buzz) at a point in space. */
export function babble(a: AudioEngine, pos: THREE.Vector3, loud = 1): void {
  const ctx = a.ctx;
  const t = ctx.currentTime + 0.01;
  const female = Math.random() < 0.45;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const base = female ? rnd(190, 260) : rnd(100, 150);
  osc.frequency.setValueAtTime(base, t);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 6;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 8;
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  const mix = ctx.createGain();
  mix.gain.value = 0.9 * loud;
  osc.connect(f1).connect(g);
  osc.connect(f2).connect(g);
  const out = a.spatialOut(pos, 2.2, 1.6, 0.6);
  g.connect(mix).connect(out.input);
  const syll = Math.floor(rnd(2, 7));
  let tt = t;
  for (let i = 0; i < syll; i++) {
    const d = rnd(0.08, 0.2);
    f1.frequency.setValueAtTime(rnd(350, 850), tt);
    f2.frequency.setValueAtTime(rnd(900, 2300), tt);
    osc.frequency.setValueAtTime(base * rnd(0.9, 1.2), tt);
    g.gain.setValueAtTime(0.0001, tt);
    g.gain.exponentialRampToValueAtTime(0.05, tt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, tt + d);
    tt += d + rnd(0.02, 0.12);
  }
  osc.start(t);
  osc.stop(tt + 0.1);
  osc.onended = () => {
    g.disconnect();
    out.panner.disconnect();
  };
}

/** Footstep: scuff + heel thud. */
export function footstep(a: AudioEngine, pos: THREE.Vector3, loud = 1, hard = true): void {
  const ctx = a.ctx;
  const t = ctx.currentTime + 0.005;
  const src = a.noiseSource('white', false);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hard ? rnd(1800, 3200) : rnd(900, 1600);
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  env(g.gain, t, 0.003, 0.01, 0.07, 0.12 * loud);
  const out = a.spatialOut(pos, 1.5, 2, 0.35);
  src.connect(bp).connect(g).connect(out.input);
  const thud = ctx.createOscillator();
  thud.frequency.setValueAtTime(95, t);
  thud.frequency.exponentialRampToValueAtTime(55, t + 0.06);
  const tg = ctx.createGain();
  env(tg.gain, t, 0.002, 0.005, 0.06, 0.18 * loud);
  thud.connect(tg).connect(out.input);
  src.start(t);
  src.stop(t + 0.15);
  thud.start(t);
  thud.stop(t + 0.1);
  src.onended = () => out.panner.disconnect();
}

/** Positional voice of one EMU rake: inverter whine, wheel rumble, rail clacks, brake squeal. */
export class TrainVoice {
  private whine: OscillatorNode[] = [];
  private whineGain: GainNode;
  private rumbleGain: GainNode;
  private squealGain: GainNode;
  private squeal: OscillatorNode;
  private out: { panner: PannerNode; input: GainNode };
  private clackTimer = 0;
  private prevSpeed = 0;
  private hissed = false;

  constructor(private readonly a: AudioEngine) {
    const ctx = a.ctx;
    this.out = a.spatialOut(new THREE.Vector3(0, 2, -500), 10, 1.0, 0.7);
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    for (const [type, mult] of [
      ['sawtooth', 1],
      ['triangle', 2],
      ['square', 3.02],
    ] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 100 * mult;
      const g = ctx.createGain();
      g.gain.value = mult === 1 ? 0.5 : 0.18;
      o.connect(g).connect(bp);
      o.start();
      (o as OscillatorNode & { mult?: number }).mult = mult;
      this.whine.push(o);
    }
    bp.connect(this.whineGain).connect(this.out.input);
    const rumble = a.noiseSource('brown');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(lp).connect(this.rumbleGain).connect(this.out.input);
    rumble.start();
    this.squeal = ctx.createOscillator();
    this.squeal.type = 'sine';
    this.squeal.frequency.value = 3400;
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vibG = ctx.createGain();
    vibG.gain.value = 60;
    vib.connect(vibG).connect(this.squeal.frequency);
    vib.start();
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squeal.connect(this.squealGain).connect(this.out.input);
    this.squeal.start();
  }

  update(dt: number, pos: THREE.Vector3, speed: number, visible: boolean): void {
    const t = this.a.ctx.currentTime;
    const s = Math.abs(speed);
    const accel = (s - this.prevSpeed) / Math.max(dt, 1e-3);
    this.prevSpeed = s;
    this.a.setPos(this.out.panner, pos);
    const on = visible ? 1 : 0;
    // VVVF inverter: discrete tones at low speed, then a rising whine.
    const f = s < 3 ? [180, 240, 300][Math.min(2, Math.floor(s))] : 90 + s * 42;
    for (const o of this.whine) o.frequency.setTargetAtTime(f * (o as OscillatorNode & { mult: number }).mult, t, 0.1);
    const traction = Math.min(1, Math.abs(accel) * 2.2) * (s > 0.2 ? 1 : 0);
    this.whineGain.gain.setTargetAtTime(on * (0.03 + 0.1 * traction) * Math.min(1, s / 2), t, 0.15);
    this.rumbleGain.gain.setTargetAtTime(on * Math.min(0.5, s * 0.045), t, 0.2);
    const braking = accel < -0.05 && s < 4 && s > 0.15;
    this.squealGain.gain.setTargetAtTime(on * (braking ? 0.02 + 0.03 * (1 - s / 4) : 0), t, 0.08);
    if (visible && s > 0.5) {
      this.clackTimer -= dt;
      if (this.clackTimer <= 0) {
        this.clackTimer = 13 / s + rnd(-0.1, 0.1);
        this.clack(pos, Math.min(1, s / 8));
      }
    }
    // Brakes release with a hiss once the train has stopped.
    if (visible && s < 0.05 && this.prevSpeed < 0.05 && !this.hissed && accel <= 0) {
      this.hissed = true;
      this.hiss(pos);
    }
    if (s > 1) this.hissed = false;
  }

  private clack(pos: THREE.Vector3, loud: number): void {
    const ctx = this.a.ctx;
    const t0 = ctx.currentTime;
    for (const dt of [0, 0.09, 0.42, 0.51]) {
      const src = this.a.noiseSource('white', false);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = rnd(600, 1100);
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      env(g.gain, t0 + dt, 0.002, 0.004, 0.05, 0.25 * loud);
      src.connect(bp).connect(g).connect(this.out.input);
      src.start(t0 + dt);
      src.stop(t0 + dt + 0.1);
    }
    void pos;
  }

  hiss(pos: THREE.Vector3): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.05;
    const src = this.a.noiseSource('white', false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    env(g.gain, t, 0.03, 0.4, 1.4, 0.16);
    src.connect(hp).connect(g).connect(this.out.input);
    src.start(t);
    src.stop(t + 2.2);
    void pos;
  }

  /** Two-tone EMU horn. */
  horn(duration = 1.1): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.02;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const g = ctx.createGain();
    env(g.gain, t, 0.06, duration, 0.25, 0.22);
    for (const f of [311, 370]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + duration + 0.4);
    }
    lp.connect(g).connect(this.out.input);
  }
}

/** Western Railway-style PA chime (four descending bell tones). */
export function chime(a: AudioEngine, at: THREE.Vector3[]): number {
  const ctx = a.ctx;
  const t0 = ctx.currentTime + 0.05;
  const notes = [659.3, 523.3, 587.3, 392.0];
  const outs = at.map((p) => a.spatialOut(p, 12, 0.6, 1.0));
  notes.forEach((f, i) => {
    const t = t0 + i * 0.42;
    for (const [mult, amp] of [
      [1, 0.25],
      [2.01, 0.08],
      [3.02, 0.03],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      env(g.gain, t, 0.005, 0.02, 1.4, amp);
      o.connect(g);
      for (const out of outs) g.connect(out.input);
      o.start(t);
      o.stop(t + 1.6);
    }
  });
  return t0 + notes.length * 0.42 + 0.9 - ctx.currentTime;
}

/** Mumbai car horn: short square-wave beeps from a moving vehicle. */
export function honk(a: AudioEngine, pos: THREE.Vector3, bus = false): void {
  const ctx = a.ctx;
  const t = ctx.currentTime + 0.01;
  const out = a.spatialOut(pos, 6, 1.1, 0.25);
  const beeps = Math.random() < 0.5 ? 1 : Math.floor(rnd(2, 4));
  const f = bus ? rnd(260, 320) : rnd(380, 520);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = bus ? 1400 : 2600;
  lp.connect(out.input);
  let tt = t;
  for (let i = 0; i < beeps; i++) {
    const d = rnd(0.08, 0.35);
    const g = ctx.createGain();
    env(g.gain, tt, 0.01, d, 0.05, 0.12);
    for (const m of [1, 1.26]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * m;
      o.connect(g);
      o.start(tt);
      o.stop(tt + d + 0.1);
    }
    g.connect(lp);
    tt += d + rnd(0.06, 0.14);
  }
}

/** A crow: three harsh descending caws. */
export function crow(a: AudioEngine, pos: THREE.Vector3): void {
  const ctx = a.ctx;
  const out = a.spatialOut(pos, 8, 0.9, 0.3);
  let t = ctx.currentTime + 0.02;
  const n = Math.floor(rnd(2, 5));
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = rnd(620, 820);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.22);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 2.5;
    const nz = a.noiseSource('white', false);
    const ng = ctx.createGain();
    ng.gain.value = 0.3;
    nz.connect(ng).connect(bp);
    const g = ctx.createGain();
    env(g.gain, t, 0.015, 0.12, 0.12, 0.14);
    o.connect(bp).connect(g).connect(out.input);
    o.start(t);
    o.stop(t + 0.3);
    nz.start(t);
    nz.stop(t + 0.3);
    t += rnd(0.35, 0.55);
  }
}

/** A pigeon in the roof trusses: soft rolling coo. */
export function pigeon(a: AudioEngine, pos: THREE.Vector3): void {
  const ctx = a.ctx;
  const out = a.spatialOut(pos, 5, 1.2, 1.0);
  let t = ctx.currentTime + 0.02;
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rnd(340, 380), t);
    o.frequency.linearRampToValueAtTime(rnd(260, 300), t + 0.35);
    const am = ctx.createOscillator();
    am.frequency.value = 22;
    const amg = ctx.createGain();
    amg.gain.value = 0.5;
    const g = ctx.createGain();
    env(g.gain, t, 0.05, 0.2, 0.2, 0.07);
    am.connect(amg).connect(g.gain);
    o.connect(g).connect(out.input);
    o.start(t);
    am.start(t);
    o.stop(t + 0.5);
    am.stop(t + 0.5);
    t += i === 1 ? 0.7 : 0.45;
  }
}

/** Street bed: tyre and engine rumble plus a hazy city hum. */
export class StreetBed {
  readonly out: GainNode;
  private hum: GainNode;

  constructor(a: AudioEngine) {
    const ctx = a.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(a.ambienceBus);
    const b = a.noiseSource('brown');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    b.connect(lp).connect(this.out);
    b.start();
    const p = a.noiseSource('pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.6;
    this.hum = ctx.createGain();
    this.hum.gain.value = 0.25;
    p.connect(bp).connect(this.hum).connect(this.out);
    p.start();
  }

  update(level: number, t: number): void {
    this.out.gain.setTargetAtTime(level, t, 1.0);
    this.hum.gain.setTargetAtTime(0.18 + 0.12 * Math.sin(t * 0.3), t, 0.5);
  }
}

/** The sea at the wall: a swelling wash, wave splashes on the tetrapods, and wind. */
export class SeaBed {
  private wash: GainNode;
  private washLP: BiquadFilterNode;
  private wind: GainNode;
  private out: { panner: PannerNode; input: GainNode };
  private nextSplash = 0;
  private phase = Math.random() * 10;

  constructor(private readonly a: AudioEngine) {
    const ctx = a.ctx;
    this.out = a.spatialOut(new THREE.Vector3(0, 0, 0), 25, 0.6, 0.15);
    const w = a.noiseSource('pink');
    this.washLP = ctx.createBiquadFilter();
    this.washLP.type = 'lowpass';
    this.washLP.frequency.value = 700;
    this.wash = ctx.createGain();
    this.wash.gain.value = 0;
    w.connect(this.washLP).connect(this.wash).connect(this.out.input);
    w.start();
    const b = a.noiseSource('brown');
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 420;
    hp.Q.value = 0.4;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    b.connect(hp).connect(this.wind).connect(a.ambienceBus);
    b.start();
  }

  /** `near`: closest point on the sea wall; `d`: listener distance to it (metres). */
  update(dt: number, near: THREE.Vector3, d: number): void {
    const t = this.a.ctx.currentTime;
    this.a.setPos(this.out.panner, near);
    const level = Math.max(0, 1 - d / 260);
    this.phase += dt;
    // Swell every ~7 s: the wash rises, brightens and falls back.
    const swell = 0.55 + 0.45 * Math.sin(this.phase * 0.9) * Math.sin(this.phase * 0.37 + 1.3);
    this.wash.gain.setTargetAtTime(level * (0.18 + 0.22 * swell), t, 0.4);
    this.washLP.frequency.setTargetAtTime(500 + 900 * swell, t, 0.4);
    this.wind.gain.setTargetAtTime(0.04 + 0.12 * Math.max(0, 1 - d / 80) * (0.7 + 0.3 * Math.sin(this.phase * 0.23)), t, 1.0);
    if (d < 120 && t > this.nextSplash) {
      this.nextSplash = t + rnd(3.5, 8);
      this.splash(near.clone().add(new THREE.Vector3(rnd(-18, 18), -1.5, rnd(-18, 18))), level);
    }
  }

  private splash(pos: THREE.Vector3, level: number): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.02;
    const src = this.a.noiseSource('white', false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(rnd(900, 1400), t);
    bp.frequency.exponentialRampToValueAtTime(rnd(2200, 3200), t + 0.35);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    env(g.gain, t, rnd(0.15, 0.35), rnd(0.2, 0.5), rnd(1.2, 2.2), 0.22 * level);
    const out = this.a.spatialOut(pos, 10, 0.9, 0.2);
    src.connect(bp).connect(g).connect(out.input);
    // A low thump as the wave hits the concrete.
    const thump = this.a.noiseSource('brown', false);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const tg = ctx.createGain();
    env(tg.gain, t, 0.05, 0.1, 0.8, 0.5 * level);
    thump.connect(lp).connect(tg).connect(out.input);
    src.start(t);
    src.stop(t + 3.5);
    thump.start(t);
    thump.stop(t + 1.2);
    src.onended = () => out.panner.disconnect();
  }
}
