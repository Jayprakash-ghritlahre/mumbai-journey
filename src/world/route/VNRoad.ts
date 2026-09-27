import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { GeoBuilder } from '../../gfx/GeoBuilder';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import type { CollisionWorld } from '../../core/Collision';
import type { TextureFactory } from '../../gfx/TextureFactory';
import type { InstanceCuller } from '../../gfx/InstanceCuller';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { type SignAtlas, type AtlasRect, signQuad, fillFitted, fitFont, LATIN, DEVA } from '../../gfx/Signage';
import type { Ctx } from '../../gfx/TextureFactory';
import type { GeoBuilding } from '../city/City';
import { flatPolygon, pathStrip, pathWall } from './Path2';
import { H, IMC, MD, VN } from './RouteLayout';
import { footpathPavers, kerbBlackWhite } from './RouteTextures';
import { Kit, C, bollard, feederPillar, heritageLamp, planter, postBox, twinArmLamp, type PropGeo } from './Props';
import { at, instanceProps } from './MarineDrive';
import type { WalkSurface } from './WalkSurface';
import type { VehicleKind } from '../../entities/traffic/VehicleGeometry';
import type { TreeSpot } from '../city/Trees';

export interface VNResult {
  group: THREE.Group;
  cullers: InstanceCuller[];
  parked: { x: number; z: number; heading: number; kind: VehicleKind }[];
  trees: TreeSpot[];
  busStop: { x: number; z: number; ry: number };
  /** Kerb-side positions for idle people (bus stop queue, shop doors). */
  loiter: { x: number; z: number; ry: number; kind: 'queue' | 'shop' | 'vendor' }[];
  /** Street-light heads (for the night glow sprites). */
  lampHeads: THREE.Vector3[];
}

interface ShopStyle {
  en: string;
  deva: string;
  sub?: string;
  bg: string;
  fg: string;
  accent?: string;
  font: 'serif' | 'sans' | 'script' | 'neon';
  awning?: [number, number, number];
}

// Fictional businesses in the visual idiom of V.N. Road's restaurants and shops.
const SHOPS: ShopStyle[] = [
  { en: 'Café Madhuban', deva: 'कॅफे मधुबन', sub: 'Irani Restaurant · Estd. 1938', bg: '#5a1e1b', fg: '#f3e2c0', font: 'serif', awning: [0.45, 0.12, 0.1] },
  { en: 'CASA NOPAL', deva: 'कासा नोपाल', sub: 'cantina y tequila bar', bg: '#0f6f6a', fg: '#ff8fc7', accent: '#c8f04a', font: 'script' },
  { en: 'HIRA SAGAR', deva: 'हिरा सागर', sub: 'Pure Veg · South Indian', bg: '#161214', fg: '#ff4fb4', accent: '#4fd8ff', font: 'neon' },
  { en: 'LOTUS MOBILE', deva: 'लोटस मोबाईल', sub: '5G · Recharge · Accessories', bg: '#d71a3c', fg: '#ffffff', font: 'sans' },
  { en: 'BHARAT CO-OP BANK', deva: 'भारत सहकारी बँक', bg: '#123f86', fg: '#ffffff', accent: '#f2c230', font: 'sans' },
  { en: 'NEW ERA CHEMIST', deva: 'न्यू एरा केमिस्ट', sub: 'Open 24 hrs', bg: '#1d7a3c', fg: '#ffffff', font: 'sans', awning: [0.12, 0.4, 0.2] },
  { en: 'GULMOHAR BOOKS', deva: 'गुलमोहर बुक्स', sub: 'Since 1952', bg: '#1f3b2d', fg: '#efd9a8', font: 'serif' },
  { en: 'KOHINOOR BAR', deva: 'कोहिनूर बार', sub: '& Restaurant', bg: '#3b2413', fg: '#f2c46b', font: 'serif', awning: [0.35, 0.2, 0.08] },
  { en: 'SEA BREEZE CAFÉ', deva: 'सी ब्रीझ कॅफे', bg: '#f1ece0', fg: '#1a4a7a', accent: '#e8590c', font: 'script', awning: [0.1, 0.3, 0.55] },
  { en: 'SAHYADRI TRAVELS', deva: 'सह्याद्री ट्रॅव्हल्स', sub: 'Air · Rail · Bus', bg: '#f2c230', fg: '#1a1a1a', font: 'sans' },
  { en: 'ELITE TAILORS', deva: 'एलिट टेलर्स', bg: '#2b2b2b', fg: '#e8e2d0', font: 'serif' },
  { en: 'SHRINATH SWEETS', deva: 'श्रीनाथ मिठाई', sub: 'Farsan · Namkeen', bg: '#e65100', fg: '#fff6e0', font: 'sans', awning: [0.8, 0.35, 0.05] },
];

/** Shop boards are drawn at 7:1.5 (the quad keeps this aspect). */
const SHOP_W = 672;
const SHOP_H = 144;

/**
 * A shop board: the English name with the Marathi name beside it when both fit at a good size,
 * otherwise the two stacked (as Maharashtra's signage rules have most boards). Every line is
 * measured and fitted, so no text runs into another.
 */
