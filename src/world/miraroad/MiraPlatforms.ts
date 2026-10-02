import * as THREE from 'three';
import { boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { signQuad, type AtlasRect } from '../../gfx/Signage';
import type { Railway } from '../journey/Railway';
import { postBoard } from '../journey/StationBoards';
import { MIRA_LED, ledQuad } from './MiraBoards';
import { GROUND, TOP, V3, beam, cover, lamp, mat4, ramp, sign, solid, wall, type MiraCtx } from './MiraCtx';

/**
 * Mira Road's four platforms (LOCAL_TRAIN.md §3, MIRA_ROAD.md), from OpenStreetMap and the photos
 * (2, 4, 9, 11, 12, the PF 3 and PF 4 indicator photos): PF 1 on the west, the PF 2/3 island,
 * PF 4 on the east against the booking hall. Each platform's track face follows its track (the
 * OSM outlines do not line up with the OSM tracks); the back edges follow the OSM outlines.
 *
 * Dressing: corrugated canopies on steel columns with tube lights and fans, blue platform-number
 * boards, the green single-line indicators ("C 17:15 F 03"), clocks, yellow name boards facing
 * the tracks, the old diamond boards with "Caution 25000 volts", steel benches and twin bins,
 * tea stalls, water coolers, the tactile edge and the yellow guide strip, the fences between
 * tracks and the overhead-line portals.
 */

/** Platform s (from the station reference d) → offset of an edge, interpolated. */
const interp = (pts: [number, number][]) => (s: number) => {
  if (s <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++)
    if (s <= pts[i][0]) {
      const [a, oa] = pts[i - 1];
      const [b, ob] = pts[i];
      return oa + ((s - a) * (ob - oa)) / (b - a);
    }
  return pts[pts.length - 1][1];
};

/** Track centre to platform face (m) ⚠: the car is 3.66 m wide. */
const FACE = 1.68;

export interface PlatformFace {
  /** Platform number shown on it. */
  pf: number;
  /** Corridor line (track) along it. */
  line: number;
  /** Offset of the face, and which way the platform lies from it (+1 east). */
  o: number;
  side: -1 | 1;
}

export interface MiraPlatformDef {
  ref: string;
  /** Extent along the line, relative to the station reference d (m). */
  s0: number;
  s1: number;
  o0: (s: number) => number;
  o1: (s: number) => number;
  faces: PlatformFace[];
}

export const PLATFORMS: MiraPlatformDef[] = [
  {
    ref: '1',
    s0: -319.5,
    s1: 39,
    o0: interp([
      [-319.5, -28.4],
      [-269.5, -33.2],
      [-253.8, -34.3],
      [-74.1, -33.4],
      [39, -33.6],
    ]),
    o1: () => -21.7 - FACE,
    faces: [{ pf: 1, line: 3, o: -21.7 - FACE, side: -1 }],
  },
  {
    ref: '2;3',
    s0: -290.7,
    s1: 54.8,
    o0: () => -17.5 + FACE,
    o1: () => -3.9 - FACE,
    faces: [
      { pf: 2, line: 2, o: -17.5 + FACE, side: 1 },
      { pf: 3, line: 1, o: -3.9 - FACE, side: -1 },
    ],
  },
  {
    ref: '4',
    s0: -323.3,
    s1: 17.7,
    o0: () => FACE,
    o1: interp([
      [-323.5, 12.4],
      [-280, 10.4],
      [-224.5, 9.0],
      [-191.9, 9.5],
      [-167.8, 9.6],
      [17.7, 11.2],
    ]),
    faces: [{ pf: 4, line: 0, o: FACE, side: 1 }],
  },
];

export interface MiraStair {
  bottom: THREE.Vector3;
  top: THREE.Vector3;
  /** Platform the foot stands on ('4', '2;3', '1'), 'hall', or null (the street). */
  on: string | null;
}

export interface MiraPlatformsOut {
  /** Bench seats (local; h faces the way a sitter looks). */
  seats: { x: number; y: number; z: number; h: number }[];
  /** Stall counters (people stand at them). */
  stalls: { x: number; z: number; h: number }[];
  clocks: { p: THREE.Vector3; h: number }[];
}

export function buildPlatforms(c: MiraCtx, rail: Railway, hallS: [number, number], stairs: { bottom: THREE.Vector3; top: THREE.Vector3; w: number }[], deckAt: (x: number, z: number) => boolean): MiraPlatformsOut {
  const gb = c.gb;
  const rng = c.rng;
  const dm = c.dm;
  const P = (s: number, o: number, y: number) => c.P(dm + s, o, y);
  const H = (s: number) => c.heading(dm + s);
  const out: MiraPlatformsOut = { seats: [], stalls: [], clocks: [] };
  const faceQuad = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3, key: string, u: number, v: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([a, cc, b, b, cc, d].flatMap((q) => [q.x, q.y, q.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, v, u, 0, u, 0, 0, v, u, v], 2));
    g.computeVertexNormals();
    gb.add(key, g);
  };
  /** Oriented placement on the platform: s along, o across, y up; ry turns from "facing along +d". */
  const at = (s: number, o: number, y: number, ry = 0) => {
    const p = P(s, o, y);
    return mat4(p.x, p.y, p.z, H(s) + ry);
  };
  const hangRods = (m: THREE.Matrix4, w: number, h: number, top: number) => {
    for (const k of [-1, 1]) gb.add('steel', rodGeo(V3(k * w * 0.42, h / 2, 0), V3(k * w * 0.42, top, 0), 0.012, 4).applyMatrix4(m));
  };

  /** Does a local point lie in (or next to) a flight of stairs? */
  const inStair = (p: THREE.Vector3, pad: number) =>
    stairs.some((st) => {
      const dx = st.top.x - st.bottom.x;
      const dz = st.top.z - st.bottom.z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - st.bottom.x) * dx + (p.z - st.bottom.z) * dz) / l2));
      return Math.hypot(st.bottom.x + dx * t - p.x, st.bottom.z + dz * t - p.z) < st.w / 2 + pad;
    });
  /** Near a flight, or in front of its foot (where people come off it). */
  const nearFoot = (p: THREE.Vector3, pad: number) =>
    inStair(p, pad) ||
    stairs.some((st) => {
      const dx = st.bottom.x - st.top.x;
      const dz = st.bottom.z - st.top.z;
      const l = Math.hypot(dx, dz) || 1;
      const fx = st.bottom.x + (dx / l) * 3;
      const fz = st.bottom.z + (dz / l) * 3;
      return Math.hypot(p.x - fx, p.z - fz) < st.w / 2 + 3 + pad;
    });
  for (const pf of PLATFORMS) {
    const ds: number[] = [];
    for (let s = pf.s0; s < pf.s1; s += 4) ds.push(s);
    ds.push(pf.s1);
    const faceO = (o: number) => pf.faces.some((f) => Math.abs(f.o - o) < 0.01);
    // ---- The slab: top, track faces (down to the ballast) and back walls, the ends ------------
    for (let i = 1; i < ds.length; i++) {
      const a = ds[i - 1];
      const b = ds[i];
      const len = b - a;
      const a0 = pf.o0(a);
      const a1 = pf.o1(a);
      const b0 = pf.o0(b);
      const b1 = pf.o1(b);
      faceQuad(P(a, a0, TOP), P(a, a1, TOP), P(b, b0, TOP), P(b, b1, TOP), 'concrete', a1 - a0, len);
      const low0 = faceO(a0) ? -1.0 : GROUND;
      const low1 = faceO(a1) ? -1.0 : GROUND;
      faceQuad(P(a, a0, low0), P(a, a0, TOP), P(b, b0, low0), P(b, b0, TOP), 'platformSide', TOP - low0, len);
      faceQuad(P(a, a1, TOP), P(a, a1, low1), P(b, b1, TOP), P(b, b1, low1), 'platformSide', TOP - low1, len);
      ramp(c, ...xz(P(a, (a0 + a1) / 2, 0)), ...xz(P(b, (b0 + b1) / 2, 0)), (Math.min(a1 - a0, b1 - b0)) / 2, TOP);
      // Coping, the tactile warning band and the yellow line along each track face.
      for (const f of pf.faces) {
        const inw = -f.side;
        void inw;
        const o = f.o;
        gb.add('coping', beam(P(a, o + f.side * 0.22, TOP + 0.008), P(b, o + f.side * 0.22, TOP + 0.008), 0.44, 0.02));
        gb.add('tactile', beam(P(a, o + f.side * 0.9, TOP + 0.009), P(b, o + f.side * 0.9, TOP + 0.009), 0.6, 0.02));
        gb.add('yellowLine', beam(P(a, o + f.side * 0.49, TOP + 0.011), P(b, o + f.side * 0.49, TOP + 0.011), 0.1, 0.02));
      }
      // The yellow guide strip down the middle (photo 2).
      if (Math.min(a1 - a0, b1 - b0) > 7) gb.add('yellowLine', beam(P(a, (a0 + a1) / 2 + 0.9, TOP + 0.008), P(b, (b0 + b1) / 2 + 0.9, TOP + 0.008), 0.3, 0.02));
    }
    for (const s of [pf.s0, pf.s1]) {
      const o0 = pf.o0(s);
      const o1 = pf.o1(s);
      const cp = P(s, (o0 + o1) / 2, (TOP - 1.0) / 2);
      gb.add('platformSide', boxGeo(o1 - o0, TOP + 1.0, 0.25).rotateY(H(s)).translate(cp.x, cp.y, cp.z));
    }
    // Back-edge railings on the side platforms (not where PF 4 opens into the hall).
    if (pf.ref === '1' || pf.ref === '4') {
      const back = (s: number) => (pf.ref === '4' ? pf.o1(s) - 0.12 : pf.o0(s) + 0.12);
      for (let i = 1; i < ds.length; i++) {
        const a = ds[i - 1];
        const b = ds[i];
        if (pf.ref === '4' && b > hallS[0] - 0.5 && a < hallS[1] + 0.5) continue;
        gb.add('steel', beam(P(a, back(a), TOP + 1.05), P(b, back(b), TOP + 1.05), 0.05, 0.05));
        gb.add('steel', beam(P(a, back(a), TOP + 0.55), P(b, back(b), TOP + 0.55), 0.04, 0.04));
        gb.add('steel', rodGeo(P(a, back(a), TOP), P(a, back(a), TOP + 1.08), 0.03, 5));
        wall(c, ...xz(P(a, back(a), 0)), ...xz(P(b, back(b), 0)), 0.2, TOP - 0.5, TOP + 1.3);
      }
    }

    // ---- Canopy: steel columns down the middle, a gabled corrugated roof ----------------------
    const c0 = pf.s0 + 14;
    const c1 = pf.s1 - 12;
    const oc = (s: number) => (pf.o0(s) + pf.o1(s)) / 2;
    const half = (s: number) => (pf.o1(s) - pf.o0(s)) / 2;
    const ridge = TOP + 4.45;
    const eave = TOP + 3.85;
    const roofY = (s: number, o: number) => ridge - ((ridge - eave) * Math.abs(o - oc(s))) / (half(s) + 0.4);
    let colK = 0;
    for (let s = c0; s <= c1; s += 10.5, colK++) {
      const o = oc(s);
      const hf = half(s);
      if (inStair(P(s, o, 0), 0.8)) continue;
      gb.add('steelGrey', rodGeo(P(s, o, TOP), P(s, o, ridge - 0.12), 0.12, 8));
      gb.add('steelGrey', boxGeo(0.34, 0.12, 0.34).rotateY(H(s)).translate(...P(s, o, TOP + 0.06).toArray()));
      gb.add('steelGrey', beam(P(s, o - hf - 0.4, eave - 0.14), P(s, o, ridge - 0.14), 0.12, 0.3));
      gb.add('steelGrey', beam(P(s, o, ridge - 0.14), P(s, o + hf + 0.4, eave - 0.14), 0.12, 0.3));
      // Knee braces.
      for (const k of [-1, 1]) gb.add('steelGrey', beam(P(s, o, TOP + 3.0), P(s, o + k * hf * 0.45, roofY(s, o + k * hf * 0.45) - 0.2), 0.07, 0.07));
      solid(c, ...xz(P(s, o, 0)), 0.2, 0.2, 0, -1, TOP + 4);
      // Tube lights under the rafters, a fan in the middle of the bay.
      for (const k of [-0.55, 0.55]) {
        const lo = o + k * hf;
        if (inStair(P(s + 5.25, lo, 0), 0.4)) continue;
        gb.add('tube', beam(P(s + 5.25 - 0.6, lo, roofY(s, lo) - 0.35), P(s + 5.25 + 0.6, lo, roofY(s, lo) - 0.35), 0.08, 0.05));
        gb.add('steel', rodGeo(P(s + 5.25, lo, roofY(s, lo) - 0.35), P(s + 5.25, lo, roofY(s, lo) - 0.15), 0.01, 3));
        lamp(c, ...xz(P(s + 5.25, lo, 0)), 7, 0.22);
      }
      if (s + 5.25 < c1 && colK % 2 === 0 && !inStair(P(s + 5.25, o, 0), 0.8)) fan(c, P(s + 5.25, o, 0), ridge - 0.2, H(s) + colK);
      // Horn speakers on every third column.
      if (colK % 3 === 1) gb.add('paint', tint(new THREE.CylinderGeometry(0.15, 0.05, 0.36, 10).rotateX(Math.PI / 2).translate(0, 0, 0.3), 0.86, 0.85, 0.8).applyMatrix4(at(s, o, TOP + 3.3, 0.4)));
    }
    // Purlins and the sheets, bay by bay, in strips; strips over a flight of stairs are left out
    // (the stairs rise through the roof under their own).
    for (let s = c0 - 2; s < c1 + 2; s += 6) {
      const e = Math.min(c1 + 2, s + 6);
      const edgeS = (k: number) => oc(s) + k * (half(s) + 0.4);
      const edgeE = (k: number) => oc(e) + k * (half(e) + 0.4);
      const strips = 4;
      for (let k = 0; k < strips * 2; k++) {
        const ka = -1 + k / strips;
        const kb = -1 + (k + 1) / strips;
        const mid = P((s + e) / 2, oc((s + e) / 2) + ((ka + kb) / 2) * (half((s + e) / 2) + 0.4), 0);
        const endA = P(s + 0.5, edgeS((ka + kb) / 2), 0);
        const endB = P(e - 0.5, edgeE((ka + kb) / 2), 0);
        if (inStair(mid, 0.25) || inStair(endA, 0.25) || inStair(endB, 0.25)) continue;
        const A0 = edgeS(ka);
        const B0 = edgeS(kb);
        const A1 = edgeE(ka);
        const B1 = edgeE(kb);
        const q = [P(s, A0, roofY(s, A0)), P(s, B0, roofY(s, B0)), P(e, A1, roofY(e, A1)), P(e, B1, roofY(e, B1))];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([q[0], q[2], q[1], q[1], q[2], q[3]].flatMap((v) => [v.x, v.y, v.z]), 3));
        const w = Math.abs(B0 - A0);
        const u0 = (ka + 1) * (half(s) + 0.4);
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, u0, e - s, u0, 0, u0 + w, 0, u0 + w, e - s, u0, e - s, u0 + w], 2));
        g.computeVertexNormals();
        gb.add('canopy', g);
      }
      for (const k of [-0.9, -0.5, 0.5, 0.9]) {
        const ls = oc(s) + k * half(s);
        const le = oc(e) + k * half(e);
        if (inStair(P((s + e) / 2, (ls + le) / 2, 0), 0.2)) continue;
        gb.add('steelGrey', beam(P(s, ls, roofY(s, ls) - 0.07), P(e, le, roofY(e, le) - 0.07), 0.06, 0.1));
      }
      // Gutters.
      for (const k of [-1, 1]) {
        const ls = oc(s) + k * (half(s) + 0.4);
        const le = oc(e) + k * (half(e) + 0.4);
        gb.add('steelGrey', beam(P(s, ls, eave - 0.05), P(e, le, eave - 0.05), 0.16, 0.12));
      }
    }
    cover(c, ...xz(P((c0 + c1) / 2, oc((c0 + c1) / 2), 0)), (c1 - c0) / 2 + 3, half((c0 + c1) / 2) + 0.5, H((c0 + c1) / 2) - Math.PI / 2, 0.5, eave);

    // ---- Boards and signs ------------------------------------------------------------------------
    const yb = c.kitBoard;
    // Yellow name boards facing across each track.
    for (let s = c0 + 8; s < c1; s += 38)
      for (const f of pf.faces) {
        const o = f.o + f.side * 1.5;
        const m = at(s, o, TOP + 3.0, f.side > 0 ? -Math.PI / 2 : Math.PI / 2);
        gb.add('corrSigns', signQuad(yb, 2.6, 0.82).translate(0, 0, 0.035).applyMatrix4(m));
        gb.add('paint', tint(boxGeo(2.7, 0.92, 0.06), 0.1, 0.1, 0.1).applyMatrix4(m));
        for (const k of [-1.2, 1.2]) gb.add('steel', rodGeo(V3(k, 0.46, 0).applyMatrix4(m), V3(k, 1.2, 0).applyMatrix4(m), 0.015, 4));
      }
    // Platform numbers (blue, double-sided), hung near each face along the platform.
    for (let s = c0 + 20; s < c1; s += 42)
      for (const f of pf.faces) {
        const m = at(s, f.o + f.side * 2.2, TOP + 3.05);
        sign(c, c.signs.pf[String(f.pf)], 0.72, 0.72, m, { back: true, plate: [0.1, 0.18, 0.4] });
        hangRods(m, 0.72, 0.72, roofY(s, f.o + f.side * 2.2) - TOP - 3.05);
      }
    // Single-line indicators: one per face every ~60 m, double-sided, down the middle.
    for (let s = c0 + 40; s < c1; s += 62)
      pf.faces.forEach((f, k) => {
        const o = pf.faces.length > 1 ? oc(s) + (k === 0 ? -1.15 : 1.15) : oc(s) + 1.2;
        const m = at(s, o, TOP + 2.95);
        const r = MIRA_LED.line(f.pf);
        const w = 1.55;
        const h = w * (r.h / r.w);
        gb.add('led', ledQuad(r, w, h).translate(0, 0, 0.07).applyMatrix4(m));
        gb.add('led', ledQuad(r, w, h).rotateY(Math.PI).translate(0, 0, -0.07).applyMatrix4(m));
        gb.add('blackPaint', boxGeo(w + 0.12, h + 0.1, 0.13).applyMatrix4(m));
        hangRods(m, w, h, roofY(s, o) - TOP - 2.95);
      });
    // Clocks: two per platform, double-faced, in the middle.
    for (const s of [c0 + 60, c1 - 70]) {
      const o = oc(s) - (pf.faces.length > 1 ? 0 : 0.8);
      const y = TOP + 3.1;
      const m = at(s, o, y);
      gb.add('signs', signQuad(c.signs.clock, 0.56, 0.56).translate(0, 0, 0.065).applyMatrix4(m));
      gb.add('signs', signQuad(c.signs.clock, 0.56, 0.56).rotateY(Math.PI).translate(0, 0, -0.065).applyMatrix4(m));
      gb.add('blackPaint', new THREE.CylinderGeometry(0.31, 0.31, 0.12, 24).rotateX(Math.PI / 2).applyMatrix4(m));
      hangRods(m, 0.3, 0.62, roofY(s, o) - y);
      const p = P(s, o, y);
      out.clocks.push({ p, h: H(s) }, { p, h: H(s) + Math.PI });
    }
    // The old diamond boards on red posts, "Caution 25000 volts" above (photo 12). Upright: the
    // atlas face is drawn turned −45°, so the quad turns back −45° to hang as a diamond. Faced both
    // ways, to the platform it stands on (as in the photo) and across the track; the posts run
    // between the faces.
    for (const s of [c0 + 30, (c0 + c1) / 2 + 12, c1 - 25])
      for (const f of pf.faces) {
        const o = f.o + f.side * 2.1;
        const m = at(s, o, TOP + 2.0, f.side > 0 ? -Math.PI / 2 : Math.PI / 2);
        const face = signQuad(c.signs.diamond, 1.2, 1.2).rotateZ(-Math.PI / 4);
        gb.add('signs', face.clone().translate(0, 0, 0.075).applyMatrix4(m));
        gb.add('signs', face.rotateY(Math.PI).translate(0, 0, -0.075).applyMatrix4(m));
        gb.add('paint', tint(boxGeo(1.22, 1.22, 0.12).rotateZ(Math.PI / 4), 0.6, 0.58, 0.55).applyMatrix4(m));
        for (const k of [-0.25, 0.25]) gb.add('paint', tint(boxGeo(0.14, 3.4, 0.1).translate(k, -0.3, 0), 0.45, 0.14, 0.1).applyMatrix4(m));
        sign(c, c.signs.caution, 0.75, 0.5, mat4(0, 1.2, 0).premultiply(m), { back: true, plate: [0.7, 0.7, 0.68], depth: 0.12 });
        solid(c, ...xz(P(s, o, 0)), 0.3, 0.3, 0, -1, 3);
      }
    // The exit board past the south end of the PF 2/3 island's canopy, between the two tracks,
    // facing the trains pulling out towards Churchgate (miraroad_exit.png): the big yellow board
    // in its steel frame, under a little hood.
    if (pf.ref === '2;3') {
      let s = pf.s1 - 4.5;
      for (let k = 0; k < 6 && nearFoot(P(s, oc(s), 0), 1); k++) s -= 2;
      const o = oc(s);
      const steel: [number, number, number] = [0.4, 0.34, 0.28];
      postBoard(gb, { face: 'signs', paint: 'paint' }, c.signs.exitBoard, at(s, o, TOP, Math.PI), { w: 3.4, h: 1.15, y: 2.45, posts: { gap: 3.75, r: 0.07, square: true, colour: steel, top: 3.3 }, plate: steel, frame: { colour: steel, t: 0.1 }, hood: [0.36, 0.35, 0.33] });
      for (const k of [-1, 1]) solid(c, ...xz(P(s, o + k * 1.875, 0)), 0.12, 0.12, 0, -1, TOP + 3.4);
    }

    // ---- Benches, bins, stalls, water coolers --------------------------------------------------------
    for (let s = c0 + 3; s < c1 - 4; s += 10.5) {
      const o = oc(s);
      const wide = half(s) > 3.6;
      if (rng.chance(0.25)) continue;
      // Back-to-back pair of steel benches between the columns (along the platform).
      for (const k of wide ? [-1, 1] : [1]) {
        const bs = s + 5.25;
        const bo = o + k * 0.45;
        if (nearFoot(P(bs, bo, 0), 1.2)) continue;
        const m = at(bs, bo, TOP, k > 0 ? Math.PI / 2 : -Math.PI / 2);
        bench(c, m);
        for (const q of [-0.62, 0, 0.62]) {
          const p = V3(q, 0, 0.05).applyMatrix4(m);
          out.seats.push({ x: p.x, y: TOP, z: p.z, h: H(bs) + (k > 0 ? Math.PI / 2 : -Math.PI / 2) });
        }
        solid(c, ...xz(P(bs, bo + k * 0.2, 0)), 1.0, 0.35, H(bs) + Math.PI / 2, -1, 1.1);
      }
      if (colSlot(s) % 3 === 0 && !nearFoot(P(s + 1.2, o + 0.6, 0), 0.8)) twinBins(c, at(s + 1.2, o + 0.6, TOP));
    }
    const stallAt = (s0: number, o: number) => {
      // Slide along the platform until clear of the stairs.
      let s = s0;
      for (let k = 0; k < 12 && nearFoot(P(s, o, 0), 2.5); k++) s += 6;
      const m = at(s, o, TOP);
      stall(c, m);
      solid(c, ...xz(P(s, o, 0)), 1.4, 1.2, H(s), -1, 2.8);
      const p = V3(0, 0, -1.7).applyMatrix4(m);
      out.stalls.push({ x: p.x, z: p.z, h: H(s) });
    };
    const mid = (pf.s0 + pf.s1) / 2;
    stallAt(mid + 26, oc(mid + 26));
    if (pf.ref !== '1') stallAt(pf.s0 + 70, oc(pf.s0 + 70));
    let ws = mid - 33;
    for (let k = 0; k < 12 && nearFoot(P(ws, oc(ws) + 0.9, 0), 2); k++) ws -= 6;
    waterCooler(c, at(ws, oc(ws) + 0.9, TOP));
    solid(c, ...xz(P(ws, oc(ws) + 0.9, 0)), 0.8, 0.5, H(ws), -1, 2);

    // At the foot of each flight: the green way-out sign; by the first, the all-platform board.
    let mainBoard = false;
    for (const st of stairs) {
      const q = c.proj(st.bottom.x, st.bottom.z);
      const sb = q.s - dm;
      if (sb < pf.s0 || sb > pf.s1 || q.o < pf.o0(sb) - 0.5 || q.o > pf.o1(sb) + 0.5 || st.bottom.y > TOP + 0.1) continue;
      const dx = st.bottom.x - st.top.x;
      const dz = st.bottom.z - st.top.z;
      const l = Math.hypot(dx, dz) || 1;
      const face = Math.atan2(dx / l, dz / l);
      const put = (dist: number, y: number) => {
        const p = V3(st.bottom.x + (dx / l) * dist, y, st.bottom.z + (dz / l) * dist);
        return { p, m: mat4(p.x, p.y, p.z, face), roof: roofY(c.proj(p.x, p.z).s - dm, c.proj(p.x, p.z).o) };
      };
      const w = put(1.2, TOP + 2.75);
      sign(c, c.signs.wayOut, 1.9, 0.48, w.m, { back: true });
      hangRods(w.m, 1.9, 0.48, w.roof - w.p.y);
      if (!mainBoard) {
        mainBoard = true;
        const b = put(5.5, TOP + 3.0);
        const bw = 2.1;
        const bh = bw * (MIRA_LED.hall.h / MIRA_LED.hall.w);
        gb.add('led', ledQuad(MIRA_LED.hall, bw, bh).translate(0, 0, 0.07).applyMatrix4(b.m));
        gb.add('led', ledQuad(MIRA_LED.hall, bw, bh).rotateY(Math.PI).translate(0, 0, -0.07).applyMatrix4(b.m));
        gb.add('blackPaint', boxGeo(bw + 0.14, bh + 0.12, 0.13).applyMatrix4(b.m));
        hangRods(b.m, bw, bh, b.roof - b.p.y);
      }
    }

    // Timetables and posters on the columns.
    for (let s = c0 + 10.5; s < c1; s += 31.5) {
      const o = oc(s);
      sign(c, rng.chance(0.5) ? c.signs.timetable : rng.pick(c.signs.posters), 0.6, 0.85, at(s, o + 0.15, TOP + 1.8, Math.PI / 2), { plate: [0.75, 0.75, 0.72], depth: 0.02 });
    }
  }

  // ---- Fences between the tracks (photos 11, 12) ------------------------------------------------
  for (const o of [-1.95, -19.6]) {
    for (let s = -335; s < 65; s += 2.5) {
      const a = P(s, o, -0.7);
      const b = P(s + 2.5, o, -0.7);
      gb.add('prop_metal', tint(rodGeo(a, a.clone().setY(0.62), 0.035, 5), 0.42, 0.24, 0.16));
      for (const y of [-0.25, 0.3, 0.58]) gb.add('prop_metal', tint(beam(a.clone().setY(y), b.clone().setY(y), 0.04, 0.04), 0.45, 0.26, 0.17));
    }
  }

  // ---- Overhead-line portals over the station (the line's own portals stop here) ---------------------
  const SPAN = 54;
  for (let d0 = Math.ceil((dm - 330) / SPAN) * SPAN; d0 < dm + 60; d0 += SPAN) {
    // Clear of the bridges (a mast may not stand in a walkway).
    let d = d0;
    for (const shift of [0, 6, -6, 12, -12]) {
      d = d0 + shift;
      const clear = PLATFORMS.every((p) => {
        const sp = d - dm;
        const o = (p.o0(sp) + p.o1(sp)) / 2;
        const q = P(sp + 0.9, o, 0);
        return !deckAt(q.x, q.z);
      });
      if (clear) break;
    }
    const s = d - dm;
    const masts = [PLATFORMS[0], PLATFORMS[1], PLATFORMS[2]].filter((p) => s > p.s0 + 3 && s < p.s1 - 3).map((p) => (p.o0(s) + p.o1(s)) / 2 + (p.ref === '2;3' ? 0 : 0));
    if (masts.length < 2) continue;
    const lo = Math.min(...masts);
    const hi = Math.max(...masts);
    const Hb = 8.6;
    for (const o of masts) {
      gb.add('steelGrey', boxGeo(0.34, Hb - TOP, 0.22).rotateY(H(s)).translate(...P(s + 0.9, o, (Hb + TOP) / 2).toArray()));
      solid(c, ...xz(P(s + 0.9, o, 0)), 0.25, 0.25, 0, -1, 9);
      // Caution board at eye level.
      sign(c, c.signs.caution, 0.6, 0.4, at(s + 0.9, o, TOP + 2.2, Math.PI / 2 + (o > -12 ? 0 : Math.PI)).multiply(mat4(0, 0, 0.14)), { plate: [0.7, 0.7, 0.68], depth: 0.02 });
    }
    for (const y of [Hb - 0.1, Hb - 0.8]) gb.add('steelGrey', beam(P(s + 0.9, lo - 0.3, y), P(s + 0.9, hi + 0.3, y), 0.12, 0.12));
    const n = Math.max(2, Math.round((hi - lo) / 1.4));
    for (let i = 0; i < n; i++) {
      const o0 = lo + ((hi - lo) * i) / n;
      const o1 = lo + ((hi - lo) * (i + 1)) / n;
      gb.add('steelGrey', beam(P(s + 0.9, o0, Hb - 0.8), P(s + 0.9, (o0 + o1) / 2, Hb - 0.1), 0.05, 0.05));
      gb.add('steelGrey', beam(P(s + 0.9, (o0 + o1) / 2, Hb - 0.1), P(s + 0.9, o1, Hb - 0.8), 0.05, 0.05));
    }
    for (let id = 0; id < 4; id++) {
      const o = rail.lineOffset(id, d)!;
      gb.add('steel', rodGeo(P(s, o - 0.7, Hb - 0.8), P(s, o - 0.7, 6.2), 0.045, 6));
      gb.add('steel', rodGeo(P(s, o - 0.7, 6.2), P(s, o + 0.15, 5.6), 0.025, 5));
      gb.add('steel', rodGeo(P(s, o - 0.7, 7.0), P(s, o, 6.75), 0.025, 5));
      gb.add('paint', tint(rodGeo(P(s, o - 0.7, 6.25), P(s, o - 0.7, 6.9), 0.07, 8), 0.85, 0.35, 0.2));
    }
  }
  return out;
}

