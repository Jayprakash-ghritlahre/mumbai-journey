import * as THREE from 'three';
import { RNG } from '../core/Random';
import { makeCanvas, rgba, type Ctx, type TextureFactory } from './TextureFactory';

export interface SurfaceSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  emissiveMap?: THREE.Texture;
}

const fill = (ctx: Ctx, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, w, h);
};

/** Cast-in-place platform concrete (texture covers 4 m × 4 m). */
export function platformConcrete(tf: TextureFactory): SurfaceSet {
  return tf.memo('platformConcrete', () => {
    const S = 1024;
    const rng = new RNG(11);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    const [r, rx] = makeCanvas(S, S);
    fill(ctx, S, S, '#8a8987');
    tf.overlayNoise(ctx, S, S, 0, 1, 0.2, 'overlay', 1);
    tf.overlayNoise(ctx, S, S, 1, 3, 0.18, 'overlay', 2);
    tf.overlayNoise(ctx, S, S, 3, 12, 0.22, 'soft-light', 3);
    fill(hx, S, S, '#808080');
    tf.overlayNoise(hx, S, S, 3, 14, 0.6, 'overlay', 4);
    fill(rx, S, S, '#dcdcdc');
    tf.overlayNoise(rx, S, S, 1, 2, 0.35, 'overlay', 5);
    // Aggregate speckle.
    for (let i = 0; i < 9000; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      const light = rng.chance(0.5);
      ctx.fillStyle = light ? 'rgba(215,210,200,0.22)' : 'rgba(40,38,35,0.22)';
      ctx.beginPath();
      ctx.arc(x, y, rng.range(0.6, 1.8), 0, Math.PI * 2);
      ctx.fill();
    }
    // Walked-in grime and polish.
    for (let i = 0; i < 10; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(90, 240), 'rgba(52,46,40,1)', 0.05, rng, 6);
    for (let i = 0; i < 10; i++) tf.stain(rx, S, S, rng.range(0, S), rng.range(0, S), rng.range(100, 260), 'rgba(120,120,120,1)', 0.25, rng, 5);
    // Contraction joints every 2 m, slightly irregular.
    for (const [x0, y0, x1, y1] of [
      [0, 0, S, 0],
      [0, S / 2, S, S / 2],
      [0, 0, 0, S],
      [S / 2, 0, S / 2, S],
    ]) {
      for (const [cc, col, wdt] of [
        [ctx, 'rgba(38,35,32,0.75)', 3],
        [hx, 'rgba(10,10,10,1)', 4],
        [rx, 'rgba(255,255,255,1)', 4],
      ] as [Ctx, string, number][]) {
        cc.strokeStyle = col;
        cc.lineWidth = wdt;
        cc.beginPath();
        cc.moveTo(x0, y0);
        cc.lineTo(x1, y1);
        cc.stroke();
      }
      ctx.strokeStyle = 'rgba(40,36,30,0.18)';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // Old repair patches.
    for (let i = 0; i < 3; i++) {
      const x = rng.range(0, S - 200);
      const y = rng.range(0, S - 200);
      const w = rng.range(60, 200);
      const hh = rng.range(60, 160);
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(150,146,138,0.55)' : 'rgba(100,97,92,0.5)';
      ctx.fillRect(x, y, w, hh);
      ctx.strokeStyle = 'rgba(40,38,34,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, hh);
    }
    for (let i = 0; i < 7; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      const len = rng.range(40, 160);
      tf.crack(ctx, S, S, x, y, len, new RNG(i + 50));
      tf.crack(hx, S, S, x, y, len, new RNG(i + 50), 'rgba(0,0,0,0.8)', 2);
    }
    // Chewing gum spots.
    for (let i = 0; i < 160; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      ctx.fillStyle = rgba(30, 28, 26, rng.range(0.3, 0.6));
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(1.5, 4), rng.range(1.5, 3.5), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    return {
      map: tf.tex(c),
      normalMap: tf.normalFromHeight(h, 2.2),
      roughnessMap: tf.roughnessFrom(r),
    };
  });
}

/** Large polished stone floor slabs of the concourse (covers 2.4 m × 2.4 m, 0.6 m tiles). */
export function stoneTiles(tf: TextureFactory): SurfaceSet {
  return tf.memo('stoneTiles', () => {
    const S = 1024;
    const N = 4;
    const T = S / N;
    const rng = new RNG(21);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    const [r, rx] = makeCanvas(S, S);
    fill(hx, S, S, '#303030');
    fill(rx, S, S, '#f0f0f0');
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const x = i * T;
        const y = j * T;
        const warm = rng.range(-6, 6);
        const l = rng.range(150, 182) + (rng.chance(0.12) ? -35 : 0);
        ctx.fillStyle = rgba(l + warm + 4, l + warm * 0.3, l - 6 - warm * 0.5);
        ctx.fillRect(x, y, T, T);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, T, T);
        ctx.clip();
        const n = tf.noise[rng.int(1, 3)];
        ctx.globalAlpha = 0.28;
        ctx.globalCompositeOperation = 'overlay';
        ctx.drawImage(n, x - rng.range(0, T), y - rng.range(0, T), T * 2, T * 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        // Granite speckle.
        for (let k = 0; k < 420; k++) {
          ctx.fillStyle = rng.chance(0.6) ? rgba(60, 58, 56, rng.range(0.15, 0.4)) : rgba(235, 230, 222, rng.range(0.2, 0.4));
          ctx.fillRect(x + rng.range(0, T), y + rng.range(0, T), rng.range(1, 3), rng.range(1, 3));
        }
        // Dirt collects towards the grout.
        const g = ctx.createLinearGradient(x, y, x, y + T);
        g.addColorStop(0, 'rgba(50,44,38,0.18)');
        g.addColorStop(0.08, 'rgba(50,44,38,0)');
        g.addColorStop(0.92, 'rgba(50,44,38,0)');
        g.addColorStop(1, 'rgba(50,44,38,0.2)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, T, T);
        ctx.restore();
        hx.fillStyle = '#c8c8c8';
        hx.fillRect(x + 3, y + 3, T - 6, T - 6);
        const rough = rng.range(95, 150);
        rx.fillStyle = rgba(rough, rough, rough);
        rx.fillRect(x + 3, y + 3, T - 6, T - 6);
        // Chipped corners.
        if (rng.chance(0.3)) {
          const cx = x + (rng.chance(0.5) ? 3 : T - 3);
          const cy = y + (rng.chance(0.5) ? 3 : T - 3);
          ctx.fillStyle = 'rgba(70,64,58,0.8)';
          ctx.beginPath();
          ctx.arc(cx, cy, rng.range(4, 10), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    // Grout lines.
    ctx.strokeStyle = 'rgba(64,58,52,0.95)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath();
      ctx.moveTo(i * T, 0);
      ctx.lineTo(i * T, S);
      ctx.moveTo(0, i * T);
      ctx.lineTo(S, i * T);
      ctx.stroke();
    }
    for (let i = 0; i < 10; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(40, 140), 'rgba(60,50,40,1)', 0.08, rng, 5);
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 3), roughnessMap: tf.roughnessFrom(r) };
  });
}

/** Dark grey tactile warning tiles (covers 0.6 m × 0.6 m). */
export function tactileTiles(tf: TextureFactory): SurfaceSet {
  return tf.memo('tactile', () => {
    const S = 256;
    const rng = new RNG(31);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    fill(ctx, S, S, '#5d5a55');
    tf.overlayNoise(ctx, S, S, 2, 2, 0.3, 'overlay', 7);
    fill(hx, S, S, '#404040');
    const n = 5;
    for (let t = 0; t < 2; t++)
      for (let u = 0; u < 2; u++)
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const x = t * 128 + (i + 0.5) * (128 / n);
            const y = u * 128 + (j + 0.5) * (128 / n);
            const g = hx.createRadialGradient(x, y, 0, x, y, 9);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.7, '#b0b0b0');
            g.addColorStop(1, 'rgba(64,64,64,0)');
            hx.fillStyle = g;
            hx.beginPath();
            hx.arc(x, y, 9, 0, Math.PI * 2);
            hx.fill();
            ctx.fillStyle = rgba(120, 116, 110, 0.35);
            ctx.beginPath();
            ctx.arc(x - 1, y - 1, 5, 0, Math.PI * 2);
            ctx.fill();
          }
    ctx.strokeStyle = 'rgba(30,28,26,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 127, 127);
    ctx.strokeRect(129, 1, 126, 127);
    ctx.strokeRect(1, 129, 127, 126);
    ctx.strokeRect(129, 129, 126, 126);
    for (let i = 0; i < 4; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(30, 70), 'rgba(30,25,20,1)', 0.15, rng);
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 3.5) };
  });
}

