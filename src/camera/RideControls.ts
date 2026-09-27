import * as THREE from 'three';
import type { Input } from '../core/Input';
import { CAR } from '../entities/train/Livery';
import type { Ride } from '../world/journey/Ride';

const WALK = 1.3;
const EYE = 1.62;
const F = CAR.floorY;
/** Mira Road PF 4 and Churchgate's platforms: top above rail (m). */
const PF_MIRA = 0.92;

export type RideWhere = 'platform' | 'car' | 'seat';

/**
 * First-person control for the interactive ride: walking on Mira Road's PF 4 (in the frame of
 * the car where it will stop), stepping in through an open door, moving about the car while it
 * runs (the position lives in the car's frame, so the player sways with it), sitting down, and
 * stepping out at Churchgate. Positions are in the ride frame: +z towards Churchgate, +x to PF 4.
 */
export class RideControls {
  where: RideWhere = 'platform';
  readonly pos = new THREE.Vector3(3.2, PF_MIRA, 4);
  yaw = 0;
  pitch = 0;
  private seatH = 0;
  private bob = 0;
  private bobAmp = 0;
  /** The car's frame where it stops at Mira Road (the platform is static in it). */
  private stopFrame = new THREE.Matrix4();
  /** Set when the player walks out of a door at Churchgate (world position, yaw). */
  onAlight: ((p: THREE.Vector3, yaw: number, pitch: number) => void) | null = null;
  onHint: (text: string | null) => void = () => {};
  private lastHint = '';

  constructor(private readonly input: Input) {}

  begin(ride: Ride, stopFrame: THREE.Matrix4): void {
    this.stopFrame.copy(stopFrame);
    this.where = 'platform';
    // On PF 4 beside where the car's middle door will be, looking up the line for the train.
    this.pos.set(4.2, PF_MIRA, 2.5);
    this.yaw = 0.35;
    this.pitch = 0;
    void ride;
  }

