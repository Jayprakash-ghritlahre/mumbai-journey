import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { makeCanvas, rgba, type Ctx, type TextureFactory } from '../../gfx/TextureFactory';
import { DEVA, LATIN } from '../../gfx/Signage';

/** Car body layout shared by the livery painter and the geometry builder. */
export const CAR = {
  length: 20.5,
  pitch: 21.1,
  halfW: 1.83,
  floorY: 1.2,
  sideY0: 1.02,
  sideY1: 3.55,
  roofY: 4.05,
  winY0: 2.08,
  winY1: 3.0,
  doorY1: 3.22,
  doorW: 1.3,
  doors: [-6.35, 0, 6.35],
};

/** Window centres along the car (between doorways and car ends). */
export function windowPositions(): number[] {
  const L = CAR.length / 2;
  const openings = CAR.doors.map((d) => [d - CAR.doorW / 2, d + CAR.doorW / 2]);
  const sections: [number, number][] = [];
  let start = -L + 0.55;
  for (const [a, b] of openings) {
    sections.push([start, a - 0.3]);
    start = b + 0.3;
  }
  sections.push([start, L - 0.55]);
  const out: number[] = [];
  for (const [a, b] of sections) {
    const len = b - a;
    const n = Math.max(1, Math.floor((len + 0.28) / 1.28));
    const pitch = len / n;
    for (let i = 0; i < n; i++) out.push(a + pitch * (i + 0.5));
  }
  return out;
}
export const WIN_W = 1.0;

export const LIVERY_ROWS = 8;
const TEX_W = 2048;
const ROW_H = 256;

/** Western Railway violet (external photos 3, 4, 6; doors_sides 2, 4, 6). */
const PURPLE = '#74409c';
const PURPLE_DARK = '#4a2667';
const BODY = '#e9e7e1';
const FC_YELLOW = '#e8b31c';

/** z (car-local) → u in [0,1]; y → v within a row. */
export function liveryU(z: number): number {
  return (z + CAR.length / 2) / CAR.length;
}

/**
 * Livery atlas: 8 rows, each a full car side (20.5 m × 2.53 m).
 * Rows: 0–2 second class (different grime and numbers), 3 first class (yellow door frames),
 * 4 ladies coach, 5–7 vinyl ad panels.
 */