/** Platform edge coping stones with a worn white edge band (u: 1.2 m along edge, v: 0.6 m across). */
export function coping(tf: TextureFactory): SurfaceSet {
  return tf.memo('coping', () => {
    const W = 512;
    const H = 256;
    const rng = new RNG(41);
    const [c, ctx] = makeCanvas(W, H);
    fill(ctx, W, H, '#a39f97');
    tf.overlayNoise(ctx, W, H, 1, 2, 0.3, 'overlay', 9);
    tf.overlayNoise(ctx, W, H, 3, 8, 0.2, 'soft-light', 10);
    // White safety band on the outer edge (v near 1), worn.
    ctx.fillStyle = 'rgba(232,230,222,0.92)';
    ctx.fillRect(0, H - 34, W, 34);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rgba(120, 114, 105, rng.range(0.2, 0.5));
      ctx.fillRect(rng.range(0, W), H - rng.range(4, 34), rng.range(4, 30), rng.range(2, 8));
    }
    // Slab joints every 0.6 m.
    ctx.fillStyle = 'rgba(40,36,32,0.85)';
    ctx.fillRect(0, 0, 3, H);
    ctx.fillRect(W / 2, 0, 3, H);
    for (let i = 0; i < 5; i++) tf.stain(ctx, W, H, rng.range(0, W), rng.range(0, H), rng.range(20, 60), 'rgba(40,34,28,1)', 0.12, rng);
    return { map: tf.tex(c) };
  });
}

