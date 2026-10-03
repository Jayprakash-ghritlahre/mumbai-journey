import * as THREE from 'three';
import { MD } from './RouteLayout';
import { MONSOON_TIDE, type Surge } from './Ocean';
import { H } from './RouteLayout';
import { WEATHER, WX } from '../../gfx/Weather';
import type { LightingState } from '../../gfx/TimeOfDay';

/**
 * The monsoon sea at Marine Drive (MONSOON.md §5): the waves breaking on the tetrapods all along the
 * wall, and now and then a big one. Each big wave is seen coming (a surge in the ocean shader that
 * builds as it runs in) and bursts into spray when it reaches the wall; the biggest throw it over
 * the wall onto the promenade, the wind carrying it inland.
 *
 * The spray is one instanced draw of soft billboards in a ring buffer: each particle's flight
 * (launch, drag, gravity, the wind) is computed in the vertex shader from its launch values.
 */
const vert = /* glsl */ `
attribute vec2 corner;
attribute vec4 aP;
attribute vec4 aV;
attribute vec2 aS;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vC;
varying float vA;
varying float vSeed;
varying float vKind;
void main() {
  // Three kinds (aS.y's whole part): 0 water thrown up in jets (droplets, drawn along their motion),
  // 1 fine mist the wind carries inland, 2 whitewater surging over the tetrapods.
  float kind = floor(aS.y);
  float seed = fract(aS.y);
  float age = uTime - aP.w;
  float life = aV.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = kind == 0.0 ? 0.55 : kind == 1.0 ? 1.6 : 2.4;
  float g = kind == 0.0 ? 4.0 : kind == 1.0 ? 0.6 : 3.5;
  float wk = kind == 0.0 ? 0.12 : kind == 1.0 ? 0.6 : 0.08;
  float ek = exp(-k * age);
  float e = (1.0 - ek) / k;
  vec3 wind = vec3(uWind.x, 0.0, uWind.y) * wk;
  vec3 p = aP.xyz + aV.xyz * e + wind * (age - e);
  p.y -= (g / k) * (age - e);
  vec3 vel = aV.xyz * ek + wind * (1.0 - ek) - vec3(0.0, (g / k) * (1.0 - ek), 0.0);
  float t = age / life;
  float sz = aS.x * (kind == 0.0 ? 0.7 + 0.5 * t : kind == 1.0 ? 0.6 + 1.5 * t : 0.8 + 0.7 * t);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  // Droplets streak along their motion on screen; mist and foam are round puffs.
  vec2 axis = vec2(0.0, 1.0);
  float stretch = 1.0;
  if (kind == 0.0) {
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    float l = length(vv.xy);
    if (l > 1e-3) axis = vv.xy / l;
    stretch = clamp(1.0 + l * 0.05 / max(sz, 0.05), 1.0, 3.5);
  }
  vec2 perp = vec2(-axis.y, axis.x);
  mv.xy += perp * corner.x * sz + axis * corner.y * sz * stretch;
  gl_Position = projectionMatrix * mv;
  float fade = kind == 0.0 ? pow(1.0 - t, 0.8) : kind == 1.0 ? pow(1.0 - t, 1.8) * 0.5 : 1.0 - t;
  // Thinner close to the camera (a drift of spray over you, not a white-out).
  float dc = length(p - cameraPosition);
  vA = smoothstep(0.0, kind == 1.0 ? 0.15 : 0.05, t) * fade * (0.15 + 0.85 * smoothstep(2.0, 9.0, dc));
  vC = corner;
  vSeed = seed;
  vKind = kind;
}`;

