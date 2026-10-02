import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { boxGeo, rodGeo, tint, type GeoBuilder } from '../../gfx/GeoBuilder';
import { DEVA, LATIN, fitFont, signQuad, type AtlasRect } from '../../gfx/Signage';
import type { Ctx } from '../../gfx/TextureFactory';

/**
 * The station name boards a passenger sees from the train: coming in (the corrugated fascia over
 * the canopy end, a board on posts at the platform end) and pulling out (the board at the far end
 * of the platform). Borivali set the pattern; Dadar and Mira Road use the same boards in their own
 * colours, after the reference photos (HALTS.md §3, reconstruction only, never textures):
 *
 * - Borivali: tan fascia (borivali_entrace_from_miraroad.png), yellow exit board on white posts
 *   (borivali_exit_towards_churchgate.jpg).
 * - Dadar: mustard fascia and a framed board on yellow posts at the north end (dadar_entry.png),
 *   the rounded yellow board on black-footed white posts at the south end (dadar_exit.jpg).
 * - Mira Road: the big board in its steel frame with a hood (miraroad_exit.png), at the south end
 *   of the PF 2/3 island, between the tracks.
 *
 * Boards on posts face along the line (towards the train running at them) and read on both sides.
 */

type RGB = [number, number, number];

/** Board styles: each station's own colours and frame. */
export type BoardStyle = 'borivali' | 'dadarEntry' | 'dadarExit' | 'mira';

export function centred(c: Ctx, text: string, x: number, y: number, weight: string, family: string, max: number, width: number): void {
  c.font = `${weight} ${fitFont(c, text, weight, family, max, width)}px ${family}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, x, y);
}

/** Rust streaks running down from the top edge. */
export function weather(c: Ctx, w: number, h: number, seed: number, amount = 1): void {
  const rng = new RNG(seed);
  for (let i = 0; i < 10 * amount; i++) {
    const x = rng.range(0, w);
    const len = rng.range(h * 0.2, h * 0.9);
    const g = c.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(55,40,25,${0.16 * amount})`);
    g.addColorStop(1, 'rgba(55,40,25,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, rng.range(2, 10), len);
  }
}

/**
 * The corrugated fascia over the canopy end: the name in Devanagari at both ends and in English
 * in the middle. Borivali's is tan; Dadar's is mustard yellow.
 */
export function drawFascia(c: Ctx, w: number, h: number, deva: string, en: string, tone: 'tan' | 'mustard' = 'tan'): void {
  c.fillStyle = tone === 'tan' ? '#b8935f' : '#d99a22';
  c.fillRect(0, 0, w, h);
  const n = 64;
  for (let i = 0; i < n; i++) {
    const g = c.createLinearGradient((i * w) / n, 0, ((i + 1) * w) / n, 0);
    g.addColorStop(0, 'rgba(70,45,15,0.28)');
    g.addColorStop(0.5, 'rgba(255,235,190,0.2)');
    g.addColorStop(1, 'rgba(70,45,15,0.28)');
    c.fillStyle = g;
    c.fillRect((i * w) / n, 0, w / n + 1, h);
  }
  c.fillStyle = '#17120c';
  centred(c, deva, w * 0.2, h * 0.47, '700', DEVA, h * 0.62, w * 0.3);
  centred(c, deva, w * 0.8, h * 0.47, '700', DEVA, h * 0.62, w * 0.3);
  centred(c, en, w * 0.5, h * 0.6, '700', LATIN, h * 0.34, w * 0.26);
  weather(c, w, h, tone === 'tan' ? 41 : 44, 1.3);
}

/** The board on posts: Marathi / Hindi above, the name again with the English beside it below. */
export function drawNameBoard(c: Ctx, w: number, h: number, deva: string, en: string, style: BoardStyle): void {
  const bg = { borivali: '#f0c21a', dadarEntry: '#e8ae1c', dadarExit: '#f5c21b', mira: '#f5b30c' }[style];
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  if (style === 'borivali') {
    c.strokeStyle = '#151515';
    c.lineWidth = h * 0.035;
    c.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h * 0.92);
  } else if (style === 'mira') {
    // A thin grey rule inset from the edge.
    c.strokeStyle = 'rgba(70,60,50,0.7)';
    c.lineWidth = h * 0.02;
    c.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h * 0.9);
  } else if (style === 'dadarExit') {
    // Enamel sheen and a darker rim (the board itself is rounded).
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,245,200,0.18)');
    g.addColorStop(1, 'rgba(120,70,0,0.12)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(150,95,10,0.6)';
    c.lineWidth = h * 0.03;
    c.strokeRect(h * 0.015, h * 0.015, w - h * 0.03, h * 0.97);
  }
  c.fillStyle = '#151515';
  const two = `${deva}  ${en}`;
  centred(c, deva, w / 2, h * 0.3, '700', DEVA, h * 0.34, w * 0.8);
  centred(c, two, w / 2, h * 0.71, '700', DEVA, h * 0.3, w * 0.9);
  weather(c, w, h, { borivali: 53, dadarEntry: 57, dadarExit: 59, mira: 61 }[style], style === 'dadarExit' ? 0.35 : 0.6);
}

