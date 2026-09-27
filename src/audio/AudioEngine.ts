import * as THREE from 'three';

/**
 * Web Audio graph: sources → (dry + reverb send) → master → compressor → speakers.
 * All sounds are synthesised procedurally (no recorded samples).
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly dry: GainNode;
  readonly reverbSend: GainNode;
  readonly ambienceBus: GainNode;
  private convolver: ConvolverNode;
  private compressor: DynamicsCompressorNode;
  private noiseBuffers = new Map<string, AudioBuffer>();
  enabled = true;
  private targetVolume = 0.9;
  /** Where the listener is (the camera, as of the last `updateListener`). */
  readonly listener = new THREE.Vector3();
  /** The PA announcement being spoken, and how well it carries to the listener now. */
  private pa: { reach: () => number; timer: number } | null = null;

  constructor() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.25;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.compressor).connect(this.ctx.destination);
    this.dry = this.ctx.createGain();
    this.dry.connect(this.master);
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.impulse(3.2, 2.6);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.6;
    this.reverbSend.connect(this.convolver).connect(wet).connect(this.master);
    this.ambienceBus = this.ctx.createGain();
    this.ambienceBus.connect(this.dry);
    const l = this.ctx.listener;
    if (l.forwardX) {
      l.forwardX.value = 0;
      l.forwardY.value = 0;
      l.forwardZ.value = -1;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
    // Ask for the speech voices now: the browser loads them asynchronously.
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.setEnabled(this.enabled);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? this.targetVolume : 0, t, 0.4);
    if (!on) this.cancelSpeech();
  }

  /**
   * How much of a source at `pos` reaches the listener, for a sound that carries `range` metres:
   * 1 within 60 % of the range, fading to 0 at it. The panners' inverse law levels off at their
   * maxDistance and never reaches silence, so distant sources are gated with this as well.
   */
  reach(pos: THREE.Vector3, range: number): number {
    return 1 - THREE.MathUtils.smoothstep(pos.distanceTo(this.listener), range * 0.6, range);
  }

  /**
   * A PA announcement spoken after `wait` s, one language after another. Browser speech is not
   * positional, so `reach` (0–1, for the listener where they are now) stands in for distance: the
   * announcement starts only within reach, each language is spoken at the volume the reach gives
   * when its turn comes, and whatever is left is dropped once the listener is out of reach (walked
   * off, or the film has cut away). A new announcement replaces the one in progress.
   */
  speak(lines: [text: string, lang: string][], wait: number, reach: () => number): void {
    if (!('speechSynthesis' in window) || !this.enabled || reach() <= 0.001) return;
    this.cancelSpeech();
    const job = { reach, timer: 0 };
    const next = (i: number): void => {
      if (this.pa !== job) return;
      const k = reach();
      if (i >= lines.length || k <= 0.001) {
        this.pa = null;
        return;
      }
      const [text, lang] = lines[i];
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang === lang) ?? voices.find((x) => x.lang.startsWith(lang.slice(0, 2)));
      if (!v && lang !== 'en-IN') {
        next(i + 1);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      if (v) u.voice = v;
      u.lang = lang;
      u.rate = 0.92;
      u.pitch = 1.05;
      u.volume = 0.75 * k;
      u.onend = u.onerror = () => next(i + 1);
      speechSynthesis.speak(u);
    };
    job.timer = window.setTimeout(() => next(0), wait * 1000);
    this.pa = job;
  }

  /** Per frame: drop the announcement once the listener is out of its reach. */
  updateSpeech(): void {
    if (this.pa && this.pa.reach() <= 0.001) this.cancelSpeech();
  }

  cancelSpeech(): void {
    if (this.pa) window.clearTimeout(this.pa.timer);
    this.pa = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  /** Exponentially decaying stereo noise impulse (a large, hard-surfaced hall). */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Early reflections cluster, then a smooth tail.
        const early = i < rate * 0.08 && Math.random() < 0.004 ? 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay) * (t < 0.002 ? t / 0.002 : 1);
      }
    }
    return buf;
  }

  /** Cached noise buffers: white, pink or brown, ~4 s, looping. */
  noise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const cached = this.noiseBuffers.get(kind);
    if (cached) return cached;
    const rate = this.ctx.sampleRate;
    const len = rate * 4;
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0,
      last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    this.noiseBuffers.set(kind, buf);
    return buf;
  }

  noiseSource(kind: 'white' | 'pink' | 'brown', loop = true): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise(kind);
    s.loop = loop;
    s.loopStart = Math.random() * 3;
    return s;
  }

  /** A spatial panner at a world position. */
  panner(pos?: THREE.Vector3, refDistance = 4, rolloff = 1.2): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = 400;
    if (pos) this.setPos(p, pos);
    return p;
  }

  setPos(p: PannerNode, v: THREE.Vector3): void {
    if (p.positionX) {
      const t = this.ctx.currentTime;
      p.positionX.setTargetAtTime(v.x, t, 0.02);
      p.positionY.setTargetAtTime(v.y, t, 0.02);
      p.positionZ.setTargetAtTime(v.z, t, 0.02);
    } else p.setPosition(v.x, v.y, v.z);
  }

  /** Output chain for a positional source: panner → dry + reverb send. */
  spatialOut(pos: THREE.Vector3, ref = 4, rolloff = 1.2, send = 0.5): { panner: PannerNode; input: GainNode } {
    const input = this.ctx.createGain();
    const panner = this.panner(pos, ref, rolloff);
    input.connect(panner);
    panner.connect(this.dry);
    const s = this.ctx.createGain();
    s.gain.value = send;
    panner.connect(s).connect(this.reverbSend);
    return { panner, input };
  }

  updateListener(camera: THREE.Camera): void {
    const l = this.ctx.listener;
    const p = camera.position;
    this.listener.copy(p);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02);
      l.upY.setTargetAtTime(u.y, t, 0.02);
      l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  /** How reverberant the space is (0 = open street, 1 = inside the train shed). */
  setSpace(interior: number): void {
    this.reverbSend.gain.setTargetAtTime(0.12 + interior * 0.55, this.ctx.currentTime, 0.5);
  }
}
