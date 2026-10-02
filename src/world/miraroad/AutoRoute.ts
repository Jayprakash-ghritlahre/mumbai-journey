import type { OsmWay } from './MiraStreets';

type Pt = [number, number];

/**
 * The auto's way to the station (AUTO_RIDE.md §2), from OpenStreetMap: down Shanti Nagar Sector 2's
 * internal lane (215059080) and round its north side, up the short link (215058880), west along the
 * road past Sector 1 (99203763), right across Poonam Sagar Road's southbound carriageway into the
 * northbound one (788778486), north to the station junction, left into the station approach
 * (1238879349), round the U-turn at the forecourt (44427767), where it drops you, and out again.
 *
 * One lane path in Mira Road's local frame, keeping left (an offset from each way's centre line),
 * with rounded corners, resampled every half metre. s: metres from where the auto first appears.
 */

interface LegSpec {
  way: number;
  /** Indices into the way's points (from > to: driven against the way's direction). */
  from: number;
  to: number;
  /** Lane: offset to the left of the centre line (m). */
  off: number;
  /** Speed on the straight (m/s). */
  limit: number;
  /** Turning radius at the joint into the next leg (m). */
  r: number;
}

const LEGS: LegSpec[] = [
  // Sector 2: down the lane between the slab blocks, round the corner, along the north side.
  { way: 215059080, from: 0, to: 9, off: 0.85, limit: 5.8, r: 6 },
  { way: 215058880, from: 0, to: 1, off: 0.85, limit: 5.2, r: 7 },
  // West past the shops of Sector 1, to Poonam Sagar Road (a right turn across the southbound side).
  { way: 99203763, from: 2, to: 1, off: 1.5, limit: 7.6, r: 9 },
  // Poonam Sagar Road, northbound, to the junction by the station.
  { way: 788778486, from: 15, to: 21, off: 1.55, limit: 10.2, r: 8 },
  // The station approach (in), the U-turn at the forecourt, and out along the north carriageway.
  { way: 1238879349, from: 0, to: 1, off: 0.6, limit: 6.2, r: 4.6 },
  { way: 44427767, from: 0, to: 2, off: 2.0, limit: 4.2, r: 4.6 },
  { way: 44427767, from: 2, to: 4, off: -1.7, limit: 6.5, r: 6 },
];

/** Corner radius inside a leg (lanes turn tighter than roads). */
const INNER_R = [5.5, 6, 9, 14, 8, 5, 8];

export interface RouteSection {
  s: number;
  en: string;
  deva: string;
}

export interface AutoRoute {
  pts: Pt[];
  cum: number[];
  length: number;
  /** Point, heading (atan2(dx, dz), as the traffic) and curvature (1/m, + turning left) at s. */
  at(s: number): { x: number; z: number; h: number; k: number };
  /** Allowed speed at s: the leg's limit, slowed for corners and what comes (braking ≤ 1.7 m/s²). */
  profile(s: number): number;
  /** Nearest s to a point (searching all, or around a hint). */
  project(x: number, z: number, hint?: number, span?: number): { s: number; d: number };
  /** Within r of the ridden part of the route (where the street is dressed). */
  near(x: number, z: number, r: number): boolean;
  /** s where each leg starts. */
  legStart: number[];
  /** Default pickup (the auto's centre where it stops for you), and where you wait at the kerb. */
  sPickup: number;
  /** Where it gives way before crossing the southbound carriageway of Poonam Sagar Road, and the crossing point. */
  sGive: number;
  cross: Pt;
  /** Stop line at the junction (the auto's centre stops 1.5 m short of it). */
  sSignal: number;
  stopLine: { x: number; z: number; h: number };
  /** Where it stops for you at the forecourt (the south gate is just behind on the left). */
  sDrop: number;
  /** Speed breakers (s of each). */
  humps: number[];
  sections: RouteSection[];
  /** Skip targets (N): the start of each stretch after the pickup. */
  stretches: { s: number; title: [string, string, string] }[];
}

const SECTIONS_SPEC: { leg: number; en: string; deva: string }[] = [
  { leg: 0, en: 'Shanti Nagar · Sector 2', deva: 'शांती नगर · सेक्टर २' },
  { leg: 2, en: 'Shanti Nagar · Mira Road (East)', deva: 'शांती नगर · मीरा रोड (पूर्व)' },
  { leg: 3, en: 'Poonam Sagar Road', deva: 'पूनम सागर रोड' },
  { leg: 4, en: 'Mira Road station (East)', deva: 'मीरा रोड स्टेशन (पूर्व)' },
];