const frag = /* glsl */ `
uniform vec3 uLight;
uniform float uOpacity;
uniform sampler2D uWetNoise;
varying vec2 vC;
varying float vA;
varying float vSeed;
varying float vKind;
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  float n = texture2D(uWetNoise, vC * 0.55 + vec2(vSeed * 3.1, vSeed * 7.7)).r;
  float m = texture2D(uWetNoise, vC * 1.7 + vec2(vSeed * 5.3, vSeed * 1.9)).r;
  float a;
  if (vKind == 0.0) {
    // A clump of white water: a dense core, a ragged edge.
    float shape = (1.0 - r * r) - (1.0 - m) * 0.7;
    a = smoothstep(0.0, 0.25, shape) * (0.7 + 0.3 * n);
  } else {
    // Mist and foam: soft, eaten away at the edge by two octaves of noise.
    float shape = (1.0 - r * r) - (1.0 - (n * 0.65 + m * 0.35)) * 0.9;
    a = smoothstep(0.0, 0.35, shape) * (0.55 + 0.6 * m);
  }
  a *= vA * uOpacity;
  // The cores pass draws the dense water and foam (writing depth); the other pass the rest.
  bool core = vKind != 1.0 && a > 0.1;
  #ifdef CORES
    if (!core) discard;
  #else
    if (core || a < 0.003) discard;
  #endif
  gl_FragColor = vec4(uLight * (0.8 + 0.4 * n) * (vKind == 1.0 ? 0.92 : 1.0), min(a, 0.95));
}`;