  /** Stepped aboard on foot (exploring Mira Road): now in the car at a ride-frame position. */
  boardAt(p: THREE.Vector3, yaw: number, pitch: number): void {
    this.where = 'car';
    this.pos.set(Math.min(p.x, CAR.halfW - 0.25), F, p.z);
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Per frame, before the ride moves: reads the keys and moves in the local frame. */
  update(dt: number, ride: Ride): void {
    const inp = this.input;
    const sens = 0.0022;
    this.yaw -= inp.mouseDX * sens;
    this.pitch -= inp.mouseDY * sens;
    if (inp.down('ArrowLeft')) this.yaw += dt * 1.6;
    if (inp.down('ArrowRight')) this.yaw -= dt * 1.6;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.3, 1.3);
    const st = ride.state;
    const doorsOpen = st.doors > 0.9;
    const legKey = ride.current.key;
    const atChurchgate = legKey === 'E' && st.stopped && ride.t > (ride.current.handoverAt ?? 1e9);

    if (inp.hit('KeyE')) {
      if (this.where === 'seat') {
        this.where = 'car';
        this.pos.x = Math.sign(this.pos.x) * 0.2;
      } else if (this.where === 'car') {
        const seat = ride.freeSeat(this.pos);
        if (seat) {
          this.where = 'seat';
          this.pos.set(seat.x, F, seat.z);
          this.seatH = seat.h;
          this.yaw = seat.h + Math.PI;
          this.pitch = -0.05;
        }
      }
    }
    if (this.where === 'seat') {
      // Look around from the seat; no walking.
      this.yaw = this.seatH + Math.PI + THREE.MathUtils.clamp(wrap(this.yaw - this.seatH - Math.PI), -1.9, 1.9);
      const st = ride.current.stop;
      if (st && ride.t > st.at - 25 && ride.t < st.at + st.dwell + 4) this.hint(`${st.halt.name} · platform ${st.halt.pf} · E — stand up · N — skip ahead`);
      else this.hint('E — stand up · N — skip ahead · Esc — menu');
      return;
    }

    let fwd = (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0);
    let side = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    fwd += inp.touchMove.y;
    side += inp.touchMove.x;
    const speed = (inp.down('ShiftLeft') || inp.down('ShiftRight') ? 2.4 : WALK) * dt;
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const mv = new THREE.Vector3(-sinY * fwd + cosY * side, 0, -cosY * fwd - sinY * side);
    if (mv.lengthSq() > 1) mv.normalize();
    const moving = mv.lengthSq() > 0.01;
    const next = this.pos.clone().addScaledVector(mv, speed);
    this.bobAmp += ((moving ? 1 : 0) - this.bobAmp) * (1 - Math.exp(-dt * 6));
    if (moving) this.bob += speed / 0.36;

    const doorAt = (z: number) => CAR.doors.find((d) => Math.abs(z + d) < CAR.doorW / 2 - 0.15);
    if (this.where === 'platform') {
      // PF 4 beside the car; into the car through an open door of this car.
      const platformOK = (p: THREE.Vector3) => p.x > CAR.halfW + 0.15 && p.x < 9.5 && p.z > -210 && p.z < 30;
      const boarding = doorsOpen && legKey === 'A' && st.stopped && doorAt(next.z) !== undefined && next.x <= CAR.halfW + 0.15 && next.x > CAR.halfW - 0.8;
      if (boarding) {
        this.where = 'car';
        next.y = F;
        this.pos.copy(next);
      } else if (platformOK(next)) this.pos.copy(next);
      if (legKey === 'A' && st.stopped && doorsOpen) this.hint('Board the train: walk in through an open door of this coach');
      else if (legKey === 'A' && !st.stopped) this.hint('Platform 4 · the Churchgate fast is coming in');
      else this.hint(null);
      return;
    }

    // In the car: the aisle between the benches, the door vestibules, the doorway itself.
    const inVest = (z: number) => CAR.doors.some((d) => Math.abs(z + d) < 0.95);
    const L = CAR.length / 2 - 0.35;
    const ok = (p: THREE.Vector3) => {
      if (Math.abs(p.z) > L) return false;
      if (Math.abs(p.x) <= 0.35) return true;
      if (!inVest(p.z)) return false;
      const lim = doorAt(p.z) !== undefined && doorsOpen ? CAR.halfW + 0.05 : CAR.halfW - 0.3;
      return Math.abs(p.x) <= lim;
    };
    if (ok(next)) this.pos.copy(next);
    else {
      // Slide along walls.
      const a = this.pos.clone();
      a.x = next.x;
      const b = this.pos.clone();
      b.z = next.z;
      if (ok(a)) this.pos.copy(a);
      else if (ok(b)) this.pos.copy(b);
    }
    // Step out at Churchgate onto either platform.
    if (atChurchgate && doorsOpen && doorAt(this.pos.z) !== undefined && Math.abs(this.pos.x) > CAR.halfW - 0.1 && Math.abs(next.x) > Math.abs(this.pos.x)) {
      const w = ride.toWorld(new THREE.Vector3(Math.sign(this.pos.x) * (CAR.halfW + 0.5), 0, this.pos.z));
      const q = new THREE.Quaternion().setFromRotationMatrix(ride.frame);
      const e = new THREE.Euler().setFromQuaternion(q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'))), 'YXZ');
      this.hint(null);
      this.onAlight?.(w, e.y, e.x);
      return;
    }
    const stop = ride.current.stop;
    if (atChurchgate) this.hint('Churchgate · step out through an open door');
    else if (stop && ride.t > stop.at - 25 && ride.t < stop.at + stop.dwell + 4) this.hint(`${stop.halt.name} · platform ${stop.halt.pf} · stay aboard: this train runs on to Churchgate`);
    else if (legKey === 'A' && ride.t < 72) this.hint('E — sit down · WASD — move · the train leaves soon');
    else this.hint('E — sit (near a free seat) · N — skip ahead · Esc — menu');
  }

  private hint(text: string | null): void {
    const k = text ?? '';
    if (k === this.lastHint) return;
    this.lastHint = k;
    this.onHint(text);
  }

  /** After the ride has moved this frame: puts the camera at the player's eye. */
  apply(cam: THREE.PerspectiveCamera, ride: Ride): void {
    const frame = this.where === 'platform' ? this.stopFrame : ride.frame;
    const seated = this.where === 'seat';
    const b = seated ? 0 : this.bobAmp;
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + (seated ? 1.12 : EYE) + Math.abs(Math.sin(this.bob * Math.PI)) * 0.035 * b, this.pos.z);
    cam.position.copy(eye.applyMatrix4(frame));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(frame));
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, Math.cos(this.bob * Math.PI) * 0.004 * b, 'YXZ')));
    cam.quaternion.copy(q);
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
