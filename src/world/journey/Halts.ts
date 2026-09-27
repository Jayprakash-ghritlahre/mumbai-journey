import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { GeoBuilder, boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { makeCanvas, type Ctx, type TextureFactory } from '../../gfx/TextureFactory';
import { DEVA, LATIN, SignAtlas, drawDirectionSign, drawPlatformNumber, fitFont, signQuad, type AtlasRect } from '../../gfx/Signage';
import { BuildingBatch } from '../city/BuildingGen';
import { FACADE } from '../../gfx/FacadeTextures';
import { AmbientVolume } from '../../gfx/AmbientVolume';
import { drawCaution } from '../miraroad/MiraSigns';
import type { CorridorKit } from './Corridor';
import type { Halt, Railway } from './Railway';
import { HaltLife, type HaltPlan } from './HaltLife';

/**
 * Borivali and Dadar, the two stops the Churchgate fast makes on the way (HALTS.md). They are
 * seen from the train, not walked: the platforms, canopies, bridges and signs round the island
 * the ride stops at, the roads and platforms either side, the crowd, and each station's own
 * marks, after the reference photos in assets/ (reconstruction only, never textures):
 *
 * - Borivali: the tan corrugated name board over the north end of the PF 5/6 canopy
 *   (borivali_entrace_from_miraroad.png), teal-grey box columns, the WR diamond boards with the
 *   pillar numbers under them (Borivali_platformboard.jpg), the red fences between the tracks,
 *   and at the Churchgate end the yellow name board on white posts, red-and-cream paving, the
 *   pier of the new deck and the barrel-roofed canopy (borivali_exit_towards_churchgate.jpg).
 * - Dadar: narrow, packed islands under old truss canopies, the blue "दादर / DADAR" boards hung
 *   from the trusses (dadar.jpeg), three foot-over-bridges, Tilak Bridge over the north end, the
 *   Central Railway's platforms beyond the fence, and the flower market on the west side.
 *
 * Everything is built relative to the station centre (d = halt.d) so it keeps full precision.
 */

export const TOP = 0.92;
const EDGE = 1.68;
/** Foot-over-bridge floor above rail (clear of the overhead line) ⚠. */
export const FOB_Y = 7.9;

type RGB = [number, number, number];

export interface Plat {
  /** West and east edges (offset from line 0), ends (d from the station centre). */
  o0: number;
  o1: number;
  a: number;
  b: number;
  /** Platform numbers on the west and east faces; null: no track on that side. */
  faces: [string | null, string | null];
  canopies: { a: number; b: number; kind: 'bo' | 'barrel' | 'da' | 'cr' }[];
  /** The island the ride stops beside. */
  main?: boolean;
  /** People per 100 m² standing about. */
  density: number;
}

export interface HaltStation {
  halt: Halt;
  group: THREE.Group;
  plats: Plat[];
  life: HaltLife;
  /** The station's own ambient-light map (canopy shade, tube lights), in world coordinates. */
  av: AmbientVolume;
  /** Paints the platform indicators (the ride's train and the next one on the other face). */
  setIndicators(rows: [string, string][]): void;
}

// ---------------------------------------------------------------------------------------------
// Materials and signs, shared by both stations.

interface HaltKit {
  m: Record<string, THREE.Material>;
  atlas: SignAtlas;
  rect: Map<string, AtlasRect>;
}
const kits = new WeakMap<CorridorKit, HaltKit>();

function haltKit(kit: CorridorKit): HaltKit {
  let k = kits.get(kit);
  if (k) return k;
  const tf = kit.tf;
  const mats = kit.mats;
  const std = (name: string, p: THREE.MeshStandardMaterialParameters, macro = 0.3) => {
    const mat = new THREE.MeshStandardMaterial(p);
    mats.add(name, mat, macro);
    return mat;
  };
  const atlas = new SignAtlas(tf, 2048, 1024);
  const M = mats.m;
  const m: Record<string, THREE.Material> = {
    ...kit.m,
    boTiles: std('haltBoTiles', { map: boTiles(tf), roughness: 0.85 }, 0.35),
    daFloor: M.concrete,
    stone: M.stone,
    coping: M.coping,
    yellowLine: M.yellowLine,
    tactile: M.tactile,
    platformSide: M.platformSide,
    lampTube: M.lampTube,
    stainless: M.stainless,
    truss: M.steelTruss,
    whiteEnamel: M.whiteEnamel,
    hSigns: std('haltSigns', { map: atlas.texture, roughness: 0.6 }, 0.12),
    corr: std('haltCorrugated', { map: corrugated(tf), vertexColors: true, roughness: 0.75, metalness: 0.25, side: THREE.DoubleSide }, 0.25),
    // Galvanised sheet roofs, weathered (lighter than the corridor's, which read black from above).
    canopy: std('haltRoof', { map: corrugated(tf), vertexColors: true, roughness: 0.7, metalness: 0.15, side: THREE.DoubleSide }, 0.35),
  };
  k = { m, atlas, rect: new Map() };
  kits.set(kit, k);
  return k;
}

function sign(hk: HaltKit, key: string, w: number, h: number, draw: (c: Ctx, w: number, h: number) => void): AtlasRect {
  let r = hk.rect.get(key);
  if (!r) {
    r = hk.atlas.add(w, h, draw);
    hk.rect.set(key, r);
    hk.atlas.commit();
  }
  return r;
}

/** Red and cream paving (photo: borivali_exit_towards_churchgate), 2 m repeat. */
function boTiles(tf: TextureFactory): THREE.Texture {
  return tf.memo('haltBoTiles', () => {
    const S = 512;
    const [c, x] = makeCanvas(S, S);
    const rng = new RNG(5151);
    const n = 8;
    const s = S / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        // Bands of red and cream with the odd chequered row.
        const red = (j % 4 < 2) !== (j % 4 === 1 && i % 2 === 0);
        const base: RGB = red ? [168, 72, 60] : [214, 202, 178];
        const v = rng.range(-14, 10);
        x.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v})`;
        x.fillRect(i * s, j * s, s, s);
      }
    x.strokeStyle = 'rgba(70,60,50,0.55)';
    x.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      x.beginPath();
      x.moveTo(i * s, 0);
      x.lineTo(i * s, S);
      x.moveTo(0, i * s);
      x.lineTo(S, i * s);
      x.stroke();
    }
    tf.overlayNoise(x, S, S, 1, 2, 0.35, 'overlay', 31);
    for (let i = 0; i < 14; i++) tf.stain(x, S, S, rng.range(0, S), rng.range(0, S), rng.range(20, 70), 'rgba(50,40,30,1)', 0.18, rng);
    const t = tf.tex(c);
    t.repeat.set(1 / 2, 1 / 2);
    return t;
  });
}

/** Corrugated sheet (for name boards and stall roofs): vertical ribs, tinted by vertex colour. */
function corrugated(tf: TextureFactory): THREE.Texture {
  return tf.memo('haltCorrugated', () => {
    const [c, x] = makeCanvas(256, 64);
    for (let i = 0; i < 16; i++) {
      const g = x.createLinearGradient(i * 16, 0, i * 16 + 16, 0);
      g.addColorStop(0, '#8a8a8a');
      g.addColorStop(0.5, '#f4f4f4');
      g.addColorStop(1, '#8a8a8a');
      x.fillStyle = g;
      x.fillRect(i * 16, 0, 16, 64);
    }
    tf.overlayNoise(x, 256, 64, 1, 2, 0.25, 'overlay', 7);
    const t = tf.tex(c);
    t.repeat.set(1 / 1.6, 1);
    return t;
  });
}

function centred(c: Ctx, text: string, x: number, y: number, weight: string, family: string, max: number, width: number): void {
  c.font = `${weight} ${fitFont(c, text, weight, family, max, width)}px ${family}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, x, y);
}

