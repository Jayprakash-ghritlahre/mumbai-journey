import * as THREE from 'three';
import { valueNoise } from '../core/Random';

export interface ShotContext {
  camera: THREE.PerspectiveCamera;
  /** Seconds since the cinematic began. */
  T: number;
}

export interface Shot {
  name: string;
  duration: number;
  fov?: number;
  enter?: () => void;
  /** t: 0..1 progress within the shot. */
  update: (t: number, ctx: ShotContext) => void;
  title?: [string, string?, string?];
  titleAt?: number;
  titleFor?: number;
  sub?: [string, string?];
  subAt?: number;
  subFor?: number;
  /** Fade from black at the start / to black at the end of this shot (seconds). */
  fadeIn?: number;
  fadeOut?: number;
}

export const ease = (t: number) => t * t * (3 - 2 * t);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const tmpM = new THREE.Matrix4();
const tmpUp = new THREE.Vector3(0, 1, 0);

/** Points the camera from `pos` at `target` with an optional roll. */
export function pose(cam: THREE.PerspectiveCamera, pos: THREE.Vector3, target: THREE.Vector3, roll = 0): void {
  cam.position.copy(pos);
  tmpM.lookAt(pos, target, tmpUp);
  cam.quaternion.setFromRotationMatrix(tmpM);
  if (roll) cam.rotateZ(roll);
}

/** Documentary "handheld" micro-motion, applied after posing. */
export function handheld(cam: THREE.PerspectiveCamera, T: number, amount: number): void {
  if (amount <= 0) return;
  const n = (s: number) => valueNoise(T * 0.9 + s, s * 3.1, 7) - 0.5;
  cam.rotateX(n(1.3) * 0.012 * amount);
  cam.rotateY(n(7.7) * 0.016 * amount);
  cam.rotateZ(n(3.9) * 0.006 * amount);
}

/** A walking viewpoint along a path at a given pace, with head bob and gentle look-ahead. */
export class WalkPath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;

  constructor(points: THREE.Vector3[]) {
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    this.length = this.curve.getLength();
  }

  /** Places the camera `dist` metres along the path; `lookAhead` metres ahead is the gaze target. */
  apply(cam: THREE.PerspectiveCamera, dist: number, _T: number, opts: { lookAhead?: number; bob?: number; lookOffset?: THREE.Vector3; yawOffset?: number } = {}): void {
    const u = THREE.MathUtils.clamp(dist / this.length, 0, 1);
    const p = this.curve.getPointAt(u);
    const ahead = this.curve.getPointAt(Math.min(1, u + (opts.lookAhead ?? 6) / this.length));
    if (u > 0.999) ahead.add(this.curve.getTangentAt(1).multiplyScalar(opts.lookAhead ?? 6));
    const bob = opts.bob ?? 1;
    const step = dist / 0.72;
    p.y += Math.abs(Math.sin(step * Math.PI)) * 0.04 * bob - 0.02 * bob;
    const side = new THREE.Vector3().subVectors(ahead, p).cross(tmpUp).normalize();
    p.addScaledVector(side, Math.cos(step * Math.PI) * 0.018 * bob);
    ahead.y = p.y - 0.15;
    if (opts.lookOffset) ahead.add(opts.lookOffset);
    pose(cam, p, ahead, Math.cos(step * Math.PI) * 0.004 * bob);
    if (opts.yawOffset) cam.rotateY(opts.yawOffset);
  }
}

/** Plays a list of shots in order and drives titles, fades and subtitles through callbacks. */
export class CinematicPlayer {
  private shots: Shot[] = [];
  private index = -1;
  private shotTime = 0;
  T = 0;
  playing = false;
  private titleShown = false;
  private subShown = false;
  onTitle: (t: [string, string?, string?] | null) => void = () => {};
  onSub: (s: [string, string?] | null) => void = () => {};
  onFade: (black: boolean) => void = () => {};
  onEnd: () => void = () => {};
  onShot: (name: string) => void = () => {};

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  play(shots: Shot[]): void {
    this.shots = shots;
    this.index = -1;
    this.T = 0;
    this.playing = true;
    this.next();
  }

  stop(): void {
    this.playing = false;
    this.onTitle(null);
    this.onSub(null);
  }

  private next(): void {
    this.index++;
    this.shotTime = 0;
    this.titleShown = false;
    this.subShown = false;
    const s = this.shots[this.index];
    if (!s) {
      this.playing = false;
      this.onEnd();
      return;
    }
    if (s.fov) {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    s.enter?.();
    this.onShot(s.name);
    if (s.fadeIn) {
      this.onFade(true);
      window.setTimeout(() => this.onFade(false), 60);
    }
  }

  update(dt: number): void {
    if (!this.playing) return;
    const s = this.shots[this.index];
    if (!s) return;
    this.shotTime += dt;
    this.T += dt;
    const t = Math.min(1, this.shotTime / s.duration);
    s.update(t, { camera: this.camera, T: this.T });
    if (s.title && !this.titleShown && this.shotTime >= (s.titleAt ?? 0.8)) {
      this.titleShown = true;
      this.onTitle(s.title);
      window.setTimeout(() => this.onTitle(null), (s.titleFor ?? 5) * 1000);
    }
    if (s.sub && !this.subShown && this.shotTime >= (s.subAt ?? 0.5)) {
      this.subShown = true;
      this.onSub(s.sub);
      window.setTimeout(() => this.onSub(null), (s.subFor ?? 4) * 1000);
    }
    if (s.fadeOut && this.shotTime >= s.duration - s.fadeOut) this.onFade(true);
    if (this.shotTime >= s.duration) this.next();
  }

  /** Jumps to absolute time T (seconds from the start of the sequence). */
  seek(T: number): void {
    let acc = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const d = this.shots[i].duration;
      if (T < acc + d || i === this.shots.length - 1) {
        this.index = i;
        this.shotTime = Math.min(d, T - acc);
        this.T = T;
        this.titleShown = this.subShown = true;
        const s = this.shots[i];
        if (s.fov) {
          this.camera.fov = s.fov;
          this.camera.updateProjectionMatrix();
        }
        s.enter?.();
        s.update(Math.min(1, this.shotTime / d), { camera: this.camera, T: this.T });
        return;
      }
      acc += d;
    }
  }

  get totalDuration(): number {
    return this.shots.reduce((a, s) => a + s.duration, 0);
  }

  get currentShot(): string {
    return this.shots[this.index]?.name ?? '';
  }
}