const xz = (v: THREE.Vector3): [number, number] => [v.x, v.z];
const colSlot = (s: number) => Math.round(s / 10.5);

function fan(c: MiraCtx, p: THREE.Vector3, top: number, spin: number): void {
  const gb = c.gb;
  const m = mat4(p.x, 0, p.z, spin);
  gb.add('paint', tint(rodGeo(V3(0, top, 0), V3(0, TOP + 3.25, 0), 0.018, 5), 0.3, 0.3, 0.3).applyMatrix4(m));
  gb.add('paint', tint(new THREE.CylinderGeometry(0.12, 0.1, 0.12, 10).translate(0, TOP + 3.2, 0), 0.62, 0.6, 0.55).applyMatrix4(m));
  for (let k = 0; k < 3; k++) gb.add('paint', tint(boxGeo(0.62, 0.012, 0.11).translate(0.42, TOP + 3.17, 0).rotateY((k * Math.PI * 2) / 3), 0.64, 0.62, 0.58).applyMatrix4(m));
}

/** Steel three-seater (perforated seat and back), facing local +z. */
function bench(c: MiraCtx, m: THREE.Matrix4): void {
  const gb = c.gb;
  gb.add('stainless', boxGeo(1.9, 0.04, 0.42).translate(0, 0.45, 0.05).applyMatrix4(m));
  gb.add('stainless', boxGeo(1.9, 0.38, 0.03).rotateX(-0.15).translate(0, 0.72, -0.17).applyMatrix4(m));
  for (const x of [-0.85, 0, 0.85]) {
    gb.add('steelGrey', boxGeo(0.05, 0.45, 0.4).translate(x, 0.225, 0.03).applyMatrix4(m));
    gb.add('steelGrey', boxGeo(0.04, 0.04, 0.4).translate(x, 0.6, 0.05).applyMatrix4(m));
  }
}