function weather(c: Ctx, w: number, h: number, seed: number, amount = 1): void {
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

/** The tan corrugated board over the north end of Borivali's PF 5/6 canopy. */
function drawFascia(c: Ctx, w: number, h: number, deva: string, en: string): void {
  c.fillStyle = '#b8935f';
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
  weather(c, w, h, 41, 1.3);
}

/** The WR diamond (Borivali_platformboard.jpg), drawn turned −45° so the quad hangs as a diamond. */
function drawDiamond(c: Ctx, w: number, h: number, deva: string, en: string): void {
  c.fillStyle = '#ecebe6';
  c.fillRect(0, 0, w, h);
  c.save();
  c.translate(w / 2, h / 2);
  c.rotate(-Math.PI / 4);
  const s = w * 0.72;
  c.strokeStyle = '#c8352c';
  c.lineWidth = s * 0.13;
  c.beginPath();
  c.arc(0, 0, s * 0.3, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#1d2d5c';
  c.fillRect(-s * 0.44, -s * 0.12, s * 0.88, s * 0.24);
  c.fillStyle = '#f4f4f4';
  centred(c, deva, 0, s * 0.01, '700', DEVA, s * 0.2, s * 0.8);
  c.fillStyle = '#141414';
  centred(c, deva, 0, -s * 0.41, '700', DEVA, s * 0.12, s * 0.46);
  centred(c, en, 0, s * 0.42, '700', LATIN, s * 0.1, s * 0.5);
  c.restore();
  weather(c, w, h, 43, 0.8);
}

/** Dadar's blue board (dadar.jpeg): white border, cream lettering. */
function drawBlueBoard(c: Ctx, w: number, h: number, deva: string, en: string): void {
  c.fillStyle = '#2e55a8';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#f2f2ee';
  c.lineWidth = h * 0.05;
  c.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88);
  c.fillStyle = '#f3e7c4';
  centred(c, deva, w / 2, h * 0.33, '700', DEVA, h * 0.36, w * 0.8);
  centred(c, en, w / 2, h * 0.72, '700', LATIN, h * 0.34, w * 0.8);
  weather(c, w, h, 47, 0.5);
}

/** Yellow station board: Marathi / Hindi above, English below (the exit-end board). */
function drawYellow(c: Ctx, w: number, h: number, deva: string, en: string): void {
  c.fillStyle = '#f0c21a';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#151515';
  c.lineWidth = h * 0.035;
  c.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h * 0.92);
  c.fillStyle = '#151515';
  centred(c, deva, w / 2, h * 0.3, '700', DEVA, h * 0.34, w * 0.8);
  centred(c, `${deva}  ${en}`, w / 2, h * 0.72, '700', DEVA, h * 0.3, w * 0.9);
  weather(c, w, h, 53, 0.6);
}

function drawPillar(c: Ctx, w: number, h: number, n: number): void {
  c.fillStyle = '#6d7b7c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#121212';
  centred(c, String(n), w / 2, h * 0.55, '800', LATIN, h * 0.8, w * 0.9);
}

function drawStall(c: Ctx, w: number, h: number, bg: string, fg: string, en: string, dv: string): void {
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.fillStyle = fg;
  centred(c, dv, w / 2, h * 0.34, '700', DEVA, h * 0.42, w * 0.9);
  centred(c, en, w / 2, h * 0.76, '700', LATIN, h * 0.3, w * 0.9);
  weather(c, w, h, en.length, 0.6);
}

/** Fictional FOB-side adverts. */
const FOB_ADS: [string, string, string, string][] = [
  ['#0d5c9e', '#ffffff', 'NAVKAR JEWELLERS', 'नवकार ज्वेलर्स · बोरीवली प.'],
  ['#d23a1f', '#fff5d8', 'MAHALAXMI SAREES', 'महालक्ष्मी साडी सेंटर'],
  ['#15803d', '#ffffff', 'SHREEJI CLASSES', 'श्रीजी क्लासेस · 10वी 12वी'],
  ['#f2b705', '#1a1a1a', 'VIJAY FOOTWEAR', 'विजय फुटवेअर'],
  ['#5b2a86', '#ffffff', 'OM SAI TRAVELS', 'ओम साई ट्रॅव्हल्स'],
];

// ---------------------------------------------------------------------------------------------
// Geometry helpers.

