import * as THREE from 'three';
import { boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { signQuad } from '../../gfx/Signage';
import { MIRA_LED, ledQuad } from './MiraBoards';
import { TOP, PLAZA, V3, beam, cover, lamp, mat4, ramp, sign, solid, type MiraCtx } from './MiraCtx';

/**
 * Mira Road's east front and booking hall, from OpenStreetMap (the forecourt, the footways through
 * the building) and the reference photos (main_entrance, entrance2, auto_stand, outside/0, 0_1, 5):
 *
 * - An arcade of seven round arches in yellow sandstone ashlar, white columns and archivolts, a
 *   white entablature and a long, low white pediment with the raised "मिरा रोड / MIRA ROAD"
 *   plaque, reached up a flight of grey stone steps the full width of the forecourt.
 * - Behind it, one open hall at platform level (you look straight through it at PF 4's trains).
 *   On the right as you walk in, the booking office: five ticket windows, two ATVMs, queue rails,
 *   the all-platform train board and a clock. At the south end the stairs to the foot-over-bridge.
 *
 * Built in a "front frame": x = u along the facade (north +), z = v out of it (east +), so the
 * facade follows the forecourt edge (≈2.3° off the local z axis). Dimensions ⚠ from the photos.
 */

/** The facade line (forecourt west edge, OSM way 1486443015) and its frame. */
const A = { x: 0.04083, z: -0.99917 };
const N = { x: 0.99917, z: 0.04083 };
export const FRONT = {
  /** Frame origin (local): the facade line at the forecourt's middle. */
  ox: 33.21,
  oz: -48.5,
  /** Rotation about Y taking frame +x to A and +z to N. */
  angle: Math.atan2(N.x, N.z),
  /** Arcade extent (u) and the hall's (u; v back to PF 4). */
  u0: -23.5,
  u1: 23.5,
  hallU0: -27,
  hallU1: 31,
  hallV0: -13.6,
  /** The booking office (north end of the hall). */
  officeU0: 23.5,
  ceiling: 6.75,
  /** Where the stairs up to the foot-over-bridge start (frame v), rising towards −u. */
  stairV: -8.45,
  /** Front of the bottom step (frame v): the forecourt starts here. */
  stepsV: 2.1,
};

/** Frame (u, v) → local x/z. */
export function F(u: number, v: number): [number, number] {
  return [FRONT.ox + A.x * u + N.x * v, FRONT.oz + A.z * u + N.z * v];
}

/** Local x/z → frame (u, v). */
export function toFrame(x: number, z: number): [number, number] {
  const dx = x - FRONT.ox;
  const dz = z - FRONT.oz;
  return [dx * A.x + dz * A.z, dx * N.x + dz * N.z];
}

/** Matrix placing frame coordinates (plus a turn about Y) into the local frame. */
export function FM(u: number, y: number, v: number, ry = 0): THREE.Matrix4 {
  const [x, z] = F(u, v);
  return mat4(x, y, z, FRONT.angle + ry);
}

export interface MiraFront {
  /** Arch openings on the facade (local x/z, at the top step). */
  arches: { x: number; z: number }[];
  /** Standing spots at the ticket windows and the ATVMs (local, facing them). */
  windows: { x: number; z: number; h: number }[];
  atvms: { x: number; z: number; h: number }[];
  /** Foot and head of the stairs to the foot-over-bridge (local, with heights). */
  stairFoot: THREE.Vector3;
  /** Analog clocks: position (local) and the direction their face looks (radians about Y). */
  clocks: { p: THREE.Vector3; h: number }[];
  /** The hall's LED board quads are in the static geometry; the canvas is shared. */
}

export function buildFront(c: MiraCtx): MiraFront {
  const gb = c.gb;
  const W = FRONT.u1 - FRONT.u0;
  const n = 7;
  const pitch = W / n;
  const pier = 1.5;
  const span = pitch - pier;
  const r = span / 2;
  const spring = TOP + 3.0;
  const wallTop = TOP + 5.85;
  const add = (key: string, g: THREE.BufferGeometry, ry = 0) => gb.add(key, g.applyMatrix4(FM(0, 0, 0, ry)));

  // ---- Facade: ashlar piers, and the wall above traced round the arches -------------------
  const archC: number[] = [];
  for (let i = 0; i < n; i++) archC.push(FRONT.u0 + (i + 0.5) * pitch);
  const upper = new THREE.Shape();
  upper.moveTo(FRONT.u0, wallTop);
  upper.lineTo(FRONT.u0, spring);
  for (const cu of archC) {
    upper.lineTo(cu - r, spring);
    upper.absarc(cu, spring, r, Math.PI, 0, true);
  }
  upper.lineTo(FRONT.u1, spring);
  upper.lineTo(FRONT.u1, wallTop);
  upper.lineTo(FRONT.u0, wallTop);
  add('sandstone', new THREE.ExtrudeGeometry(upper, { depth: 0.8, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -0.8));
  for (let k = 0; k <= n; k++) {
    const pu = FRONT.u0 + k * pitch;
    const a0 = Math.max(FRONT.u0, pu - pier / 2);
    const a1 = Math.min(FRONT.u1, pu + pier / 2);
    add('sandstone', boxGeo(a1 - a0, spring - TOP, 0.8).translate((a0 + a1) / 2, (spring + TOP) / 2, -0.4));
  }
  // White archivolts, springing from white columns standing in front of each pier.
  for (const cu of archC) {
    const band = new THREE.Shape();
    band.absarc(cu, spring, r + 0.34, 0, Math.PI, false);
    band.lineTo(cu - r, spring);
    band.absarc(cu, spring, r, Math.PI, 0, true);
    band.lineTo(cu + r + 0.34, spring);
    add('white', new THREE.ExtrudeGeometry(band, { depth: 0.14, bevelEnabled: false, curveSegments: 14 }));
    // Keystone.
    add('white', boxGeo(0.5, 0.62, 0.22).translate(cu, spring + r + 0.18, 0.08));
  }
  for (let i = 0; i <= n; i++) {
    const pu = FRONT.u0 + i * pitch;
    const end = i === 0 || i === n;
    // Pier face pilaster strips and plinth.
    add('white', boxGeo(end ? 0.9 : pier + 0.1, 0.42, 0.95).translate(pu, TOP + 0.21, -0.35));
    // The column: base, shaft, capital (Tuscan).
    const cz = 0.42;
    add('white', boxGeo(0.78, 0.26, 0.78).translate(pu, TOP + 0.13, cz));
    add('white', new THREE.CylinderGeometry(0.34, 0.36, 0.14, 18).translate(pu, TOP + 0.33, cz));
    add('white', new THREE.CylinderGeometry(0.25, 0.29, spring - TOP - 0.62, 18).translate(pu, (TOP + 0.4 + spring - 0.22) / 2, cz));
    add('white', new THREE.CylinderGeometry(0.33, 0.26, 0.16, 18).translate(pu, spring - 0.14, cz));
    add('white', boxGeo(0.74, 0.14, 0.74).translate(pu, spring, cz));
    // Impost block tying the column to the pier.
    add('white', boxGeo(pier + 0.12, 0.24, 1.3).translate(pu, spring - 0.02, -0.2));
    solid(c, ...F(pu, -0.1), (end ? 0.45 : pier / 2) + 0.05, 0.9, FRONT.angle, -1, 7);
  }
  // Entablature, cornice.
  add('white', boxGeo(W + 0.6, 0.62, 1.15).translate(0, wallTop + 0.31, -0.3));
  add('white', tint(boxGeo(W + 1.1, 0.24, 1.55).translate(0, wallTop + 0.74, -0.25), 0.95, 0.95, 0.93));
  add('white', tint(boxGeo(W + 0.4, 0.08, 0.2).translate(0, wallTop - 0.06, 0.2), 0.8, 0.79, 0.76));
  // The pediment: a long, low gable with raking cornices, and the name plaque.
  const pedBase = wallTop + 0.86;
  const pedH = 3.0;
  const half = W / 2 - 0.4;
  const tri = new THREE.Shape();
  tri.moveTo(-half, pedBase);
  tri.lineTo(half, pedBase);
  tri.lineTo(0, pedBase + pedH);
  tri.lineTo(-half, pedBase);
  add('white', tint(new THREE.ExtrudeGeometry(tri, { depth: 0.6, bevelEnabled: false }).translate(0, 0, -0.75), 0.96, 0.95, 0.92));
  for (const s of [-1, 1]) {
    const a = V3(s * (half + 0.3), pedBase - 0.05, -0.35);
    const b = V3(0, pedBase + pedH + 0.12, -0.35);
    add('white', tint(beam(a, b, 0.95, 0.26), 0.94, 0.94, 0.91));
  }
  const plaqueW = 3.7;
  const plaqueH = 1.39;
  gb.add('signs', signQuad(c.signs.plaque, plaqueW, plaqueH).translate(0, pedBase + 1.05, -0.066).applyMatrix4(FM(0, 0, 0)));
  add('white', boxGeo(plaqueW + 0.16, plaqueH + 0.16, 0.08).translate(0, pedBase + 1.05, -0.11));
  // Return walls at the ends of the arcade, and the plain bays beyond: south to the stairs,
  // north in front of the booking office (kept below the skywalk).
  for (const [ua, ub, top] of [
    [FRONT.hallU0, FRONT.u0, wallTop + 0.95],
    [FRONT.u1, FRONT.hallU1, TOP + 5.75],
  ] as const) {
    const w = ub - ua;
    add('sandstone', boxGeo(w, top - TOP + 1.2, 0.8).translate((ua + ub) / 2, (top + TOP - 1.2) / 2, -0.4));
    add('white', boxGeo(w + 0.05, 0.3, 0.95).translate((ua + ub) / 2, top, -0.4));
    add('white', boxGeo(w + 0.05, 0.42, 0.9).translate((ua + ub) / 2, TOP + 0.21, -0.38));
    solid(c, ...F((ua + ub) / 2, -0.4), w / 2, 0.45, FRONT.angle);
  }
  // Small grilled windows in the north bay (the booking office's back).
  for (const u of [26, 29]) {
    add('glass', boxGeo(1.1, 1.3, 0.05).translate(u, TOP + 2.6, 0.02));
    for (let k = 0; k < 6; k++) add('steel', rodGeo(V3(u - 0.5 + k * 0.2, TOP + 1.95, 0.08), V3(u - 0.5 + k * 0.2, TOP + 3.25, 0.08), 0.015, 4));
  }

  // ---- The steps up from the forecourt ------------------------------------------------------
  const nSteps = 5;
  const rise = (TOP - PLAZA) / (nSteps + 1);
  const tread = (FRONT.stepsV - 0.3) / nSteps;
  for (let i = 1; i <= nSteps; i++) {
    const top = TOP - i * rise;
    const v0 = 0.3 + (i - 1) * tread;
    add('granite', boxGeo(W + 0.3, top + 0.45, tread + 0.02).translate(0, (top - 0.45) / 2, v0 + tread / 2));
    // Worn nosing.
    add('granite', tint(boxGeo(W + 0.3, 0.05, 0.06).translate(0, top - 0.02, v0 + tread - 0.02), 0.75, 0.73, 0.7));
  }
  // Cheek blocks at the ends.
  for (const s of [-1, 1]) {
    const u = s * (W / 2 + 0.55);
    add('sandstone', boxGeo(0.8, TOP + 0.45, FRONT.stepsV + 0.4).translate(u, (TOP - 0.45) / 2, FRONT.stepsV / 2 - 0.1));
    solid(c, ...F(u, FRONT.stepsV / 2), 0.4, FRONT.stepsV / 2 + 0.2, FRONT.angle);
  }
  ramp(c, ...F(0, 0.28), ...F(0, FRONT.stepsV + 0.02), W / 2, TOP + 0.005, PLAZA);

  // ---- The hall -------------------------------------------------------------------------------
  const hu0 = FRONT.hallU0;
  const hu1 = FRONT.hallU1;
  const hv0 = FRONT.hallV0;
  const HL = hu1 - hu0;
  const hm = (hu0 + hu1) / 2;
  add('hallFloor', boxGeo(HL, TOP + 0.46, 0.3 - hv0).translate(hm, (TOP + 0.01 - 0.45) / 2, (0.3 + hv0) / 2));
  add('white', tint(boxGeo(HL, 0.3, -0.8 - hv0 + 0.4).translate(hm, FRONT.ceiling + 0.15, (-0.8 + hv0) / 2 - 0.2), 0.9, 0.9, 0.88));
  ramp(c, ...F(hu0 - 0.3, (0.3 + hv0) / 2), ...F(hu1, (0.3 + hv0) / 2), (0.3 - hv0) / 2, TOP + 0.005);
  cover(c, ...F(hm, (-0.8 + hv0) / 2), HL / 2, (-0.8 - hv0) / 2, FRONT.angle, 0.22, FRONT.ceiling);
  // Columns along the platform side and down the middle (they carry the walkway above).
  for (let u = hu0 + 3; u < hu1 - 1; u += 7) {
    for (const v of [hv0 + 0.6, -4.5]) {
      // None in front of the booking office (they would hide the board and the windows).
      if (v > -5 && u > FRONT.officeU0 - 8) continue;
      add('wallTiles', boxGeo(0.55, 1.8, 0.55).translate(u, TOP + 0.9, v));
      add('white', tint(boxGeo(0.52, FRONT.ceiling - TOP - 1.8, 0.52).translate(u, (FRONT.ceiling + TOP + 1.8) / 2, v), 0.86, 0.85, 0.8));
      solid(c, ...F(u, v), 0.3, 0.3, FRONT.angle);
    }
  }
  // South end wall, with the opening for the stairs.
  const sv = FRONT.stairV;
  for (const [va, vb] of [
    [hv0 + 0.4, sv - 1.6],
    [sv + 1.6, -0.8],
  ] as const) {
    add('wallTiles', boxGeo(0.3, 1.9, vb - va).translate(hu0, TOP + 0.95, (va + vb) / 2));
    add('white', boxGeo(0.3, FRONT.ceiling - TOP - 1.9, vb - va).translate(hu0, (FRONT.ceiling + TOP + 1.9) / 2, (va + vb) / 2));
    solid(c, ...F(hu0, (va + vb) / 2), 0.15, (vb - va) / 2, FRONT.angle);
  }
  add('white', boxGeo(0.3, 1.2, 3.2).translate(hu0, FRONT.ceiling - 0.6, sv));

  // ---- The booking office ---------------------------------------------------------------------
  const ou = FRONT.officeU0;
  const ov0 = hv0 + 1.0;
  const ov1 = -0.8;
  const ow = ov1 - ov0;
  // South wall (facing the hall): tiles low down, plaster above.
  add('wallTiles', boxGeo(0.28, 2.0, ow).translate(ou, TOP + 1.0, (ov0 + ov1) / 2));
  add('white', tint(boxGeo(0.28, FRONT.ceiling - TOP - 2.0, ow).translate(ou, (FRONT.ceiling + TOP + 2.0) / 2, (ov0 + ov1) / 2), 0.94, 0.93, 0.9));
  // West wall (towards PF 4) and the north end of the hall.
  add('white', tint(boxGeo(hu1 - ou, FRONT.ceiling - TOP, 0.28).translate((ou + hu1) / 2, (FRONT.ceiling + TOP) / 2, ov0), 0.9, 0.89, 0.85));
  add('white', tint(boxGeo(0.3, FRONT.ceiling - TOP, -0.8 - hv0).translate(hu1, (FRONT.ceiling + TOP) / 2, (-0.8 + hv0) / 2), 0.9, 0.89, 0.85));
  solid(c, ...F((ou + hu1) / 2, (ov0 + ov1) / 2), (hu1 - ou) / 2, ow / 2, FRONT.angle);
  solid(c, ...F(hu1, (-0.8 + hv0) / 2), 0.2, (-0.8 - hv0) / 2, FRONT.angle);
  const windows: { x: number; z: number; h: number }[] = [];
  const winV = [-11.1, -9.55, -8.0, -6.45, -4.9];
  winV.forEach((v, i) => {
    // Recess, lit interior behind a grille, the counter ledge and the window's label.
    add('blackPaint', boxGeo(0.06, 1.1, 1.18).translate(ou - 0.16, TOP + 1.55, v));
    {
      const g = new THREE.PlaneGeometry(0.98, 0.9);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (4.05 + uv.getX(k) * 0.9) / 5, 0.25 + uv.getY(k) * 0.6);
      gb.add('shopGlow', tint(g.rotateY(-Math.PI / 2).translate(ou - 0.2, TOP + 1.55, v), 1, 1, 1).applyMatrix4(FM(0, 0, 0)));
    }
    for (let k = 0; k < 7; k++) add('steel', rodGeo(V3(ou - 0.23, TOP + 1.1, v - 0.45 + k * 0.15), V3(ou - 0.23, TOP + 2.0, v - 0.45 + k * 0.15), 0.012, 4));
    add('steel', boxGeo(0.04, 0.18, 0.5).translate(ou - 0.24, TOP + 1.18, v));
    add('granite', boxGeo(0.42, 0.06, 1.25).translate(ou - 0.35, TOP + 1.02, v));
    sign(c, c.signs.windows[i], 1.2, 0.3, FM(ou - 0.17, TOP + 2.35, v, -Math.PI / 2), { plate: [0.85, 0.85, 0.82] });
    const [x, z] = F(ou - 0.75, v);
    windows.push({ x, z, h: FRONT.angle + Math.PI / 2 });
  });
  sign(c, c.signs.booking, 4.2, 1.05, FM(ou - 0.2, TOP + 3.05, -8.0, -Math.PI / 2));
  // The all-platform train board above the windows, and its twin by the stairs.
  const boardM = FM(ou - 0.24, TOP + 4.42, -8.0, -Math.PI / 2);
  gb.add('led', ledQuad(MIRA_LED.hall, 2.9, 2.9 * (MIRA_LED.hall.h / MIRA_LED.hall.w)).translate(0, 0, 0.06).applyMatrix4(boardM));
  gb.add('blackPaint', boxGeo(3.1, 3.1 * (MIRA_LED.hall.h / MIRA_LED.hall.w) + 0.16, 0.1).applyMatrix4(boardM));
  const tube = (m: THREE.Matrix4) => gb.add('tube', boxGeo(1.25, 0.05, 0.08).applyMatrix4(m));
  tube(FM(ou - 0.4, TOP + 5.35, -8.0, -Math.PI / 2));
  // The two ATVMs, at the east end of the booking office wall.
  const atvms: { x: number; z: number; h: number }[] = [];
  for (const v of [-2.95, -1.7]) {
    const m = FM(ou - 0.36, 0, v, -Math.PI / 2);
    gb.add('paint', tint(boxGeo(0.98, 1.85, 0.62).translate(0, TOP + 0.925, 0), 0.72, 0.75, 0.78).applyMatrix4(m));
    gb.add('paint', tint(boxGeo(1.02, 0.14, 0.7).translate(0, TOP + 1.9, 0.02), 0.15, 0.3, 0.62).applyMatrix4(m));
    gb.add('signsLit', signQuad(c.signs.atvm, 0.9, 1.75).translate(0, TOP + 0.95, 0.315).applyMatrix4(m));
    solid(c, ...F(ou - 0.36, v), 0.35, 0.5, FRONT.angle);
    const [x, z] = F(ou - 1.05, v);
    atvms.push({ x, z, h: FRONT.angle + Math.PI / 2 });
  }
  // Queue rails between the windows.
  for (const v of [-11.9, -10.33, -8.78, -7.23, -5.68, -4.1]) {
    const a = V3(ou - 0.3, TOP + 1.0, v);
    const b = V3(ou - 3.0, TOP + 1.0, v);
    add('stainless', rodGeo(a, b, 0.024, 6));
    add('stainless', rodGeo(a.clone().setY(TOP + 0.55), b.clone().setY(TOP + 0.55), 0.018, 6));
    for (const u of [ou - 0.3, ou - 1.65, ou - 3.0]) add('stainless', rodGeo(V3(u, TOP, v), V3(u, TOP + 1.03, v), 0.028, 6));
    solid(c, ...F(ou - 1.65, v), 1.4, 0.06, FRONT.angle, -1, TOP + 1.1);
  }
  // Enquiry window towards PF 4.
  sign(c, c.signs.enquiry, 1.9, 0.48, FM(27.2, TOP + 2.75, ov0 - 0.16, Math.PI));
  add('shopGlow', tint(boxGeo(1.2, 0.8, 0.03).translate(27.2, TOP + 1.65, ov0 - 0.16), 0.9, 0.84, 0.7));

  // ---- Lights, fans, signs and clocks under the hall ceiling ---------------------------------
  const lightV = [-2.4, -7.0, -11.6];
  for (let u = hu0 + 2; u < hu1 - 1; u += 4.2)
    for (const v of lightV) {
      if (u > ou && v < -1) continue;
      tube(FM(u, FRONT.ceiling - 0.05, v));
      lamp(c, ...F(u, v), 6, 0.2);
    }
  for (let u = hu0 + 4; u < ou - 2; u += 8.4)
    for (const v of [-4.6, -9.3]) {
      const m = FM(u, 0, v);
      gb.add('paint', tint(rodGeo(V3(0, FRONT.ceiling, 0), V3(0, FRONT.ceiling - 0.7, 0), 0.02, 5), 0.3, 0.3, 0.3).applyMatrix4(m));
      gb.add('paint', tint(new THREE.CylinderGeometry(0.12, 0.1, 0.12, 10).translate(0, FRONT.ceiling - 0.76, 0), 0.55, 0.52, 0.48).applyMatrix4(m));
      for (let k = 0; k < 3; k++) gb.add('paint', tint(boxGeo(0.62, 0.012, 0.11).translate(0.4, FRONT.ceiling - 0.78, 0).rotateY((k * Math.PI * 2) / 3 + u), 0.6, 0.58, 0.54).applyMatrix4(m));
    }
  const hang = (rect: import('../../gfx/Signage').AtlasRect, w: number, h: number, u: number, v: number, y: number, ry: number, back = false) => {
    const m = FM(u, y, v, ry);
    sign(c, rect, w, h, m, { back });
    for (const k of [-1, 1]) gb.add('steel', rodGeo(V3(k * w * 0.4, h / 2, 0), V3(k * w * 0.4, FRONT.ceiling - y, 0), 0.012, 4).applyMatrix4(m));
  };
  // Entering (facing −v): straight on for PF 4. Coming off PF 4 (facing +v): the way out.
  hang(c.signs.toPf4, 2.4, 0.6, -8, -6.5, TOP + 3.9, 0);
  hang(c.signs.toPf4, 2.4, 0.6, 12, -6.5, TOP + 3.9, 0);
  hang(c.signs.wayOut, 2.4, 0.6, -8, -6.7, TOP + 3.9, Math.PI);
  hang(c.signs.wayOut, 2.4, 0.6, 12, -6.7, TOP + 3.9, Math.PI);
  // The stairs to the foot-over-bridge (seen walking south through the hall).
  hang(c.signs.toFob, 2.6, 0.65, hu0 + 1.2, sv, TOP + 3.6, Math.PI / 2);
  sign(c, c.signs.toFob, 2.6, 0.65, FM(hu0 + 0.16, FRONT.ceiling - 0.9, sv, Math.PI / 2));
  // Posters on the column faces towards the entrance.
  let pk = 0;
  for (let u = hu0 + 3; u < ou - 1; u += 7) {
    if ((pk & 1) === 0) sign(c, c.signs.posters[pk % c.signs.posters.length], 0.7, 1.0, FM(u, TOP + 2.35, -4.5 + 0.285, 0), { plate: [0.8, 0.8, 0.78], depth: 0.02 });
    pk++;
  }
  // Clocks: double-faced, hung over the middle of the hall.
  const clocks: { p: THREE.Vector3; h: number }[] = [];
  for (const u of [-14, 6]) {
    const cy = TOP + 4.35;
    const m = FM(u, cy, -6.6);
    gb.add('signs', signQuad(c.signs.clock, 0.62, 0.62).translate(0, 0, 0.07).applyMatrix4(m));
    gb.add('signs', signQuad(c.signs.clock, 0.62, 0.62).rotateY(Math.PI).translate(0, 0, -0.07).applyMatrix4(m));
    gb.add('blackPaint', new THREE.CylinderGeometry(0.34, 0.34, 0.13, 24).rotateX(Math.PI / 2).applyMatrix4(m));
    gb.add('steel', rodGeo(V3(0, 0.34, 0), V3(0, FRONT.ceiling - cy, 0), 0.015, 4).applyMatrix4(m));
    const [x, z] = F(u, -6.6);
    clocks.push({ p: V3(x, cy, z), h: FRONT.angle }, { p: V3(x, cy, z), h: FRONT.angle + Math.PI });
  }
  // Speakers on the columns (the PA is heard all through the hall).
  for (let u = hu0 + 3; u < ou - 1; u += 14) gb.add('paint', tint(new THREE.CylinderGeometry(0.16, 0.06, 0.34, 10).rotateX(Math.PI / 2).translate(0, 0, 0.35).applyMatrix4(FM(u, TOP + 4.2, hv0 + 0.6, Math.PI)), 0.85, 0.84, 0.8));

  const arches = archC.map((u) => {
    const [x, z] = F(u, 0.2);
    return { x, z };
  });
  const [fx, fz] = F(FRONT.hallU0 + 0.9, FRONT.stairV);
  return { arches, windows, atvms, stairFoot: V3(fx, TOP, fz), clocks };
}
