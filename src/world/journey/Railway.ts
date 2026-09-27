import { TRACKS } from '../churchgate/Layout';

/** public/data/western-line.json (tools/build-railway.mjs, © OpenStreetMap contributors, ODbL). */
export interface RailwayData {
  length: number;
  /** Smoothed main-track centre line, Churchgate throat (u = 0) → Mira Road, x/z pairs. */
  line: number[];
  stations: { name: string; s: number; off: number }[];
  /** The PF 4 road north of Mira Road (far north first). */
  north: number[];
}

/** Where the Churchgate station tracks (straight, x = track) hand over to the real curve. */
export const STRAIGHT_Z = -650;
/** Northern end of the straight station roads built with the station (Layout.TRACK_NORTH_Z). */
export const THROAT_Z = -330;
/** PF 3 road at Churchgate. */
const PF3_X = 6;
/** Track centres on the open line (m) ⚠ (typical Indian broad-gauge spacing). */
export const LINE_SPACING = 4.8;
/** Corridor line per Churchgate platform road (PF 1–4). */
export const TI_LINE = [2, 1, 0, 4];
/** Line offsets at Churchgate's platforms (PF 1, PF 2, PF 3, –, PF 4 roads). */
const STATION_OFFSET: Record<number, number> = { 0: 0, 1: TRACKS[1].x - PF3_X, 2: TRACKS[0].x - PF3_X, 4: TRACKS[3].x - PF3_X };
/** Line offsets through Mira Road (OSM, at z −37640: roads at x 9017.6, 9013.7, 9000.1, 8995.9). */
const MIRA_LINES = [0, -3.9, -17.5, -21.7];
/**
 * Corridor lines: 0–3 the open line, 4 Churchgate's PF 4 road, 5–7 extra roads that exist only at
 * the halts (Borivali's PF 1 and PF 6 roads, Dadar's PF 5 road and the Central Railway beside it).
 */
export const LINES = 8;
const PF_EDGE = 1.68;

/**
 * A station the Churchgate fast stops at on the way (Borivali, Dadar; HALTS.md). At the station the
 * two western lines step aside for an island platform, and extra roads run beside the platforms.
 * Layout ⚠: simplified from the photos and general knowledge (platform numbers from WR sources).
 */
export interface Halt {
  key: 'BO' | 'DA';
  name: string;
  /** Marathi and Hindi names (the same spelling at both stations). */
  deva: string;
  /** Code on the train indicators. */
  code: string;
  u: number;
  /** Path distance of the station centre. */
  d: number;
  /** Platform the ride stops at (the west face of the island east of line 0). */
  pf: number;
  /** Platform half-length (12-car platforms, ≈ 300 m ⚠). */
  half: number;
  /** Width of the island east of line 0, and of the island between lines 1 and 2. */
  island: number;
  islandWest: number;
  /** Extra roads: line id → offset at the station and where it runs. */
  extra: Record<number, { o: number; kind: 'siding' | 'parallel'; from: 0 | 3 }>;
  /** Extra railway land beyond the outermost lines (west, east). */
  land: [number, number];
}

/**
 * A long rail centre line sampled every metre in double precision, so that arc length maps to
 * a sample index exactly (no drift or stutter over 40 km, no float32 jitter far from the origin).
 * Offsets follow Path2's convention: along n = (tz, −tx).
 */
export class RailPath {
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly length: number;