/** Asbestos-cement corrugated roofing seen from below (covers 2 m × 2 m, grooves along v). */
export function roofSheet(tf: TextureFactory): SurfaceSet {
  return tf.memo('roofSheet', () => {
    const S = 512;
    const rng = new RNG(51);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    fill(ctx, S, S, '#77746e');
    tf.overlayNoise(ctx, S, S, 0, 1, 0.3, 'overlay', 12);
    const periods = 14;
    for (let x = 0; x < S; x++) {
      const p = Math.sin((x / S) * periods * Math.PI * 2);
      const v = Math.round(128 + p * 110);
      hx.fillStyle = rgba(v, v, v);
      hx.fillRect(x, 0, 1, S);
      // Soot collects in the troughs.
      ctx.fillStyle = rgba(30, 28, 26, Math.max(0, -p) * 0.18);
      ctx.fillRect(x, 0, 1, S);
    }
    // Streaks along the grooves.
    for (let i = 0; i < 80; i++) {
      const x = Math.floor(rng.range(0, periods)) * (S / periods) + rng.range(-4, 4) + S / periods / 2;
      const y = rng.range(0, S);
      const len = rng.range(60, 400);
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, 'rgba(25,22,20,0)');
      g.addColorStop(0.3, rgba(25, 22, 20, rng.range(0.1, 0.3)));
      g.addColorStop(1, 'rgba(25,22,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 3, y, rng.range(3, 9), len);
    }
    // Sheet end laps.
    for (const y of [0, S / 2]) {
      ctx.fillStyle = 'rgba(20,18,16,0.5)';
      ctx.fillRect(0, y, S, 5);
      hx.fillStyle = '#202020';
      hx.fillRect(0, y, S, 3);
    }
    for (let i = 0; i < 6; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(40, 120), 'rgba(35,30,25,1)', 0.2, rng);
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 1.6) };
  });
}

