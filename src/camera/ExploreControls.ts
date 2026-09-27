import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { CollisionWorld } from '../core/Collision';

const EYE = 1.62;
const WALK = 1.45;
const RUN = 3.6;

/** First-person walking camera with collision, stepping and a subtle head bob. */
export class ExploreControls {
  enabled = false;
  fly = false;
  readonly feet = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private velocity = new THREE.Vector3();
  private bobPhase = 0;
  private bobAmount = 0;
  private eyeY = 0;
  private lastStepPhase = 0;
  onFootstep: ((speed: number, surface: number) => void) | null = null;
  // The modelled area: the station, the route to Marine Drive and Nariman Point.
  bounds = { minX: -1250, maxX: 600, minZ: -900, maxZ: 1140 };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    /** The walkable world (Churchgate's, or Mira Road's while exploring there). */
    public world: CollisionWorld,
  ) {}

  /** Places the walker at a position (feet on the ground) looking along yaw/pitch (radians). */
  place(x: number, z: number, yaw: number, pitch = 0, feetY?: number): void {
    this.feet.set(x, feetY ?? this.world.groundAt(x, z, 50, 100), z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.eyeY = this.feet.y + EYE;
    this.velocity.set(0, 0, 0);
    this.apply(0);
  }

  /** Continue walking from wherever the camera currently is (after a cinematic). */
  takeOverFromCamera(): void {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const x = this.camera.position.x;
    const z = this.camera.position.z;
    const y = this.world.groundAt(x, z, this.camera.position.y - 0.5, 0.2);
    this.place(x, z, e.y, THREE.MathUtils.clamp(e.x, -1.2, 1.2), y);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const inp = this.input;
    const sens = 0.0022;
    this.yaw -= inp.mouseDX * sens;
    this.pitch -= inp.mouseDY * sens;
    if (inp.down('ArrowLeft')) this.yaw += dt * 1.6;
    if (inp.down('ArrowRight')) this.yaw -= dt * 1.6;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.35);
    if (inp.hit('KeyF')) this.fly = !this.fly;

    let fwd = (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0);
    let side = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    fwd += inp.touchMove.y;
    side += inp.touchMove.x;
    const running = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const speed = this.fly ? (running ? 40 : 12) : running ? RUN : WALK;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const want = new THREE.Vector3(-sinY * fwd + cosY * side, 0, -cosY * fwd - sinY * side);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(speed);

    if (this.fly) {
      const up = (inp.down('KeyE') || inp.down('Space') ? 1 : 0) - (inp.down('KeyQ') || inp.down('KeyC') ? 1 : 0);
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const right = new THREE.Vector3(cosY, 0, -sinY);
      this.feet.addScaledVector(dir, fwd * speed * dt).addScaledVector(right, side * speed * dt);
      this.feet.y += up * speed * dt;
      this.eyeY = this.feet.y + EYE;
      this.apply(dt);
      return;
    }

    // Smooth acceleration feels like a person rather than a camera.
    const accel = 1 - Math.exp(-dt * 9);
    this.velocity.lerp(want, accel);
    const next = this.feet.clone().addScaledVector(this.velocity, dt);
    next.x = THREE.MathUtils.clamp(next.x, this.bounds.minX, this.bounds.maxX);
    next.z = THREE.MathUtils.clamp(next.z, this.bounds.minZ, this.bounds.maxZ);
    this.world.resolve(next, 0.3);
    const ground = this.world.groundAt(next.x, next.z, this.feet.y, 0.45);
    if (ground < this.feet.y - 0.6) {
      // Refuse to walk off a ledge (platform edges, stair wells).
      next.x = this.feet.x;
      next.z = this.feet.z;
      this.velocity.multiplyScalar(0.2);
    } else {
      next.y = ground;
    }
    this.feet.copy(next);

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.bobAmount += ((horizSpeed > 0.2 ? 1 : 0) - this.bobAmount) * (1 - Math.exp(-dt * 6));
    this.bobPhase += dt * (horizSpeed > 2 ? 11.5 : 8.2) * Math.min(1, horizSpeed / WALK);
    // Eye height follows the ground smoothly (stairs).
    this.eyeY += (this.feet.y + EYE - this.eyeY) * (1 - Math.exp(-dt * 14));
    const stepPhase = Math.floor(this.bobPhase / Math.PI);
    if (stepPhase !== this.lastStepPhase && horizSpeed > 0.3) {
      this.lastStepPhase = stepPhase;
      this.onFootstep?.(horizSpeed, this.feet.y > 0.5 ? 1 : 0);
    }
    this.apply(dt);
  }

  private apply(_dt: number): void {
    const bob = this.fly ? 0 : this.bobAmount;
    const by = Math.abs(Math.sin(this.bobPhase)) * 0.045 * bob;
    const bx = Math.cos(this.bobPhase) * 0.02 * bob;
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    this.camera.position.set(this.feet.x + cosY * bx, this.eyeY + by - 0.02 * bob, this.feet.z - sinY * bx);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, Math.cos(this.bobPhase) * 0.004 * bob, 'YXZ'));
  }
}