  constructor(control: [number, number][]) {
    // Centripetal Catmull-Rom through the control points, densely evaluated...
    const dense: number[] = [];
    const n = control.length;
    const P = (i: number) => control[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1);
      const p1 = P(i);
      const p2 = P(i + 1);
      const p3 = P(i + 2);
      const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const k = Math.max(1, Math.ceil(seg / 0.5));
      const dt = (a: number[], b: number[]) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
      const t1 = dt(p0, p1);
      const t2 = t1 + dt(p1, p2);
      const t3 = t2 + dt(p2, p3);
      for (let j = 0; j < k; j++) {
        const t = t1 + ((t2 - t1) * j) / k;
        const out = [0, 0];
        for (let c = 0; c < 2; c++) {
          const A1 = ((t1 - t) / t1) * p0[c] + (t / t1) * p1[c];
          const A2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c];
          const A3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c];
          const B1 = ((t2 - t) / t2) * A1 + (t / t2) * A2;
          const B2 = ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
          out[c] = ((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2;
        }
        dense.push(out[0], out[1]);
      }
    }
    dense.push(control[n - 1][0], control[n - 1][1]);
    // ...then walked at exactly 1 m.
    const xs: number[] = [dense[0]];
    const zs: number[] = [dense[1]];
    let carry = 0;
    for (let i = 2; i < dense.length; i += 2) {
      const ax = dense[i - 2];
      const az = dense[i - 1];
      const bx = dense[i];
      const bz = dense[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-9) continue;
      let t = 1 - carry;
      while (t <= len) {
        xs.push(ax + ((bx - ax) * t) / len);
        zs.push(az + ((bz - az) * t) / len);
        t += 1;
      }
      carry = len - (t - 1);
    }
    this.x = new Float64Array(xs);
    this.z = new Float64Array(zs);
    this.length = xs.length - 1;
  }

  /** Position and unit tangent (central difference over ±3 m, interpolated) at arc length s. */
  at(s: number, out = { x: 0, z: 0, tx: 0, tz: 1 }): { x: number; z: number; tx: number; tz: number } {
    const L = this.length;
    const sc = Math.max(0, Math.min(L, s));
    const i = Math.min(L - 1, Math.floor(sc));
    const f = sc - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * f;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * f;
    const ia = Math.max(0, i - 3);
    const ib = Math.min(L, i + 4);
    let tx = this.x[ib] - this.x[ia];
    let tz = this.z[ib] - this.z[ia];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    out.tx = tx;
    out.tz = tz;
    if (s < 0 || s > L) {
      const e = s < 0 ? s : s - L;
      out.x += tx * e;
      out.z += tz * e;
    }
    return out;
  }

  point(s: number, o: number): [number, number] {
    const a = this.at(s);
    return [a.x + a.tz * o, a.z - a.tx * o];
  }

  heading(s: number): number {
    const a = this.at(s);
    return Math.atan2(a.tx, a.tz);
  }

  /** Nearest arc length and signed offset of a point (optionally searching only [s0, s1]). */
  project(px: number, pz: number, s0 = 0, s1 = this.length): { s: number; o: number; d: number } {
    const i0 = Math.max(0, Math.floor(s0));
    const i1 = Math.min(this.length, Math.ceil(s1));
    let best = i0;
    let bd = Infinity;
    const stride = Math.max(1, Math.floor((i1 - i0) / 400));
    for (let i = i0; i <= i1; i += stride) {
      const d = (this.x[i] - px) ** 2 + (this.z[i] - pz) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const lo = Math.max(0, best - stride - 1);
    const hi = Math.min(this.length - 1, best + stride + 1);
    let bs = best;
    bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      const ax = this.x[i];
      const az = this.z[i];
      const dx = this.x[i + 1] - ax;
      const dz = this.z[i + 1] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
      const d = (ax + dx * t - px) ** 2 + (az + dz * t - pz) ** 2;
      if (d < bd) {
        bd = d;
        bs = i + t;
      }
    }
    const a = this.at(bs);
    return { s: bs, o: (px - a.x) * a.tz - (pz - a.z) * a.tx, d: Math.sqrt(bd) };
  }
}

/**
 * The Western Railway as one path for the Churchgate-bound local: from north of Mira Road to the
 * PF 3 buffers at Churchgate. Arc length d increases towards Churchgate. u is the OSM distance from
 * the Churchgate throat used in LOCAL_TRAIN.md (u = 0 near Churchgate, ≈ 40 km at Mira Road).
 *
 * The path is the PF 3 road (track index 2). The other roads are offsets from it: 12 m apart
 * between Churchgate's platforms, closing to LINE_SPACING through the throat (THROAT_Z → STRAIGHT_Z).
 */
export class Railway {
  readonly path: RailPath;
  /** d of the lead end when the train stands at the Churchgate buffers (car 0 front). */
  readonly dChurchgate: number;
  /** d of the lead end at Mira Road PF 4 (the lead end near the platform's south end). */
  readonly dMiraRoad: number;
  /** d where the straight Churchgate tracks begin, and where the throat fan starts. */
  readonly dStraight: number;
  readonly dThroat: number;
  readonly stations: { name: string; d: number; u: number }[] = [];
  /** Where line 4 splits off and line 3 joins line 2 (approaching Churchgate). */
  readonly dCgRegion: [number, number];
  private readonly lineCum: number[] = [];
  /** d at which the OSM line (u) takes over, and the u there. */
  private readonly uAnchors: { d: number; u: number }[] = [];