/** Translucent fibreglass skylight sheets (emissive, covers 2 m × 2 m). */
export function skylightSheet(tf: TextureFactory): SurfaceSet {
  return tf.memo('skylight', () => {
    const S = 256;
    const rng = new RNG(61);
    const [c, ctx] = makeCanvas(S, S);
    fill(ctx, S, S, '#f2eee2');
    tf.overlayNoise(ctx, S, S, 2, 2, 0.12, 'multiply', 14);
    const periods = 7;
    for (let x = 0; x < S; x++) {
      const p = Math.sin((x / S) * periods * Math.PI * 2);
      ctx.fillStyle = rgba(120, 110, 90, Math.max(0, p) * 0.18);
      ctx.fillRect(x, 0, 1, S);
    }
    for (let i = 0; i < 7; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(8, 30), rng.chance(0.7) ? 'rgba(90,92,80,1)' : 'rgba(60,56,50,1)', 0.15, rng);
    ctx.fillStyle = 'rgba(40,38,34,0.55)';
    ctx.fillRect(0, 0, S, 4);
    ctx.fillRect(0, S / 2, S, 3);
    const t = tf.tex(c);
    return { map: t, emissiveMap: t };
  });
}

/** Railway ballast: angular basalt stones with brake-dust staining (covers 2 m × 2 m). */
export function ballast(tf: TextureFactory): SurfaceSet {
  return tf.memo('ballast', () => {
    const S = 512;
    const rng = new RNG(71);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    fill(ctx, S, S, '#2a2724');
    fill(hx, S, S, '#101010');
    for (let i = 0; i < 2600; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      const r = rng.range(6, 15);
      const n = rng.int(5, 7);
      const tone = rng.range(70, 125);
      const rust = rng.chance(0.35) ? rng.range(10, 30) : 0;
      tf.wrapped(S, S, x, y, r, (px, py) => {
        const pts: [number, number][] = [];
        const a0 = rng.range(0, 6.28);
        for (let k = 0; k < n; k++) {
          const a = a0 + (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
          const rr = r * rng.range(0.65, 1);
          pts.push([px + Math.cos(a) * rr, py + Math.sin(a) * rr]);
        }
        const path = () => {
          ctx.beginPath();
          pts.forEach(([ax, ay], k) => (k ? ctx.lineTo(ax, ay) : ctx.moveTo(ax, ay)));
          ctx.closePath();
        };
        path();
        const g = ctx.createLinearGradient(px - r, py - r, px + r, py + r);
        g.addColorStop(0, rgba(tone + 35 + rust, tone + 32, tone + 28));
        g.addColorStop(1, rgba(tone * 0.6 + rust, tone * 0.58, tone * 0.55));
        ctx.fillStyle = g;
        ctx.fill();
        hx.beginPath();
        pts.forEach(([ax, ay], k) => (k ? hx.lineTo(ax, ay) : hx.moveTo(ax, ay)));
        hx.closePath();
        const hg = hx.createRadialGradient(px, py, 0, px, py, r);
        hg.addColorStop(0, '#f0f0f0');
        hg.addColorStop(1, '#505050');
        hx.fillStyle = hg;
        hx.fill();
      });
    }
    // Brake dust and oil.
    for (let i = 0; i < 12; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(40, 130), 'rgba(95,55,30,1)', 0.25, rng);
    for (let i = 0; i < 5; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(20, 60), 'rgba(10,10,10,1)', 0.35, rng);
    // Litter specks.
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rng.pick(['rgba(230,230,225,0.8)', 'rgba(200,60,50,0.7)', 'rgba(60,110,190,0.7)', 'rgba(240,200,60,0.7)']);
      ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(3, 9), rng.range(2, 6));
    }
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 4) };
  });
}