/** A rounded rectangle face (front +Z) mapped to an atlas rect. */
function roundedSign(rect: AtlasRect, w: number, h: number, r: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(roundedShape(w, h, r), 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = rect.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, u0 + (p.getX(i) / w + 0.5) * (u1 - u0), v0 + (p.getY(i) / h + 0.5) * (v1 - v0));
  return g;
}

function roundedShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = -h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r);
  s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h);
  s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

export interface PostBoard {
  /** Face size, and the height of its centre above the platform. */
  w: number;
  h: number;
  y: number;
  /** Posts: centre to centre, section (radius, or half width when square), colour. */
  posts: { gap: number; r: number; colour: RGB; square?: boolean; top?: number; foot?: { colour: RGB; h: number } };
  /** Backing plate behind the face. */
  plate: RGB;
  /** A raised frame round the face (width). */
  frame?: { colour: RGB; t: number };
  /** Corner radius of a rounded board. */
  round?: number;
  /** A little sloping roof over the board (Mira Road). */
  hood?: RGB;
}

/**
 * A name board on two posts at matrix m (platform level, the face towards +Z), reading on both
 * sides. keys: the sign-atlas material the face is in, a vertex-coloured paint, and optionally a
 * material for round posts (enamel).
 */
export function postBoard(gb: GeoBuilder, keys: { face: string; paint: string; post?: string }, rect: AtlasRect, m: THREE.Matrix4, b: PostBoard): void {
  const place = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z).applyMatrix4(m);
  const d = 0.06;
  // The face, front and back.
  for (const back of [false, true]) {
    const g = b.round ? roundedSign(rect, b.w, b.h, b.round) : signQuad(rect, b.w, b.h);
    if (back) g.rotateY(Math.PI);
    gb.add(keys.face, place(g, 0, b.y, back ? -(d / 2 + 0.004) : d / 2 + 0.004));
  }
  const [pr, pg, pb] = b.plate;
  if (b.round) {
    const plate = new THREE.ExtrudeGeometry(roundedShape(b.w + 0.04, b.h + 0.04, b.round + 0.02), { depth: d, bevelEnabled: false, curveSegments: 4 });
    gb.add(keys.paint, tint(place(plate, 0, b.y, -d / 2), pr, pg, pb));
  } else gb.add(keys.paint, tint(place(boxGeo(b.w + 0.06, b.h + 0.06, d), 0, b.y, 0), pr, pg, pb));
  if (b.frame) {
    const { colour: fc, t } = b.frame;
    const W = b.w + 2 * t;
    for (const [w, h, x, y] of [
      [W, t, 0, b.y + b.h / 2 + t / 2],
      [W, t, 0, b.y - b.h / 2 - t / 2],
      [t, b.h, -b.w / 2 - t / 2, b.y],
      [t, b.h, b.w / 2 + t / 2, b.y],
    ] as const)
      gb.add(keys.paint, tint(place(boxGeo(w, h, d + 0.05), x, y, 0), fc[0], fc[1], fc[2]));
  }
  // Posts, from the platform to the top of the board (or higher).
  const P = b.posts;
  const top = P.top ?? b.y + b.h / 2;
  for (const s of [-1, 1]) {
    const x = (s * P.gap) / 2;
    const foot = P.foot?.h ?? 0;
    const post = (y0: number, y1: number, col: RGB, key: string) => {
      const g = P.square ? boxGeo(P.r * 2, y1 - y0, P.r * 2).translate(0, (y0 + y1) / 2, 0) : rodGeo(new THREE.Vector3(0, y0, 0), new THREE.Vector3(0, y1, 0), P.r, 8);
      const q = g.translate(x, 0, 0).applyMatrix4(m);
      gb.add(key, key === keys.paint ? tint(q, col[0], col[1], col[2]) : q);
    };
    if (P.foot) post(0, foot, P.foot.colour, keys.paint);
    post(foot, top, P.colour, keys.post && !P.square ? keys.post : keys.paint);
  }
  if (b.hood) {
    // Cross rail over the board, and a small roof sloping back over both faces.
    const [hr, hg, hb] = b.hood;
    const [cr, cg, cb] = P.colour;
    gb.add(keys.paint, tint(place(boxGeo(P.gap + P.r * 2, P.r * 1.6, P.r * 2), 0, top - P.r * 0.8, 0), cr, cg, cb));
    const roof = boxGeo(P.gap + 0.5, 0.05, 0.62);
    roof.rotateX(0.18);
    gb.add(keys.paint, tint(place(roof, 0, top + 0.1, 0), hr, hg, hb));
  }
}
