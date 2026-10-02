import * as THREE from 'three';
import { boxGeo, tint } from '../../gfx/GeoBuilder';
import type { AtlasRect } from '../../gfx/Signage';
import { FOOTPATH, GROUND, ROAD, lamp, mat4, solid, type MiraCtx } from './MiraCtx';
import { autoRickshaw } from './MiraVehicles';
import { instanced, prop, shopfront } from './MiraStreets';
import { Kit } from '../route/Props';
import type { FirstMileSigns } from './MiraSigns';

type Pt = [number, number];
type Spot = { kind: string; x: number; z: number; y: number; h: number; pose?: number };

/**
 * What you see as the auto turns in to the station (AUTO_RIDE.md §3, the user's Street View
 * captures of Station Road and Poonam Sagar Road): Shanti Shopping Centre (OSM 1063810561), the
 * long weathered pink block facing the station approach, with the arched gables on its parapet,
 * its shops as they stand from the station end (Veg Sagar where Natraj was, Bikaner, the building's
 * own entrance, Jio with Bharat Bank above, Monginis, Jumboking, an Udupi hotel, Ambika, Oppo), the
 * dormitory board and a festival banner upstairs, tin awnings; its Poonam Sagar Road side (Generic
 * Medical at the junction); the Union Bank on the curved corner across the junction (the former
 * Corporation Bank, which named it); autos queued at the kerb behind yellow-and-black bollards.
 *
 * Names are the real businesses there; their boards are drawn in their colours, not copied.
 */

export interface StationShopsInput {
  /** Shanti Shopping Centre's footprint (local). */
  centre: Pt[] | null;
  /** The one-storey bank building on the junction's south-east corner. */
  bank: Pt[] | null;
  signs: FirstMileSigns;
  board: (rect: AtlasRect, w: number, h: number, m: THREE.Matrix4, opts?: { lit?: boolean; back?: boolean; plate?: [number, number, number] }) => void;
}