interface Ctx3 {
  gb: GeoBuilder;
  /** Station-local point: d from the station centre, offset from line 0, height. */
  P: (rd: number, o: number, y: number) => THREE.Vector3;
  mat: (rd: number, o: number, y: number, rotY?: number) => THREE.Matrix4;
  hk: HaltKit;
  kit: CorridorKit;
  h: Halt;
  rng: RNG;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Quad strip between edges A and B; u across (ua → ub), v = vs. Faces `dir` (flipped to suit). */
function strip(A: THREE.Vector3[], B: THREE.Vector3[], ua: number, ub: number, vs: number[], dir: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  e1.subVectors(A[1], A[0]);
  e2.subVectors(B[0], A[0]);
  const flip = n.crossVectors(e1, e2).dot(dir) < 0;
  const tri = (p: THREE.Vector3[], t: number[][]) => {
    const order = flip ? [0, 2, 1] : [0, 1, 2];
    for (const k of order) {
      pos.push(p[k].x, p[k].y, p[k].z);
      uv.push(t[k][0], t[k][1]);
    }
  };
  for (let i = 0; i < A.length - 1; i++) {
    tri([A[i], A[i + 1], B[i]], [
      [ua, vs[i]],
      [ua, vs[i + 1]],
      [ub, vs[i]],
    ]);
    tri([B[i], A[i + 1], B[i + 1]], [
      [ub, vs[i]],
      [ua, vs[i + 1]],
      [ub, vs[i + 1]],
    ]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** A w × h beam between two points. */
function beam(A: THREE.Vector3, B: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(w, h, Math.max(0.001, len));
  const dir = B.clone().sub(A).normalize();
  // Keep the beam's height vertical: yaw to the horizontal direction, then pitch.
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = -Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

const samples = (a: number, b: number, step: number): number[] => {
  const out: number[] = [];
  for (let d = a; d < b; d += step) out.push(d);
  out.push(b);
  return out;
};

// ---------------------------------------------------------------------------------------------

/** Platforms, per station (offsets from the lines at the station centre). */
function layout(rail: Railway, h: Halt): Plat[] {
  const at = (id: number) => rail.lineOffset(id, h.d)!;
  if (h.key === 'BO')
    return [
      { o0: at(6) + EDGE, o1: at(3) - EDGE, a: -150, b: 135, faces: ['1', '2'], canopies: [{ a: -118, b: 75, kind: 'bo' }], density: 3 },
      {
        o0: at(2) + EDGE,
        o1: at(1) - EDGE,
        a: -150,
        b: 150,
        faces: ['3', '4'],
        canopies: [
          { a: -140, b: 22, kind: 'bo' },
          { a: 32, b: 140, kind: 'barrel' },
        ],
        density: 3.5,
      },
      { o0: EDGE, o1: at(5) - EDGE, a: -150, b: 152, faces: ['5', '6'], canopies: [{ a: -138, b: 100, kind: 'bo' }], main: true, density: 4.5 },
    ];
  return [
    { o0: at(3) - EDGE - 8, o1: at(3) - EDGE, a: -150, b: 145, faces: [null, '1'], canopies: [{ a: -140, b: 140, kind: 'da' }], density: 8 },
    { o0: at(2) + EDGE, o1: at(1) - EDGE, a: -150, b: 150, faces: ['2', '3'], canopies: [{ a: -145, b: 145, kind: 'da' }], density: 13 },
    { o0: EDGE, o1: at(5) - EDGE, a: -150, b: 152, faces: ['4', '5'], canopies: [{ a: -145, b: 145, kind: 'da' }], main: true, density: 16 },
    { o0: at(6) + EDGE, o1: at(7) - EDGE, a: -155, b: 150, faces: ['', ''], canopies: [{ a: -150, b: 145, kind: 'cr' }], density: 8 },
  ];
}

/** Foot-over-bridges: d from the centre (between the overhead portals), width, stairs per platform. */
function bridges(h: Halt): { rd: number; w: number; stairs: { plat: number; dir: 1 | -1 }[] }[] {
  // Portals stand every 54 m of path distance (Corridor): put each bridge midway between two.
  const mid = (rd: number) => Math.round((h.d + rd - 27) / 54) * 54 + 27 - h.d;
  if (h.key === 'BO')
    return [
      {
        rd: mid(-95),
        w: 5,
        stairs: [
          { plat: 0, dir: 1 },
          { plat: 1, dir: 1 },
          { plat: 2, dir: 1 },
        ],
      },
      {
        rd: mid(30),
        w: 5.5,
        stairs: [
          { plat: 1, dir: -1 },
          { plat: 2, dir: -1 },
        ],
      },
    ];
  return [
    {
      rd: mid(-100),
      w: 5,
      stairs: [
        { plat: 1, dir: 1 },
        { plat: 2, dir: 1 },
        { plat: 3, dir: 1 },
      ],
    },
    {
      rd: mid(-5),
      w: 7,
      stairs: [
        { plat: 0, dir: -1 },
        { plat: 1, dir: 1 },
        { plat: 2, dir: -1 },
        { plat: 3, dir: 1 },
      ],
    },
    {
      rd: mid(95),
      w: 5,
      stairs: [
        { plat: 1, dir: -1 },
        { plat: 2, dir: 1 },
        { plat: 3, dir: -1 },
      ],
    },
  ];
}

export function buildHalt(kit: CorridorKit, rail: Railway, h: Halt, av: AmbientVolume): HaltStation {
  const hk = haltKit(kit);
  const path = rail.path;
  const anchor = path.at(h.d);
  const AX = anchor.x;
  const AZ = anchor.z;
  const group = new THREE.Group();
  group.name = 'halt-' + h.key;
  const tmp = { x: 0, z: 0, tx: 0, tz: 1 };
  const P = (rd: number, o: number, y: number) => {
    const a = path.at(h.d + rd, tmp);
    return new THREE.Vector3(a.x + a.tz * o - AX, y, a.z - a.tx * o - AZ);
  };
  const headingAt = (rd: number) => {
    const a = path.at(h.d + rd, tmp);
    return Math.atan2(a.tx, a.tz);
  };
  const mat = (rd: number, o: number, y: number, rotY = 0) => new THREE.Matrix4().compose(P(rd, o, y), new THREE.Quaternion().setFromAxisAngle(UP, headingAt(rd) + rotY), new THREE.Vector3(1, 1, 1));
  const gb = new GeoBuilder();
  const rng = new RNG(h.key === 'BO' ? 3407 : 1027);
  const c: Ctx3 = { gb, P, mat, hk, kit, h, rng };
  const plats = layout(rail, h);
  const bo = h.key === 'BO';

  for (const pl of plats) buildPlatform(c, pl, bo);
  for (const pl of plats) for (const cn of pl.canopies) buildCanopy(c, pl, cn);
  const stairs: HaltPlan['stairs'] = [];
  for (const b of bridges(h)) buildBridge(c, rail, plats, b, stairs);
  for (const pl of plats) dressPlatform(c, pl, stairs);
  buildTrackside(c, rail, plats);
  if (bo) borivaliMarks(c, plats);
  else dadarMarks(c, rail, plats);
  // Platform indicators: a small live canvas (the ride's train and the next one on the other face).
  const [ic, ix] = makeCanvas(512, 256);
  const itex = kit.tf.tex(ic, { wrap: false, mips: false });
  const imat = new THREE.MeshBasicMaterial({ map: itex, toneMapped: false });
  const main = plats.find((p) => p.main)!;
  const ind = new GeoBuilder();
  for (const [rd, row] of [
    [-25, 0],
    [62, 0],
    [15, 1],
  ] as const) {
    const oc = (main.o0 + main.o1) / 2 + (row ? 1.6 : -1.6);
    for (const face of [0, Math.PI]) {
      const g = new THREE.PlaneGeometry(1.9, 0.48);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), row ? 0.5 * uv.getY(i) : 0.5 + 0.5 * uv.getY(i));
      g.translate(0, 0, 0.045).rotateY(face);
      ind.add('led', g.applyMatrix4(mat(rd, oc, TOP + 3.05)));
    }
    gb.add('paint', tint(boxGeo(2.0, 0.56, 0.08).applyMatrix4(mat(rd, oc, TOP + 3.05)), 0.1, 0.1, 0.11));
    for (const s of [-0.7, 0.7]) gb.add('steel', rodGeo(P(rd + s, oc, TOP + 3.3), P(rd + s, oc, TOP + 4.1), 0.015, 4));
  }
  group.add(ind.build({ led: imat }, { castShadow: false }));
  const built = gb.build(hk.m, { noShadowKeys: ['hSigns', 'signs', 'lampTube', 'yellowLine', 'tactile', 'coping'] });
  group.add(built);
  group.add(surroundings(c, rail, plats));

  const setIndicators = (rows: [string, string][]) => {
    ix.fillStyle = '#050505';
    ix.fillRect(0, 0, 512, 256);
    rows.slice(0, 2).forEach(([pf, text], i) => {
      const y0 = i * 128;
      ix.fillStyle = '#1b2a4a';
      ix.fillRect(0, y0, 512, 34);
      ix.fillStyle = '#eef2f6';
      ix.font = `700 20px ${DEVA}`;
      ix.textBaseline = 'middle';
      ix.textAlign = 'left';
      ix.fillText(`फलाट ${pf}   गंतव्य   समय   गति   डिब्बे`, 10, y0 + 18);
      // Dot-matrix green text.
      ix.fillStyle = '#39ff6a';
      ix.shadowColor = '#39ff6a';
      ix.shadowBlur = 8;
      ix.font = `700 58px "Courier New", monospace`;
      ix.fillText(text, 14, y0 + 82);
      ix.shadowBlur = 0;
      ix.fillStyle = 'rgba(0,0,0,0.45)';
      for (let x = 0; x < 512; x += 4) ix.fillRect(x, y0 + 36, 1, 92);
      for (let y = y0 + 36; y < y0 + 128; y += 4) ix.fillRect(0, y, 512, 1);
    });
    itex.needsUpdate = true;
  };
  setIndicators([
    [String(h.pf), 'C  --:--  F 12'],
    [bo ? '6' : '5', 'A  --:--  S 12'],
  ]);

  // Life: the crowd on every platform, and the exchange at the ride's doors.
  const plan: HaltPlan = {
    plats: plats.map((p) => ({ o0: p.o0, o1: p.o1, a: p.a, b: p.b, main: !!p.main, density: p.density, west: p.faces[0] !== null, east: p.faces[1] !== null })),
    stairs,
    heading: headingAt(0),
  };
  const life = new HaltLife(av, P, plan, h, bo ? 811 : 823);
  group.add(life.group);
  return { halt: h, group, plats, life, av: lightMap(rail, h, plats, bridges(h)), setIndicators };
}

/**
 * The station's ambient-light map (like Mira Road's): shade and ceilings under the canopies and
 * bridges, and light from the tube lights and the lamp posts on the open platform ends.
 */
function lightMap(rail: Railway, h: Halt, plats: Plat[], fobs: { rd: number; w: number }[]): AmbientVolume {
  const path = rail.path;
  const tmp = { x: 0, z: 0, tx: 0, tz: 1 };
  const W = (rd: number, o: number) => {
    const a = path.at(h.d + rd, tmp);
    return [a.x + a.tz * o, a.z - a.tx * o];
  };
  const [L, R] = rail.bounds(h.d);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const rd of [-190, 0, 190])
    for (const o of [L - 6, R + 6]) {
      const [x, z] = W(rd, o);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  const av = new AmbientVolume(minX, minZ, maxX, maxZ, 512);
  // Station coordinates of a world point: project on the centre tangent, then refine locally.
  const c0 = path.at(h.d);
  const local = (x: number, z: number): [number, number] => {
    let rd = (x - c0.x) * c0.tx + (z - c0.z) * c0.tz;
    const a = path.at(h.d + rd, tmp);
    rd += (x - a.x) * a.tx + (z - a.z) * a.tz;
    return [rd, (x - a.x) * a.tz - (z - a.z) * a.tx];
  };
  av.paint(minX, minZ, maxX, maxZ, (x, z, sky, ceil) => {
    const [rd, o] = local(x, z);
    for (const pl of plats)
      for (const cn of pl.canopies)
        if (rd > cn.a && rd < cn.b && o > pl.o0 - 0.3 && o < pl.o1 + 0.3) return [Math.min(sky, 0.32), Math.max(ceil, cn.kind === 'barrel' ? 5.4 : 5.2)];
    for (const b of fobs) if (Math.abs(rd - b.rd) < b.w / 2 + 0.5 && o > L - 3 && o < R + 3) return [Math.min(sky, 0.55), Math.max(ceil, FOB_Y - 0.3)];
    return [sky, ceil];
  });
  for (const pl of plats) {
    const oc = (pl.o0 + pl.o1) / 2;
    const half = (pl.o1 - pl.o0) / 2;
    for (let d = pl.a + 4; d < pl.b - 3; d += 9) {
      const under = pl.canopies.some((cn) => d > cn.a && d < cn.b);
      if (under) for (const s of [-1, 1]) {
        const [x, z] = W(d, oc + s * half * 0.45);
        av.light(x, z, 5, 0.4);
      }
      else if (Math.round(d / 9) % 2 === 0) {
        const [x, z] = W(d, oc);
        av.light(x, z, 9, 0.34);
      }
    }
  }
  for (const b of fobs)
    for (let o = L; o < R; o += 8) {
      const [x, z] = W(b.rd, o);
      av.light(x, z, 5, 0.3);
    }
  av.commit(2, 2);
  return av;
}

// ---------------------------------------------------------------------------------------------

function buildPlatform(c: Ctx3, pl: Plat, bo: boolean): void {
  const { gb, P } = c;
  const ds = samples(pl.a, pl.b, 6);
  const [fw, fe] = [pl.faces[0] !== null, pl.faces[1] !== null];
  const cw = 0.45;
  const i0 = pl.o0 + (fw ? cw : 0.25);
  const i1 = pl.o1 - (fe ? cw : 0.25);
  const floor = bo ? 'boTiles' : 'daFloor';
  // Borivali's paving is red and cream at the Churchgate end, older grey stone elsewhere.
  if (bo) {
    const split = pl.main ? 60 : 90;
    const dA = ds.filter((d) => d <= split).concat(split);
    const dB = [split, ...ds.filter((d) => d > split)];
    gb.add('stone', strip(dA.map((d) => P(d, i0, TOP)), dA.map((d) => P(d, i1, TOP)), i0, i1, dA, UP));
    gb.add(floor, strip(dB.map((d) => P(d, i0, TOP)), dB.map((d) => P(d, i1, TOP)), i0, i1, dB, UP));
  } else gb.add(floor, strip(ds.map((d) => P(d, i0, TOP)), ds.map((d) => P(d, i1, TOP)), i0, i1, ds, UP));
  for (const [on, o, s] of [
    [fw, pl.o0, 1],
    [fe, pl.o1, -1],
  ] as const) {
    const out = P(0, o - s, 0).sub(P(0, o, 0)).normalize();
    const inner = s > 0 ? i0 : i1;
    if (on) {
      // Coping, the yellow line, a tactile band; the face down to the ballast.
      gb.add('coping', strip(ds.map((d) => P(d, Math.min(o, inner), TOP + 0.002)), ds.map((d) => P(d, Math.max(o, inner), TOP + 0.002)), 0, 0.45, ds, UP));
      const y0 = o + s * 0.7;
      const y1 = o + s * 0.82;
      gb.add('yellowLine', strip(ds.map((d) => P(d, Math.min(y0, y1), TOP + 0.006)), ds.map((d) => P(d, Math.max(y0, y1), TOP + 0.006)), 0, 0.12, ds, UP));
      const t0 = o + s * 0.95;
      const t1 = o + s * 1.25;
      gb.add('tactile', strip(ds.map((d) => P(d, Math.min(t0, t1), TOP + 0.005)), ds.map((d) => P(d, Math.max(t0, t1), TOP + 0.005)), 0, 0.3, ds, UP));
    } else {
      gb.add('coping', strip(ds.map((d) => P(d, Math.min(o, inner), TOP + 0.002)), ds.map((d) => P(d, Math.max(o, inner), TOP + 0.002)), 0, 0.25, ds, UP));
    }
    gb.add('platformSide', strip(ds.map((d) => P(d, o, on ? -0.35 : -0.55)), ds.map((d) => P(d, o, TOP)), 0, 1.3, ds, out));
  }
  // Ramps down at both ends.
  for (const [e, s] of [
    [pl.a, -1],
    [pl.b, 1],
  ] as const) {
    const f = e + s * 7;
    gb.add('daFloor', strip([P(e, pl.o0, TOP), P(f, pl.o0, -0.25)], [P(e, pl.o1, TOP), P(f, pl.o1, -0.25)], pl.o0, pl.o1, [e, f], UP));
    for (const o of [pl.o0, pl.o1]) {
      const g = new THREE.BufferGeometry().setFromPoints([P(e, o, TOP), P(f, o, -0.25), P(e, o, -0.35)]);
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 0, 0, 0], 2));
      g.computeVertexNormals();
      const g2 = g.clone();
      const p = g2.attributes.position as THREE.BufferAttribute;
      const t = [p.getX(1), p.getY(1), p.getZ(1)];
      p.setXYZ(1, p.getX(2), p.getY(2), p.getZ(2));
      p.setXYZ(2, t[0], t[1], t[2]);
      g2.computeVertexNormals();
      gb.add('platformSide', g);
      gb.add('platformSide', g2);
    }
  }
}

