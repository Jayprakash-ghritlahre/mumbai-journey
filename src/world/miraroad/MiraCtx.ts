import * as THREE from 'three';
import { boxGeo, tint, type GeoBuilder } from '../../gfx/GeoBuilder';
import { signQuad, type AtlasRect } from '../../gfx/Signage';
import type { CollisionWorld } from '../../core/Collision';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import type { RNG } from '../../core/Random';
import type { WalkSurface } from '../route/WalkSurface';
import type { MiraSignSet } from './MiraSigns';

/** Platform top above rail (m) ⚠. */
export const TOP = 0.92;
/** Deck, foot-over-bridge and skywalk walking level above rail (m) ⚠. */
export const DECK = 7.3;
/** The town's ground, the roads, the footpaths and the forecourt (heights above rail, m) ⚠. */
export const GROUND = -0.45;
export const ROAD = -0.42;
export const FOOTPATH = -0.26;
export const PLAZA = -0.3;

/**
 * What the Mira Road builders share. Geometry is built relative to the station anchor (the group
 * sits there); collision, the ambient volume and the walk surface are in world coordinates.
 */
export interface MiraCtx {
  gb: GeoBuilder;
  M: Record<string, THREE.Material>;
  signs: MiraSignSet;
  col: CollisionWorld;
  av: AmbientVolume;
  walk: WalkSurface;
  AX: number;
  AZ: number;
  rng: RNG;
  /** Local point at path distance d (towards Churchgate), offset o (east +), height y. */
  P(d: number, o: number, y: number): THREE.Vector3;
  heading(d: number): number;
  proj(x: number, z: number): { s: number; o: number };
  /** d of the station reference (the lead end of the Churchgate fast at PF 4). */
  dm: number;
  /** The yellow मीरा रोड / MIRA ROAD board in the corridor's sign atlas (key 'corrSigns'). */
  kitBoard: AtlasRect;
}

export const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function mat4(x: number, y: number, z: number, ry = 0, rx = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), V3(1, 1, 1));
}

/** A box between two points (a beam, a rail) with a given section. */
export function beam(A: THREE.Vector3, B: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const g = boxGeo(w, h, A.distanceTo(B));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

/**
 * A sign on a backing plate at matrix m (front +Z): the face in the sign atlas, a dark plate
 * behind; `back` also shows the face on the reverse (hung signs).
 */
export function sign(c: MiraCtx, rect: AtlasRect, w: number, h: number, m: THREE.Matrix4, opts: { back?: boolean; lit?: boolean; plate?: [number, number, number]; depth?: number } = {}): void {
  const key = opts.lit ? 'signsLit' : 'signs';
  const d = opts.depth ?? 0.05;
  c.gb.add(key, signQuad(rect, w, h).translate(0, 0, d / 2 + 0.004).applyMatrix4(m));
  if (opts.back) c.gb.add(key, signQuad(rect, w, h).rotateY(Math.PI).translate(0, 0, -d / 2 - 0.004).applyMatrix4(m));
  const p = opts.plate ?? [0.12, 0.12, 0.13];
  c.gb.add('paint', tint(boxGeo(w + 0.06, h + 0.06, d), p[0], p[1], p[2]).applyMatrix4(m));
}

/**
 * Local → world helpers for collision and the ambient volume. Solids stop below the decks unless
 * given a range (people on the bridges walk over everything at street and platform level).
 */
export function solid(c: MiraCtx, x: number, z: number, hx: number, hz: number, angle: number, minY = -1, maxY = 6.5): void {
  c.col.addSolid(x + c.AX, z + c.AZ, hx, hz, angle, minY, maxY);
}

export function wall(c: MiraCtx, x0: number, z0: number, x1: number, z1: number, t: number, minY = -1, maxY = 6.5): void {
  c.col.addWall(x0 + c.AX, z0 + c.AZ, x1 + c.AX, z1 + c.AZ, t, minY, maxY);
}

export function ramp(c: MiraCtx, ax: number, az: number, bx: number, bz: number, hw: number, h0: number, h1 = h0): void {
  c.col.addRamp(ax + c.AX, az + c.AZ, bx + c.AX, bz + c.AZ, hw, h0, h1);
}

/** Artificial light in the ambient volume (lamps, tube lights) at a local point. */
export function lamp(c: MiraCtx, x: number, z: number, r: number, amount: number): void {
  c.av.light(x + c.AX, z + c.AZ, r, amount);
}

/** Roof cover in the ambient volume over a local oriented rectangle (centre, half sizes, angle). */
export function cover(c: MiraCtx, x: number, z: number, hu: number, hv: number, angle: number, sky: number, ceil: number): void {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const r = Math.hypot(hu, hv);
  const X = x + c.AX;
  const Z = z + c.AZ;
  c.av.paint(X - r, Z - r, X + r, Z + r, (wx, wz, s0, c0) => {
    const dx = wx - X;
    const dz = wz - Z;
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    if (Math.abs(lx) > hu || Math.abs(lz) > hv) return [s0, c0];
    return [Math.min(s0, sky), Math.max(c0, ceil)];
  });
}

/** Raised walkable street surface (footpaths, the forecourt) over a local polygon. */
export function raise(c: MiraCtx, pts: [number, number][], y: number): void {
  c.walk.polygon(
    pts.map(([x, z]) => [x + c.AX, z + c.AZ]),
    y,
  );
}