/** Painted plaster wall with monsoon streaks and splash-back grime (covers 4 m × 4 m). */
export function plaster(tf: TextureFactory, base = '#d9d2c2', seed = 81): SurfaceSet {
  return tf.memo('plaster' + base + seed, () => {
    const S = 1024;
    const rng = new RNG(seed);
    const [c, ctx] = makeCanvas(S, S);
    fill(ctx, S, S, base);
    tf.overlayNoise(ctx, S, S, 0, 1, 0.22, 'overlay', seed);
    tf.overlayNoise(ctx, S, S, 2, 4, 0.18, 'soft-light', seed + 1);
    // Vertical black streaks from ledges (the classic Mumbai monsoon look).
    for (let i = 0; i < 70; i++) {
      const x = rng.range(0, S);
      const y = rng.range(-100, S);
      const len = rng.range(80, 500);
      const w = rng.range(4, 26);
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, rgba(35, 35, 30, rng.range(0.15, 0.35)));
      g.addColorStop(1, 'rgba(35,35,30,0)');
      ctx.fillStyle = g;
      tf.wrapped(S, S, x, y + len / 2, len, (px, py) => ctx.fillRect(px - w / 2, py - len / 2, w, len));
    }
    for (let i = 0; i < 10; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(40, 160), 'rgba(90,80,60,1)', 0.12, rng);
    // Peeling patches.
    for (let i = 0; i < 6; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      tf.stain(ctx, S, S, x, y, rng.range(15, 45), 'rgba(160,155,145,1)', 0.5, rng, 3);
    }
    return { map: tf.tex(c) };
  });
}

/** Painted steel with chips and rust (covers 1 m × 1 m). */
export function paintedSteel(tf: TextureFactory, base: string, seed = 91): SurfaceSet {
  return tf.memo('steel' + base + seed, () => {
    const S = 256;
    const rng = new RNG(seed);
    const [c, ctx] = makeCanvas(S, S);
    fill(ctx, S, S, base);
    tf.overlayNoise(ctx, S, S, 1, 1, 0.2, 'overlay', seed);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rgba(rng.range(70, 110), rng.range(40, 60), rng.range(25, 35), rng.range(0.3, 0.7));
      ctx.beginPath();
      ctx.ellipse(rng.range(0, S), rng.range(0, S), rng.range(1, 5), rng.range(1, 3), rng.range(0, 3), 0, 6.3);
      ctx.fill();
    }
    for (let i = 0; i < 5; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(20, 60), 'rgba(40,36,30,1)', 0.18, rng);
    return { map: tf.tex(c) };
  });
}

export const DECAL = {
  wet: 0,
  paan: 1,
  gum: 2,
  oil: 3,
  cup: 4,
  bag: 5,
  paper: 6,
  butts: 7,
  dust: 8,
  crack: 9,
  leaves: 10,
  smear: 11,
  grate: 12,
  manhole: 13,
  spill: 14,
  dropping: 15,
} as const;