function buildCanopy(c: Ctx3, pl: Plat, cn: Plat['canopies'][number]): void {
  const { gb, P, mat } = c;
  const oc = (pl.o0 + pl.o1) / 2;
  const half = (pl.o1 - pl.o0) / 2;
  const e0 = pl.o0 + 0.1;
  const e1 = pl.o1 - 0.1;
  const ds = samples(cn.a, cn.b, 3);
  const cols: number[] = [];
  for (let d = cn.a + 2; d <= cn.b - 1; d += 9) cols.push(d);
  if (cn.kind === 'barrel') {
    // Curved roof on two rows of columns: pale above, orange beneath (the exit-end photo).
    const yE = 4.6;
    const rise = 1.5;
    const N = 10;
    const os = Array.from({ length: N + 1 }, (_, i) => e0 + ((e1 - e0) * i) / N);
    const yAt = (o: number) => yE + rise * (1 - ((o - oc) / (half - 0.1)) ** 2);
    for (let i = 0; i < N; i++) {
      const [oa, ob] = [os[i], os[i + 1]];
      const top = strip(ds.map((d) => P(d, oa, yAt(oa) + 0.03)), ds.map((d) => P(d, ob, yAt(ob) + 0.03)), oa, ob, ds, UP);
      gb.add('paint', tint(top, 0.86, 0.87, 0.85));
      const under = strip(ds.map((d) => P(d, oa, yAt(oa))), ds.map((d) => P(d, ob, yAt(ob))), oa, ob, ds, UP.clone().negate());
      gb.add('paint', tint(under, 0.88, 0.45, 0.2));
    }
    for (const d of cols) {
      for (const s of [-1, 1]) {
        const o = oc + s * (half - 1.3);
        gb.add('paint', tint(boxGeo(0.28, yAt(o) - TOP, 0.28).applyMatrix4(mat(d, o, (yAt(o) + TOP) / 2)), 0.78, 0.8, 0.8));
      }
      for (let i = 0; i < N; i++) gb.add('steel', beam(P(d, os[i], yAt(os[i]) - 0.08), P(d, os[i + 1], yAt(os[i + 1]) - 0.08), 0.1, 0.16));
      gb.add('lampTube', boxGeo(0.07, 0.05, 1.2).applyMatrix4(mat(d + 4.5, oc, yAt(oc) - 0.25)));
    }
    return;
  }
  const bo = cn.kind === 'bo';
  const yE = bo ? 5.0 : 4.55;
  const yR = yE + (bo ? 0.7 : 0.9);
  const colTint: RGB = bo ? [0.36, 0.5, 0.52] : cn.kind === 'cr' ? [0.42, 0.2, 0.15] : [0.86, 0.83, 0.72];
  // Roof, two slopes from the ridge to the eaves.
  const roof: RGB = bo ? [0.62, 0.6, 0.56] : cn.kind === 'cr' ? [0.55, 0.47, 0.4] : [0.6, 0.55, 0.5];
  for (const [oa, ob, ya, yb] of [
    [e0, oc, yE, yR],
    [oc, e1, yR, yE],
  ] as const)
    gb.add('canopy', tint(strip(ds.map((d) => P(d, oa, ya)), ds.map((d) => P(d, ob, yb)), oa, ob, ds, UP), roof[0], roof[1], roof[2]));
  // Gutters or, at Dadar, the white valance along the eaves.
  for (const o of [e0, e1]) {
    const d0 = cn.a;
    const d1 = cn.b;
    if (bo) gb.add('paint', tint(beam(P(d0, o, yE - 0.1), P(d1, o, yE - 0.1), 0.16, 0.24), 0.3, 0.32, 0.32));
    else gb.add('paint', tint(beam(P(d0, o, yE - 0.22), P(d1, o, yE - 0.22), 0.05, 0.5), 0.9, 0.9, 0.86));
  }
  // Purlins.
  for (const f of [0.25, 0.5, 0.75]) {
    for (const [oa, ya] of [
      [e0 + (oc - e0) * f, yE + (yR - yE) * f],
      [oc + (e1 - oc) * f, yR - (yR - yE) * f],
    ] as const)
      gb.add('steel', beam(P(cn.a, oa, ya - 0.1), P(cn.b, oa, ya - 0.1), 0.08, 0.12));
  }
  gb.add('steel', beam(P(cn.a, oc, yR - 0.12), P(cn.b, oc, yR - 0.12), 0.12, 0.16));
  for (const d of cols) {
    // Columns: Borivali's single row of teal-grey box columns; Dadar's pairs of slim cream posts.
    const rows = bo ? [oc] : [oc - (half - 1.5), oc + (half - 1.5)];
    for (const o of rows) {
      const yTop = yE + (yR - yE) * (1 - Math.abs(o - oc) / (oc - e0)) - 0.1;
      const w = bo ? 0.34 : 0.2;
      gb.add('paint', tint(boxGeo(w, yTop - TOP, w).applyMatrix4(mat(d, o, (yTop + TOP) / 2)), colTint[0], colTint[1], colTint[2]));
      gb.add('paint', tint(boxGeo(w + 0.12, 0.25, w + 0.12).applyMatrix4(mat(d, o, TOP + 0.12)), colTint[0] * 0.8, colTint[1] * 0.8, colTint[2] * 0.8));
    }
    // Rafters from the ridge to the eaves, and a truss beneath at Dadar.
    gb.add('steel', beam(P(d, e0, yE - 0.12), P(d, oc, yR - 0.14), 0.12, 0.26));
    gb.add('steel', beam(P(d, oc, yR - 0.14), P(d, e1, yE - 0.12), 0.12, 0.26));
    if (bo) {
      // Cantilever brackets off the column head.
      for (const s of [-1, 1]) gb.add('steel', beam(P(d, oc, yR - 1.3), P(d, oc + s * (half - 1.2), yE + 0.1 + (yR - yE) * (1.2 / half)), 0.1, 0.14));
    } else {
      gb.add('steel', beam(P(d, e0 + 0.4, yE - 0.25), P(d, e1 - 0.4, yE - 0.25), 0.08, 0.12));
      for (let k = 1; k < 6; k++) {
        const o = e0 + ((e1 - e0) * k) / 6;
        const yT = o < oc ? yE + (yR - yE) * ((o - e0) / (oc - e0)) : yR - (yR - yE) * ((o - oc) / (e1 - oc));
        gb.add('steel', beam(P(d, o, yE - 0.25), P(d, o + (k < 3 ? -0.5 : k > 3 ? 0.5 : 0), yT - 0.2), 0.05, 0.05));
      }
    }
    // Tube lights between the bays, and a fan now and then.
    for (const s of bo ? [-1, 1] : [0]) {
      const o = oc + s * (half * 0.45);
      gb.add('lampTube', boxGeo(0.07, 0.05, 1.22).applyMatrix4(mat(d + 4.5, o, yE - 0.45)));
      gb.add('paint', tint(boxGeo(0.12, 0.06, 1.3).applyMatrix4(mat(d + 4.5, o, yE - 0.4)), 0.85, 0.85, 0.82));
    }
    if (c.rng.chance(0.4)) {
      const o = oc + (bo ? 2 : 0);
      gb.add('steel', rodGeo(P(d + 2, o, yE - 0.1), P(d + 2, o, yE - 0.75), 0.02, 4));
      gb.add('paint', tint(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 12).applyMatrix4(mat(d + 2, o, yE - 0.78)), 0.35, 0.36, 0.38));
    }
  }
}