const N = 4200;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class MonsoonSea {
  readonly mesh: THREE.Group;
  readonly surges: Surge[] = [];
  /** A wave hitting the wall (for the sound): where, and how big (0.15 … 1.4). */
  onImpact: (pos: THREE.Vector3, strength: number) => void = () => {};
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aP: THREE.InstancedBufferAttribute;
  private readonly aV: THREE.InstancedBufferAttribute;
  private readonly aS: THREE.InstancedBufferAttribute;
  private cursor = 0;
  private readonly u = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uLight: { value: new THREE.Color(1, 1, 1) },
    uOpacity: { value: 0.9 },
    uWetNoise: WX.uWetNoise,
  };
  private nextSmall = 1;
  private nextMedium = 6;
  private nextBig = 14;
  private pending: { s: number; at: number; strength: number }[] = [];
  private time = 0;

  constructor() {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(N * 4).fill(-1e4), 4);
    this.aV = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.aS = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    for (const a of [this.aP, this.aV, this.aS]) {
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(a === this.aP ? 'aP' : a === this.aV ? 'aV' : 'aS', a);
    }
    this.geo.instanceCount = N;
    // Two draws: the dense white water writes depth (so the fog and the rain haze treat it at its
    // own distance, not the far sea's behind it), then the soft edges and the mist over it.
    this.mesh = new THREE.Group();
    this.mesh.name = 'sea-spray';
    this.mesh.visible = false;
    for (const cores of [true, false]) {
      // Double-sided: a streak turned along its motion can face either way.
      const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.u, transparent: true, depthWrite: cores, depthTest: true, side: THREE.DoubleSide, defines: cores ? { CORES: '' } : {} });
      const m = new THREE.Mesh(this.geo, mat);
      m.frustumCulled = false;
      m.renderOrder = cores ? 3 : 4;
      this.mesh.add(m);
    }
  }

  /** Point on the wall face (offset o from the median) at arc length s, and the landward normal. */
  private wallAt(s: number, o: number): { x: number; z: number; nx: number; nz: number } {
    const [x, z] = MD.axis.point(s, o);
    const [x1, z1] = MD.axis.point(s, o + 1);
    const l = Math.hypot(x1 - x, z1 - z) || 1;
    return { x, z, nx: (x1 - x) / l, nz: (z1 - z) / l };
  }

  /**
   * A wave hitting the tetrapods and the wall at s: whitewater surging over the tetrapods, a few
   * narrow jets of water thrown up (higher the bigger the wave) that fall back, and from the big
   * ones a mist the wind carries inland. Strength 0.12 … 1.4.
   */
  private burst(s: number, strength: number): void {
    const S = strength;
    const level = H.sea + MONSOON_TIDE * WEATHER.sea;
    const along = MD.axis.at(s);
    const first = this.cursor;
    let count = 0;
    const emit = (x: number, y: number, z: number, t0: number, vx: number, vy: number, vz: number, life: number, size: number, kind: number) => {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % N;
      this.aP.setXYZW(k, x, y, z, t0);
      this.aV.setXYZW(k, vx, vy, vz, life);
      this.aS.setXY(k, size, kind + Math.random() * 0.98);
      count++;
    };
    // Whitewater over the tetrapods where it breaks.
    const foamSpread = 3 + 5 * S;
    for (let i = 0, n = Math.round(18 + 50 * S); i < n; i++) {
      const w = this.wallAt(s + rnd(-foamSpread, foamSpread), MD.wallOuter - rnd(0.6, 6.5));
      emit(w.x, level + rnd(0.1, 0.7), w.z, this.time + rnd(0, 0.5), w.nx * rnd(0.4, 1.8) + along.tx * rnd(-1, 1), rnd(0.6, 2.2) + 2.5 * S, w.nz * rnd(0.4, 1.8) + along.tz * rnd(-1, 1), rnd(1.5, 2.8), rnd(0.7, 1.5), 2);
    }
    // Jets: a narrow base, a few irregular fingers of water, each its own height and lean.
    const fingers = 2 + Math.floor(Math.random() * (2 + 4 * S));
    const base = 1.2 + 3.5 * S;
    for (let f = 0; f < fingers; f++) {
      const ds = rnd(-base, base);
      const up = (4.5 + 11 * S) * rnd(0.55, 1.1) * (1 - 0.35 * Math.abs(ds) / base);
      const lean = rnd(-0.2, 0.6) + 0.9 * S;
      const tilt = rnd(-1.2, 1.2);
      const t0 = this.time + rnd(0, 0.25);
      for (let i = 0, n = Math.round(14 + 45 * S); i < n; i++) {
        const w = this.wallAt(s + ds + rnd(-0.5, 0.5), MD.wallOuter - rnd(0.3, 1.6));
        const v = up * rnd(0.6, 1.05);
        emit(w.x, level + rnd(0.3, 1.4), w.z, t0 + rnd(0, 0.22), w.nx * lean * rnd(0.6, 1.3) + along.tx * (tilt + rnd(-0.5, 0.5)), v, w.nz * lean * rnd(0.6, 1.3) + along.tz * (tilt + rnd(-0.5, 0.5)), rnd(1.8, 2.6) + 1.3 * S, rnd(0.16, 0.42) + 0.15 * S, 0);
      }
    }
    // The big ones leave a mist the wind takes inland (it clears in a couple of seconds).
    if (S > 0.4)
      for (let i = 0, n = Math.round(60 * (S - 0.3)); i < n; i++) {
        const w = this.wallAt(s + rnd(-base, base), MD.wallOuter - rnd(0, 1.5));
        emit(w.x, level + rnd(2, 4 + 5 * S), w.z, this.time + rnd(0.25, 0.8), w.nx * rnd(0.3, 1.5), rnd(0.8, 2.6), w.nz * rnd(0.3, 1.5), rnd(2.4, 3.8), rnd(1.0, 2.0) + 0.6 * S, 1);
      }
    this.upload(first, count);
    const w = this.wallAt(s, MD.wallOuter);
    this.onImpact(new THREE.Vector3(w.x, H.wallTop, w.z), strength);
  }

  /** Particles written since the last frame's upload (ranges accumulate until three uploads them). */
  private dirty = false;

  private upload(first: number, n: number): void {
    for (const a of [this.aP, this.aV, this.aS]) {
      if (!this.dirty) a.clearUpdateRanges();
      const end = first + n;
      if (end <= N) a.addUpdateRange(first * a.itemSize, n * a.itemSize);
      else {
        a.addUpdateRange(first * a.itemSize, (N - first) * a.itemSize);
        a.addUpdateRange(0, (end - N) * a.itemSize);
      }
      a.needsUpdate = true;
    }
    this.dirty = true;
  }

  /** A big wave of `strength` hitting the wall at s, `lead` seconds from now. */
  cue(s: number, lead: number, strength: number): void {
    const w = this.wallAt(s, MD.wallOuter - 1.5);
    const at = this.time + lead;
    this.surges.push({ x: w.x, z: w.z, at, strength, nx: w.nx, nz: w.nz });
    if (this.surges.length > 4) this.surges.shift();
    this.pending.push({ s, at, strength });
    this.nextBig = Math.max(this.nextBig, at + 15);
  }

  /** A big wave somewhere along the wall that the camera can see (the film cues them). */
  cueInView(camera: THREE.Camera, lead: number, strength: number): void {
    const s = this.inView(camera);
    if (s !== null) this.cue(s, lead, strength);
  }

  /**
   * A stretch of the wall in view, 30–200 m off (from the wall itself the near wall runs almost
   * side-on; further along, Marine Drive's curve comes round into view). Null if none is.
   */
  private inView(camera: THREE.Camera): number | null {
    camera.updateMatrixWorld();
    const vp = new THREE.Matrix4().multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
    const camS = MD.axis.project(camera.position.x, camera.position.z).s;
    const v = new THREE.Vector4();
    let best: number | null = null;
    let bestScore = Infinity;
    for (let ds = -320; ds <= 320; ds += 8) {
      const s = camS + ds;
      if (s < MD.sDetail0 + 20 || s > MD.sDetail1 - 10) continue;
      const w = this.wallAt(s, MD.wallOuter - 2);
      const d = Math.hypot(w.x - camera.position.x, w.z - camera.position.z);
      if (d < 30 || d > 200) continue;
      v.set(w.x, H.wallTop + 3, w.z, 1).applyMatrix4(vp);
      if (v.w <= 0) continue;
      const x = v.x / v.w;
      const y = v.y / v.w;
      if (Math.abs(x) > 0.7 || Math.abs(y) > 0.9) continue;
      const score = Math.abs(d - 75) / 75 + Math.abs(x) + Math.random() * 0.4;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /** Where along the wall to put the next wave: in view when there is wall in view, else close by. */
  private pickS(camera: THREE.Camera, camS: number, ahead: boolean): number {
    const seen = ahead ? this.inView(camera) : null;
    if (seen !== null) return seen;
    return THREE.MathUtils.clamp(camS + rnd(-70, 70), MD.sDetail0 + 20, MD.sDetail1 - 10);
  }

  update(_dt: number, time: number, camera: THREE.Camera, light: LightingState): void {
    // Last frame's writes have been uploaded by now.
    this.dirty = false;
    this.time = time;
    const rough = WEATHER.sea;
    this.u.uTime.value = time;
    this.u.uWind.value.copy(WEATHER.wind);
    // Spray is white water: brighter than the grey sky behind it; the street lights' glow after dark.
    this.u.uLight.value.copy(light.horizon).lerp(light.zenith, 0.3).multiplyScalar(2.3).add(new THREE.Color(0.32, 0.27, 0.2).multiplyScalar(light.lamps * 0.5));
    // Finished surges drop out.
    for (let i = this.surges.length - 1; i >= 0; i--) if (time > this.surges[i].at + 12) this.surges.splice(i, 1);
    // The waves hit the wall: the spray.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (time >= p.at) {
        this.burst(p.s, p.strength);
        this.pending.splice(i, 1);
      }
    }
    this.mesh.visible = rough > 0.02 || this.pending.length > 0;
    if (rough < 0.05) return;
    const q = MD.axis.project(camera.position.x, camera.position.z);
    const near = Math.abs(q.o) < 300 && q.s > MD.sDetail0 - 150 && q.s < MD.sDetail1 + 150;
    if (!near) return;
    // Waves breaking on the tetrapods all along the wall.
    if (time > this.nextSmall) {
      this.nextSmall = time + rnd(0.9, 2.8) / rough;
      this.burst(this.pickS(camera, q.s, false), rnd(0.12, 0.38) * rough);
    }
    // Bigger sets, seen coming in; and now and then a really big one, in front of you.
    const surge = (strength: number, lead: number, ahead: boolean) => {
      const s = this.pickS(camera, q.s, ahead);
      const w = this.wallAt(s, MD.wallOuter - 1.5);
      const at = time + lead;
      this.surges.push({ x: w.x, z: w.z, at, strength, nx: w.nx, nz: w.nz });
      if (this.surges.length > 4) this.surges.shift();
      this.pending.push({ s, at, strength });
    };
    if (time > this.nextMedium) {
      this.nextMedium = time + rnd(6, 13);
      surge(rnd(0.45, 0.75) * rough, 7, Math.random() < 0.6);
    }
    if (time > this.nextBig) {
      this.nextBig = time + rnd(20, 42);
      surge(rnd(1.0, 1.4) * rough, 9, true);
    }
  }
}