function drawShop(c: Ctx, w: number, h: number, s: ShopStyle): void {
  c.fillStyle = s.bg;
  c.fillRect(0, 0, w, h);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.25)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  if (s.accent) {
    c.fillStyle = s.accent;
    c.fillRect(0, h - h * 0.08, w, h * 0.08);
  }
  const family = s.font === 'serif' ? 'Georgia, serif' : LATIN;
  const weight = s.font === 'script' ? 'italic 700' : '800';
  const pad = h * 0.22;
  const inner = w - pad * 2;
  const devaFg = s.font === 'neon' ? (s.accent ?? s.fg) : s.fg;
  c.textBaseline = 'middle';
  const glow = () => {
    if (s.font !== 'neon') return;
    c.shadowColor = s.fg;
    c.shadowBlur = h * 0.12;
  };
  // Natural widths at full size decide the layout.
  c.font = `${weight} ${h * 0.42}px ${family}`;
  const enW = c.measureText(s.en).width;
  c.font = `700 ${h * 0.34}px ${DEVA}`;
  const devaW = c.measureText(s.deva).width;
  const gap = h * 0.35;
  if (enW + devaW + gap <= inner * 1.12) {
    // Side by side, both scaled down together if needed.
    const k = Math.min(1, (inner - gap) / (enW + devaW));
    const enPx = h * 0.42 * k;
    c.fillStyle = s.fg;
    c.textAlign = 'left';
    c.font = `${weight} ${enPx}px ${family}`;
    glow();
    c.fillText(s.en, pad, s.sub ? h * 0.38 : h * 0.5);
    c.shadowBlur = 0;
    if (s.sub) {
      c.globalAlpha = 0.9;
      const subPx = fitFont(c, s.sub, '600', LATIN, h * 0.17, enW * k);
      c.font = `600 ${subPx}px ${LATIN}`;
      c.fillText(s.sub, pad, h * 0.75);
      c.globalAlpha = 1;
    }
    c.textAlign = 'right';
    c.fillStyle = devaFg;
    c.font = `700 ${h * 0.34 * k}px ${DEVA}`;
    c.fillText(s.deva, w - pad, h * 0.5);
    return;
  }
  // Stacked: English on top, Marathi below (with the small print beside it when there is room).
  c.textAlign = 'center';
  c.fillStyle = s.fg;
  const enPx = fitFont(c, s.en, weight, family, h * 0.4, inner);
  c.font = `${weight} ${enPx}px ${family}`;
  glow();
  c.fillText(s.en, w / 2, h * 0.32);
  c.shadowBlur = 0;
  c.fillStyle = devaFg;
  let devaPx = fitFont(c, s.deva, '700', DEVA, h * 0.29, inner);
  if (s.sub) {
    c.font = `600 ${h * 0.15}px ${LATIN}`;
    const subW = c.measureText(s.sub).width;
    c.font = `700 ${devaPx}px ${DEVA}`;
    const dW = c.measureText(s.deva).width;
    if (dW + subW + gap <= inner) {
      c.textAlign = 'left';
      c.fillText(s.deva, pad, h * 0.73);
      c.textAlign = 'right';
      c.globalAlpha = 0.9;
      c.fillStyle = s.fg;
      c.font = `600 ${h * 0.15}px ${LATIN}`;
      c.fillText(s.sub, w - pad, h * 0.74);
      c.globalAlpha = 1;
      return;
    }
    devaPx = Math.min(devaPx, h * 0.27);
  }
  c.font = `700 ${devaPx}px ${DEVA}`;
  c.fillText(s.deva, w / 2, h * 0.73);
}