function buildBridge(c: Ctx3, rail: Railway, plats: Plat[], b: { rd: number; w: number; stairs: { plat: number; dir: 1 | -1 }[] }, stairsOut: HaltPlan['stairs']): void {
  const { gb, P, mat, rng } = c;
  const [L, R] = rail.bounds(c.h.d + b.rd);
  const o0 = L - 3;
  const o1 = R + 3;
  const span = o1 - o0;
  const om = (o0 + o1) / 2;
  const hw = b.w / 2;
  const bo = c.h.key === 'BO';
  const trussKey = bo ? 'paint' : 'truss';
  const tr = (g: THREE.BufferGeometry) => (bo ? tint(g, 0.42, 0.52, 0.6) : g);
  // Deck.
  gb.add('concrete', boxGeo(span, 0.35, b.w).applyMatrix4(mat(b.rd, om, FOB_Y - 0.17)));
  // Side trusses, with advert panels on the lower half facing up and down the line.
  for (const s of [-1, 1]) {
    const d = b.rd + s * hw;
    gb.add(trussKey, tr(beam(P(d, o0, FOB_Y + 0.05), P(d, o1, FOB_Y + 0.05), 0.2, 0.3)));
    gb.add(trussKey, tr(beam(P(d, o0, FOB_Y + 2.0), P(d, o1, FOB_Y + 2.0), 0.18, 0.22)));
    const n = Math.round(span / 3);
    for (let i = 0; i <= n; i++) {
      const o = o0 + (span * i) / n;
      gb.add(trussKey, tr(beam(P(d, o, FOB_Y + 0.1), P(d, o, FOB_Y + 2.0), 0.12, 0.12)));
      if (i < n) gb.add(trussKey, tr(beam(P(d, o, FOB_Y + 0.1), P(d, o + span / n, FOB_Y + 2.0), 0.06, 0.06)));
    }
    gb.add('paint', tint(beam(P(d, o0, FOB_Y + 0.6), P(d, o1, FOB_Y + 0.6), 0.05, 1.0), 0.55, 0.57, 0.56));
    // Ads over the tracks (fictional).
    for (let o = o0 + 6; o < o1 - 6; o += 11) {
      if (!rng.chance(0.6)) continue;
      const ad = rng.pick(FOB_ADS);
      const r = sign(c.hk, 'ad:' + ad[2], 512, 96, (x, w, h) => drawStall(x, w, h, ad[0], ad[1], ad[2], ad[3]));
      const g = signQuad(r, 5.4, 1.0).translate(0, 0, 0.05);
      if (s < 0) g.rotateY(Math.PI);
      gb.add('hSigns', g.applyMatrix4(mat(d, o, FOB_Y + 0.6)));
    }
  }
  // Roof.
  for (const [oa, ob] of [[o0, o1]] as const) {
    gb.add('canopy', tint(strip([P(b.rd - hw - 0.4, oa, FOB_Y + 2.5), P(b.rd - hw - 0.4, ob, FOB_Y + 2.5)], [P(b.rd, oa, FOB_Y + 2.9), P(b.rd, ob, FOB_Y + 2.9)], 0, b.w, [oa, ob], UP), 0.6, 0.6, 0.58));
    gb.add('canopy', tint(strip([P(b.rd, oa, FOB_Y + 2.9), P(b.rd, ob, FOB_Y + 2.9)], [P(b.rd + hw + 0.4, oa, FOB_Y + 2.5), P(b.rd + hw + 0.4, ob, FOB_Y + 2.5)], 0, b.w, [oa, ob], UP), 0.6, 0.6, 0.58));
  }
  // Supports on each platform crossed, and at the ends.
  const feet = [o0 + 1, o1 - 1, ...plats.filter((p) => (p.o0 + p.o1) / 2 > o0 && (p.o0 + p.o1) / 2 < o1).map((p) => (p.o0 + p.o1) / 2)];
  for (const o of feet) {
    const base = plats.some((p) => o > p.o0 && o < p.o1) ? TOP : -0.4;
    for (const s of [-1, 1]) gb.add(trussKey, tr(boxGeo(0.35, FOB_Y - 0.35 - base, 0.35).applyMatrix4(mat(b.rd + s * (hw - 0.3), o + (b.stairs.length ? 1.6 : 0), (FOB_Y - 0.35 + base) / 2))));
  }
  // Stairs down to the islands.
  for (const st0 of b.stairs) {
    const pl = plats[st0.plat];
    if (!pl) continue;
    // Keep the ride's own doors clear: its car stands at rd ≈ 94–118 beside the main island.
    const clash = (dir: number) => pl.main && Math.max(b.rd + dir * hw, b.rd + dir * (hw + 15)) > 88 && Math.min(b.rd + dir * hw, b.rd + dir * (hw + 15)) < 122;
    const st = clash(st0.dir) ? { ...st0, dir: (-st0.dir) as 1 | -1 } : st0;
    const oc = (pl.o0 + pl.o1) / 2;
    const sw = Math.min(2.6, (pl.o1 - pl.o0) * 0.3);
    const rise = FOB_Y - TOP;
    const n = Math.ceil(rise / 0.175);
    const tread = 0.29;
    const landing = 1.6;
    const top = b.rd + st.dir * hw;
    const run = n * tread + landing;
    const foot = top + st.dir * run;
    const along = (k: number) => top + st.dir * (k * tread + (k > n / 2 ? landing : 0));
    for (let k = 0; k < n; k++) {
      const y = FOB_Y - (k + 1) * (rise / n);
      gb.add('concrete', boxGeo(sw, 0.2, tread + 0.02).applyMatrix4(mat(along(k) + st.dir * tread * 0.5, oc, y + 0.1 - 0.02)));
    }
    gb.add('concrete', boxGeo(sw, 0.2, landing).applyMatrix4(mat(along(Math.floor(n / 2)) + st.dir * (tread + landing * 0.5), oc, FOB_Y - (Math.floor(n / 2) + 1) * (rise / n) + 0.08)));
    // Soffit and sides.
    gb.add('concrete', beam(P(top, oc, FOB_Y - 0.4), P(foot, oc, TOP - 0.25), sw, 0.3));
    for (const s of [-1, 1]) {
      const o = oc + s * (sw / 2 + 0.05);
      gb.add('paint', tint(beam(P(top, o, FOB_Y + 0.5), P(foot, o, TOP + 0.5), 0.06, 1.0), 0.5, 0.53, 0.52));
      gb.add('steel', beam(P(top, o, FOB_Y + 1.02), P(foot, o, TOP + 1.02), 0.05, 0.05));
    }
    // A roof over the stair, and its posts.
    gb.add('canopy', tint(strip([P(top, oc - sw / 2 - 0.3, FOB_Y + 2.5), P(foot, oc - sw / 2 - 0.3, TOP + 2.8)], [P(top, oc + sw / 2 + 0.3, FOB_Y + 2.5), P(foot, oc + sw / 2 + 0.3, TOP + 2.8)], 0, sw + 0.6, [0, run], UP), 0.6, 0.6, 0.58));
    for (const s of [-1, 1]) gb.add('steel', rodGeo(P(foot - st.dir * 0.3, oc + s * (sw / 2 + 0.2), TOP), P(foot - st.dir * 0.3, oc + s * (sw / 2 + 0.2), TOP + 2.8), 0.05, 6));
    stairsOut.push({ plat: st.plat, rd0: foot + st.dir * 0.8, rd1: top, o: oc, w: sw });
  }
}