export function buildStationShops(c: MiraCtx, inp: StationShopsInput): { spots: Spot[]; meshes: THREE.Object3D[] } {
  const gb = c.gb;
  const rng = c.rng;
  const out: { spots: Spot[]; meshes: THREE.Object3D[] } = { spots: [], meshes: [] };
  const st = inp.signs.station;
  const named = (key: string) => ({ rect: st[key], key: 'fmSignsLit' });
  const ryZ = (dx: number, dz: number) => Math.atan2(dx, dz);

  // ---- Shanti Shopping Centre ------------------------------------------------------------------
  const P = inp.centre;
  if (P && P.length >= 4) {
    let area = 0;
    for (let i = 0; i < P.length; i++) area += P[i][0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * P[i][1];
    // Its north face (along the approach) and east face (along Poonam Sagar Road).
    let north = 0;
    let east = 0;
    let bn = Infinity;
    let be = -Infinity;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const mz = (a[1] + b[1]) / 2;
      const mx = (a[0] + b[0]) / 2;
      if (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) && mz < bn) {
        bn = mz;
        north = i;
      }
      if (Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) && mx > be) {
        be = mx;
        east = i;
      }
    }
    const faceOf = (i: number) => {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      let nx = uz;
      let nz = -ux;
      if (area < 0) {
        nx = -nx;
        nz = -nz;
      }
      return { a, b, len, ux, uz, nx, nz };
    };
    const nf = faceOf(north);
    // Walk the north face from its station (west) end.
    const fromWest = nf.ux > 0;
    const along = (f: ReturnType<typeof faceOf>, t: number, westFirst: boolean): Pt => {
      const d = westFirst ? t : f.len - t;
      return [f.a[0] + f.ux * d, f.a[1] + f.uz * d];
    };
    const hN = ryZ(nf.nx, nf.nz);
    type Unit = { t0: number; t1: number; key?: string; interior?: number; awning?: 'tin' | 'none'; entrance?: boolean };
    const units: Unit[] = [
      { t0: 0.6, t1: 8.8, key: 'vegSagar', interior: 2, awning: 'tin' },
      { t0: 8.8, t1: 13.6, key: 'bikaner', interior: 2, awning: 'tin' },
      { t0: 13.6, t1: 17.1, entrance: true },
      { t0: 17.1, t1: 21.1, key: 'jio', interior: 3, awning: 'none' },
      { t0: 21.1, t1: 25.5, key: 'monginis', interior: 2, awning: 'tin' },
      { t0: 25.5, t1: 29.5 },
      { t0: 29.5, t1: 34.0, key: 'jumboking', interior: 2, awning: 'tin' },
      { t0: 34.0, t1: 39.0, key: 'udupi', interior: 2, awning: 'tin' },
    ];
    for (let t = 39; t < nf.len - 4.5; ) {
      const w = rng.range(4.0, 4.8);
      units.push({ t0: t, t1: Math.min(nf.len - 0.6, t + w) });
      t += w;
    }
    // Ambika and Oppo, about two-thirds of the way along (the view from the approach road).
    const mid = units.findIndex((u) => u.t0 > nf.len * 0.55);
    if (mid > 0) {
      units[mid].key = 'ambika';
      units[mid].awning = 'tin';
      if (units[mid + 1]) {
        units[mid + 1].key = 'oppo';
        units[mid + 1].interior = 3;
        units[mid + 1].awning = 'none';
      }
    }
    let k = 3;
    for (const u of units) {
      const t = (u.t0 + u.t1) / 2;
      const w = u.t1 - u.t0;
      const [x, z] = along(nf, t, fromWest);
      if (u.entrance) {
        // The building's own entrance: a dark stair hall, its name board over it.
        gb.add('prop_paint', tint(boxGeo(w - 0.4, 2.9, 0.05).translate(0, 1.45, 0.03), 0.08, 0.07, 0.07).applyMatrix4(mat4(x, FOOTPATH, z, hN)));
        inp.board(st.centre, w - 0.2, (w - 0.2) / 4, mat4(x + nf.nx * 0.16, FOOTPATH + 3.45, z + nf.nz * 0.16, hN), { lit: true });
        lamp(c, x + nf.nx * 1.5, z + nf.nz * 1.5, 5, 0.3);
        continue;
      }
      if (u.key) {
        shopfront(c, x, z, hN, w - 0.25, k++, { board: named(u.key), interior: u.interior, open: true, awning: u.awning ?? 'tin' });
        for (let q = 0; q < (u.key === 'vegSagar' || u.key === 'monginis' || u.key === 'jumboking' ? 3 : 1); q++)
          out.spots.push({ kind: 'shop', x: x + nf.nx * rng.range(1.0, 2.2) + nf.ux * rng.range(-w / 3, w / 3), z: z + nf.nz * rng.range(1.0, 2.2) + nf.uz * rng.range(-w / 3, w / 3), y: FOOTPATH, h: hN + Math.PI + rng.range(-0.7, 0.7), pose: rng.chance(0.3) ? 2 : 0 });
      } else shopfront(c, x, z, hN, w - 0.25, k++, { awning: rng.chance(0.75) ? 'tin' : 'none' });
    }
    // Upstairs: Bharat Bank over Jio, the dormitory board, a festival banner, classes and clinics.
    const upper = (t: number, y: number, w: number, rect: AtlasRect, hgt = w / 5.33) => {
      const [x, z] = along(nf, t, fromWest);
      inp.board(rect, w, hgt, mat4(x + nf.nx * 0.1, FOOTPATH + y, z + nf.nz * 0.1, hN), { lit: true });
    };
    upper(19.6, 5.3, 6.2, st.bharatBank, 1.16);
    upper(11, 8.4, 6.4, st.dorm, 1.6);
    upper(29, 6.2, 9.0, inp.signs.bigBanner, 3.4);
    let ui = 0;
    for (let t = 44; t < nf.len - 6; t += rng.range(9, 16)) upper(t, rng.chance(0.5) ? 5.3 : 8.3, 4.2, inp.signs.upper[ui++ % inp.signs.upper.length], 0.79);
    // The arched gables on the parapet (Station Road photos), at about a third and two-thirds.
    for (const f of [0.3, 0.62]) {
      const [x, z] = along(nf, nf.len * f, fromWest);
      gable(c, x - nf.nx * 0.1, z - nf.nz * 0.1, hN);
    }
    // Poonam Sagar Road side, from the junction: Generic Medical, then the rest.
    const ef = faceOf(east);
    const hE = ryZ(ef.nx, ef.nz);
    // From its north (junction) end.
    const northFirst = ef.uz > 0;
    let t = 0.5;
    let first = true;
    while (t < ef.len - 4) {
      const w = first ? 5.0 : rng.range(4.0, 4.8);
      const [x, z] = along(ef, t + w / 2, northFirst);
      if (first) shopfront(c, x, z, hE, w - 0.25, k++, { board: named('generic'), interior: 0, open: true, awning: 'tin' });
      else shopfront(c, x, z, hE, w - 0.25, k++, { awning: rng.chance(0.8) ? 'tin' : 'none' });
      if (rng.chance(0.4)) out.spots.push({ kind: 'shop', x: x + ef.nx * 1.5, z: z + ef.nz * 1.5, y: FOOTPATH, h: hE + Math.PI + rng.range(-0.6, 0.6) });
      if (!first && rng.chance(0.25)) {
        inp.board(inp.signs.upper[ui++ % inp.signs.upper.length], 4.2, 0.79, mat4(x + ef.nx * 0.1, FOOTPATH + (rng.chance(0.5) ? 5.3 : 8.3), z + ef.nz * 0.1, hE), { lit: true });
      }
      first = false;
      t += w;
    }

    // ---- Autos queued at the kerb in front of it, the bollards along the footpath's edge ------------
    const autos: { x: number; y: number; z: number; h: number; c?: THREE.Color }[] = [];
    const bollard = bollardProp();
    for (let x = 76 + rng.range(0, 1); x < 147; x += rng.range(2.85, 3.3)) {
      if (rng.chance(0.08)) continue;
      const z = -23.55 + (x - 71) * 0.0198;
      const h = -Math.PI / 2 + rng.range(-0.04, 0.04);
      autos.push({ x, y: ROAD, z, h, c: new THREE.Color().setScalar(rng.range(0.85, 1.05)) });
      solid(c, x, z, 0.66, 1.3, h, -1, 1.9);
      // The driver waiting in it, or standing by it.
      if (rng.chance(0.55)) out.spots.push({ kind: 'driver', x: x - 0.36, z, y: ROAD + 0.27, h, pose: 1 });
      else if (rng.chance(0.4)) out.spots.push({ kind: 'driver', x: x + rng.range(-0.6, 0.6), z: z + 1.05, y: FOOTPATH, h: rng.range(0, 6.28), pose: rng.chance(0.4) ? 2 : 0 });
    }
    out.meshes.push(instanced(autoRickshaw(), c.M.prop_paint, autos));
    let nb = 0;
    for (let x = 73; x < 152; x += 1.7) {
      if (++nb % 7 === 0) continue;
      const z = -22.05 + (x - 71) * 0.0199;
      prop(c, bollard, mat4(x, FOOTPATH, z));
      solid(c, x, z, 0.1, 0.1, 0, -1, 1.1);
    }
  }

  // ---- The Union Bank on the curved corner of the junction ----------------------------------------
  const B = inp.bank;
  if (B && B.length >= 4) {
    let area = 0;
    for (let i = 0; i < B.length; i++) area += B[i][0] * B[(i + 1) % B.length][1] - B[(i + 1) % B.length][0] * B[i][1];
    const top = GROUND + 4.1;
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      const b = B[(i + 1) % B.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      let nx = (b[1] - a[1]) / len;
      let nz = -(b[0] - a[0]) / len;
      if (area < 0) {
        nx = -nx;
        nz = -nz;
      }
      // Only the faces looking at the junction (north and west).
      if (!(nz < -0.3 || nx < -0.3)) continue;
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const h = ryZ(nx, nz);
      const m = mat4(mx + nx * 0.06, GROUND, mz + nz * 0.06, h);
      // The red band with the bank's name, the white curved parapet over it, green shutters below.
      gb.add('prop_paint', tint(boxGeo(len + 0.05, 0.95, 0.12).translate(0, 3.35, 0.02), 0.78, 0.1, 0.1).applyMatrix4(m));
      gb.add('plaster', tint(boxGeo(len + 0.12, 0.55, 0.42).translate(0, top - 0.1, 0.15), 0.95, 0.93, 0.86).applyMatrix4(m));
      if (len > 4.2) inp.board(st.unionBank, Math.min(len - 0.6, 4.6), Math.min(len - 0.6, 4.6) / 4, mat4(mx + nx * 0.16, GROUND + 3.35, mz + nz * 0.16, h), { lit: true });
      for (let d = -len / 2 + 1.4; d < len / 2 - 0.8; d += 2.6) gb.add('shutter', tint(boxGeo(2.3, 2.6, 0.04).translate(d, 1.3, 0.06), 0.25, 0.5, 0.35).applyMatrix4(m));
      lamp(c, mx + nx * 1.5, mz + nz * 1.5, 6, 0.35);
    }
  }
  return out;
}