const left = (a: Pt, b: Pt): Pt => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dz / l, -dx / l];
};

/** A polyline offset to the left by o, mitred at the vertices. */
export function offsetLine(p: Pt[], o: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const na = i > 0 ? left(p[i - 1], p[i]) : left(p[i], p[i + 1]);
    const nb = i < p.length - 1 ? left(p[i], p[i + 1]) : na;
    let nx = na[0] + nb[0];
    let nz = na[1] + nb[1];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const k = 1 / Math.max(0.4, nx * na[0] + nz * na[1]);
    out.push([p[i][0] + nx * o * k, p[i][1] + nz * o * k]);
  }
  return out;
}

/** Intersection of the lines a0→a1 and b0→b1 (extended), or null when nearly parallel. */
function meet(a0: Pt, a1: Pt, b0: Pt, b1: Pt): Pt | null {
  const rx = a1[0] - a0[0];
  const rz = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sz = b1[1] - b0[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-6 * Math.hypot(rx, rz) * Math.hypot(sx, sz)) return null;
  const t = ((b0[0] - a0[0]) * sz - (b0[1] - a0[1]) * sx) / den;
  return [a0[0] + rx * t, a0[1] + rz * t];
}

/** Replaces each corner by a quadratic curve of about radius r (cut back r·tan(θ/2) each side). */
function roundCorners(p: Pt[], radius: (i: number) => number): Pt[] {
  const out: Pt[] = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = out[out.length - 1];
    const v = p[i];
    const b = p[i + 1];
    const lin = Math.hypot(v[0] - a[0], v[1] - a[1]);
    const lout = Math.hypot(b[0] - v[0], b[1] - v[1]);
    if (lin < 1e-3 || lout < 1e-3) continue;
    const ux = (v[0] - a[0]) / lin;
    const uz = (v[1] - a[1]) / lin;
    const wx = (b[0] - v[0]) / lout;
    const wz = (b[1] - v[1]) / lout;
    const th = Math.acos(Math.max(-1, Math.min(1, ux * wx + uz * wz)));
    if (th < 0.035) {
      out.push(v);
      continue;
    }
    const cut = Math.min(radius(i) * Math.tan(th / 2), lin * 0.48, lout * 0.48);
    const p0: Pt = [v[0] - ux * cut, v[1] - uz * cut];
    const p2: Pt = [v[0] + wx * cut, v[1] + wz * cut];
    const n = Math.max(3, Math.ceil(cut * th * 1.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const m0 = (1 - t) * (1 - t);
      const m1 = 2 * (1 - t) * t;
      const m2 = t * t;
      out.push([m0 * p0[0] + m1 * v[0] + m2 * p2[0], m0 * p0[1] + m1 * v[1] + m2 * p2[1]]);
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

function resample(p: Pt[], step: number): Pt[] {
  const out: Pt[] = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = step - carry;
    while (t <= len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = p[p.length - 1];
  const e = out[out.length - 1];
  if (Math.hypot(last[0] - e[0], last[1] - e[1]) > step * 0.3) out.push(last);
  return out;
}

export function buildAutoRoute(ways: OsmWay[]): AutoRoute {
  const way = (id: number) => {
    const w = ways.find((x) => x.id === id);
    if (!w) throw new Error(`auto route: OSM way ${id} missing`);
    return w.pts;
  };
  // Each leg as an offset polyline; joints where consecutive lanes meet.
  const lines = LEGS.map((L) => {
    const src = way(L.way);
    const pts: Pt[] = [];
    const step = L.from <= L.to ? 1 : -1;
    for (let i = L.from; i !== L.to + step; i += step) pts.push(src[i]);
    return offsetLine(pts, L.off);
  });
  const raw: Pt[] = [];
  const radiusAt: number[] = [];
  lines.forEach((ln, li) => {
    const pts = ln.map((p) => [...p] as Pt);
    if (li > 0) {
      const prev = lines[li - 1];
      const x = meet(prev[prev.length - 2], prev[prev.length - 1], pts[0], pts[1]);
      // The previous leg's last point becomes the joint; this leg starts after it.
      if (x) raw[raw.length - 1] = x;
      radiusAt[raw.length - 1] = LEGS[li - 1].r;
      pts.shift();
    }
    for (const p of pts) {
      raw.push(p);
      radiusAt.push(INNER_R[li]);
    }
  });
  const rounded = roundCorners(raw, (i) => radiusAt[i] ?? 6);
  const pts = resample(rounded, 0.5);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = cum[cum.length - 1];

  const idx = (s: number) => {
    const S = Math.max(0, Math.min(length, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1;
      if (cum[m] <= S) lo = m;
      else hi = m;
    }
    return { lo, hi, t: (S - cum[lo]) / (cum[hi] - cum[lo] || 1) };
  };
  const pos = (s: number): Pt => {
    const { lo, hi, t } = idx(s);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
  };
  const head = (s: number) => {
    const c = Math.max(1, Math.min(length - 1, s));
    const a = pos(c - 1);
    const b = pos(c + 1);
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  };
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const curv = (s: number) => wrap(head(s + 1.5) - head(s - 1.5)) / 3;

  const project = (x: number, z: number, hint?: number, span = 60) => {
    let best = { s: 0, d: Infinity };
    const i0 = hint === undefined ? 0 : idx(hint - span).lo;
    const i1 = hint === undefined ? pts.length - 1 : idx(hint + span).hi;
    for (let i = Math.max(1, i0); i <= i1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
      if (d < best.d) best = { s: cum[i - 1] + (cum[i] - cum[i - 1]) * t, d };
    }
    return best;
  };

  // Where each leg begins along the path.
  const legStart = LEGS.map((_, li) => (li === 0 ? 0 : project(...lines[li][0], undefined).s));
  for (let li = 1; li < legStart.length; li++) legStart[li] = Math.max(legStart[li], legStart[li - 1] + 1);
  const legAt = (s: number) => {
    let li = 0;
    while (li < LEGS.length - 1 && s >= legStart[li + 1]) li++;
    return li;
  };

  // Marks (from the real layout).
  const sPickup = project(293.9, 399.2).s;
  const cross: Pt = [189.5, 277.6];
  const sCross = project(cross[0], cross[1], legStart[3], 40).s;
  const sGive = sCross - 6.5;
  const line = project(169.0, -9.5, legStart[4], 60);
  const sSignal = line.s - 1.6;
  const lp = pos(line.s);
  const stopLine = { x: lp[0], z: lp[1], h: head(line.s) };
  const sDrop = project(69.85, -34.6, legStart[5], 30).s;
  const humps = [project(306.4, 433.6).s, project(276.2, 351.8).s, project(283.6, 245.9, legStart[2], 60).s];

  // Speed profile: the leg's limit, corners (lateral ≤ 1.6 m/s²), braking ahead (≤ 1.7 m/s²).
  const N = Math.ceil(length) + 1;
  const vmax = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = i;
    const k = Math.abs(curv(s));
    let v = LEGS[legAt(s)].limit;
    if (k > 1e-3) v = Math.min(v, Math.sqrt(1.6 / k));
    vmax[i] = Math.max(1.6, v);
  }
  for (let i = N - 2; i >= 0; i--) vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] * vmax[i + 1] + 2 * 1.7));
  const profile = (s: number) => {
    const i = Math.max(0, Math.min(N - 2, Math.floor(s)));
    const t = Math.max(0, Math.min(1, s - i));
    return vmax[i] + (vmax[i + 1] - vmax[i]) * t;
  };

  // Coarse samples for "near the route" (the part you ride, from the lane to the drop-off).
  const coarse: Pt[] = [];
  for (let s = 0; s <= sDrop + 20; s += 4) coarse.push(pos(s));
  const near = (x: number, z: number, r: number) => {
    const r2 = r * r;
    for (const p of coarse) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < r2) return true;
    return false;
  };

  const sections = SECTIONS_SPEC.map((q) => ({ s: legStart[q.leg], en: q.en, deva: q.deva }));
  return {
    pts,
    cum,
    length,
    at(s) {
      const [x, z] = pos(s);
      return { x, z, h: head(s), k: curv(s) };
    },
    profile,
    project,
    near,
    legStart,
    sPickup,
    sGive,
    cross,
    sSignal,
    stopLine,
    sDrop,
    humps,
    sections,
    stretches: [
      { s: legStart[3] + 14, title: ['Poonam Sagar Road', 'पूनम सागर रोड', 'North to the station'] },
      { s: sSignal - 70, title: ['The station junction', 'स्टेशन चौक', 'Mira Road (East)'] },
    ],
  };
}