/** Boards, benches, stalls and the rest on each platform. */
function dressPlatform(c: Ctx3, pl: Plat, stairs: HaltPlan['stairs']): void {
  const { gb, P, mat, hk, kit, h, rng } = c;
  const bo = h.key === 'BO';
  const oc = (pl.o0 + pl.o1) / 2;
  const cr = pl.canopies[0]?.kind === 'cr';
  const blocked = (d: number, o: number, r = 2) => stairs.some((s) => Math.abs(o - s.o) < s.w / 2 + 0.6 && d > Math.min(s.rd0, s.rd1) - r && d < Math.max(s.rd0, s.rd1) + r);
  const covered = (d: number) => pl.canopies.some((cn) => d > cn.a + 1 && d < cn.b - 1);
  const blue = sign(hk, 'blue:' + h.key, 512, 192, (x, w, hh) => drawBlueBoard(x, w, hh, h.deva, h.name.toUpperCase()));
  const board2 = kit.board(h.deva, h.name.toUpperCase());
  for (const [face, o, s] of [
    [pl.faces[0], pl.o0, 1],
    [pl.faces[1], pl.o1, -1],
  ] as const) {
    if (face === null) continue;
    const rot = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    // Name boards facing the track, readable from the train: on posts (yellow) and hung (Dadar: blue).
    for (const f of [-0.8, -0.45, -0.1, 0.25, 0.55, 0.85]) {
      const d = f * 140 + s * 4;
      if (d < pl.a + 5 || d > pl.b - 5 || blocked(d, o + s * 3.2)) continue;
      const hung = !bo && covered(d);
      const oo = o + s * (hung ? 1.2 : 3.0);
      const y = hung ? TOP + 3.0 : TOP + 2.2;
      const m = mat(d, oo, y, rot);
      if (hung) {
        gb.add('hSigns', signQuad(blue, 2.9, 1.08).translate(0, 0, 0.035).applyMatrix4(m));
        gb.add('paint', tint(boxGeo(3.0, 1.18, 0.06).applyMatrix4(m), 0.15, 0.2, 0.35));
        for (const k of [-1.1, 1.1]) gb.add('steel', rodGeo(P(d + k, oo, y + 0.55), P(d + k, oo, TOP + 3.9), 0.015, 4));
      } else {
        gb.add('signs', signQuad(board2, 2.9, 0.9).translate(0, 0, 0.035).applyMatrix4(m));
        gb.add('paint', tint(boxGeo(3.0, 1.0, 0.06).applyMatrix4(m), 0.12, 0.12, 0.12));
        for (const k of [-1.3, 1.3]) gb.add('whiteEnamel', rodGeo(P(d + k, oo, TOP), P(d + k, oo, y + 0.5), 0.045, 6));
      }
    }
    // Platform numbers hung at the eaves, facing the track.
    if (face && pl.canopies.length) {
      const r = sign(hk, 'pf:' + face, 128, 128, (x, w, hh) => drawPlatformNumber(x, w, hh, face));
      for (let d = -120; d <= 120; d += 40) {
        const dd = d + s * 10;
        if (!covered(dd) || dd < pl.a || dd > pl.b) continue;
        const m = mat(dd, o + s * 0.9, TOP + 3.55, rot);
        gb.add('hSigns', signQuad(r, 0.75, 0.75).translate(0, 0, 0.03).applyMatrix4(m));
        gb.add('paint', tint(boxGeo(0.8, 0.8, 0.05).applyMatrix4(m), 0.12, 0.2, 0.45));
      }
    }
    // Caution plates at the platform ends.
    const caution = sign(hk, 'caution', 256, 192, drawCaution);
    for (const e of [pl.a + 3, pl.b - 3]) gb.add('hSigns', signQuad(caution, 0.7, 0.52).translate(0, 0, 0.03).applyMatrix4(mat(e, o + s * 1.6, TOP + 1.5, rot)));
  }
  // Borivali: diamond boards on the columns (the photo's pillar "31"), facing both tracks.
  if (bo && pl.canopies.some((cn) => cn.kind === 'bo')) {
    const dia = sign(hk, 'diamond:' + h.key, 256, 256, (x, w, hh) => drawDiamond(x, w, hh, h.deva, h.name.toUpperCase()));
    const cn = pl.canopies.find((q) => q.kind === 'bo')!;
    const cols: number[] = [];
    for (let d = cn.a + 2; d <= cn.b - 1; d += 9) cols.push(d);
    cols.forEach((d, i) => {
      if (i % 3 !== 1 && i !== cols.length - 1) return;
      const n = 12 + i;
      const pr = sign(hk, 'pillar:' + n, 64, 48, (x, w, hh) => drawPillar(x, w, hh, n));
      for (const [face, s] of [
        [pl.faces[0], -1],
        [pl.faces[1], 1],
      ] as const) {
        if (face === null) continue;
        const rot = s < 0 ? -Math.PI / 2 : Math.PI / 2;
        const o = oc + s * 0.2;
        const q = signQuad(dia, 0.92, 0.92).rotateZ(Math.PI / 4).translate(0, 0, 0.06);
        gb.add('hSigns', q.applyMatrix4(mat(d, o, TOP + 2.35, rot)));
        gb.add('paint', tint(boxGeo(1.05, 1.5, 0.05).applyMatrix4(mat(d, o, TOP + 2.2, rot)), 0.42, 0.45, 0.44));
        gb.add('hSigns', signQuad(pr, 0.34, 0.26).translate(0, 0, 0.001).applyMatrix4(mat(d, o, TOP + 1.05, rot)));
      }
    });
  }
  // Benches, twin bins, a stall, a water cooler; the Dadar islands are too crowded for many benches.
  const stalls: [string, string, string, string][] = [
    ['#b3261e', '#fff4da', 'SHREE GANESH TEA', 'श्री गणेश चहा'],
    ['#1f5e3a', '#ffffff', 'JAI BHAVANI VADA PAV', 'जय भवानी वडापाव'],
    ['#233c8c', '#ffffff', 'NEWSPAPERS · BOOKS', 'वृत्तपत्रे · पुस्तके'],
  ];
  const width = pl.o1 - pl.o0;
  for (let d = pl.a + 12; d < pl.b - 10; d += bo ? 13 : 19) {
    if (blocked(d, oc, 3)) continue;
    const r = rng.next();
    if (r < 0.1 && width > 7.5) {
      const st = stalls[Math.floor(rng.next() * stalls.length)];
      const rect = sign(hk, 'stall:' + st[2], 256, 64, (x, w, hh) => drawStall(x, w, hh, st[0], st[1], st[2], st[3]));
      const m = mat(d, oc, TOP + 1.15);
      gb.add('paint', tint(boxGeo(1.9, 2.3, 3.2).applyMatrix4(m), 0.62, 0.64, 0.62));
      gb.add('paint', tint(boxGeo(2.3, 0.06, 3.6).applyMatrix4(mat(d, oc, TOP + 2.35)), 0.3, 0.35, 0.4));
      for (const s of [-1, 1]) {
        gb.add('hSigns', signQuad(rect, 2.8, 0.7).applyMatrix4(mat(d, oc + s * 0.97, TOP + 2.0, s * Math.PI / 2)));
        gb.add('paint', tint(boxGeo(0.4, 0.95, 2.6).applyMatrix4(mat(d, oc + s * 1.1, TOP + 0.5)), 0.72, 0.5, 0.3));
      }
      d += 6;
    } else if (r < 0.55) {
      for (const s of width > 7.5 ? [-1, 1] : [1]) {
        const o = oc + s * (width > 7.5 ? 1.1 : 0);
        gb.add('stainless', boxGeo(0.45, 0.06, 1.9).applyMatrix4(mat(d, o, TOP + 0.45)));
        gb.add('stainless', boxGeo(0.05, 0.42, 1.9).applyMatrix4(mat(d, o + s * 0.22, TOP + 0.68)));
        for (const k of [-0.8, 0.8]) gb.add('steel', boxGeo(0.4, 0.45, 0.05).applyMatrix4(mat(d + k, o, TOP + 0.22)));
      }
    } else if (r < 0.7) {
      for (const k of [-0.3, 0.3]) gb.add('stainless', new THREE.CylinderGeometry(0.2, 0.18, 0.75, 10).applyMatrix4(mat(d + k, oc + 1.3, TOP + 0.38)));
    } else if (r < 0.78) {
      const wr = sign(hk, 'water', 256, 64, (x, w, hh) => drawStall(x, w, hh, '#1f5aa6', '#ffffff', 'DRINKING WATER', 'पिण्याचे पाणी'));
      gb.add('stainless', boxGeo(0.7, 1.3, 1.1).applyMatrix4(mat(d, oc - 1.2, TOP + 0.65)));
      gb.add('hSigns', signQuad(wr, 0.9, 0.22).applyMatrix4(mat(d, oc - 1.56, TOP + 1.5, -Math.PI / 2)));
    }
  }
  // Lamp posts where there is no canopy (every 18 m, as in the light map).
  for (let d = pl.a + 4; d < pl.b - 3; d += 9) {
    if (covered(d) || Math.round(d / 9) % 2 !== 0 || blocked(d, oc, 1)) continue;
    gb.add('steel', rodGeo(P(d, oc, TOP), P(d, oc, TOP + 5.2), 0.07, 8));
    gb.add('steel', beam(P(d, oc, TOP + 5.1), P(d, oc - 0.9, TOP + 5.25), 0.06, 0.06));
    gb.add('lampTube', boxGeo(0.25, 0.08, 0.6).applyMatrix4(mat(d, oc - 0.9, TOP + 5.18)));
  }
  if (cr) {
    // Beyond the fence, the Central Railway's island.
    const r = sign(hk, 'cr', 640, 128, (x, w, hh) => drawDirectionSign(x, w, hh, { mr: 'मध्य रेल्वे', en: 'CENTRAL RAILWAY' }, 'none', '#1d4f9c', 9));
    for (const d of [-90, 0, 90]) gb.add('hSigns', signQuad(r, 3.2, 0.64).translate(0, 0, 0.03).applyMatrix4(mat(d, pl.o0 + 1.0, TOP + 3.2, -Math.PI / 2)));
  }
}