  constructor(private readonly data: RailwayData) {
    const pts: [number, number][] = [];
    for (let i = 0; i < data.north.length; i += 2) pts.push([data.north[i], data.north[i + 1]]);
    // The OSM line from Mira Road down to where it meets Churchgate's straight station tracks.
    const line: [number, number][] = [];
    for (let i = 0; i < data.line.length; i += 2) line.push([data.line[i], data.line[i + 1]]);
    this.lineCum.push(0);
    for (let i = 1; i < line.length; i++) this.lineCum.push(this.lineCum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    // Thin the 10 m line to 30 m controls (the spline is smooth either way; fewer kinks from noise).
    for (let i = line.length - 1; i >= 0; i -= 3) {
      const [x, z] = line[i];
      if (z < STRAIGHT_Z - 180) pts.push([x, z]);
    }
    // Ease onto the PF 3 road and run straight to the buffers.
    for (let z = STRAIGHT_Z - 60; z < 12; z += 30) pts.push([PF3_X, z]);
    pts.push([PF3_X, 12]);
    this.path = new RailPath(pts);
    const p = this.path;
    this.dChurchgate = p.project(PF3_X, -2, p.length - 400).s;
    this.dStraight = p.project(PF3_X, STRAIGHT_Z, p.length - 1200).s;
    this.dThroat = p.project(PF3_X, THROAT_Z, p.length - 1200).s;
    this.dMiraRoad = p.project(9010, -37500, 0, 9000).s;
    // u ↔ d anchors every 250 m of the OSM line (the path is not the line near Churchgate).
    for (let u = this.data.length; u >= 600; u -= 250) {
      const [x, z] = this.lineAt(u);
      this.uAnchors.push({ d: p.project(x, z).s, u });
    }
    this.uAnchors.push({ d: this.dChurchgate, u: -(this.dChurchgate - this.uAnchors[this.uAnchors.length - 1].d) + 600 });
    this.dCgRegion = [this.dOfU(3300), this.dOfU(2700)];
    // ⚠ A fast local runs through these without stopping (LOCAL_TRAIN.md §7).
    const pass: [string, string][] = [
      ['Malad', 'मालाड'],
      ['Lower Parel', 'लोअर परळ'],
      ['Charni Road', 'चर्नी रोड'],
      ['Marine Lines', 'मरीन लाइन्स'],
    ];
    for (const [name, deva] of pass) {
      const st = data.stations.find((x) => x.name === name);
      if (st) this.passing.push({ name, deva, d: this.dOfU(st.s) });
    }
    for (const st of data.stations) this.stations.push({ name: st.name, d: st.name === 'Churchgate' ? this.dChurchgate : this.dOfU(st.s), u: st.s });
    // Halts. Borivali: PF 5 takes the Churchgate fasts (WR); islands PF 3/4 and PF 5/6, PF 1/2
    // to the west. Dadar: PF 4 for the up fast (WR), narrow islands, the Central Railway's
    // platforms beyond a fence to the east ⚠ (layouts simplified).
    const halt = (key: Halt['key'], name: string, deva: string, code: string, pf: number, island: number, islandWest: number, extra: Halt['extra'], land: [number, number]) => {
      const st = data.stations.find((x) => x.name === name);
      if (st) this.halts.push({ key, name, deva, code, u: st.s, d: this.dOfU(st.s), pf, half: 150, island, islandWest, extra, land });
    };
    const e5 = (w: number) => PF_EDGE * 2 + w;
    halt('BO', 'Borivali', 'बोरीवली', 'BO', 5, 11, 10, { 5: { o: e5(11), kind: 'siding', from: 0 }, 6: { o: -3 * LINE_SPACING - (10 + 2 * PF_EDGE - LINE_SPACING) - e5(10), kind: 'siding', from: 3 } }, [0, 2]);
    halt('DA', 'Dadar', 'दादर', 'DDR', 4, 8, 8, { 5: { o: e5(8), kind: 'siding', from: 0 }, 6: { o: e5(8) + 7.6, kind: 'parallel', from: 0 }, 7: { o: e5(8) + 7.6 + e5(8), kind: 'parallel', from: 0 } }, [9, 2]);
  }

  static async load(base: string): Promise<Railway> {
    const data = (await (await fetch(`${base}data/western-line.json`)).json()) as RailwayData;
    return new Railway(data);
  }

  /** Position on the OSM line at distance u from the Churchgate throat. */
  lineAt(u: number): [number, number] {
    const c = this.lineCum;
    const L = this.data.line;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1;
      if (c[m] < u) lo = m;
      else hi = m;
    }
    const t = Math.max(0, Math.min(1, (u - c[lo]) / (c[hi] - c[lo] || 1)));
    return [L[lo * 2] + (L[hi * 2] - L[lo * 2]) * t, L[lo * 2 + 1] + (L[hi * 2 + 1] - L[lo * 2 + 1]) * t];
  }