/** A pair of stainless bins in a frame (photo 2). */
function twinBins(c: MiraCtx, m: THREE.Matrix4): void {
  const gb = c.gb;
  for (const x of [-0.25, 0.25]) {
    gb.add('stainless', new THREE.CylinderGeometry(0.19, 0.17, 0.62, 14, 1, true).translate(x, 0.45, 0).applyMatrix4(m));
    gb.add('stainless', new THREE.CylinderGeometry(0.2, 0.2, 0.04, 14).translate(x, 0.78, 0).applyMatrix4(m));
  }
  gb.add('steelGrey', boxGeo(0.95, 0.04, 0.05).translate(0, 0.9, 0).applyMatrix4(m));
  for (const x of [-0.47, 0.47]) gb.add('steelGrey', boxGeo(0.04, 0.9, 0.04).translate(x, 0.45, 0).applyMatrix4(m));
}

/** Tea and snacks stall: counter, glass case, shelves of packets, a lit sign. Front is local −z. */
function stall(c: MiraCtx, m: THREE.Matrix4): void {
  const gb = c.gb;
  gb.add('paint', tint(boxGeo(2.6, 1.0, 1.1).translate(0, 0.5, -0.4), 0.72, 0.18, 0.12).applyMatrix4(m));
  gb.add('stainless', boxGeo(2.7, 0.05, 1.2).translate(0, 1.02, -0.4).applyMatrix4(m));
  gb.add('glass', boxGeo(1.2, 0.45, 0.5).translate(-0.55, 1.28, -0.6).applyMatrix4(m));
  gb.add('paint', tint(boxGeo(2.6, 2.4, 0.1).translate(0, 1.2, 0.55), 0.8, 0.78, 0.72).applyMatrix4(m));
  for (let y = 1.3; y < 2.3; y += 0.35)
    for (let x = -1.1; x < 1.1; x += 0.22) gb.add('paint', tint(boxGeo(0.18, 0.25, 0.12).translate(x, y, 0.42), 0.4 + ((x * 7) % 0.5), 0.3 + ((y * 5) % 0.5), 0.2).applyMatrix4(m));
  gb.add('paint', tint(boxGeo(2.9, 0.08, 1.9).translate(0, 2.55, -0.25), 0.2, 0.2, 0.2).applyMatrix4(m));
  gb.add('signsLit', signQuad(c.signs.tea, 2.4, 0.6).rotateY(Math.PI).translate(0, 2.9, -1.21).applyMatrix4(m));
  gb.add('paint', tint(boxGeo(2.5, 0.66, 0.05).translate(0, 2.9, -1.18), 0.1, 0.1, 0.1).applyMatrix4(m));
  gb.add('tube', boxGeo(1.2, 0.05, 0.06).translate(0, 2.48, -0.6).applyMatrix4(m));
  for (const x of [-1.35, 1.35]) gb.add('steelGrey', boxGeo(0.06, 2.5, 0.06).translate(x, 1.25, -1.1).applyMatrix4(m));
  const p = V3(0, 0, -0.6).applyMatrix4(m);
  lamp(c, p.x, p.z, 4, 0.3);
}