/** Fences between tracks, buffer stops at the sidings' ends. */
function buildTrackside(c: Ctx3, rail: Railway, plats: Plat[]): void {
  const { gb, P, mat, h } = c;
  const bo = h.key === 'BO';
  const fence = (o: number, a: number, b: number, height: number, col: RGB, bars: number) => {
    const ds = samples(a, b, 2.4);
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      gb.add('paint', tint(boxGeo(0.08, height, 0.08).applyMatrix4(mat(d, o, -0.2 + height / 2)), col[0] * 0.8, col[1] * 0.8, col[2] * 0.8));
      if (i === 0) continue;
      const d0 = ds[i - 1];
      for (const y of [0.15, height * 0.55, height - 0.05]) gb.add('paint', tint(beam(P(d0, o, -0.2 + y), P(d, o, -0.2 + y), 0.05, 0.05), col[0], col[1], col[2]));
      for (let k = 1; k < bars; k++) {
        const dd = d0 + ((d - d0) * k) / bars;
        gb.add('paint', tint(boxGeo(0.025, height - 0.2, 0.025).applyMatrix4(mat(dd, o, -0.2 + height / 2)), col[0], col[1], col[2]));
      }
    }
  };
  if (bo) {
    // Red fences between the fast lines and between PF 1–2's roads (Borivali_platformboard.jpg).
    fence(-LINE_HALF(rail, h, 0, 1), -175, 175, 1.25, [0.55, 0.17, 0.1], 5);
    fence(-LINE_HALF(rail, h, 2, 3), -160, 160, 1.25, [0.55, 0.17, 0.1], 5);
  } else {
    // The fence between the Western and Central Railway.
    const o = (rail.lineOffset(5, h.d)! + rail.lineOffset(6, h.d)!) / 2;
    fence(o, -260, 260, 2.1, [0.35, 0.37, 0.36], 8);
    fence(-LINE_HALF(rail, h, 0, 1), -170, 170, 1.1, [0.4, 0.42, 0.4], 4);
  }
  // Buffer stops where the sidings end.
  for (const [id, x] of Object.entries(h.extra)) {
    if (x.kind !== 'siding') continue;
    for (const s of [-1, 1]) {
      const rd = s * (h.half + 329);
      const o = rail.lineOffset(Number(id), h.d + rd - s * 1);
      if (o === null) continue;
      const m = mat(rd, o, 0.9);
      gb.add('paint', tint(boxGeo(2.4, 0.5, 0.4).applyMatrix4(m), 0.75, 0.12, 0.08));
      for (const k of [-0.85, 0.85]) gb.add('paint', tint(boxGeo(0.25, 1.3, 0.25).applyMatrix4(mat(rd, o + k, 0.45)), 0.1, 0.1, 0.1));
      gb.add('paint', tint(boxGeo(0.25, 0.25, 2.2).applyMatrix4(mat(rd - s * 1.0, o, 0.25)), 0.1, 0.1, 0.1));
    }
  }
  void plats;
}

const LINE_HALF = (rail: Railway, h: Halt, a: number, b: number) => -(rail.lineOffset(a, h.d)! + rail.lineOffset(b, h.d)!) / 2;