/** 4×4 atlas of ground decals with alpha. */
export function decalAtlas(tf: TextureFactory): THREE.Texture {
  return tf.memo('decals', () => {
    const C = 256;
    const S = C * 4;
    const [c, ctx] = makeCanvas(S, S);
    const rng = new RNG(101);
    const cell = (i: number, fn: (cx: number, cy: number) => void) => {
      const x = (i % 4) * C;
      const y = Math.floor(i / 4) * C;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, C, C);
      ctx.clip();
      fn(x + C / 2, y + C / 2);
      ctx.restore();
    };
    const blob = (cx: number, cy: number, r: number, col: string, a: number, n = 7) => {
      for (let k = 0; k < n; k++) {
        const bx = cx + rng.range(-r, r) * 0.5;
        const by = cy + rng.range(-r, r) * 0.5;
        const br = r * rng.range(0.35, 0.8);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, col);
        g.addColorStop(0.7, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, 6.3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    cell(DECAL.wet, (x, y) => blob(x, y, 110, 'rgba(25,24,22,1)', 0.35, 9));
    cell(DECAL.paan, (x, y) => {
      blob(x, y, 45, 'rgba(120,28,18,1)', 0.75, 5);
      for (let k = 0; k < 30; k++) {
        const a = rng.range(0, 6.3);
        const d = rng.range(30, 110);
        ctx.fillStyle = rgba(125, 30, 20, rng.range(0.5, 0.85));
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, rng.range(2, 9), rng.range(1.5, 5), a, 0, 6.3);
        ctx.fill();
      }
    });
    cell(DECAL.gum, (x, y) => {
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = rgba(28, 26, 24, rng.range(0.5, 0.85));
        ctx.beginPath();
        ctx.ellipse(x + rng.gauss() * 45, y + rng.gauss() * 45, rng.range(3, 8), rng.range(3, 7), rng.range(0, 3), 0, 6.3);
        ctx.fill();
      }
    });
    cell(DECAL.oil, (x, y) => {
      blob(x, y, 90, 'rgba(10,10,12,1)', 0.55, 8);
      blob(x + 10, y, 40, 'rgba(40,30,60,1)', 0.25, 3);
    });
    cell(DECAL.cup, (x, y) => {
      // Crushed white plastic tea cups.
      for (let k = 0; k < 3; k++) {
        const px = x + rng.range(-70, 70);
        const py = y + rng.range(-70, 70);
        ctx.fillStyle = 'rgba(240,238,230,0.95)';
        ctx.beginPath();
        ctx.ellipse(px, py, rng.range(14, 22), rng.range(8, 14), rng.range(0, 3), 0, 6.3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(150,140,120,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(150,110,60,0.6)';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 6.3);
        ctx.fill();
      }
    });
    cell(DECAL.bag, (x, y) => {
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(235,235,240,0.85)' : 'rgba(80,120,200,0.8)';
      ctx.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * 6.3;
        const d = rng.range(40, 90);
        k ? ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7) : ctx.moveTo(x + d, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      for (let k = 0; k < 8; k++) {
        ctx.beginPath();
        ctx.moveTo(x + rng.range(-60, 60), y + rng.range(-40, 40));
        ctx.lineTo(x + rng.range(-60, 60), y + rng.range(-40, 40));
        ctx.stroke();
      }
    });
    cell(DECAL.paper, (x, y) => {
      ctx.translate(x, y);
      ctx.rotate(rng.range(0, 3));
      ctx.fillStyle = 'rgba(215,210,195,0.95)';
      ctx.fillRect(-80, -55, 160, 110);
      ctx.fillStyle = 'rgba(60,60,60,0.5)';
      for (let k = 0; k < 14; k++) ctx.fillRect(-70 + (k % 2) * 75, -45 + Math.floor(k / 2) * 13, 65, 4);
      ctx.fillStyle = 'rgba(80,70,50,0.25)';
      ctx.fillRect(-80, 0, 160, 3);
    });
    cell(DECAL.butts, (x, y) => {
      for (let k = 0; k < 9; k++) {
        const px = x + rng.range(-90, 90);
        const py = y + rng.range(-90, 90);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rng.range(0, 6.3));
        ctx.fillStyle = 'rgba(230,225,215,0.95)';
        ctx.fillRect(-8, -2.5, 12, 5);
        ctx.fillStyle = 'rgba(200,140,60,0.95)';
        ctx.fillRect(4, -2.5, 5, 5);
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(200,40,40,0.8)';
      ctx.fillRect(x - 20, y + 30, 26, 16);
    });
    cell(DECAL.dust, (x, y) => blob(x, y, 110, 'rgba(120,105,85,1)', 0.35, 10));
    cell(DECAL.crack, (x, y) => {
      for (let k = 0; k < 4; k++) tf.crack(ctx, S, S, x + rng.range(-30, 30), y + rng.range(-30, 30), rng.range(60, 140), rng, 'rgba(25,22,20,0.8)', 2);
    });
    cell(DECAL.leaves, (x, y) => {
      for (let k = 0; k < 14; k++) {
        const px = x + rng.range(-90, 90);
        const py = y + rng.range(-90, 90);
        ctx.fillStyle = rgba(rng.range(110, 160), rng.range(80, 110), rng.range(30, 50), 0.9);
        ctx.beginPath();
        ctx.ellipse(px, py, rng.range(8, 16), rng.range(4, 7), rng.range(0, 3), 0, 6.3);
        ctx.fill();
      }
    });
    cell(DECAL.smear, (x, y) => {
      for (let k = 0; k < 6; k++) blob(x + rng.range(-60, 60), y + rng.range(-60, 60), 35, 'rgba(60,50,40,1)', 0.25, 2);
    });
    cell(DECAL.grate, (x, y) => {
      ctx.fillStyle = 'rgba(45,43,40,1)';
      ctx.fillRect(x - 100, y - 100, 200, 200);
      ctx.fillStyle = 'rgba(10,10,10,1)';
      for (let k = 0; k < 10; k++) ctx.fillRect(x - 90 + k * 18.5, y - 90, 10, 180);
      ctx.strokeStyle = 'rgba(90,70,50,0.9)';
      ctx.lineWidth = 6;
      ctx.strokeRect(x - 100, y - 100, 200, 200);
    });
    cell(DECAL.manhole, (x, y) => {
      ctx.fillStyle = 'rgba(55,52,48,1)';
      ctx.beginPath();
      ctx.arc(x, y, 110, 0, 6.3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,28,26,1)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(80,76,70,1)';
      ctx.lineWidth = 3;
      for (let k = -4; k <= 4; k++) {
        ctx.beginPath();
        ctx.moveTo(x - 90, y + k * 20);
        ctx.lineTo(x + 90, y + k * 20);
        ctx.stroke();
      }
    });
    cell(DECAL.spill, (x, y) => blob(x, y, 70, 'rgba(110,70,30,1)', 0.35, 6));
    cell(DECAL.dropping, (x, y) => {
      for (let k = 0; k < 12; k++) {
        ctx.fillStyle = rgba(235, 235, 225, 0.9);
        ctx.beginPath();
        ctx.arc(x + rng.gauss() * 50, y + rng.gauss() * 50, rng.range(3, 9), 0, 6.3);
        ctx.fill();
      }
    });
    const t = tf.tex(c, { wrap: false });
    return t;
  });
}

/** Road asphalt with aggregate, patch repairs, oil and tyre polish (covers 6 m × 6 m). */
export function asphalt(tf: TextureFactory): SurfaceSet {
  return tf.memo('asphalt', () => {
    const S = 512;
    const rng = new RNG(121);
    const [c, ctx] = makeCanvas(S, S);
    const [r, rx] = makeCanvas(S, S);
    fill(ctx, S, S, '#57554f');
    tf.overlayNoise(ctx, S, S, 0, 1, 0.3, 'overlay', 21);
    tf.overlayNoise(ctx, S, S, 3, 10, 0.35, 'overlay', 22);
    fill(rx, S, S, '#d8d8d8');
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = rng.chance(0.5) ? rgba(120, 118, 112, rng.range(0.2, 0.5)) : rgba(15, 15, 14, rng.range(0.2, 0.5));
      ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 2.5), rng.range(1, 2.5));
    }
    // Patch repairs (darker, fresher) and worn lighter areas.
    for (let i = 0; i < 4; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      const w = rng.range(40, 160);
      const h = rng.range(30, 120);
      tf.wrapped(S, S, x, y, Math.max(w, h), (px, py) => {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(25,25,24,0.55)' : 'rgba(80,78,72,0.4)';
        ctx.fillRect(px, py, w, h);
      });
    }
    for (let i = 0; i < 10; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(20, 70), 'rgba(10,10,10,1)', 0.25, rng);
    for (let i = 0; i < 6; i++) tf.stain(rx, S, S, rng.range(0, S), rng.range(0, S), rng.range(40, 100), 'rgba(120,120,120,1)', 0.4, rng);
    for (let i = 0; i < 8; i++) tf.crack(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(30, 120), rng, 'rgba(10,10,10,0.6)', 1.5);
    return { map: tf.tex(c), roughnessMap: tf.roughnessFrom(r) };
  });
}