function drawNamePlate(c: Ctx, w: number, h: number, name: string): void {
  c.fillStyle = '#e4dcc7';
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(0,0,0,0.25)';
  const text = name.toUpperCase();
  c.font = `700 ${fitFont(c, text, '700', 'Georgia, serif', h * 0.62, w - h * 0.6)}px Georgia, serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, w / 2 + 3, h * 0.56 + 3);
  c.fillStyle = '#3a2a1c';
  c.fillText(text, w / 2, h * 0.56);
}

function drawBestSign(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#6b1e7a';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#d1265e';
  c.beginPath();
  c.roundRect(w * 0.12, h * 0.1, w * 0.76, h * 0.42, h * 0.08);
  c.fill();
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `800 ${h * 0.3}px ${DEVA}`;
  c.fillText('बेस्ट', w / 2, h * 0.32);
  fillFitted(c, 'अहिल्याबाई होळकर चौक', w / 2, h * 0.64, '700', DEVA, h * 0.085, w * 0.9);
  fillFitted(c, 'AHILYABAI HOLKAR CHOWK', w / 2, h * 0.78, '700', LATIN, h * 0.075, w * 0.9);
  fillFitted(c, '70 · 106 · 123 · 138', w / 2, h * 0.9, '600', LATIN, h * 0.06, w * 0.9);
}

function drawBmcNet(c: Ctx, w: number, h: number): void {
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgba(18,120,70,0.92)';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(0,40,20,0.5)';
  c.lineWidth = 2;
  for (let x = 0; x < w; x += 8) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }
  for (let y = 0; y < h; y += 8) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
  c.fillStyle = 'rgba(210,235,120,0.95)';
  c.textAlign = 'left';
  fillFitted(c, 'बृहन्मुंबई महानगरपालिका', w * 0.05, h * 0.3, '800', DEVA, h * 0.12, w * 0.9);
  fillFitted(c, 'ROAD & TRAFFIC', w * 0.05, h * 0.55, '800', LATIN, h * 0.13, w * 0.9);
  fillFitted(c, 'inconvenience regretted', w * 0.05, h * 0.75, 'italic 700', LATIN, h * 0.11, w * 0.9);
}

/** Bus shelter (the sign face goes in the atlas). */
function busShelter(): PropGeo {
  const k = new Kit();
  const L = 6.4;
  for (const x of [-L / 2 + 0.2, 0, L / 2 - 0.2]) k.box('metal', 0.1, 2.6, 0.1, x, 1.3, -0.7, C.steel);
  for (const x of [-L / 2 + 0.2, L / 2 - 0.2]) k.box('metal', 0.08, 2.4, 0.08, x, 1.2, 0.55, C.steel);
  k.box('paint', L, 0.12, 1.9, 0, 2.66, -0.1, [0.42, 0.1, 0.5], 0, 0.06);
  k.box('glow', L - 0.4, 0.02, 0.3, 0, 2.58, -0.1, [1, 1, 1]);
  k.box('metal', L - 0.6, 0.05, 0.42, 0, 0.5, -0.45, C.steel);
  k.box('paint', L - 0.4, 1.2, 0.03, 0, 1.3, -0.74, [0.28, 0.3, 0.32]);
  return k.build();
}

/** White balustrade compound wall segment of length L (1 m units). */
function balustrade(L: number): PropGeo {
  const k = new Kit();
  k.box('paint', L, 0.45, 0.3, 0, 0.225, 0, C.white);
  k.box('paint', L + 0.1, 0.09, 0.36, 0, 1.12, 0, C.white);
  for (let x = -L / 2 + 0.2; x < L / 2 - 0.1; x += 0.32) {
    k.cyl('paint', 0.07, 0.07, 0.62, x, 0.45, 0, C.white, 8);
    k.sphere('paint', 0.085, x, 0.76, 0, C.white, 1, 1.3, 1, 8);
  }
  for (const x of [-L / 2, L / 2]) k.box('paint', 0.4, 1.35, 0.4, x, 0.675, 0, C.white);
  return k.build();
}

/** Low wall with a black wrought-iron railing. */
function railingWall(L: number): PropGeo {
  const k = new Kit();
  k.box('paint', L, 0.6, 0.28, 0, 0.3, 0, [0.78, 0.74, 0.66]);
  k.box('metal', L, 0.04, 0.04, 0, 1.55, 0, C.black);
  k.box('metal', L, 0.04, 0.04, 0, 0.72, 0, C.black);
  for (let x = -L / 2 + 0.06; x < L / 2; x += 0.14) {
    k.box('metal', 0.022, 0.95, 0.022, x, 1.12, 0, C.black);
    k.sphere('metal', 0.03, x, 1.62, 0, C.black, 1, 2, 1, 5);
  }
  for (const x of [-L / 2, L / 2]) k.box('paint', 0.35, 1.8, 0.35, x, 0.9, 0, [0.8, 0.76, 0.68]);
  return k.build();
}

/** Bougainvillea spilling over a wall: magenta-flowered leaf cards. */
function bougainvillea(L: number, seed: number): PropGeo {
  const k = new Kit();
  const rng = new RNG(seed);
  for (let i = 0; i < L * 2; i++) {
    const g = new THREE.PlaneGeometry(rng.range(0.6, 1.1), rng.range(0.5, 0.9));
    g.rotateY(rng.range(-0.5, 0.5));
    g.rotateX(rng.range(-0.3, 0.3));
    const col: [number, number, number] = rng.chance(0.5) ? [1.6, 0.3, 1.0] : [0.7, 0.85, 0.6];
    k.add('leaf', g.translate(rng.range(-L / 2, L / 2), rng.range(1.3, 2.1), rng.range(0.05, 0.35)), col);
  }
  return k.build();
}

/** Scooter (parked outside the restaurants). */
function scooter(color: [number, number, number]): PropGeo {
  const k = new Kit();
  k.box('paint', 0.34, 0.42, 1.25, 0, 0.5, 0, color);
  k.box('paint', 0.3, 0.5, 0.18, 0, 0.9, 0.5, color);
  k.box('paint', 0.3, 0.12, 0.6, 0, 0.78, -0.2, C.black);
  for (const z of [0.55, -0.48]) {
    const w = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12);
    w.rotateZ(Math.PI / 2);
    k.add('paint', w.translate(0, 0.22, z), C.black);
  }
  k.box('metal', 0.6, 0.04, 0.04, 0, 1.18, 0.5, C.steel);
  return k.build();
}

export function buildVNRoad(tf: TextureFactory, mats: StationMaterials, atlas: SignAtlas, col: CollisionWorld, av: AmbientVolume, walk: WalkSurface, buildings: GeoBuilding[], heights: Map<number, number>): VNResult {
  const group = new THREE.Group();
  group.name = 'vn-road';
  const cullers: InstanceCuller[] = [];
  const rng = new RNG(1936);
  const a = VN.axis;
  const md = MD.axis;
  const M = mats.m;
  const gb = new GeoBuilder();
  const sW = VN.sWest;
  const sE = VN.sEast;

  const fp = footpathPavers(tf);
  const fpMap = fp.map.clone();
  fpMap.repeat.set(1 / 2, 1 / 2);
  const fpN = fp.normalMap!.clone();
  fpN.repeat.set(1 / 2, 1 / 2);
  mats.add('vnFootpath', new THREE.MeshStandardMaterial({ map: fpMap, normalMap: fpN, roughness: 0.9 }), 0.45);
  if (!M.mdKerb) mats.add('mdKerb', new THREE.MeshStandardMaterial({ map: kerbBlackWhite(tf).map.clone(), roughness: 0.8 }));

  // ---- Carriageways -------------------------------------------------------------------------
  gb.add('asphalt', pathStrip(a, sW - 4, sE + 8, -VN.kerb, VN.kerb, H.road + 0.002, 2));
  const sMedW = sW + 12;
  gb.add('grass', pathStrip(a, sMedW, sE + 30, -VN.median, VN.median, H.median, 2));
  gb.add('mdKerb', pathWall(a, sMedW, sE + 30, VN.median, H.road, H.median, 1, 2));
  gb.add('mdKerb', pathWall(a, sMedW, sE + 30, -VN.median, H.road, H.median, -1, 2));
  walk.strip(a, sMedW, sE + 30, -VN.median, VN.median, H.median);
  {
    const [x, z] = a.point(sMedW, 0);
    const nose = new THREE.CylinderGeometry(VN.median, VN.median, H.median, 12, 1, false, 0, Math.PI);
    nose.rotateY(a.heading(sMedW) + Math.PI / 2 + Math.PI);
    gb.add('mdKerb', nose.translate(x, H.median / 2, z));
  }
  const lane = (VN.carriage - VN.median) / 3;
  for (const side of [-1, 1]) {
    for (let k = 1; k < 3; k++) {
      const o = side * (VN.median + lane * k);
      for (let s = sW + 14; s < sE; s += 8) gb.add('marking', pathStrip(a, s, Math.min(sE, s + 3), o - 0.06, o + 0.06, H.road + 0.008, 3));
    }
    const po = side * VN.carriage;
    gb.add('marking', pathStrip(a, sW + 10, sE, po - 0.06, po + 0.06, H.road + 0.008, 4));
  }
  // Stop line for westbound traffic approaching Marine Drive (south carriageway).
  gb.add('marking', pathStrip(a, sW + 6.0, sW + 6.4, -VN.carriage, -VN.median, H.road + 0.009, 1));

  // ---- Corner blocks (footpaths wrapping onto Marine Drive) ------------------------------------
  const kerbFace = (kp: [number, number][]) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let u = 0;
    kp.forEach(([x, z], i) => {
      if (i > 0) u += Math.hypot(x - kp[i - 1][0], z - kp[i - 1][1]);
      pos.push(x, H.road, z, x, H.footpath, z);
      uv.push(u, 0, u, 0.15);
      if (i > 0) {
        const k = (i - 1) * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    });
    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    kg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    kg.setIndex(idx);
    kg.computeVertexNormals();
    gb.add('mdKerb', kg);
  };
  (M.mdKerb as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  /** A raised footpath: kerb line (gets a kerb face) followed by the back boundary. */
  const footpath = (kerb: [number, number][], back: [number, number][]) => {
    const poly = [...kerb, ...back];
    gb.add('vnFootpath', flatPolygon(poly, H.footpath));
    walk.polygon(poly, H.footpath);
    kerbFace(kerb);
  };
  /** Quadratic Bézier from p0 to p1 with control c (inner points only). */
  const bezier = (p0: [number, number], c: [number, number], p1: [number, number], out: [number, number][], n = 8) => {
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
    }
  };
  const block = (side: 1 | -1) => {
    // Kerb corner = intersection of V.N. kerb line and Marine Drive east kerb line.
    const sCorner = a.intersectOffsetAt(side * VN.kerb, md, MD.kerb, 0, 80) ?? sW;
    const R = 5;
    const kerbPts: [number, number][] = [];
    // Along Marine Drive's kerb towards the corner (north block: from the north; south block: from the south).
    const [cx, cz] = a.point(sCorner, side * VN.kerb);
    const cp = md.project(cx, cz);
    const mdFar = side > 0 ? cp.s - 60 : cp.s + 60;
    const mdNear = side > 0 ? cp.s - R : cp.s + R;
    const n = 20;
    for (let i = 0; i <= n; i++) kerbPts.push(md.point(mdFar + ((mdNear - mdFar) * i) / n, MD.kerb));
    // Rounded corner (quadratic Bézier with the corner as control point).
    bezier(md.point(mdNear, MD.kerb), [cx, cz], a.point(sCorner + R, side * VN.kerb), kerbPts);
    // Back boundary on Marine Drive: its frontage line.
    const cornerOuter = a.point(sCorner + 8, side * VN.frontage);
    const mdOuterStart = md.project(cornerOuter[0], cornerOuter[1]).s;
    const oOut = Math.max(MD.eastFoot + 3, md.project(cornerOuter[0], cornerOuter[1]).o);
    const mdBack: [number, number][] = [];
    for (let i = 0; i <= n; i++) mdBack.push(md.point(mdOuterStart + ((mdFar - mdOuterStart) * i) / n, oOut));
    const vnBack = (s0: number, s1: number) => {
      const out: [number, number][] = [];
      for (let s = s0; s > s1; s -= 4) out.push(a.point(s, side * VN.frontage));
      out.push(a.point(s1, side * VN.frontage));
      return out;
    };
    if (side < 0) {
      for (let s = sCorner + R; s < sE; s += 4) kerbPts.push(a.point(s, -VN.kerb));
      kerbPts.push(a.point(sE, -VN.kerb));
      footpath(kerbPts, [...vnBack(sE, sCorner + 8), ...mdBack]);
      return { sCorner };
    }
    // North side: IMC Road's mouth splits the footpath, with rounded kerb returns into it.
    const imc = IMC.axis;
    const [w, e] = IMC.edges;
    const RM = 3.2;
    for (let s = sCorner + R; s < w.sKerb - RM; s += 4) kerbPts.push(a.point(s, VN.kerb));
    const kW = a.point(w.sKerb - RM, VN.kerb);
    const flareW: [number, number][] = [];
    bezier(kW, imc.point(w.tKerb, w.off), imc.point(w.tKerb - RM, w.off), flareW);
    kerbPts.push(kW, ...flareW);
    const edgeW: [number, number][] = [];
    for (let t = w.tKerb - RM; t > w.tFront; t -= 2) edgeW.push(imc.point(t, w.off));
    edgeW.push(imc.point(w.tFront, w.off));
    footpath([...kerbPts, ...edgeW], [...vnBack(w.sFront - 1, sCorner + 8), ...mdBack]);
    const edgeE: [number, number][] = [];
    for (let t = e.tFront; t < e.tKerb - RM; t += 2) edgeE.push(imc.point(t, e.off));
    edgeE.push(imc.point(e.tKerb - RM, e.off));
    const kE = a.point(e.sKerb + RM, VN.kerb);
    const flareE: [number, number][] = [];
    bezier(edgeE[edgeE.length - 1], imc.point(e.tKerb, e.off), kE, flareE);
    const kerbE: [number, number][] = [...edgeE, ...flareE, kE];
    for (let s = e.sKerb + RM + 4; s < sE; s += 4) kerbE.push(a.point(s, VN.kerb));
    kerbE.push(a.point(sE, VN.kerb));
    footpath(kerbE, vnBack(sE, e.sFront + 1));
    // Road surface through the mouth, out to where the city's IMC Road carriageway takes over.
    const tW = imc.intersectOffsetAt(w.off, a, VN.frontage + 7) ?? 0;
    const tE = imc.intersectOffsetAt(e.off, a, VN.frontage + 7) ?? 0;
    const mouth: [number, number][] = [kW, ...flareW];
    for (let t = w.tKerb - RM; t > tW; t -= 2) mouth.push(imc.point(t, w.off));
    mouth.push(imc.point(tW, w.off), imc.point(tE, e.off));
    for (let t = tE + 2; t < e.tKerb - RM; t += 2) mouth.push(imc.point(t, e.off));
    mouth.push(edgeE[edgeE.length - 1], ...flareE, kE);
    gb.add('asphalt', flatPolygon(mouth, H.road + 0.002));
    return { sCorner };
  };
  const ne = block(1);
  const se = block(-1);
  /** Keeps kerbside furniture out of IMC Road's mouth. */
  const clearOfImc = (s: number, o: number, margin = 2.5) => o < 0 || !IMC.inMouth(s, o, margin);

  // ---- Street furniture along the north footpath ------------------------------------------------
  const sAtX = (x: number, z: number) => a.project(x, z).s;
  const lamps: THREE.Matrix4[] = [];
  const planters: THREE.Matrix4[] = [];
  const bollards: THREE.Matrix4[] = [];
  const treeSpots: TreeSpot[] = [];
  const loiter: VNResult['loiter'] = [];
  const hVN = (s: number) => a.heading(s);
  // Heritage lamps along both kerbs.
  for (const side of [1, -1]) {
    for (let s = ne.sCorner + 10; s < sE - 4; s += 22) {
      if (!clearOfImc(s, side * (VN.kerb + 0.55), 3)) continue;
      const [x, z] = a.point(s + (side < 0 ? 11 : 0), side * (VN.kerb + 0.55));
      lamps.push(at(x, H.footpath, z, hVN(s)));
      col.addSolid(x, z, 0.2, 0.2, 0, -1, 5);
      av.light(x, z, 11, 0.4);
    }
  }
  // Tall twin-arm street lights down the median: the heritage posts light the footpaths, these the
  // carriageways (as along Marine Drive; spacing is an estimate, see CHURCHGATE_TO_MARINE_DRIVE.md).
  const medLamps: THREE.Matrix4[] = [];
  const lampHeads: THREE.Vector3[] = [];
  const sMedLamp0 = sW + 12 + 8;
  for (let s = sMedLamp0; s < sE + 26; s += 30) {
    const [x, z] = a.point(s, 0);
    medLamps.push(at(x, H.median, z, hVN(s)));
    col.addSolid(x, z, 0.22, 0.22, 0, -1, 6);
    av.light(x, z, 21, 0.62);
    for (const sd of [-1, 1]) {
      const [hx, hz] = a.point(s, sd * 2.3);
      lampHeads.push(new THREE.Vector3(hx, 10.3, hz));
    }
  }
  instanceProps({ geo: twinArmLamp(true, 10), mats: medLamps, cull: { radius: 6, dist: 900, near: 60 } }, M, group, cullers);
  // Bus stop (Ahilyabai Holkar Chowk) with its purple BEST sign.
  const sBus = sAtX(-104, 80);
  const [bx, bz] = a.point(sBus, VN.kerb + 1.5);
  const busRy = hVN(sBus) - Math.PI / 2;
  instanceProps({ geo: busShelter(), mats: [at(bx, H.footpath, bz, busRy)] }, M, group, cullers);
  {
    const sign = atlas.add(256, 384, (c, w, h) => drawBestSign(c, w, h));
    const m = at(bx, H.footpath, bz, busRy);
    const poleK = new Kit();
    poleK.cyl('metal', 0.05, 0.05, 3.1, 0, 0, 0, C.steel, 8);
    const [px, pz] = a.point(sBus - 4.2, VN.kerb + 0.5);
    const pm = at(px, H.footpath, pz, busRy);
    instanceProps({ geo: poleK.build(), mats: [pm] }, M, group, cullers);
    for (const face of [0, Math.PI]) gb.add('routeSigns', signQuad(sign, 0.62, 0.93).rotateY(face).translate(0, 2.55, face ? -0.03 : 0.03).applyMatrix4(pm));
    void m;
    col.addSolid(bx, bz, 3.2, 0.95, -busRy, -1, 3);
    for (let i = 0; i < 5; i++) loiter.push({ x: bx + rng.range(-2.5, 2.5), z: bz + rng.range(-0.3, 0.6), ry: busRy + Math.PI, kind: 'queue' });
  }
  // Planters: the white cubes along the kerb near the IMC building.
  for (let s = sAtX(-62, 96); s > sAtX(-114, 78); s -= 2.7) {
    if (Math.abs(s - sBus) < 5 || !clearOfImc(s, VN.kerb + 0.75)) continue;
    const [x, z] = a.point(s, VN.kerb + 0.75);
    planters.push(at(x, H.footpath, z, hVN(s)));
    col.addSolid(x, z, 0.5, 0.5, -hVN(s), -1, 1.2);
  }
  // Bollards: at driveways and clusters near crossings.
  for (let s = ne.sCorner + 16; s < sE - 6; s += 38 + rng.range(-8, 8)) {
    for (let i = 0; i < 4; i++) {
      if (!clearOfImc(s + i * 1.3, VN.kerb + 0.35, 1)) continue;
      const [x, z] = a.point(s + i * 1.3, VN.kerb + 0.35);
      bollards.push(at(x, H.footpath, z, hVN(s)));
      col.addSolid(x, z, 0.1, 0.1, 0, -1, 1);
    }
  }
  for (let i = 0; i < 6; i++) {
    const [x, z] = a.point(ne.sCorner + 6 + i * 1.4, VN.kerb + 0.35);
    bollards.push(at(x, H.footpath, z, 0));
  }
  instanceProps({ geo: heritageLamp(), mats: lamps, cull: { radius: 3, dist: 420, near: 40 } }, M, group, cullers);
  instanceProps({ geo: planter(), mats: planters, cull: { radius: 1.2, dist: 220, near: 25 } }, M, group, cullers);
  instanceProps({ geo: bollard(), mats: bollards, cull: { radius: 0.6, dist: 140, near: 20 } }, M, group, cullers);
  // Feeder pillars, post box.
  {
    const red = [a.point(sAtX(-66, 90), VN.kerb + 5.2), a.point(sAtX(-305, 12), VN.kerb + 5.3)];
    instanceProps({ geo: feederPillar([0.52, 0.08, 0.06]), mats: red.map(([x, z], i) => at(x, H.footpath, z, hVN(sBus) + (i ? 0.2 : 0))) }, M, group, cullers);
    const green = [a.point(sAtX(-205, 45), VN.kerb + 5.0)];
    instanceProps({ geo: feederPillar([0.1, 0.28, 0.2]), mats: green.map(([x, z]) => at(x, H.footpath, z, hVN(sBus))) }, M, group, cullers);
    const pb = a.point(sAtX(-199, 47), VN.kerb + 1.6);
    instanceProps({ geo: postBox(), mats: [at(pb[0], H.footpath, pb[1], hVN(sBus) + Math.PI)] }, M, group, cullers);
    for (const [x, z] of [...red, ...green, pb]) col.addSolid(x, z, 0.5, 0.35, 0, -1, 1.6);
  }
  // Trees: old banyans and rain trees along both kerbs.
  const bigTrees = [-92, -150, -200, -262, -330];
  for (const tx of bigTrees) {
    const s = sAtX(tx, 60);
    const [x, z] = a.point(s, VN.kerb + 1.5);
    treeSpots.push({ x, z, s: rng.range(1.15, 1.35), kind: 'banyan' });
  }
  for (let s = ne.sCorner + 20; s < sE - 10; s += rng.range(16, 26)) {
    const [x, z] = a.point(s, -(VN.kerb + 1.4));
    treeSpots.push({ x, z, s: rng.range(0.9, 1.2), kind: rng.chance(0.3) ? 'banyan' : 'mixed' });
  }
  for (let s = ne.sCorner + 30; s < sE - 10; s += rng.range(20, 34)) {
    if (bigTrees.some((tx) => Math.abs(sAtX(tx, 60) - s) < 10) || !clearOfImc(s, VN.kerb + 1.4, 3.5)) continue;
    const [x, z] = a.point(s, VN.kerb + 1.4);
    treeSpots.push({ x, z, s: rng.range(0.8, 1.05), kind: 'mixed' });
  }
  // Median: shrubs and a few young trees.
  for (let s = sMedW + 8; s < sE; s += rng.range(14, 22)) {
    if (Math.abs(((s - sMedLamp0) % 30 + 30) % 30 - 15) > 11) continue; // keep clear of the lamp posts
    const [x, z] = a.point(s, 0);
    treeSpots.push({ x, z, s: rng.range(0.45, 0.6), kind: 'mixed' });
  }

  // ---- Frontage: compound walls, bougainvillea, restaurant dressing ------------------------------
  const walls: { geo: PropGeo; mats: THREE.Matrix4[] }[] = [];
  const bal = balustrade(4);
  const rail = railingWall(4);
  const balM: THREE.Matrix4[] = [];
  const railM: THREE.Matrix4[] = [];
  const bougM: THREE.Matrix4[] = [];
  for (let s = ne.sCorner + 14; s < sE - 6; s += 4) {
    const x0 = a.point(s, VN.footpath)[0];
    // Restaurant row (no walls): roughly x -122 … -190.
    if (x0 < -120 && x0 > -192) continue;
    if (!clearOfImc(s, VN.footpath + 0.25, 0.5) || !clearOfImc(s + 4, VN.footpath + 0.25, 0.5)) continue;
    if (rng.chance(0.14)) continue; // gates
    const [x, z] = a.point(s + 2, VN.footpath + 0.25);
    const m = at(x, H.footpath, z, hVN(s) - Math.PI / 2);
    if (x0 < -94 && x0 > -120) balM.push(m);
    else railM.push(m);
    const [wx0, wz0] = a.point(s, VN.footpath + 0.25);
    const [wx1, wz1] = a.point(s + 4, VN.footpath + 0.25);
    col.addWall(wx0, wz0, wx1, wz1, 0.35, -1, 2);
    if (rng.chance(0.35)) bougM.push(at(x, H.footpath, z, hVN(s) - Math.PI / 2));
  }
  walls.push({ geo: bal, mats: balM }, { geo: rail, mats: railM });
  for (const w of walls) instanceProps({ geo: w.geo, mats: w.mats, cull: { radius: 3, dist: 260, near: 30 } }, M, group, cullers);
  instanceProps({ geo: bougainvillea(4, 7), mats: bougM, cull: { radius: 3, dist: 200, near: 25 }, shadow: true }, M, group, cullers);
  // South side: the Brabourne Stadium (CCI) compound wall with its gates.
  {
    const railS: THREE.Matrix4[] = [];
    for (let s = sAtX(-352, 30); s < sAtX(-176, 90); s += 4) {
      if (rng.chance(0.08)) continue;
      const [x, z] = a.point(s + 2, -(VN.footpath + 0.4));
      railS.push(at(x, H.footpath, z, hVN(s) + Math.PI / 2));
      const [wx0, wz0] = a.point(s, -(VN.footpath + 0.4));
      const [wx1, wz1] = a.point(s + 4, -(VN.footpath + 0.4));
      col.addWall(wx0, wz0, wx1, wz1, 0.35, -1, 2);
    }
    instanceProps({ geo: railingWall(4), mats: railS, cull: { radius: 3, dist: 300, near: 30 } }, M, group, cullers);
  }
  // Restaurant row props: scooters and planters at the doors.
  {
    const scoots: THREE.Matrix4[] = [];
    for (let s = sAtX(-128, 70); s > sAtX(-188, 50); s -= rng.range(5, 9)) {
      const [x, z] = a.point(s, VN.footpath - 1.1);
      scoots.push(at(x, H.footpath, z, hVN(s) + Math.PI / 2 + rng.range(-0.2, 0.2)));
      col.addSolid(x, z, 0.3, 0.7, -(hVN(s) + Math.PI / 2), -1, 1.2);
      loiter.push({ x: x + rng.range(-1, 1), z: z + rng.range(-0.5, 0.5), ry: hVN(s) - Math.PI / 2, kind: 'shop' });
    }
    instanceProps({ geo: scooter([0.72, 0.62, 0.9]), mats: scoots.filter((_, i) => i % 3 === 0) }, M, group, cullers);
    instanceProps({ geo: scooter([0.1, 0.1, 0.1]), mats: scoots.filter((_, i) => i % 3 === 1) }, M, group, cullers);
    instanceProps({ geo: scooter([0.75, 0.1, 0.1]), mats: scoots.filter((_, i) => i % 3 === 2) }, M, group, cullers);
  }
  // BMC road-works netting around the corner tree at IMC Road (footage #03).
  {
    const net = atlas.add(320, 200, (c, w, h) => drawBmcNet(c, w, h));
    const sNet = IMC.span(VN.kerb + 1.2)[1] + 3.5;
    const [x, z] = a.point(sNet, VN.kerb + 1.2);
    const ry = hVN(sE) + Math.PI;
    for (let i = 0; i < 4; i++) {
      const q = signQuad(net, 1.6, 1.0);
      q.translate(0, 0.5, 0.8);
      q.rotateY((i / 4) * Math.PI * 2 + ry);
      gb.add('routeSigns', q.translate(x, H.footpath, z));
    }
    treeSpots.push({ x, z, s: 0.75, kind: 'mixed' });
    col.addSolid(x, z, 0.8, 0.8, 0, -1, 1.5);
  }

  // ---- Shop signs, awnings and building names on facades facing the road ------------------------
  const shopRects = SHOPS.map((sh) => atlas.add(SHOP_W, SHOP_H, (c, w, h) => drawShop(c, w, h, sh)));
  const nameRects = new Map<string, AtlasRect>();
  const awn: THREE.Matrix4[][] = SHOPS.map(() => []);
  let shopIdx = 0;
  for (const b of buildings) {
    const p = b.fp;
    const n = p.length / 2;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += p[i * 2];
      cz += p[i * 2 + 1];
    }
    cx /= n;
    cz /= n;
    const pr = a.project(cx, cz);
    if (pr.s < ne.sCorner - 4 || pr.s > sE + 2 || Math.abs(pr.o) > 70 || Math.abs(pr.o) < VN.footpath) continue;
    const side = Math.sign(pr.o);
    // Edge facing the road: outward normal pointing at the axis.
    let best = -1;
    let bestScore = 0.55;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = p[j * 2] - p[i * 2];
      const ez = p[j * 2 + 1] - p[i * 2 + 1];
      const len = Math.hypot(ex, ez);
      if (len < 5) continue;
      // Footprints are CCW from above; outward normal = (ez, -ex)/len… check against the road.
      let nx = ez / len;
      let nz = -ex / len;
      const mx = (p[i * 2] + p[j * 2]) / 2;
      const mz = (p[i * 2 + 1] + p[j * 2 + 1]) / 2;
      if ((mx + nx - cx) ** 2 + (mz + nz - cz) ** 2 < (mx - cx) ** 2 + (mz - cz) ** 2) {
        nx = -nx;
        nz = -nz;
      }
      const toAxis = a.project(mx, mz);
      const [ax2, az2] = a.point(toAxis.s, 0);
      const dx = ax2 - mx;
      const dz = az2 - mz;
      const dl = Math.hypot(dx, dz) || 1;
      const score = (nx * dx + nz * dz) / dl;
      if (score > bestScore && Math.abs(toAxis.o) < 40) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) continue;
    const j = (best + 1) % n;
    const x0 = p[best * 2];
    const z0 = p[best * 2 + 1];
    const x1 = p[j * 2];
    const z1 = p[j * 2 + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    let nx = (z1 - z0) / len;
    let nz = -(x1 - x0) / len;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    if ((mx + nx - cx) ** 2 + (mz + nz - cz) ** 2 < (mx - cx) ** 2 + (mz - cz) ** 2) {
      nx = -nx;
      nz = -nz;
    }
    const ry = Math.atan2(nx, nz);
    const hgt = heights.get(b.id) ?? 12;
    // One or two shop signs along the ground floor.
    const count = len > 16 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const t = count === 1 ? 0.5 : 0.28 + k * 0.44;
      const w = Math.min(len / count - 1.2, 6.5);
      if (w < 2.5) continue;
      const si = (shopIdx++ * 5 + (side > 0 ? 0 : 3)) % SHOPS.length;
      const sx = x0 + (x1 - x0) * t + nx * 0.12;
      const sz = z0 + (z1 - z0) * t + nz * 0.12;
      const q = signQuad(shopRects[si], w, (w * SHOP_H) / SHOP_W);
      q.rotateY(ry);
      gb.add('routeSigns', q.translate(sx, 3.35, sz));
      const bg = new THREE.BoxGeometry(w + 0.1, (w * SHOP_H) / SHOP_W + 0.1, 0.1).rotateY(ry).translate(sx - nx * 0.06, 3.35, sz - nz * 0.06);
      gb.add('darkMetal', bg);
      if (SHOPS[si].awning) awn[si].push(at(sx + nx * 0.7, 2.75, sz + nz * 0.7, ry, 1).multiply(new THREE.Matrix4().makeScale(w / 4, 1, 1)));
      av.light(sx + nx * 2, sz + nz * 2, 8, 0.4);
    }
    // Building name above the ground floor, as on Mumbai's Art Deco blocks.
    if (b.n && /mahal|bhavan|mansion|court|house|niwas|sadan|building|chambers/i.test(b.n) && hgt > 10) {
      let r = nameRects.get(b.n);
      if (!r) {
        r = atlas.add(512, 72, (c, w, h) => drawNamePlate(c, w, h, b.n!));
        nameRects.set(b.n, r);
      }
      const w = Math.min(len - 2, 7.5);
      const q = signQuad(r, w, (w * 72) / 512);
      q.rotateY(ry);
      gb.add('routeSigns', q.translate(mx + nx * 0.14, 5.4, mz + nz * 0.14));
    }
  }
  // Awnings: sloped fabric canopies.
  SHOPS.forEach((sh, i) => {
    if (!sh.awning || !awn[i].length) return;
    const k = new Kit();
    const g = new THREE.BoxGeometry(4, 0.04, 1.5);
    g.rotateX(0.35);
    k.add('paint', g, sh.awning);
    k.box('paint', 4, 0.25, 0.02, 0, -0.3, 0.72, sh.awning);
    instanceProps({ geo: k.build(), mats: awn[i] }, M, group, cullers);
  });

  // ---- Parked vehicles along both kerbs ---------------------------------------------------------
  const parked: VNResult['parked'] = [];
  const kinds: [VehicleKind, number][] = [
    ['taxi', 45],
    ['cab', 20],
    ['car', 25],
    ['suv', 10],
  ];
  for (const side of [1, -1]) {
    for (let s = ne.sCorner + 24; s < sE - 8; s += rng.range(5.2, 6.4)) {
      if (Math.abs(s - sBus) < 11 && side > 0) continue;
      if (side > 0 && !clearOfImc(s, VN.kerb, 7)) continue;
      if (rng.chance(0.18)) continue;
      const [x, z] = a.point(s, side * (VN.carriage + 1.35));
      const kind = rng.weighted(kinds);
      parked.push({ x, z, heading: hVN(s) + (side > 0 ? 0 : Math.PI), kind });
      col.addSolid(x, z, 0.85, 2.0, -(hVN(s) + (side > 0 ? 0 : Math.PI)), -1, 1.6);
    }
  }

  av.paint(-420, -30, -20, 170, (x, z, sky, ceil) => {
    const p = a.project(x, z);
    if (p.s > sW && p.s < sE && Math.abs(p.o) < VN.frontage) return [Math.min(sky, 0.82), ceil];
    return [sky, ceil];
  });

  const built = gb.build(M, { noShadowKeys: ['asphalt', 'marking', 'grass', 'mdKerb', 'vnFootpath', 'routeSigns'] });
  group.add(built);
  const busStop = { x: bx, z: bz, ry: busRy };
  void se;
  return { group, cullers, parked, trees: treeSpots, busStop, loiter, lampHeads };
}