/** A parapet gable with an arched opening, rising over the roof line (the facade's +z faces out). */
function gable(c: MiraCtx, x: number, z: number, h: number): void {
  const s = new THREE.Shape();
  const w = 2.3;
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, 1.6);
  s.absarc(0, 1.6, w, 0, Math.PI, false);
  s.lineTo(-w, 0);
  const hole = new THREE.Path();
  hole.moveTo(-0.85, 0.7);
  hole.lineTo(0.85, 0.7);
  hole.lineTo(0.85, 1.75);
  hole.absarc(0, 1.75, 0.85, 0, Math.PI, false);
  hole.lineTo(-0.85, 0.7);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.28, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -0.14);
  // The building's roof: three floors over a 4 m ground floor (10.3 m), the parapet on top.
  c.gb.add('plaster', tint(g, 0.92, 0.66, 0.6).applyMatrix4(mat4(x, GROUND + 10.2, z, h)));
  c.gb.add('plaster', tint(boxGeo(2 * w + 0.3, 0.12, 0.4).translate(0, 0.05, 0), 0.8, 0.6, 0.55).applyMatrix4(mat4(x, GROUND + 10.2, z, h)));
}

/** A steel bollard painted in yellow and black bands. */
function bollardProp() {
  const k = new Kit();
  for (let i = 0; i < 4; i++) k.cyl('paint', 0.085, 0.085, 0.22, 0, i * 0.22, 0, i % 2 ? [0.06, 0.06, 0.06] : [0.92, 0.72, 0.06], 10);
  k.sphere('paint', 0.085, 0, 0.88, 0, [0.06, 0.06, 0.06], 1, 0.5, 1, 8);
  return k.build();
}