/** Interlocking concrete paver blocks of Mumbai footpaths (covers 2 m × 2 m). */
export function pavers(tf: TextureFactory): SurfaceSet {
  return tf.memo('pavers', () => {
    const S = 512;
    const rng = new RNG(131);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    fill(ctx, S, S, '#3a3632');
    fill(hx, S, S, '#202020');
    const bw = 51;
    const bh = 25.6;
    for (let row = 0; row < S / bh; row++)
      for (let col = -1; col < S / bw + 1; col++) {
        const x = col * bw + (row % 2) * (bw / 2);
        const y = row * bh;
        const red = row % 10 === 0 || row % 10 === 1;
        const l = rng.range(118, 146);
        ctx.fillStyle = red ? rgba(l * 0.92, l * 0.66, l * 0.58) : rgba(l, l * 0.975, l * 0.94);
        ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        hx.fillStyle = '#d0d0d0';
        hx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    tf.overlayNoise(ctx, S, S, 1, 2, 0.3, 'overlay', 23);
    for (let i = 0; i < 16; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(20, 90), 'rgba(40,32,24,1)', 0.18, rng);
    for (let i = 0; i < 3; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(8, 18), 'rgba(110,35,25,1)', 0.25, rng, 3);
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 2.5) };
  });
}

/** Black-and-yellow painted kerb stones (u along the kerb: 1 m per stripe pair). */
export function kerbStripes(tf: TextureFactory): SurfaceSet {
  return tf.memo('kerb', () => {
    const [c, ctx] = makeCanvas(256, 64);
    ctx.fillStyle = '#e0b92a';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#161616';
    ctx.fillRect(128, 0, 128, 64);
    tf.overlayNoise(ctx, 256, 64, 2, 2, 0.35, 'overlay', 24);
    const rng = new RNG(140);
    for (let i = 0; i < 20; i++) tf.stain(ctx, 256, 64, rng.range(0, 256), rng.range(0, 64), rng.range(6, 20), 'rgba(90,80,70,1)', 0.4, rng, 3);
    return { map: tf.tex(c) };
  });
}

/** Sun-dried maidan grass (covers 4 m × 4 m). */
export function grass(tf: TextureFactory): SurfaceSet {
  return tf.memo('grass', () => {
    const S = 512;
    const rng = new RNG(151);
    const [c, ctx] = makeCanvas(S, S);
    fill(ctx, S, S, '#5f6e37');
    tf.overlayNoise(ctx, S, S, 0, 1, 0.45, 'overlay', 31);
    tf.overlayNoise(ctx, S, S, 2, 6, 0.35, 'overlay', 32);
    for (let i = 0; i < 9000; i++) {
      ctx.strokeStyle = rng.chance(0.3) ? rgba(150, 140, 80, 0.5) : rgba(60, 90, 40, 0.5);
      ctx.lineWidth = 1;
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-2, 2), y - rng.range(3, 8));
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(40, 120), 'rgba(130,110,70,1)', 0.25, rng);
    return { map: tf.tex(c) };
  });
}
