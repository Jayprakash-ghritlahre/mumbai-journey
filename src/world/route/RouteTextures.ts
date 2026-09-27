import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { makeCanvas, rgba, type TextureFactory } from '../../gfx/TextureFactory';
import type { SurfaceSet } from '../../gfx/Surfaces';

const fill = (ctx: CanvasRenderingContext2D, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, w, h);
};

/** Marine Drive promenade: dark grey rectangular pavers in running bond (covers 3 m × 3 m). */
export function promenadePavers(tf: TextureFactory): SurfaceSet {
  return tf.memo('promenadePavers', () => {
    const S = 768;
    const rng = new RNG(301);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    const [r, rx] = makeCanvas(S, S);
    fill(ctx, S, S, '#2e2c2a');
    fill(hx, S, S, '#1a1a1a');
    fill(rx, S, S, '#e0e0e0');
    const bw = S / 10; // 0.3 m
    const bh = S / 20; // 0.15 m
    for (let row = 0; row < 20; row++)
      for (let col = -1; col < 11; col++) {
        const x = col * bw + (row % 2) * (bw / 2);
        const y = row * bh;
        const l = rng.range(78, 104) + (rng.chance(0.06) ? -18 : 0);
        ctx.fillStyle = rgba(l, l * 0.98, l * 0.95);
        ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        hx.fillStyle = '#cfcfcf';
        hx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        const rr = rng.range(150, 210);
        rx.fillStyle = rgba(rr, rr, rr);
        rx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    tf.overlayNoise(ctx, S, S, 1, 2, 0.25, 'overlay', 41);
    for (let i = 0; i < 14; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(30, 110), 'rgba(15,12,10,1)', 0.18, rng);
    for (let i = 0; i < 10; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(20, 60), 'rgba(120,110,95,1)', 0.12, rng);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = rgba(20, 18, 16, rng.range(0.3, 0.6));
      ctx.beginPath();
      ctx.arc(rng.range(0, S), rng.range(0, S), rng.range(1.5, 3.5), 0, 6.3);
      ctx.fill();
    }
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 2.2), roughnessMap: tf.roughnessFrom(r) };
  });
}

/** Plain grey interlocking footpath pavers of V.N. Road (covers 2 m × 2 m). */
export function footpathPavers(tf: TextureFactory): SurfaceSet {
  return tf.memo('footpathPavers', () => {
    const S = 512;
    const rng = new RNG(311);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    fill(ctx, S, S, '#3c3a37');
    fill(hx, S, S, '#1c1c1c');
    const bw = S / 9;
    const bh = S / 18;
    for (let row = 0; row < 18; row++)
      for (let col = -1; col < 10; col++) {
        const x = col * bw + (row % 2) * (bw / 2);
        const y = row * bh;
        const l = rng.range(112, 142);
        ctx.fillStyle = rgba(l, l * 0.985, l * 0.955);
        ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        hx.fillStyle = '#d0d0d0';
        hx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    tf.overlayNoise(ctx, S, S, 1, 2, 0.28, 'overlay', 43);
    for (let i = 0; i < 16; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(20, 80), 'rgba(40,32,24,1)', 0.2, rng);
    // Sunken / broken pavers.
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(rng.range(0, 9)) * bw;
      const y = Math.floor(rng.range(0, 18)) * bh;
      ctx.fillStyle = 'rgba(30,25,20,0.55)';
      ctx.fillRect(x, y, bw, bh);
    }
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 2.5) };
  });
}