  /** d on the path for a real distance u from the Churchgate throat. */
  dOfU(u: number): number {
    const a = this.uAnchors;
    if (u >= a[0].u) return a[0].d - (u - a[0].u);
    for (let i = 1; i < a.length; i++)
      if (u >= a[i].u) {
        const t = (u - a[i].u) / (a[i - 1].u - a[i].u);
        return a[i].d + (a[i - 1].d - a[i].d) * t;
      }
    return a[a.length - 1].d + (a[a.length - 1].u - u);
  }

  /** u (km-post from Churchgate, metres) for a path position d. */
  uOfD(d: number): number {
    const a = this.uAnchors;
    if (d <= a[0].d) return a[0].u + (a[0].d - d);
    for (let i = 1; i < a.length; i++)
      if (d <= a[i].d) {
        const t = (d - a[i - 1].d) / (a[i].d - a[i - 1].d);
        return a[i - 1].u + (a[i].u - a[i - 1].u) * t;
      }
    return a[a.length - 1].u - (d - a[a.length - 1].d);
  }

  /**
   * Lateral offset from the PF 3 road of corridor line `id` at d, or null where it does not run.
   * Lines: 0 the ridden line (PF 4 road at Mira Road, PF 3 at Churchgate), 1–3 to its west, 4 a
   * line that splits off to its east for the last 3 km (PF 4 at Churchgate). ⚠ The real WR has
   * four to six tracks and the order of fast and slow lines changes along the way; this keeps four.
   */
  lineOffset(id: number, d: number): number | null {
    const sm = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const m = 1 - sm(this.dMiraRoad + 60, this.dMiraRoad + 500, d);
    const c = sm(this.dCgRegion[0], this.dCgRegion[1], d);
    const h = this.haltNear(d);
    // At a halt, lines 2–3 step west round the island platform between lines 1 and 2.
    const hs = h ? this.haltRamp(h, d) : 0;
    const spread = h ? (h.islandWest + 2 * PF_EDGE - LINE_SPACING) * hs : 0;
    if (id >= 5) {
      const x = h?.extra[id];
      if (!h || !x) return null;
      if (x.kind === 'parallel') return Math.abs(d - h.d) < 1700 ? x.o : null;
      // A siding beside the platform: parallel to its neighbour outside the station, stopping at
      // buffer stops beyond the platform ends.
      if (Math.abs(d - h.d) > h.half + 330) return null;
      const base = x.from === 0 ? 0 : -3 * LINE_SPACING - spread;
      const baseAt = x.from === 0 ? 0 : -3 * LINE_SPACING - (h.islandWest + 2 * PF_EDGE - LINE_SPACING);
      const side = Math.sign(x.o - baseAt);
      return base + side * (LINE_SPACING + (Math.abs(x.o - baseAt) - LINE_SPACING) * hs);
    }
    let o: number;
    switch (id) {
      case 0:
        o = 0;
        break;
      case 1:
        o = -LINE_SPACING + (MIRA_LINES[1] + LINE_SPACING) * m;
        break;
      case 2:
        o = -2 * LINE_SPACING + (MIRA_LINES[2] + 2 * LINE_SPACING) * m - spread;
        break;
      case 3: {
        if (c >= 0.999) return null;
        const g = -3 * LINE_SPACING + (MIRA_LINES[3] + 3 * LINE_SPACING) * m - spread;
        o = g + (-2 * LINE_SPACING - g) * c;
        break;
      }
      case 4:
        if (c <= 0.001) return null;
        o = LINE_SPACING * c;
        break;
      default:
        return null;
    }
    if (d > this.dStraight) {
      const st = STATION_OFFSET[id];
      if (st === undefined) return null;
      o += (st - o) * sm(this.dStraight, this.dThroat, d);
    }
    return o;
  }

  /** Lateral offset of Churchgate platform road `ti` (0–3, PF 1–4) from the PF 3 road at d. */
  trackOffset(ti: number, d: number): number {
    return this.lineOffset(TI_LINE[ti], d) ?? 0;
  }

