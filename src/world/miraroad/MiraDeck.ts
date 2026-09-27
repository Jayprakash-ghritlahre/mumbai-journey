import * as THREE from 'three';
import { boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { signQuad } from '../../gfx/Signage';
import type { Railway } from '../journey/Railway';
import { F } from './MiraFront';
import { PLATFORMS, hungBoard } from './MiraPlatforms';
import { DECK, TOP, V3, beam, cover, lamp, mat4, ramp, sign, solid, type MiraCtx } from './MiraCtx';
import type { OsmWay } from './MiraStreets';

/**
 * The elevated walkways (OpenStreetMap, bridge=yes footways): the station deck across the north
 * end, the three foot-over-bridges, the long walkway along the east side over the booking hall,
 * and the skywalk east over the auto stand to Shrikant Dhadwe Road; and every flight of stairs
 * (OSM steps) between them and the platforms, the hall and the streets.
 *
 * From the photos: concrete decks with low parapets and steel rails; curved sheet roofs on steel
 * frames (the skywalk's slanted green trusses); the yellow corrugated "मीरा रोड / MIRA ROAD"
 * boards hung from the bridges over the platforms.
 *
 * One OSM correction: the east walkway's centre line runs over the arcade's facade in OSM; the
 * photos show it behind the pediment, so it is moved back over the hall (⚠ ≈4 m).
 */

type Pt = [number, number];

export interface Walkway {
  id: number;
  pts: Pt[];
  w: number;
  kind: 'fob' | 'skywalk' | 'spur';
}

export interface MiraDeckOut {
  walkways: Walkway[];
  /** Walking graph over decks, stairs, platform feet (local positions with heights). */
  nodes: THREE.Vector3[];
  edges: [number, number][];
  /** Stair feet: graph node and what they stand on. */
  feet: { node: number; on: string | null }[];
  /** Skywalk column footprints (for the bike lot). */
  skywalkCols: Pt[];
  /** Every flight of stairs (for cutting the platform canopies round them). */
  stairs: { bottom: THREE.Vector3; top: THREE.Vector3; w: number }[];
  /** Is a local point under (or on) a walkway? */
  deckAt: (x: number, z: number) => boolean;
}

const DECK_IDS = [151208734, 151208737, 1410033868, 1410033870, 151208736, 151208735, 1410033840, 1410033857, 1410033851, 1410033861, 1410033871, 376221510, 1463162444];

export function buildDeck(c: MiraCtx, ways: OsmWay[], rail: Railway, inHall: (x: number, z: number) => boolean, noColumn: (x: number, z: number) => boolean = () => false): MiraDeckOut {
  const gb = c.gb;
  const dm = c.dm;
  const onTrack = (x: number, z: number, pad = 2.3) => {
    const q = c.proj(x, z);
    for (let id = 0; id < 4; id++) {
      const o = rail.lineOffset(id, q.s);
      if (o !== null && Math.abs(q.o - o) < pad) return true;
    }
    return false;
  };
  const onPlatform = (x: number, z: number): string | null => {
    const q = c.proj(x, z);
    const s = q.s - dm;
    for (const p of PLATFORMS) if (s > p.s0 - 1 && s < p.s1 + 1 && q.o > p.o0(s) - 0.4 && q.o < p.o1(s) + 0.4) return p.ref;
    return null;
  };

  // ---- Walkways -------------------------------------------------------------------------------
  const walkways: Walkway[] = [];
  for (const e of ways) {
    if (!DECK_IDS.includes(e.id)) continue;
    let pts = e.pts.map((p) => [...p] as Pt);
    if (e.id === 151208737) {
      // Along the east side: off the facade, back over the hall (⚠ OSM correction).
      const i0 = pts.findIndex((p) => Math.abs(p[0] - 29.3) < 0.3 && Math.abs(p[1] + 85.1) < 0.3);
      const i1 = pts.findIndex((p) => Math.abs(p[0] - 26.4) < 0.3 && Math.abs(p[1] + 2.8) < 0.3);
      if (i0 >= 0 && i1 > i0) pts = [...pts.slice(0, i0 + 1), F(28.5, -4.6), F(4.1, -4.6), ...pts.slice(i1)];
    }
    if (e.id === 151208736) pts[0] = F(27.3, -4.6);
    const kind = e.id === 151208736 || e.id === 376221510 || e.id === 1463162444 ? 'skywalk' : pts.length <= 2 && polyLen(pts) < 15 ? 'spur' : 'fob';
    walkways.push({ id: e.id, pts, w: kind === 'skywalk' ? 4.4 : kind === 'spur' ? 3.4 : e.id === 1410033870 ? 6.2 : 5.5, kind });
  }
  /** Is (x, z) on some walkway's floor (other than `skip`)? */
  const onDeck = (x: number, z: number, skip?: Walkway, pad = 0) =>
    walkways.some((w) => {
      if (w === skip) return false;
      for (let i = 1; i < w.pts.length; i++) if (segDist(x, z, w.pts[i - 1], w.pts[i]) < w.w / 2 + pad) return true;
      return false;
    });

  // ---- Stairs (resolved first: the parapets open where they arrive) ---------------------------
  interface Stair {
    bottom: THREE.Vector3;
    top: THREE.Vector3;
    w: number;
    esc: boolean;
    on: string | null;
  }
  const stairs: Stair[] = [];
  for (const e of ways) {
    if (e.tags.highway !== 'steps' || e.pts.length < 2) continue;
    const a = e.pts[0];
    const b = e.pts[e.pts.length - 1];
    const da = distToDecks(walkways, a);
    const db = distToDecks(walkways, b);
    if (Math.min(da, db) > 4) continue;
    let top = da < db ? a : b;
    const bot = top === a ? b : a;
    // Trim the head back to the deck's edge.
    const len = Math.hypot(top[0] - bot[0], top[1] - bot[1]);
    const ux = (top[0] - bot[0]) / len;
    const uz = (top[1] - bot[1]) / len;
    let t = len;
    while (t > 4 && onDeck(bot[0] + ux * t, bot[1] + uz * t, undefined, -0.2)) t -= 0.25;
    top = [bot[0] + ux * (t + 0.15), bot[1] + uz * (t + 0.15)];
    const on = onPlatform(bot[0], bot[1]) ?? (inHall(bot[0], bot[1]) ? 'hall' : null);
    const y0 = on ? TOP : -0.3;
    const esc = e.tags.conveying !== undefined || e.tags.escalator === 'yes';
    stairs.push({ bottom: V3(bot[0], y0, bot[1]), top: V3(top[0], DECK, top[1]), w: esc ? 1.5 : 2.7, esc, on });
  }
  const nearStairHead = (x: number, z: number) => stairs.some((s) => Math.hypot(s.top.x - x, s.top.z - z) < s.w / 2 + 0.9);

  const skywalkCols: Pt[] = [];
  for (const w of walkways) {
    const hw = w.w / 2;
    const green = w.kind === 'skywalk';
    const frameKey = green ? 'skyGreen' : 'steelGrey';
    let colAcc = 6;
    for (let i = 1; i < w.pts.length; i++) {
      const A = V3(w.pts[i - 1][0], DECK, w.pts[i - 1][1]);
      const B = V3(w.pts[i][0], DECK, w.pts[i][1]);
      const len = A.distanceTo(B);
      if (len < 0.4) continue;
      const h = Math.atan2(B.x - A.x, B.z - A.z);
      const nx = Math.cos(h);
      const nz = -Math.sin(h);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      // Slab and its floor.
      gb.add('concrete', boxGeo(w.w, 0.5, len + hw * 0.6).rotateY(h).translate(mid.x, DECK - 0.25, mid.z));
      gb.add('hallFloor', boxGeo(w.w - 0.3, 0.02, len + hw * 0.6).rotateY(h).translate(mid.x, DECK + 0.005, mid.z));
      ramp(c, A.x - Math.sin(h) * hw * 0.3, A.z - Math.cos(h) * hw * 0.3, B.x + Math.sin(h) * hw * 0.3, B.z + Math.cos(h) * hw * 0.3, hw, DECK);
      cover(c, mid.x, mid.z, len / 2 + hw * 0.3, hw + 0.3, h - Math.PI / 2, 0.5, DECK + 3.2);
      // Parapets in 1 m pieces, open where another walkway or a stair joins.
      for (const s of [-1, 1]) {
        for (let t = 0; t < len; t += 1) {
          const t1 = Math.min(len, t + 1);
          const tm = (t + t1) / 2;
          const px = A.x + ((B.x - A.x) * tm) / len + nx * s * hw;
          const pz = A.z + ((B.z - A.z) * tm) / len + nz * s * hw;
          const ox = px + nx * s * 0.7;
          const oz = pz + nz * s * 0.7;
          if (onDeck(ox, oz, w) || nearStairHead(px, pz)) continue;
          const pa = A.clone().lerp(B, t / len).add(V3(nx * s * hw, 0, nz * s * hw));
          const pb = A.clone().lerp(B, t1 / len).add(V3(nx * s * hw, 0, nz * s * hw));
          gb.add('wall', tint(beam(pa.clone().setY(DECK + 0.5), pb.clone().setY(DECK + 0.5), 0.16, 1.0), 0.88, 0.87, 0.83));
          gb.add('steel', beam(pa.clone().setY(DECK + 1.1), pb.clone().setY(DECK + 1.1), 0.06, 0.05));
          c.col.addWall(pa.x + c.AX, pa.z + c.AZ, pb.x + c.AX, pb.z + c.AZ, 0.25, DECK - 0.5, DECK + 1.3);
        }
      }
      // Roof: a frame every 6 m (slanted green trusses on the skywalk), curved sheets between.
      const nFr = Math.max(1, Math.round(len / 6));
      const arch = (tt: number, k: number): THREE.Vector3 => {
        const a = (k / 6) * Math.PI;
        const lean = green ? 0.5 : 0.25;
        return A.clone()
          .lerp(B, tt)
          .add(V3(nx * Math.cos(a) * (hw + lean), 3.0 + Math.sin(a) * 1.25, nz * Math.cos(a) * (hw + lean)));
      };
      for (let f = 0; f <= nFr; f++) {
        const tt = f / nFr;
        for (const s of [-1, 1]) {
          const base = A.clone().lerp(B, tt).add(V3(nx * s * (hw - 0.05), 1.0, nz * s * (hw - 0.05)));
          gb.add(frameKey, beam(base, arch(tt, s > 0 ? 0 : 6), 0.1, 0.14));
          if (green) gb.add(frameKey, beam(base.clone(), A.clone().lerp(B, Math.min(1, tt + 0.5 / nFr)).add(V3(nx * s * (hw + 0.5), 3.0, nz * s * (hw + 0.5))), 0.06, 0.06));
        }
        for (let k = 1; k <= 6; k++) gb.add(frameKey, beam(arch(tt, k - 1), arch(tt, k), 0.08, 0.12));
      }
      for (let k = 1; k <= 6; k++) {
        const q = [arch(0, k - 1).add(V3(0, 0.1, 0)), arch(0, k).add(V3(0, 0.1, 0)), arch(1, k - 1).add(V3(0, 0.1, 0)), arch(1, k).add(V3(0, 0.1, 0))];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([q[0], q[2], q[1], q[1], q[2], q[3]].flatMap((v) => [v.x, v.y, v.z]), 3));
        const arc = q[0].distanceTo(q[1]);
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len, 0, 0, arc, 0, arc, len, 0, len, arc], 2));
        g.computeVertexNormals();
        gb.add('roofSheet', g);
      }
      // Tube lights along the roof.
      for (let t = 3; t < len; t += 6) {
        const p = A.clone().lerp(B, t / len);
        gb.add('tube', boxGeo(0.08, 0.05, 1.2).rotateY(h).translate(p.x, DECK + 3.2, p.z));
        lamp(c, p.x, p.z, 6, 0.28);
      }
      // Columns to the ground or a platform every ~12 m (not on the tracks, not in the hall).
      for (let t = colAcc; t < len; t += 12) {
        const x = A.x + ((B.x - A.x) * t) / len;
        const z = A.z + ((B.z - A.z) * t) / len;
        if (onTrack(x, z)) continue;
        const pf = onPlatform(x, z);
        const hall = inHall(x, z);
        const y0 = pf || hall ? TOP : -0.45;
        for (const s of w.w > 4 ? [-1, 1] : [0]) {
          const cx = x + nx * s * (hw - 0.5);
          const cz = z + nz * s * (hw - 0.5);
          if (onTrack(cx, cz) || noColumn(cx, cz)) continue;
          gb.add(green ? 'skyGreen' : 'concrete', boxGeo(0.6, DECK - 0.5 - y0, 0.6).rotateY(h).translate(cx, (DECK - 0.5 + y0) / 2, cz));
          solid(c, cx, cz, 0.35, 0.35, 0, -1, DECK - 0.6);
          if (green) skywalkCols.push([cx, cz]);
        }
      }
      colAcc = 12 - ((len - colAcc) % 12);
    }
  }

  // ---- Stairs ------------------------------------------------------------------------------------
  for (const s of stairs) buildStair(c, s.bottom, s.top, s.w, s.esc);

  // ---- The yellow name boards hung from the foot-over-bridges over each platform ----------------
  for (const w of walkways) {
    if (w.kind !== 'fob') continue;
    for (const pf of PLATFORMS) {
      for (let i = 1; i < w.pts.length; i++) {
        const qa = c.proj(...w.pts[i - 1]);
        const qb = c.proj(...w.pts[i]);
        const sa = qa.s - dm;
        const oc = (pf.o0(sa) + pf.o1(sa)) / 2;
        if ((qa.o - oc) * (qb.o - oc) > 0 || Math.abs(qb.o - qa.o) < 3) continue;
        const k = (oc - qa.o) / (qb.o - qa.o);
        const s = qa.s + (qb.s - qa.s) * k;
        if (s - dm < pf.s0 || s - dm > pf.s1) continue;
        for (const side of [-1, 1]) {
          const p = c.P(s + side * (w.w / 2 + 0.25), oc, DECK - 1.15);
          const m = mat4(p.x, p.y, p.z, c.heading(s) + (side > 0 ? 0 : Math.PI));
          hungBoard(c, c.signs.fobBoard, 3.6, 0.9, m);
          // The platform numbers under it.
          pf.faces.forEach((f, fi) => {
            const po = c.P(s + side * (w.w / 2 + 0.25), oc + (pf.faces.length > 1 ? (fi === 0 ? -2.6 : 2.6) : 0), DECK - 2.25);
            sign(c, c.signs.pf[String(f.pf)], 0.62, 0.62, mat4(po.x, po.y, po.z, c.heading(s) + (side > 0 ? 0 : Math.PI)), { back: true, plate: [0.1, 0.18, 0.4] });
          });
        }
      }
    }
  }
  // Signs on the deck: the skywalk, the way down to the booking hall.
  {
    const [sx, sz] = F(24.5, -4.6);
    sign(c, c.signs.skywalk, 2.4, 0.6, mat4(sx, DECK + 2.5, sz, Math.atan2(1, 0)), { back: true });
    const [hx, hz] = F(-43, -4.8);
    sign(c, c.signs.wayOut, 2.4, 0.6, mat4(hx, DECK + 2.5, hz, Math.atan2(0.04, -1)), { back: true });
  }

  // ---- The elevated block between the deck and the east walkway (OSM building 526883822) --------
  {
    const q: Pt[] = [
      [31.8, -92.5],
      [6.9, -94.3],
      [7.7, -106.5],
      [32.7, -105.0],
    ];
    const cx = q.reduce((a, p) => a + p[0], 0) / 4;
    const cz = q.reduce((a, p) => a + p[1], 0) / 4;
    const h = Math.atan2(q[0][0] - q[1][0], q[0][1] - q[1][1]);
    const L = Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]);
    const D = Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
    const m = mat4(cx, 0, cz, h - Math.PI / 2);
    gb.add('wall', tint(boxGeo(L, 4.0, D).translate(0, DECK + 1.6, 0), 0.9, 0.88, 0.8).applyMatrix4(m));
    gb.add('wall', tint(boxGeo(L + 0.4, 0.3, D + 0.4).translate(0, DECK + 3.75, 0), 0.75, 0.72, 0.66).applyMatrix4(m));
    for (let x = -L / 2 + 2; x < L / 2 - 1; x += 2.6) gb.add('glass', boxGeo(1.4, 1.1, 0.05).translate(x, DECK + 2.0, D / 2 + 0.03).applyMatrix4(m));
    sign(c, c.signs.booking, 3.6, 0.9, mat4(0, DECK + 3.1, D / 2 + 0.06).premultiply(m));
    solid(c, cx, cz, L / 2, D / 2, h - Math.PI / 2, DECK - 1, DECK + 5);
  }

  // ---- The walking graph ------------------------------------------------------------------------
  const nodes: THREE.Vector3[] = [];
  const edges: [number, number][] = [];
  const nodeAt = (p: THREE.Vector3) => {
    for (let i = 0; i < nodes.length; i++) if (nodes[i].distanceToSquared(p) < 0.8 * 0.8) return i;
    nodes.push(p.clone());
    return nodes.length - 1;
  };
  // Walkway polylines split every ~10 m, then joined where they meet.
  const wayNodes: number[][] = [];
  for (const w of walkways) {
    const list: number[] = [];
    for (let i = 0; i < w.pts.length; i++) {
      const p = V3(w.pts[i][0], DECK, w.pts[i][1]);
      if (i > 0) {
        const q = V3(w.pts[i - 1][0], DECK, w.pts[i - 1][1]);
        const n = Math.floor(p.distanceTo(q) / 10);
        for (let k = 1; k <= n; k++) list.push(nodeAt(q.clone().lerp(p, k / (n + 1))));
      }
      list.push(nodeAt(p));
    }
    for (let i = 1; i < list.length; i++) if (list[i] !== list[i - 1]) edges.push([list[i - 1], list[i]]);
    wayNodes.push(list);
  }
  const nearestDeckNode = (p: THREE.Vector3, max: number) => {
    let best = -1;
    let bd = max * max;
    wayNodes.forEach((l) =>
      l.forEach((i) => {
        const d = (nodes[i].x - p.x) ** 2 + (nodes[i].z - p.z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }),
    );
    return best;
  };
  // Ends of walkways join the nearest node of another walkway.
  wayNodes.forEach((l, wi) => {
    for (const end of [l[0], l[l.length - 1]]) {
      let best = -1;
      let bd = 9 * 9;
      wayNodes.forEach((m, wj) => {
        if (wj === wi) return;
        for (const i of m) {
          const d = nodes[i].distanceToSquared(nodes[end]);
          if (d < bd && i !== end) {
            bd = d;
            best = i;
          }
        }
      });
      if (best >= 0) edges.push([end, best]);
    }
  });
  const feet: { node: number; on: string | null }[] = [];
  for (const s of stairs) {
    const topN = nodeAt(s.top);
    const deckN = nearestDeckNode(s.top, 12);
    if (deckN >= 0 && deckN !== topN) edges.push([topN, deckN]);
    const botN = nodeAt(s.bottom);
    edges.push([botN, topN]);
    feet.push({ node: botN, on: s.on });
  }
  return { walkways, nodes, edges, feet, skywalkCols, stairs, deckAt: (x, z) => onDeck(x, z, undefined, 0.6) };
}

