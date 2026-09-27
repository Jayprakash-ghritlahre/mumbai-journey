import * as THREE from 'three';
import { RNG } from '../core/Random';
import { makeCanvas, type Ctx, type TextureFactory } from './TextureFactory';

export const DEVA = '"Noto Sans Devanagari", "Noto Sans", sans-serif';
export const LATIN = '"Noto Sans", "Inter", sans-serif';

/** Largest font size (≤ max) at which `text` fits in `width`. */
export function fitFont(c: Ctx, text: string, weight: string, family: string, max: number, width: number): number {
  c.font = `${weight} ${max}px ${family}`;
  const w = c.measureText(text).width;
  return w <= width ? max : Math.max(8, Math.floor((max * width) / w));
}

/** Sets the font to the largest size (≤ max) that fits `width` and draws the text. */
export function fillFitted(c: Ctx, text: string, x: number, y: number, weight: string, family: string, max: number, width: number): void {
  c.font = `${weight} ${fitFont(c, text, weight, family, max, width)}px ${family}`;
  c.fillText(text, x, y);
}

export interface AtlasRect {
  /** UV rectangle (u0, v0, u1, v1) in texture space (v up). */
  uv: [number, number, number, number];
  w: number;
  h: number;
}

/** Shelf-packed canvas atlas for static signs, ads and posters. */
export class SignAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  readonly texture: THREE.CanvasTexture;
  readonly size: number;
  readonly height: number;

  constructor(tf: TextureFactory, size = 2048, height = size) {
    this.size = size;
    this.height = height;
    [this.canvas, this.ctx] = makeCanvas(size, height);
    this.ctx.fillStyle = '#808080';
    this.ctx.fillRect(0, 0, size, height);
    this.texture = tf.tex(this.canvas, { wrap: false });
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  private shelves: { y: number; h: number; x: number }[] = [];
  private nextY = 0;

  /** Reserves a w×h pixel rect (best-fit shelf packing) and lets `draw` paint into it. */
  add(w: number, h: number, draw: (ctx: Ctx, w: number, h: number) => void): AtlasRect {
    const pad = 4;
    let shelf: { y: number; h: number; x: number } | null = null;
    for (const sh of this.shelves) {
      if (sh.h >= h && sh.h <= h * 1.6 + 8 && sh.x + w + pad <= this.size && (!shelf || sh.h < shelf.h)) shelf = sh;
    }
    if (!shelf) {
      if (this.nextY + h > this.height) {
        // Fall back to any shelf with room, even if it wastes height.
        for (const sh of this.shelves) if (sh.h >= h && sh.x + w + pad <= this.size && (!shelf || sh.h < shelf.h)) shelf = sh;
        if (!shelf) throw new Error('SignAtlas full');
      } else {
        shelf = { y: this.nextY, h, x: 0 };
        this.shelves.push(shelf);
        this.nextY += h + pad;
      }
    }
    const x = shelf.x;
    const y = shelf.y;
    shelf.x += w + pad;
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    draw(c, w, h);
    c.restore();
    const S = this.size;
    const T = this.height;
    // Inset half a texel to avoid bleeding.
    return { uv: [(x + 0.5) / S, 1 - (y + h - 0.5) / T, (x + w - 0.5) / S, 1 - (y + 0.5) / T], w, h };
  }

  commit(): void {
    this.texture.needsUpdate = true;
  }
}