  /** Offsets of the lines running at d (min, max). */
  bundle(d: number): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let id = 0; id < LINES; id++) {
      const o = this.lineOffset(id, d);
      if (o === null) continue;
      lo = Math.min(lo, o);
      hi = Math.max(hi, o);
    }
    return [lo, hi];
  }

  /** Stations the Churchgate fast stops at on the way (HALTS.md). */
  readonly halts: Halt[] = [];

  /** The halt whose layout reaches d, if any. */
  haltNear(d: number): Halt | null {
    for (const h of this.halts) if (Math.abs(d - h.d) < 1800) return h;
    return null;
  }

  /** 1 along a halt's platforms, easing to 0 over the throats beyond them. */
  haltRamp(h: Halt, d: number): number {
    const a = Math.abs(d - h.d) - h.half;
    const t = Math.max(0, Math.min(1, (a - 30) / 190));
    return 1 - t * t * (3 - 2 * t);
  }

  /** How far a halt's station layout reaches d (0 … 1). */
  haltAt(d: number): number {
    const h = this.haltNear(d);
    return h ? this.haltRamp(h, d) : 0;
  }

  /** Stations the ride passes through without stopping (platforms on both sides). */
  readonly passing: { name: string; deva: string; d: number }[] = [];
  /** Platform half-length of the passing stations (12-car platforms, ≈270 m ⚠). */
  static readonly PLATFORM_HALF = 140;

  /** How far a passing-station platform widens the corridor at d (0 … 1). */
  platformAt(d: number): { k: number; st: { name: string; deva: string; d: number } | null } {
    for (const st of this.passing) {
      const e = Math.abs(d - st.d) - Railway.PLATFORM_HALF;
      if (e < 40) return { k: e <= 0 ? 1 : 1 - e / 40, st };
    }
    return { k: 0, st: null };
  }

  /** Boundary walls of the railway land at d (offsets from the PF 3 road). */
  bounds(d: number): [number, number] {
    const [lo, hi] = this.bundle(d);
    let L = lo - 7;
    let R = hi + 7;
    const p = this.platformAt(d).k;
    L -= 9 * p;
    R += 9 * p;
    const h = this.haltNear(d);
    if (h) {
      const k = this.haltRamp(h, d);
      L -= h.land[0] * k;
      R += h.land[1] * k;
    }
    // Mira Road's platforms (built by MiraRoad.ts from OSM) need room on both sides.
    const m = Math.max(0, Math.min(1, 1 - (d - this.dMiraRoad - 40) / 80));
    L -= 26 * m;
    R += 26 * m;
    if (d > this.dStraight) {
      const t = Math.min(1, (d - this.dStraight) / (this.dThroat - this.dStraight));
      const e = t * t * (3 - 2 * t);
      L += (-30.5 - PF3_X - L) * e;
      R += (30.5 - PF3_X - R) * e;
    }
    return [L, R];
  }

  /** Distance of x/z outside the railway walls (negative inside), near Churchgate (u < 5.2 km). */
  clearance(x: number, z: number): number {
    const p = this.path.project(x, z, this.dOfU(5400), this.dChurchgate);
    if (p.s <= this.dOfU(5300) || p.s >= this.dChurchgate - 1) return p.d;
    const [L, R] = this.bounds(p.s);
    return p.o < L ? L - p.o : p.o > R ? p.o - R : -Math.min(p.o - L, R - p.o);
  }

  /** Outline of the railway land from Churchgate's platforms to u (for cutting it out of the ground). */
  landHole(uEnd: number): [number, number][] {
    const d0 = this.dOfU(uEnd);
    const d1 = this.dChurchgate - 4;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let d = d0; ; d = Math.min(d1, d + 10)) {
      const [L, R] = this.bounds(d);
      left.push(this.path.point(d, L - 0.4));
      right.push(this.path.point(d, R + 0.4));
      if (d >= d1) break;
    }
    return [...left, ...right.reverse()];
  }

  /** Station-frame z (straight PF roads) → path d, valid on the straight part. */
  dOfStationZ(z: number): number {
    return this.dChurchgate + (z + 2);
  }

  /**
   * Pose of a car on track ti whose centre is at path distance d: position and heading (object +Z
   * along increasing d, i.e. towards Churchgate).
   */
  carPose(ti: number, d: number, out: { x: number; z: number; heading: number }): void {
    this.linePose(TI_LINE[ti], d, out);
  }

  /** As carPose, for corridor line `id`. */
  linePose(id: number, d: number, out: { x: number; z: number; heading: number }): void {
    // The body rests on its two bogies (14.6 m apart): place it on the chord between them.
    const B = 7.3;
    const o0 = this.lineOffset(id, d - B) ?? 0;
    const o1 = this.lineOffset(id, d + B) ?? 0;
    const [ax, az] = this.path.point(d - B, o0);
    const [bx, bz] = this.path.point(d + B, o1);
    out.x = (ax + bx) / 2;
    out.z = (az + bz) / 2;
    out.heading = Math.atan2(bx - ax, bz - az);
  }
}