/** Borivali's own marks: the name board over the canopy, the exit-end board, the pier. */
function borivaliMarks(c: Ctx3, plats: Plat[]): void {
  const { gb, mat, hk, h } = c;
  const main = plats.find((p) => p.main)!;
  const oc = (main.o0 + main.o1) / 2;
  const cn = main.canopies[0];
  const fascia = sign(hk, 'fascia', 1024, 160, (x, w, hh) => drawFascia(x, w, hh, h.deva, h.name.toUpperCase()));
  const W = main.o1 - main.o0 + 0.4;
  // Leaning back a little over the canopy's north end, facing the trains from Mira Road.
  const m = mat(cn.a - 0.2, oc, 5.95, Math.PI).multiply(new THREE.Matrix4().makeRotationX(-0.16));
  gb.add('hSigns', signQuad(fascia, W, W * (160 / 1024) * 1.25).translate(0, 0, 0.04).applyMatrix4(m));
  gb.add('corr', tint(boxGeo(W + 0.1, W * (160 / 1024) * 1.25 + 0.1, 0.05).applyMatrix4(m), 0.55, 0.42, 0.28));
  for (const s of [-1, 1]) gb.add('steel', beam(c.P(cn.a - 0.2, oc + s * (W / 2 - 0.5), 5.1), c.P(cn.a + 1.2, oc + s * (W / 2 - 0.5), 6.6), 0.1, 0.1));
  // The same board over the north end of PF 3/4's canopy.
  const west = plats[1];
  const ow = (west.o0 + west.o1) / 2;
  const Ww = west.o1 - west.o0;
  const m2 = mat(west.canopies[0].a - 0.2, ow, 5.95, Math.PI).multiply(new THREE.Matrix4().makeRotationX(-0.16));
  gb.add('hSigns', signQuad(fascia, Ww, Ww * (160 / 1024) * 1.25).translate(0, 0, 0.04).applyMatrix4(m2));
  gb.add('corr', tint(boxGeo(Ww + 0.1, Ww * (160 / 1024) * 1.25 + 0.1, 0.05).applyMatrix4(m2), 0.55, 0.42, 0.28));
  // The exit end: yellow board on white posts facing along the platform, the new deck's pier.
  const yellow = sign(hk, 'yellow:' + h.key, 512, 256, (x, w, hh) => drawYellow(x, w, hh, h.deva, h.name.toUpperCase()));
  for (const [rd, o] of [
    [137, main.o0 + 2.8],
    [128, main.o1 - 2.6],
  ] as const) {
    const mb = mat(rd, o, TOP + 2.25, Math.PI);
    gb.add('hSigns', signQuad(yellow, 2.2, 1.1).translate(0, 0, 0.04).applyMatrix4(mb));
    gb.add('hSigns', signQuad(yellow, 2.2, 1.1).translate(0, 0, 0.04).applyMatrix4(mat(rd, o, TOP + 2.25)));
    gb.add('paint', tint(boxGeo(2.3, 1.2, 0.06).applyMatrix4(mb), 0.2, 0.2, 0.2));
    for (const k of [-0.95, 0.95]) gb.add('whiteEnamel', rodGeo(c.P(rd, o + k, TOP), c.P(rd, o + k, TOP + 2.85), 0.06, 8));
  }
  gb.add('concrete', boxGeo(2.1, 9.6, 2.1).applyMatrix4(mat(145, oc + 1.2, TOP + 4.8)));
  gb.add('concrete', boxGeo(4.6, 1.5, 3.2).applyMatrix4(mat(145, oc + 1.2, TOP + 10.3)));
  gb.add('paint', tint(boxGeo(2.4, 0.3, 2.4).applyMatrix4(mat(145, oc + 1.2, TOP + 0.15)), 0.55, 0.53, 0.5));
}

/** Dadar's own marks: Tilak Bridge is built with the corridor; the flower market on the west side. */
function dadarMarks(c: Ctx3, rail: Railway, plats: Plat[]): void {
  const { gb, P, mat, rng, h } = c;
  const west = rail.bounds(h.d)[0];
  // Flower market stalls beyond the west wall ⚠ (placed from general knowledge).
  for (let d = -150; d < 90; d += rng.range(3.2, 4.4)) {
    for (const row of [0, 1]) {
      const o = west - 5 - row * 7;
      const m = mat(d, o, -0.3);
      const tarp: RGB = rng.pick([
        [0.15, 0.3, 0.75],
        [0.85, 0.45, 0.12],
        [0.9, 0.9, 0.85],
        [0.2, 0.55, 0.3],
      ] as RGB[]);
      gb.add('tarp', tint(boxGeo(3.4, 0.04, 3.4).applyMatrix4(mat(d, o, 2.3)), tarp[0], tarp[1], tarp[2]));
      for (const k of [-1.5, 1.5]) for (const q of [-1.5, 1.5]) gb.add('paint', tint(boxGeo(0.06, 2.6, 0.06).applyMatrix4(mat(d + k, o + q, 1.0)), 0.45, 0.35, 0.2));
      gb.add('paint', tint(boxGeo(2.6, 0.6, 2.6).applyMatrix4(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.6, 0))), 0.45, 0.33, 0.22));
      // Heaps of marigold and chrysanthemum.
      for (let k = 0; k < 4; k++) {
        const col: RGB = rng.pick([
          [0.98, 0.55, 0.05],
          [0.98, 0.78, 0.1],
          [0.95, 0.95, 0.9],
          [0.85, 0.15, 0.2],
        ] as RGB[]);
        const p = P(d + rng.range(-1, 1), o + rng.range(-1, 1), 1.15);
        gb.add('paint', tint(new THREE.SphereGeometry(rng.range(0.3, 0.5), 7, 5).scale(1, 0.55, 1).translate(p.x, p.y, p.z), col[0], col[1], col[2]));
      }
    }
  }
  void plats;
}

/** Tall towers round Borivali; old blocks and a few towers round Dadar. */
function surroundings(c: Ctx3, rail: Railway, plats: Plat[]): THREE.Group {
  const { P, rng, h } = c;
  const batch = new BuildingBatch();
  const bo = h.key === 'BO';
  const rect = (rd: number, o: number, along: number, across: number): number[] => {
    const pts = [P(rd - along / 2, o - across / 2, 0), P(rd - along / 2, o + across / 2, 0), P(rd + along / 2, o + across / 2, 0), P(rd + along / 2, o - across / 2, 0)];
    const fp = pts.flatMap((p) => [p.x, p.z]);
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      area += fp[i * 2] * fp[j * 2 + 1] - fp[j * 2] * fp[i * 2 + 1];
    }
    if (area > 0) {
      const r: number[] = [];
      for (let i = 3; i >= 0; i--) r.push(fp[i * 2], fp[i * 2 + 1]);
      return r;
    }
    return fp;
  };
  const TINTS: RGB[] = [
    [1, 0.97, 0.9],
    [0.95, 0.93, 0.88],
    [0.88, 0.9, 0.93],
    [0.98, 0.88, 0.8],
    [1, 0.95, 0.78],
  ];
  const [L, R] = rail.bounds(h.d);
  const add = (rd: number, o: number, along: number, across: number, floors: number, style: number) =>
    batch.add({ fp: rect(rd, o, along, across), height: floors * 3.1 + 1.2, floorH: 3.1, groundH: 4, style, groundStyle: floors > 14 ? style : FACADE.shop, tint: rng.pick(TINTS), seed: rng.range(0, 100), chajjas: floors < 12, parapet: 1, detail: floors > 14 ? 0 : 1, baseY: -0.55 });
  if (bo) {
    // Borivali's high-rises stand close to the station on both sides (the entrance photo).
    for (const [rd, side, dist, fl] of [
      [-60, 1, 34, 24],
      [40, 1, 44, 31],
      [150, 1, 30, 19],
      [-190, -1, 38, 22],
      [-20, -1, 58, 28],
      [120, -1, 42, 17],
      [260, 1, 60, 26],
      [-300, 1, 50, 21],
    ] as const)
      add(rd, side > 0 ? R + dist : L - dist, rng.range(22, 30), rng.range(18, 24), fl, rng.pick([FACADE.grille, FACADE.glass, FACADE.grille]));
  } else {
    for (let rd = -300; rd < 300; rd += rng.range(22, 34)) {
      for (const side of [-1, 1]) {
        if (side < 0 && rd > -170 && rd < 110) continue; // the flower market
        const o = side > 0 ? R + rng.range(10, 16) : L - rng.range(26, 32);
        add(rd, o, rng.range(16, 24), rng.range(12, 18), rng.int(4, 7), rng.pick([FACADE.deco, FACADE.chawl, FACADE.decoBalcony, FACADE.grille]));
      }
    }
    for (const [rd, side, dist, fl] of [
      [-120, 1, 70, 22],
      [80, -1, 90, 30],
      [200, 1, 110, 26],
    ] as const)
      add(rd, side > 0 ? R + dist : L - dist, 26, 22, fl, FACADE.glass);
  }
  const g = new THREE.Group();
  if (!batch.empty) {
    const walls = batch.buildWalls(c.kit.facade);
    walls.castShadow = true;
    g.add(walls);
    g.add(batch.details.build(c.kit.m as Record<string, THREE.Material>, { castShadow: false }));
  }
  void plats;
  return g;
}