/** A textured quad (front face +Z) mapped to an atlas rect, centred at origin. */
export function signQuad(rect: AtlasRect, width: number, height: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = rect.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

function fitText(ctx: Ctx, text: string, font: (px: number) => string, maxW: number, px: number): number {
  let size = px;
  ctx.font = font(size);
  while (ctx.measureText(text).width > maxW && size > 8) {
    size -= 2;
    ctx.font = font(size);
  }
  return size;
}

function grime(ctx: Ctx, w: number, h: number, rng: RNG, amount = 1): void {
  for (let i = 0; i < 6 * amount; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const r = rng.range(w * 0.05, w * 0.25);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(60,50,40,${0.05 * amount})`);
    g.addColorStop(1, 'rgba(60,50,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // Streaks from the top edge.
  for (let i = 0; i < 10 * amount; i++) {
    const x = rng.range(0, w);
    const len = rng.range(h * 0.1, h * 0.6);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(40,35,30,${0.12 * amount})`);
    g.addColorStop(1, 'rgba(40,35,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, rng.range(2, 8), len);
  }
}

/** Indian Railways style trilingual station name board: Marathi, Hindi, English. */
export function drawStationBoard(ctx: Ctx, w: number, h: number, mr: string, hi: string, en: string, seed = 1): void {
  const rng = new RNG(seed);
  ctx.fillStyle = '#f1ede2';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = h * 0.035;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = [
    [mr, DEVA, 0.24],
    [hi, DEVA, 0.5],
    [en, LATIN, 0.77],
  ] as const;
  for (const [t, family, yy] of lines) {
    const px = fitText(ctx, t, (p) => `700 ${p}px ${family}`, w * 0.86, h * 0.21);
    ctx.font = `700 ${px}px ${family}`;
    ctx.fillText(t, w / 2, h * yy);
  }
  grime(ctx, w, h, rng, 1);
}

/** Blue square platform number sign with a white inset border. */
export function drawPlatformNumber(ctx: Ctx, w: number, h: number, n: number | string): void {
  ctx.fillStyle = '#1f3f8c';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = w * 0.045;
  ctx.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
  ctx.fillStyle = '#f6f6f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${h * 0.62}px ${LATIN}`;
  ctx.fillText(String(n), w / 2, h * 0.54);
  grime(ctx, w, h, new RNG(Number(n) || 3), 0.6);
}

export interface DirLine {
  en: string;
  mr?: string;
  hi?: string;
}

/** Blue direction sign with white text and an arrow. */
export function drawDirectionSign(ctx: Ctx, w: number, h: number, line: DirLine, arrow: 'left' | 'right' | 'up' | 'none', bg = '#1d4f9c', seed = 5): void {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = h * 0.03;
  ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h * 0.9);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  const ax = arrow === 'right' ? w - h * 0.55 : h * 0.55;
  const textX0 = arrow === 'left' ? h * 1.05 : h * 0.3;
  const textW = w - h * 1.4;
  ctx.textAlign = 'left';
  const rows = [line.mr, line.hi, line.en].filter(Boolean) as string[];
  rows.forEach((t, i) => {
    const isEn = i === rows.length - 1;
    const family = isEn ? LATIN : DEVA;
    const px = fitText(ctx, t, (p) => `700 ${p}px ${family}`, textW, (h * 0.8) / rows.length);
    ctx.font = `700 ${px}px ${family}`;
    ctx.fillText(t, textX0, (h * (i + 0.55)) / rows.length);
  });
  if (arrow !== 'none') {
    ctx.save();
    ctx.translate(ax, h / 2);
    ctx.rotate(arrow === 'left' ? Math.PI : arrow === 'up' ? -Math.PI / 2 : 0);
    const s = h * 0.28;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.28);
    ctx.lineTo(s * 0.1, -s * 0.28);
    ctx.lineTo(s * 0.1, -s * 0.75);
    ctx.lineTo(s, 0);
    ctx.lineTo(s * 0.1, s * 0.75);
    ctx.lineTo(s * 0.1, s * 0.28);
    ctx.lineTo(-s, s * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  grime(ctx, w, h, new RNG(seed), 0.5);
}

/** The newer Western Railway "roundel" diamond (white diamond, red ring, blue bar). */
export function drawRoundel(ctx: Ctx, w: number, h: number, deva: string, en: string): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(Math.PI / 4);
  const d = w * 0.68;
  ctx.fillStyle = '#f3f2ee';
  ctx.fillRect(-d / 2, -d / 2, d, d);
  ctx.strokeStyle = '#9a9a96';
  ctx.lineWidth = w * 0.01;
  ctx.strokeRect(-d / 2, -d / 2, d, d);
  ctx.restore();
  ctx.strokeStyle = '#c8303a';
  ctx.lineWidth = w * 0.06;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#233c8c';
  ctx.fillRect(w * 0.19, h * 0.44, w * 0.62, h * 0.12);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${h * 0.085}px ${DEVA}`;
  ctx.fillText(deva, w / 2, h * 0.505);
  ctx.fillStyle = '#111';
  ctx.font = `700 ${h * 0.07}px ${DEVA}`;
  ctx.fillText(deva, w / 2, h * 0.24);
  ctx.font = `700 ${h * 0.06}px ${LATIN}`;
  ctx.fillText(en, w / 2, h * 0.76);
}

export interface AdSpec {
  bg: [string, string];
  title: string;
  deva?: string;
  sub?: string;
  accent: string;
  motif: 'circle' | 'stripes' | 'phone' | 'bottle' | 'building' | 'sun' | 'rupee' | 'train';
  dark?: boolean;
}

/** Entirely fictional brands in the visual idiom of Mumbai station advertising. */
export const ADS: AdSpec[] = [
  { bg: ['#f6d743', '#f19b1f'], title: 'Konkan Aamras', deva: 'अस्सल कोकणचा स्वाद', sub: 'Pure Alphonso pulp · 850 g', accent: '#1f7a3a', motif: 'circle' },
  { bg: ['#0d3b66', '#1b6ca8'], title: 'Sagar Classes', deva: 'IIT-JEE · NEET · MHT-CET', sub: 'Dadar · Andheri · Borivali  ☎ 2600 4411', accent: '#ffd23f', motif: 'stripes', dark: true },
  { bg: ['#ffffff', '#dfe7ef'], title: 'Swift Home Loans', deva: 'आपलं घर, आपल्या हक्काचं', sub: 'Rates from 8.4%* · Mira Road to Virar', accent: '#d7263d', motif: 'building' },
  { bg: ['#1b1b1b', '#3a3a3a'], title: 'Jhakaas 5G', deva: 'मुंबई की सबसे तेज़ स्पीड', sub: 'Unlimited data ₹299', accent: '#ff3d7f', motif: 'phone', dark: true },
  { bg: ['#e9f5ec', '#b8e0c2'], title: 'Nirmal Aqua', deva: 'शुद्ध पाणी, निरोगी जीवन', sub: 'RO water purifiers · Free demo', accent: '#127a6e', motif: 'bottle' },
  { bg: ['#fff4e0', '#ffd8a8'], title: 'Laxmi Jewellers', deva: 'दिवाळी धमाका ऑफर', sub: 'Zaveri Bazaar since 1952', accent: '#a4161a', motif: 'sun' },
  { bg: ['#6a1b9a', '#8e24aa'], title: 'Bindaas Tea', deva: 'कटिंग चाय का असली मज़ा', sub: 'Masala · Elaichi · Ginger', accent: '#ffcc00', motif: 'circle', dark: true },
  { bg: ['#f2f2f2', '#d9d9d9'], title: 'Rail Yatri App', deva: 'लोकल ट्रेन का लाइव स्टेटस', sub: 'Download now · Free', accent: '#1565c0', motif: 'train' },
  { bg: ['#00897b', '#26a69a'], title: 'Mahalaxmi Bank', deva: 'सुरक्षित बचत, उज्ज्वल भविष्य', sub: 'FD rates up to 7.25%', accent: '#fff176', motif: 'rupee', dark: true },
  { bg: ['#fbe9e7', '#ffccbc'], title: 'Monsoon Sale', deva: 'फ़ैशन स्ट्रीट से भी सस्ता', sub: 'Upto 60% off · Linking Road', accent: '#d84315', motif: 'stripes' },
];

export function drawAd(ctx: Ctx, w: number, h: number, ad: AdSpec, seed = 1): void {
  const rng = new RNG(seed);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, ad.bg[0]);
  g.addColorStop(1, ad.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const ink = ad.dark ? '#ffffff' : '#141414';
  const portrait = h > w;
  // Motif.
  ctx.save();
  ctx.globalAlpha = 0.9;
  const mx = portrait ? w * 0.5 : w * 0.78;
  const my = portrait ? h * 0.36 : h * 0.5;
  const mr = Math.min(w, h) * (portrait ? 0.3 : 0.34);
  ctx.fillStyle = ad.accent;
  ctx.strokeStyle = ad.accent;
  switch (ad.motif) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ad.bg[0];
      ctx.beginPath();
      ctx.arc(mx - mr * 0.25, my - mr * 0.2, mr * 0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'stripes':
      for (let i = -4; i < 8; i++) {
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(-0.5);
        ctx.fillRect(i * mr * 0.3, -mr * 1.5, mr * 0.13, mr * 3);
        ctx.restore();
      }
      break;
    case 'phone':
      ctx.fillRect(mx - mr * 0.45, my - mr * 0.85, mr * 0.9, mr * 1.7);
      ctx.fillStyle = '#111';
      ctx.fillRect(mx - mr * 0.38, my - mr * 0.72, mr * 0.76, mr * 1.4);
      ctx.fillStyle = ad.accent;
      ctx.fillRect(mx - mr * 0.3, my - mr * 0.3, mr * 0.6, mr * 0.08);
      break;
    case 'bottle':
      ctx.beginPath();
      ctx.roundRect(mx - mr * 0.3, my - mr * 0.5, mr * 0.6, mr * 1.4, mr * 0.1);
      ctx.fill();
      ctx.fillRect(mx - mr * 0.12, my - mr * 0.8, mr * 0.24, mr * 0.35);
      break;
    case 'building':
      for (let i = 0; i < 4; i++) ctx.fillRect(mx - mr + i * mr * 0.5, my + mr * 0.8 - (i % 2 ? mr * 1.6 : mr * 1.2), mr * 0.42, i % 2 ? mr * 1.6 : mr * 1.2);
      break;
    case 'sun':
      for (let i = 0; i < 16; i++) {
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate((i / 16) * Math.PI * 2);
        ctx.fillRect(mr * 0.55, -mr * 0.04, mr * 0.45, mr * 0.08);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(mx, my, mr * 0.45, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rupee':
      ctx.font = `700 ${mr * 1.6}px ${LATIN}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('₹', mx, my);
      break;
    case 'train':
      ctx.beginPath();
      ctx.roundRect(mx - mr, my - mr * 0.45, mr * 2, mr * 0.9, mr * 0.2);
      ctx.fill();
      ctx.fillStyle = ad.bg[0];
      for (let i = 0; i < 4; i++) ctx.fillRect(mx - mr * 0.85 + i * mr * 0.45, my - mr * 0.25, mr * 0.3, mr * 0.25);
      break;
  }
  ctx.restore();
  // Copy.
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const tx = portrait ? w * 0.08 : w * 0.06;
  const tw = portrait ? w * 0.84 : w * 0.58;
  const ty = portrait ? h * 0.7 : h * 0.38;
  let px = fitText(ctx, ad.title, (p) => `700 ${p}px ${LATIN}`, tw, h * (portrait ? 0.075 : 0.2));
  ctx.font = `700 ${px}px ${LATIN}`;
  ctx.fillText(ad.title, tx, ty);
  if (ad.deva) {
    px = fitText(ctx, ad.deva, (p) => `700 ${p}px ${DEVA}`, tw, h * (portrait ? 0.05 : 0.13));
    ctx.font = `700 ${px}px ${DEVA}`;
    ctx.fillText(ad.deva, tx, ty + px * 1.35);
  }
  if (ad.sub) {
    ctx.globalAlpha = 0.85;
    px = fitText(ctx, ad.sub, (p) => `400 ${p}px ${LATIN}`, tw, h * (portrait ? 0.035 : 0.085));
    ctx.font = `400 ${px}px ${LATIN}`;
    ctx.fillText(ad.sub, tx, portrait ? h * 0.92 : h * 0.86);
    ctx.globalAlpha = 1;
  }
  grime(ctx, w, h, rng, 0.7);
}

/** Round station clock face (hands are separate geometry). */
export function drawClockFace(ctx: Ctx, w: number, h: number): void {
  const r = w / 2;
  ctx.fillStyle = '#f4f2ec';
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = r * 0.06;
  ctx.strokeStyle = '#1a1a1a';
  ctx.stroke();
  ctx.fillStyle = '#111';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(a);
    ctx.fillRect(-r * (long ? 0.025 : 0.01), -r * 0.9, r * (long ? 0.05 : 0.02), r * (long ? 0.14 : 0.06));
    ctx.restore();
  }
  ctx.font = `700 ${r * 0.16}px ${LATIN}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.fillText(String(i), r + Math.sin(a) * r * 0.62, r - Math.cos(a) * r * 0.62);
  }
  ctx.font = `400 ${r * 0.07}px ${LATIN}`;
  ctx.fillText('WESTERN RAILWAY', r, r * 1.35);
  void h;
}
