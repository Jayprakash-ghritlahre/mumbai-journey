import * as THREE from 'three';
import type { AudioEngine } from './AudioEngine';
import { env } from './Synth';
import type { AutoRide } from '../world/journey/AutoRide';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The auto's sounds (procedural, like the rest): the single-cylinder engine's putter, its firing
 * rate following the revs (idle shake, the climb through the gears, the dip at each change), tyre
 * rumble and the wind through the open sides growing with speed, the body's rattles, the horn's
 * nasal "peep-peep", the meter's beep and the thump over a speed breaker. All placed at the auto.
 */
export class AutoAudio {
  private readonly out: { panner: PannerNode; input: GainNode };
  private readonly master: GainNode;
  private readonly saw: OscillatorNode;
  private readonly sawLp: BiquadFilterNode;
  private readonly sawGain: GainNode;
  private readonly lfo: OscillatorNode;
  private readonly puttGain: GainNode;
  private readonly hum: OscillatorNode;
  private readonly road: GainNode;
  private readonly wind: GainNode;
  private readonly windLp: BiquadFilterNode;
  private readonly pos = new THREE.Vector3();
  private on = false;

  constructor(private readonly a: AudioEngine) {
    const ctx = a.ctx;
    this.out = a.spatialOut(new THREE.Vector3(), 3, 1.1, 0.2);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.out.input);
    // Engine: a sawtooth at the firing rate, filtered and shaped …
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    this.saw = ctx.createOscillator();
    this.saw.type = 'sawtooth';
    this.saw.frequency.value = 9;
    this.sawLp = ctx.createBiquadFilter();
    this.sawLp.type = 'lowpass';
    this.sawLp.frequency.value = 380;
    this.sawLp.Q.value = 2;
    this.sawGain = ctx.createGain();
    this.sawGain.gain.value = 0.35;
    this.saw.connect(shaper).connect(this.sawLp).connect(this.sawGain).connect(this.master);
    this.saw.start();
    // … and noise chopped at the same rate (the exhaust's put-put).
    const n = a.noiseSource('pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 240;
    bp.Q.value = 0.9;
    this.puttGain = ctx.createGain();
    this.puttGain.gain.value = 0;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfo.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    this.lfo.connect(depth).connect(this.puttGain.gain);
    n.connect(bp).connect(this.puttGain).connect(this.master);
    n.start();
    this.lfo.start();
    // The drivetrain's hum.
    this.hum = ctx.createOscillator();
    this.hum.type = 'triangle';
    this.hum.frequency.value = 60;
    const hg = ctx.createGain();
    hg.gain.value = 0.05;
    this.hum.connect(hg).connect(this.master);
    this.hum.start();
    // Tyres on the road, and the wind (straight to the listener: you sit in it).
    const b = a.noiseSource('brown');
    const rl = ctx.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 320;
    this.road = ctx.createGain();
    this.road.gain.value = 0;
    b.connect(rl).connect(this.road).connect(this.master);
    b.start();
    const w = a.noiseSource('pink');
    this.windLp = ctx.createBiquadFilter();
    this.windLp.type = 'lowpass';
    this.windLp.frequency.value = 400;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    w.connect(this.windLp).connect(this.wind).connect(a.dry);
    w.start();
  }

  update(dt: number, ride: AutoRide, camera: THREE.Camera): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime;
    const where = ride.heroWorld(this.pos);
    const on = !!where;
    if (on !== this.on) {
      this.on = on;
      this.master.gain.setTargetAtTime(on ? 0.55 : 0, t, 0.3);
    }
    const inside = ride.seated;
    if (!on) {
      this.wind.gain.setTargetAtTime(0, t, 0.3);
      ride.takeCues();
      return;
    }
    this.a.setPos(this.out.panner, inside ? camera.position.clone().add(new THREE.Vector3(0, -0.7, 0)) : this.pos);
    const v = ride.v;
    const f = ride.rpm / 120;
    const load = Math.max(0, Math.min(1, ride.a / 1.2));
    this.saw.frequency.setTargetAtTime(f, t, 0.05);
    this.lfo.frequency.setTargetAtTime(f, t, 0.05);
    this.hum.frequency.setTargetAtTime(f * 6.5, t, 0.08);
    this.sawLp.frequency.setTargetAtTime(260 + ride.rpm * 0.1 + load * 300, t, 0.08);
    this.sawGain.gain.setTargetAtTime(0.22 + 0.25 * load + (v < 0.3 ? 0.1 : 0), t, 0.08);
    this.puttGain.gain.setTargetAtTime(0.35 + 0.35 * load, t, 0.08);
    this.road.gain.setTargetAtTime(Math.min(0.6, v * 0.06), t, 0.2);
    this.wind.gain.setTargetAtTime(inside ? Math.min(0.12, (v / 10) ** 2 * 0.09) : 0, t, 0.3);
    this.windLp.frequency.setTargetAtTime(250 + v * 45, t, 0.3);
    // Rattles of the body, more as it goes faster.
    if (Math.random() < dt * (0.6 + v * 0.5)) this.click(inside ? 0.05 : 0.02);
    const cues = ride.takeCues();
    for (let i = 0; i < cues.horn; i++) this.horn();
    for (let i = 0; i < cues.beep; i++) this.beep();
    for (let i = 0; i < cues.bump; i++) this.thump();
  }

  private click(loud: number): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime;
    const n = this.a.noiseSource('white', false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = rnd(1800, 4200);
    hp.Q.value = 4;
    const g = ctx.createGain();
    env(g.gain, t, 0.002, 0.004, 0.03, loud);
    n.connect(hp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.08);
  }

  /** The auto's electric horn: one or two nasal peeps. */
  private horn(): void {
    const ctx = this.a.ctx;
    let t = ctx.currentTime + 0.02;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.8;
    bp.connect(this.out.input);
    const n = Math.random() < 0.5 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const d = rnd(0.12, 0.26);
      const g = ctx.createGain();
      env(g.gain, t, 0.008, d, 0.04, 0.22);
      for (const fr of [470, 590]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = fr;
        o.connect(g);
        o.start(t);
        o.stop(t + d + 0.08);
      }
      g.connect(bp);
      t += d + 0.09;
    }
  }

  private beep(): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.05;
    for (const k of [0, 0.16]) {
      const o = ctx.createOscillator();
      o.frequency.value = 2400;
      const g = ctx.createGain();
      env(g.gain, t + k, 0.005, 0.08, 0.02, 0.05);
      o.connect(g).connect(this.out.input);
      o.start(t + k);
      o.stop(t + k + 0.15);
    }
  }

  private thump(): void {
    const ctx = this.a.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    env(g.gain, t, 0.005, 0.03, 0.25, 0.5);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
    this.click(0.12);
  }
}