function polyLen(p: Pt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

function segDist(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}

function distToDecks(ws: Walkway[], p: Pt): number {
  let best = Infinity;
  for (const w of ws) for (let i = 1; i < w.pts.length; i++) best = Math.min(best, segDist(p[0], p[1], w.pts[i - 1], w.pts[i]) - w.w / 2);
  return best;
}

/** A straight flight from bottom up to top: treads, soffit, side walls with rails, a roof. */
function buildStair(c: MiraCtx, bottom: THREE.Vector3, top: THREE.Vector3, w: number, esc: boolean): void {
  const gb = c.gb;
  const dx = top.x - bottom.x;
  const dz = top.z - bottom.z;
  const len = Math.hypot(dx, dz);
  if (len < 2) return;
  const h = Math.atan2(dx, dz);
  const y0 = bottom.y;
  const y1 = top.y;
  const rise = y1 - y0;
  const n = Math.max(8, Math.round(rise / 0.17));
  const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), h);
  const at = (t: number, y: number, side = 0) => V3(bottom.x + dx * t + side * Math.cos(h), y, bottom.z + dz * t - side * Math.sin(h));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cc = at(t, y0 + (rise * (i + 1)) / n - 0.1);
    gb.add(esc ? 'stainless' : 'granite', tint(boxGeo(w, 0.2, len / n + 0.02), 1.12, 1.12, 1.12).applyQuaternion(q).translate(cc.x, cc.y, cc.z));
  }
  const mid = at(0.5, y0 + rise / 2);
  const slope = Math.atan2(rise, len);
  const hyp = Math.hypot(len, rise);
  gb.add('concrete', boxGeo(w, 0.25, hyp).rotateX(-slope).applyQuaternion(q).translate(mid.x, mid.y - 0.35, mid.z));
  for (const s of [-1, 1]) {
    const wm = at(0.5, y0 + rise / 2 + 0.5, s * (w / 2 + 0.08));
    gb.add('wall', tint(boxGeo(0.14, 1.0, hyp).rotateX(-slope).applyQuaternion(q).translate(wm.x, wm.y, wm.z), 0.88, 0.87, 0.83));
    gb.add('steel', rodGeo(at(0, y0 + 1.05, s * (w / 2 - 0.08)), at(1, y1 + 1.05, s * (w / 2 - 0.08)), 0.025, 5));
    for (let t = 0; t <= 1.001; t += 0.25) gb.add('steel', rodGeo(at(t, y0 + rise * t + 1.0, s * (w / 2 + 0.2)), at(t, y0 + rise * t + 3.1, s * (w / 2 + 0.2)), 0.05, 5));
    // The side walls are solid to walk into from the platform or the deck.
    const wc = at(0.5, 0, s * (w / 2 + 0.1));
    solid(c, wc.x, wc.z, 0.12, len / 2, h, y0 - 0.5, y1 + 1.2);
  }
  // Nobody walks under the upper half of a flight (the solid is too low to touch anyone on it).
  const lowC = at(0.725, 0);
  solid(c, lowC.x, lowC.z, w / 2, len * 0.275, h, y0 - 0.5, y0 + 1.5);
  gb.add('roofSheet', boxGeo(w + 1, 0.05, hyp + 0.5).rotateX(-slope).applyQuaternion(q).translate(mid.x, mid.y + 3.2, mid.z));
  lamp(c, mid.x, mid.z, 5, 0.2);
  // Walkable: the flight as a ramp.
  ramp(c, bottom.x, bottom.z, top.x, top.z, w / 2 - 0.05, y0, y1);
  // A glowing tube under the roof halfway up.
  gb.add('tube', boxGeo(0.08, 0.05, 1.2).rotateX(-slope).applyQuaternion(q).translate(mid.x, mid.y + 3.0, mid.z));
  void signQuad;
}