/** Weathered sea-wall concrete: light grey, formwork seams, dark rain streaks (covers 4 m × 2 m). */
export function seaWallConcrete(tf: TextureFactory): SurfaceSet {
  return tf.memo('seaWall', () => {
    const W = 1024;
    const Hh = 512;
    const rng = new RNG(321);
    const [c, ctx] = makeCanvas(W, Hh);
    const [h, hx] = makeCanvas(W, Hh);
    fill(ctx, W, Hh, '#b4b0a7');
    fill(hx, W, Hh, '#808080');
    tf.overlayNoise(ctx, W, Hh, 0, 1, 0.3, 'overlay', 51);
    tf.overlayNoise(ctx, W, Hh, 3, 10, 0.2, 'soft-light', 52);
    tf.overlayNoise(hx, W, Hh, 3, 12, 0.5, 'overlay', 53);
    // Expansion joints every 4 m and formwork lines.
    for (const [cc, col, w] of [
      [ctx, 'rgba(50,48,44,0.7)', 3],
      [hx, 'rgba(0,0,0,1)', 4],
    ] as [CanvasRenderingContext2D, string, number][]) {
      cc.fillStyle = col;
      cc.fillRect(0, 0, w, Hh);
      cc.fillRect(W / 2, 0, w * 0.5, Hh);
    }
    for (let i = 0; i < 60; i++) {
      const x = rng.range(0, W);
      const len = rng.range(40, 300);
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, rgba(60, 58, 52, rng.range(0.1, 0.25)));
      g.addColorStop(1, 'rgba(60,58,52,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, rng.range(4, 22), len);
    }
    for (let i = 0; i < 18; i++) tf.stain(ctx, W, Hh, rng.range(0, W), rng.range(0, Hh), rng.range(30, 110), 'rgba(70,64,56,1)', 0.12, rng);
    // Graffiti-free but full of small chips.
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = rgba(90, 86, 80, rng.range(0.2, 0.5));
      ctx.fillRect(rng.range(0, W), rng.range(0, Hh), rng.range(1, 3), rng.range(1, 3));
    }
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 1.5) };
  });
}

/** Tetrapod concrete: rough dark grey with pores (covers 2 m × 2 m). */
export function tetrapodConcrete(tf: TextureFactory): SurfaceSet {
  return tf.memo('tetrapod', () => {
    const S = 512;
    const rng = new RNG(331);
    const [c, ctx] = makeCanvas(S, S);
    const [h, hx] = makeCanvas(S, S);
    fill(ctx, S, S, '#6d6a64');
    fill(hx, S, S, '#909090');
    tf.overlayNoise(ctx, S, S, 1, 2, 0.4, 'overlay', 61);
    tf.overlayNoise(ctx, S, S, 3, 8, 0.3, 'overlay', 62);
    tf.overlayNoise(hx, S, S, 3, 8, 0.6, 'overlay', 63);
    for (let i = 0; i < 2600; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      const r = rng.range(0.8, 3);
      ctx.fillStyle = rgba(30, 28, 26, rng.range(0.3, 0.7));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.3);
      ctx.fill();
      hx.fillStyle = 'rgba(0,0,0,0.8)';
      hx.beginPath();
      hx.arc(x, y, r, 0, 6.3);
      hx.fill();
    }
    for (let i = 0; i < 20; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(20, 80), 'rgba(35,33,30,1)', 0.25, rng);
    return { map: tf.tex(c), normalMap: tf.normalFromHeight(h, 3) };
  });
}

/** Black-and-white painted kerb (u: 1 m per stripe pair). */
export function kerbBlackWhite(tf: TextureFactory): SurfaceSet {
  return tf.memo('kerbBW', () => {
    const [c, ctx] = makeCanvas(256, 64);
    ctx.fillStyle = '#d9d6cc';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#141414';
    ctx.fillRect(128, 0, 128, 64);
    tf.overlayNoise(ctx, 256, 64, 2, 2, 0.35, 'overlay', 71);
    const rng = new RNG(72);
    for (let i = 0; i < 26; i++) tf.stain(ctx, 256, 64, rng.range(0, 256), rng.range(0, 64), rng.range(5, 18), 'rgba(90,82,70,1)', 0.45, rng, 3);
    return { map: tf.tex(c) };
  });
}

/** Tileable ocean detail normal map (two octaves of ripples). */
export function oceanNormals(tf: TextureFactory): THREE.Texture {
  return tf.memo('oceanNormals', () => {
    const S = 512;
    const [h, hx] = makeCanvas(S, S);
    const img = hx.createImageData(S, S);
    const d = img.data;
    // Sum of periodic sine waves in several directions → perfectly tileable.
    const waves: [number, number, number, number][] = [];
    const rng = new RNG(81);
    for (let i = 0; i < 22; i++) {
      const kx = Math.round(rng.range(-9, 9));
      const ky = Math.round(rng.range(2, 12)) * (rng.chance(0.5) ? 1 : -1);
      waves.push([kx, ky, rng.range(0.3, 1) / Math.sqrt(kx * kx + ky * ky), rng.range(0, 6.28)]);
    }
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let v = 0;
        for (const [kx, ky, a, ph] of waves) v += a * Math.sin(((kx * x + ky * y) / S) * Math.PI * 2 + ph);
        const g = Math.max(0, Math.min(255, 128 + v * 90));
        const o = (y * S + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = g;
        d[o + 3] = 255;
      }
    hx.putImageData(img, 0, 0);
    const t = tf.normalFromHeight(h, 3.2);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}