export function buildLiveryAtlas(tf: TextureFactory): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(TEX_W, ROW_H * LIVERY_ROWS);
  for (let r = 0; r < LIVERY_ROWS; r++) {
    ctx.save();
    ctx.translate(0, r * ROW_H);
    ctx.beginPath();
    ctx.rect(0, 0, TEX_W, ROW_H);
    ctx.clip();
    paintSide(ctx, TEX_W, ROW_H, r, new RNG(900 + r * 13), tf);
    ctx.restore();
  }
  const t = tf.tex(c, { wrap: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** One car side at high resolution (the car the player rides in). */
export function buildHeroLivery(tf: TextureFactory, row: number): THREE.CanvasTexture {
  const W = 4096;
  const H = 512;
  const [c, ctx] = makeCanvas(W, H);
  paintSide(ctx, W, H, row, new RNG(900 + row * 13), tf, '5014B');
  const t = tf.tex(c, { wrap: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function paintSide(ctx: Ctx, W: number, H: number, row: number, rng: RNG, tf: TextureFactory, number?: string): void {
  // Drawing in metres: 1 m along the car = W / 20.5 px.
  const k = W / CAR.length;
  const yPx = (y: number) => H - ((y - CAR.sideY0) / (CAR.sideY1 - CAR.sideY0)) * H;
  const zPx = (z: number) => liveryU(z) * W;
  const band = 1.98; // top of the violet band (just under the window sills)
  ctx.fillStyle = BODY;
  ctx.fillRect(0, 0, W, H);
  tf.overlayNoise(ctx, W, H, 1, 8, 0.1, 'overlay', row);

  const firstClass = row === 3;
  const ladies = row === 4;
  const ads = row >= 5;
  // The broad violet lower band and the thin cantrail band.
  ctx.fillStyle = PURPLE;
  ctx.fillRect(0, yPx(band), W, H - yPx(band));
  ctx.fillStyle = PURPLE_DARK;
  ctx.fillRect(0, yPx(band), W, Math.max(2, 0.025 * k));
  ctx.fillStyle = PURPLE;
  ctx.fillRect(0, yPx(3.46), W, yPx(3.37) - yPx(3.46));
  // Door surrounds: violet (yellow in first class) frames running up to the cantrail.
  for (const d of CAR.doors) {
    const x0 = zPx(d - CAR.doorW / 2 - 0.14);
    const x1 = zPx(d + CAR.doorW / 2 + 0.14);
    ctx.fillStyle = firstClass ? FC_YELLOW : PURPLE;
    ctx.fillRect(x0, yPx(CAR.doorY1 + 0.14), x1 - x0, H - yPx(CAR.doorY1 + 0.14));
    if (firstClass) {
      ctx.fillStyle = PURPLE;
      ctx.fillRect(x0, yPx(band), x1 - x0, H - yPx(band));
    }
    // Grab-worn grime beside the doorway.
    for (const sd of [-1, 1]) {
      const gx = zPx(d + sd * (CAR.doorW / 2 + 0.1));
      const g = ctx.createLinearGradient(gx - 0.2 * k, 0, gx + 0.2 * k, 0);
      g.addColorStop(0, 'rgba(40,30,25,0)');
      g.addColorStop(0.5, 'rgba(40,30,25,0.4)');
      g.addColorStop(1, 'rgba(40,30,25,0)');
      ctx.fillStyle = g;
      ctx.fillRect(gx - 0.2 * k, yPx(2.7), 0.4 * k, yPx(1.3) - yPx(2.7));
    }
    // Class numerals beside the doorway.
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `700 ${0.3 * k}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const sd of [-1, 1]) ctx.fillText(firstClass ? 'I' : 'II', zPx(d + sd * (CAR.doorW / 2 + 0.36)), yPx(3.02));
  }
  // Window surrounds (grey rubber frames).
  for (const z of windowPositions()) {
    const x0 = zPx(z - WIN_W / 2 - 0.06);
    const x1 = zPx(z + WIN_W / 2 + 0.06);
    ctx.fillStyle = 'rgba(96,96,96,0.95)';
    ctx.beginPath();
    ctx.roundRect(x0, yPx(CAR.winY1 + 0.06), x1 - x0, yPx(CAR.winY0 - 0.06) - yPx(CAR.winY1 + 0.06), 0.1 * k);
    ctx.fill();
  }
  // Lettering on the violet band: the big WR monogram and पश्चिम रेलवे, WESTERN RAILWAY above the windows.
  const secs: [number, number][] = [
    [-CAR.length / 2, CAR.doors[0] - CAR.doorW / 2 - 0.14],
    [CAR.doors[0] + CAR.doorW / 2 + 0.14, CAR.doors[1] - CAR.doorW / 2 - 0.14],
    [CAR.doors[1] + CAR.doorW / 2 + 0.14, CAR.doors[2] - CAR.doorW / 2 - 0.14],
    [CAR.doors[2] + CAR.doorW / 2 + 0.14, CAR.length / 2],
  ];
  if (ads) {
    // Vinyl ad panels on the band between the doorways (fictional brands).
    const ad = [
      { bg: ['#ffd100', '#ffb300'], fg: '#1a1a1a', text: 'JHAKAAS 5G · ₹299', sub: 'UNLIMITED DATA' },
      { bg: ['#0e7c86', '#12a4a0'], fg: '#ffffff', text: 'NIRMAL AQUA', sub: 'शुद्ध पाणी · PURE WATER' },
      { bg: ['#d8431c', '#f06a2a'], fg: '#fff6e6', text: 'BINDAAS CHAI', sub: 'एक कटिंग · ONE CUTTING' },
    ][row - 5];
    for (const [a, b] of secs.slice(1, 3)) {
      const x0 = zPx(a + 0.25);
      const x1 = zPx(b - 0.25);
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, ad.bg[0]);
      g.addColorStop(1, ad.bg[1]);
      ctx.fillStyle = g;
      ctx.fillRect(x0, yPx(band - 0.08), x1 - x0, yPx(1.12) - yPx(band - 0.08));
      ctx.fillStyle = ad.fg;
      ctx.textAlign = 'left';
      ctx.font = `800 ${0.32 * k}px ${LATIN}`;
      ctx.fillText(ad.text, x0 + 0.2 * k, yPx(1.62), x1 - x0 - 0.4 * k);
      ctx.font = `700 ${0.17 * k}px ${DEVA}`;
      ctx.fillText(ad.sub, x0 + 0.2 * k, yPx(1.3), x1 - x0 - 0.4 * k);
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const wrSec = ads ? [secs[0], secs[3]] : [secs[0], secs[2]];
  for (const [a, b] of wrSec) {
    ctx.font = `900 ${0.86 * k}px ${LATIN}`;
    ctx.fillText('WR', zPx((a + b) / 2), yPx(1.5), (b - a - 0.4) * k);
  }
  if (!ads) {
    ctx.font = `700 ${0.36 * k}px ${DEVA}`;
    for (const [a, b] of [secs[1], secs[3]]) ctx.fillText('पश्चिम रेलवे', zPx((a + b) / 2), yPx(1.52), (b - a - 0.4) * k);
  }
  ctx.fillStyle = '#2a2a2a';
  ctx.font = `700 ${0.12 * k}px ${LATIN}`;
  for (const [a, b] of [secs[1], secs[2]]) ctx.fillText('WESTERN RAILWAY', zPx((a + b) / 2), yPx(3.24));
  // Ladies coach: green plates beside the doorways.
  if (ladies) {
    for (const d of CAR.doors) {
      const x = zPx(d + CAR.doorW / 2 + 0.62);
      ctx.fillStyle = '#1b7a3a';
      ctx.fillRect(x - 0.38 * k, yPx(3.22), 0.76 * k, yPx(2.72) - yPx(3.22));
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = `700 ${0.15 * k}px ${DEVA}`;
      ctx.fillText('महिला', x, yPx(3.08));
      ctx.font = `700 ${0.12 * k}px ${LATIN}`;
      ctx.fillText('LADIES', x, yPx(2.86));
    }
  }
  // Car numbers at both ends, as stencilled on the rakes.
  ctx.fillStyle = '#1e1e1e';
  ctx.font = `700 ${0.2 * k}px ${LATIN}`;
  ctx.textAlign = 'left';
  const num = number ?? `${5000 + rng.int(10, 180)}${rng.pick(['A', 'B', 'C'])}`;
  ctx.fillText(num, zPx(-CAR.length / 2 + 0.3), yPx(3.2));
  ctx.textAlign = 'right';
  ctx.fillText(num, zPx(CAR.length / 2 - 0.3), yPx(3.2));
  // Grime: dust along the bottom, streaks from the roof, general dirt.
  const dust = ctx.createLinearGradient(0, H, 0, yPx(1.9));
  dust.addColorStop(0, 'rgba(70,55,40,0.5)');
  dust.addColorStop(1, 'rgba(70,55,40,0)');
  ctx.fillStyle = dust;
  ctx.fillRect(0, yPx(1.9), W, H - yPx(1.9));
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, W);
    const len = rng.range(0.2, 1.4) * k;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, rgba(40, 36, 32, rng.range(0.12, 0.35)));
    g.addColorStop(1, 'rgba(40,36,32,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, rng.range(0.02, 0.06) * k, len);
  }
  for (let i = 0; i < 25; i++) tf.stain(ctx, W, H, rng.range(0, W), rng.range(0, H), rng.range(0.1, 0.5) * k, 'rgba(80,70,55,1)', 0.1, rng, 3);
}

/** Yellow cab front (texture covers x ∈ [-1.83, 1.83], y ∈ [0.9, 4.1]). */
export function buildCabFront(tf: TextureFactory, number: string, dest: string): THREE.CanvasTexture {
  const W = 512;
  const H = 448;
  const [c, ctx] = makeCanvas(W, H);
  const rng = new RNG(number.length * 97);
  const X = (x: number) => ((x + 1.83) / 3.66) * W;
  const Y = (y: number) => H - ((y - 0.9) / 3.2) * H;
  ctx.fillStyle = '#efbe24';
  ctx.fillRect(0, 0, W, H);
  tf.overlayNoise(ctx, W, H, 1, 3, 0.18, 'overlay', 5);
  // Purple bottom stripe with the unit number.
  ctx.fillStyle = PURPLE;
  ctx.fillRect(0, Y(1.46), W, Y(1.3) - Y(1.46));
  ctx.fillStyle = '#f0e6c8';
  ctx.font = `700 13px ${LATIN}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(number + 'C', X(-1.6), Y(1.38));
  ctx.textAlign = 'right';
  ctx.fillText(number + 'C', X(1.6), Y(1.38));
  // Grey panel below the stripe.
  ctx.fillStyle = '#8b8a86';
  ctx.fillRect(0, Y(1.3), W, H - Y(1.3));
  // Black lamp band.
  ctx.fillStyle = '#121212';
  ctx.beginPath();
  ctx.roundRect(X(-1.55), Y(2.15), X(1.55) - X(-1.55), Y(1.78) - Y(2.15), 18);
  ctx.fill();
  // Grey window surrounds and windscreens.
  for (const s of [-1, 1]) {
    const cx = s * 0.78;
    ctx.fillStyle = '#9b9a95';
    ctx.beginPath();
    ctx.roundRect(X(cx - 0.68), Y(3.3), X(cx + 0.68) - X(cx - 0.68), Y(2.3) - Y(3.3), 16);
    ctx.fill();
    ctx.fillStyle = '#9b9a95';
    ctx.beginPath();
    ctx.roundRect(X(cx - 0.62), Y(3.83), X(cx + 0.62) - X(cx - 0.62), Y(3.48) - Y(3.83), 10);
    ctx.fill();
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(X(cx - 0.52), Y(3.76), X(cx + 0.52) - X(cx - 0.52), Y(3.55) - Y(3.76));
    ctx.fillStyle = '#ff9d2a';
    ctx.font = `700 14px ${LATIN}`;
    ctx.textAlign = 'center';
    ctx.fillText(s < 0 ? dest : 'CHURCHGATE', X(cx), Y(3.655));
  }
  // Unit number between the windscreens.
  ctx.fillStyle = '#161616';
  ctx.font = `700 21px ${LATIN}`;
  ctx.textAlign = 'center';
  ctx.fillText(number, X(0), Y(2.95));
  ctx.fillStyle = '#e8b21e';
  ctx.globalAlpha = 0.6;
  ctx.font = `700 40px ${LATIN}`;
  ctx.fillText('CF', X(0), Y(2.25));
  ctx.globalAlpha = 1;
  // Red-dot plate and the red X (last vehicle) plate.
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(X(-0.95), Y(1.74), X(-0.65) - X(-0.95), Y(1.5) - Y(1.74));
  ctx.fillStyle = '#c62828';
  for (const [dx, dy] of [
    [-0.87, 1.66],
    [-0.73, 1.66],
    [-0.87, 1.56],
    [-0.73, 1.56],
  ]) {
    ctx.beginPath();
    ctx.arc(X(dx), Y(dy), 3.2, 0, 6.3);
    ctx.fill();
  }
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(X(0.62), Y(1.76), X(0.95) - X(0.62), Y(1.48) - Y(1.76));
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(X(0.65), Y(1.74));
  ctx.lineTo(X(0.92), Y(1.5));
  ctx.moveTo(X(0.92), Y(1.74));
  ctx.lineTo(X(0.65), Y(1.5));
  ctx.stroke();
  // Grime and chips.
  for (let i = 0; i < 20; i++) tf.stain(ctx, W, H, rng.range(0, W), rng.range(0, H), rng.range(10, 40), 'rgba(90,70,40,1)', 0.12, rng, 3);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = rgba(120, 110, 90, rng.range(0.3, 0.7));
    ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(1, 4), rng.range(1, 3));
  }
  const dust = ctx.createLinearGradient(0, H, 0, Y(1.8));
  dust.addColorStop(0, 'rgba(60,50,40,0.5)');
  dust.addColorStop(1, 'rgba(60,50,40,0)');
  ctx.fillStyle = dust;
  ctx.fillRect(0, Y(1.8), W, H - Y(1.8));
  const t = tf.tex(c, { wrap: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Interior wall/ceiling panels (cream laminate with grime), tiling 2 m. */
export function buildInteriorTex(tf: TextureFactory): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  // Pale grey-green laminate, as in the Siemens rakes.
  ctx.fillStyle = '#a7b0a6';
  ctx.fillRect(0, 0, S, S);
  tf.overlayNoise(ctx, S, S, 3, 4, 0.07, 'overlay', 44);
  // Laminate panel seams and rivet lines.
  ctx.fillStyle = 'rgba(70,66,60,0.45)';
  ctx.fillRect(0, 0, 3, S);
  ctx.fillRect(S / 2, 0, 3, S);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(4, 0, 2, S);
  ctx.fillRect(S / 2 + 4, 0, 2, S);
  const rng = new RNG(45);
  for (let i = 0; i < 6; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(10, 30), 'rgba(90,80,70,1)', 0.08, rng, 3);
  return tf.tex(c);
}