function waterCooler(c: MiraCtx, m: THREE.Matrix4): void {
  const gb = c.gb;
  gb.add('stainless', boxGeo(1.4, 1.35, 0.6).translate(0, 0.68, 0).applyMatrix4(m));
  for (const x of [-0.4, 0, 0.4]) gb.add('steelGrey', boxGeo(0.05, 0.05, 0.12).translate(x, 1.0, 0.35).applyMatrix4(m));
  gb.add('paint', tint(boxGeo(1.4, 0.05, 0.3).translate(0, 0.72, 0.42), 0.4, 0.4, 0.42).applyMatrix4(m));
  sign(c, c.signs.water, 1.2, 0.45, mat4(0, 1.75, 0.02).premultiply(m), { depth: 0.03 });
}

/** A hung sign's face/back without the plate (used by the deck module for the FOB boards). */
export function hungBoard(c: MiraCtx, rect: AtlasRect, w: number, h: number, m: THREE.Matrix4, key = 'signs'): void {
  c.gb.add(key, signQuad(rect, w, h).translate(0, 0, 0.04).applyMatrix4(m));
  c.gb.add(key, signQuad(rect, w, h).rotateY(Math.PI).translate(0, 0, -0.04).applyMatrix4(m));
  c.gb.add('paint', tint(boxGeo(w + 0.08, h + 0.08, 0.06), 0.35, 0.3, 0.1).applyMatrix4(m));
}
