import * as THREE from 'three';
import { RNG } from '../core/Random';
import { makeCanvas, rgba, type Ctx, type TextureFactory } from './TextureFactory';

/**
 * Facade "cells" (one bay × one storey) packed in a texture array.
 * RGB = albedo (to be tinted), A = window mask (1 = glass: night lights + reflections).
 */
export const FACADE = {
  deco: 0, // Art Deco residential: eyebrow chajjas, banded parapets
  decoBalcony: 1, // Art Deco with rounded balcony and railing
  office: 2, // ribbon windows
  grille: 3, // 70s/80s block with steel window grilles and AC units
  stone: 4, // Victorian/Indo-Saracenic basalt with arched windows
  shop: 5, // ground-floor shopfront with shutters and a signboard
  blank: 6, // side wall
  glass: 7, // curtain wall
  station: 8, // station building offices: strip windows with grilles
  chawl: 9, // old mansion: wooden louvred windows, verandah
  decoCinema: 10, // Eros-style Art Deco: cream, vertical window strips between fins
  sandstone: 11, // red Agra sandstone base with shopfronts
} as const;
export const FACADE_LAYERS = 12;
const S = 256;

type Painter = (ctx: Ctx, rng: RNG, tf: TextureFactory) => { mask: (ctx: Ctx) => void };

function weather(ctx: Ctx, rng: RNG, tf: TextureFactory, amount = 1): void {
  tf.overlayNoise(ctx, S, S, 1, 1, 0.16 * amount, 'overlay', rng.int(0, 99));
  for (let i = 0; i < 14 * amount; i++) {
    const x = rng.range(0, S);
    const len = rng.range(40, 200);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, rgba(30, 30, 26, rng.range(0.12, 0.3) * amount));
    g.addColorStop(1, 'rgba(30,30,26,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, rng.range(-20, 60), rng.range(3, 12), len);
  }
}

function window(ctx: Ctx, x: number, y: number, w: number, h: number, frame: string, glass: string, rng: RNG, bars = 0, shutters = false): void {
  ctx.fillStyle = frame;
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, glass);
  g.addColorStop(1, rgba(20, 24, 30, 1));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Curtains / interior variation.
  if (rng.chance(0.6)) {
    ctx.fillStyle = rgba(rng.range(120, 220), rng.range(100, 190), rng.range(80, 170), 0.55);
    ctx.fillRect(x + (rng.chance(0.5) ? 0 : w * 0.5), y, w * rng.range(0.3, 0.5), h);
  }
  ctx.strokeStyle = frame;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h * 0.35);
  ctx.lineTo(x + w, y + h * 0.35);
  ctx.stroke();
  if (bars) {
    ctx.strokeStyle = 'rgba(40,40,40,0.9)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= bars; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (w * i) / (bars + 1), y);
      ctx.lineTo(x + (w * i) / (bars + 1), y + h);
      ctx.stroke();
    }
  }
  if (shutters) {
    ctx.fillStyle = rgba(90, 70, 50, 0.95);
    for (let i = 0; i < h; i += 6) ctx.fillRect(x, y + i, w * 0.48, 3);
  }
}

const painters: Record<number, Painter> = {
  [FACADE.deco]: (ctx, rng, tf) => {
    ctx.fillStyle = '#e9e1cf';
    ctx.fillRect(0, 0, S, S);
    // Horizontal banding and an eyebrow chajja shadow over the window.
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 12, S, 8);
    window(ctx, 58, 70, 140, 120, '#4f4a42', '#39434d', rng, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(40, 52, 176, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(40, 44, 176, 8);
    weather(ctx, rng, tf);
    return { mask: (m) => m.fillRect(58, 70, 140, 120) };
  },
  [FACADE.decoBalcony]: (ctx, rng, tf) => {
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(0, 0, S, S);
    window(ctx, 40, 50, 176, 150, '#4a4540', '#33404a', rng, 0, rng.chance(0.4));
    // Balcony slab and railing bars.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(10, 206, S - 20, 10);
    ctx.fillStyle = '#d9d0bc';
    ctx.fillRect(10, 196, S - 20, 10);
    ctx.fillStyle = '#3a3a38';
    for (let x = 16; x < S - 16; x += 12) ctx.fillRect(x, 150, 3, 48);
    ctx.fillRect(14, 148, S - 28, 4);
    weather(ctx, rng, tf);
    return { mask: (m) => m.fillRect(40, 50, 176, 98) };
  },
  [FACADE.office]: (ctx, rng, tf) => {
    ctx.fillStyle = '#b9b8b2';
    ctx.fillRect(0, 0, S, S);
    const g = ctx.createLinearGradient(0, 80, 0, 200);
    g.addColorStop(0, '#5d7486');
    g.addColorStop(1, '#27323c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 80, S, 120);
    ctx.fillStyle = '#2a2a2a';
    for (let x = 0; x < S; x += 64) ctx.fillRect(x, 80, 4, 120);
    weather(ctx, rng, tf, 0.6);
    return { mask: (m) => m.fillRect(0, 80, S, 120) };
  },
  [FACADE.grille]: (ctx, rng, tf) => {
    ctx.fillStyle = '#e2ddd2';
    ctx.fillRect(0, 0, S, S);
    window(ctx, 50, 66, 156, 124, '#6d6a64', '#3a4550', rng, 0, rng.chance(0.3));
    // Projecting steel grille box (very Mumbai).
    ctx.strokeStyle = 'rgba(35,35,35,0.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(44, 60, 168, 136);
    for (let x = 56; x < 210; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 60);
      ctx.lineTo(x, 196);
      ctx.stroke();
    }
    if (rng.chance(0.5)) {
      ctx.fillStyle = '#d8d8d4';
      ctx.fillRect(150, 150, 60, 40);
      ctx.fillStyle = '#9a9a96';
      for (let i = 0; i < 5; i++) ctx.fillRect(154, 154 + i * 7, 52, 3);
    }
    weather(ctx, rng, tf, 1.3);
    return { mask: (m) => m.fillRect(50, 66, 156, 124) };
  },
  [FACADE.stone]: (ctx, rng, tf) => {
    ctx.fillStyle = '#5f5a52';
    ctx.fillRect(0, 0, S, S);
    // Ashlar courses.
    for (let y = 0; y < S; y += 22) {
      ctx.fillStyle = rgba(40, 36, 32, 0.6);
      ctx.fillRect(0, y, S, 2);
      for (let x = (y / 22) % 2 ? 0 : 30; x < S; x += 60) ctx.fillRect(x, y, 2, 22);
    }
    // Limestone arch surround and pointed-arch window.
    ctx.fillStyle = '#d8ccb2';
    ctx.beginPath();
    ctx.moveTo(62, 220);
    ctx.lineTo(62, 110);
    ctx.quadraticCurveTo(62, 40, 128, 26);
    ctx.quadraticCurveTo(194, 40, 194, 110);
    ctx.lineTo(194, 220);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2c3238';
    ctx.beginPath();
    ctx.moveTo(78, 214);
    ctx.lineTo(78, 112);
    ctx.quadraticCurveTo(78, 56, 128, 44);
    ctx.quadraticCurveTo(178, 56, 178, 112);
    ctx.lineTo(178, 214);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#d8ccb2';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(128, 50);
    ctx.lineTo(128, 214);
    ctx.stroke();
    weather(ctx, rng, tf, 0.8);
    return {
      mask: (m) => {
        m.beginPath();
        m.moveTo(78, 214);
        m.lineTo(78, 112);
        m.quadraticCurveTo(78, 56, 128, 44);
        m.quadraticCurveTo(178, 56, 178, 112);
        m.lineTo(178, 214);
        m.closePath();
        m.fill();
      },
    };
  },
  [FACADE.shop]: (ctx, rng, tf) => {
    ctx.fillStyle = '#cfc8b8';
    ctx.fillRect(0, 0, S, S);
    // Signboard band.
    const cols = ['#b71c1c', '#0d47a1', '#1b5e20', '#f9a825', '#4a148c', '#e65100', '#006064'];
    ctx.fillStyle = rng.pick(cols);
    ctx.fillRect(8, 20, S - 16, 50);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 5; i++) ctx.fillRect(24 + i * 44, 34, 30, 22);
    // Opening with a half-raised rolling shutter.
    ctx.fillStyle = '#1b1a18';
    ctx.fillRect(20, 84, S - 40, 172);
    ctx.fillStyle = rgba(140, 130, 110, 0.9);
    ctx.fillRect(30, 150, 60, 80);
    ctx.fillRect(150, 160, 70, 70);
    ctx.fillStyle = '#8c8e8a';
    const sh = rng.range(20, 80);
    for (let y = 84; y < 84 + sh; y += 6) ctx.fillRect(20, y, S - 40, 4);
    weather(ctx, rng, tf, 0.9);
    return { mask: (m) => m.fillRect(20, 84 + sh, S - 40, 172 - sh) };
  },
  [FACADE.blank]: (ctx, rng, tf) => {
    ctx.fillStyle = '#d7d0c2';
    ctx.fillRect(0, 0, S, S);
    weather(ctx, rng, tf, 1.5);
    return { mask: () => undefined };
  },
  [FACADE.glass]: (ctx, rng, tf) => {
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#6f8f9e');
    g.addColorStop(1, '#2d4552');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#1c2429';
    for (let x = 0; x < S; x += 64) ctx.fillRect(x, 0, 5, S);
    ctx.fillRect(0, 0, S, 10);
    ctx.fillRect(0, 170, S, 8);
    weather(ctx, rng, tf, 0.3);
    return { mask: (m) => m.fillRect(0, 10, S, 160) };
  },
  [FACADE.station]: (ctx, rng, tf) => {
    ctx.fillStyle = '#e7e5de';
    ctx.fillRect(0, 0, S, S);
    // Strip window with steel grille, AC unit below some.
    window(ctx, 22, 70, 212, 100, '#5b5b58', '#3d4852', rng, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 196, S, 14);
    if (rng.chance(0.5)) {
      ctx.fillStyle = '#e0e0dc';
      ctx.fillRect(170, 182, 56, 36);
      ctx.fillStyle = '#9a9a96';
      for (let i = 0; i < 4; i++) ctx.fillRect(174, 186 + i * 8, 48, 3);
    }
    weather(ctx, rng, tf, 1.1);
    return { mask: (m) => m.fillRect(22, 70, 212, 100) };
  },
  [FACADE.chawl]: (ctx, rng, tf) => {
    ctx.fillStyle = '#d9c9a8';
    ctx.fillRect(0, 0, S, S);
    window(ctx, 60, 56, 136, 150, '#5a3e28', '#2e3136', rng, 0, true);
    ctx.fillStyle = '#6b4a30';
    for (let y = 60; y < 200; y += 8) ctx.fillRect(130, y, 62, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 216, S, 12);
    weather(ctx, rng, tf, 1.4);
    return { mask: (m) => m.fillRect(60, 56, 70, 150) };
  },
  [FACADE.decoCinema]: (ctx, rng, tf) => {
    ctx.fillStyle = '#e9dfc6';
    ctx.fillRect(0, 0, S, S);
    // Vertical fins either side, a recessed window strip in the middle with spandrel bands.
    ctx.fillStyle = '#d7cbb0';
    ctx.fillRect(0, 0, 34, S);
    ctx.fillRect(S - 34, 0, 34, S);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(4, 0, 8, S);
    ctx.fillRect(S - 30, 0, 8, S);
    window(ctx, 58, 40, 140, 150, '#6b6254', '#34404a', rng, 3);
    ctx.fillStyle = '#c9b996';
    ctx.fillRect(50, 206, 156, 22);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < 3; k++) ctx.fillRect(56, 210 + k * 6, 144, 2);
    weather(ctx, rng, tf, 0.9);
    return { mask: (m) => m.fillRect(58, 40, 140, 150) };
  },
  [FACADE.sandstone]: (ctx, rng, tf) => {
    ctx.fillStyle = '#9b4f3a';
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 32) {
      ctx.fillStyle = 'rgba(60,25,18,0.5)';
      ctx.fillRect(0, y, S, 2);
    }
    tf.overlayNoise(ctx, S, S, 1, 2, 0.25, 'overlay', 77);
    // Glazed shopfront / foyer with a stepped deco head.
    ctx.fillStyle = '#5c2b1f';
    ctx.fillRect(40, 70, 176, 186);
    const g = ctx.createLinearGradient(0, 90, 0, 256);
    g.addColorStop(0, '#2f3438');
    g.addColorStop(1, '#171a1c');
    ctx.fillStyle = g;
    ctx.fillRect(52, 90, 152, 166);
    ctx.fillStyle = 'rgba(255,220,150,0.35)';
    ctx.fillRect(60, 180, 136, 60);
    ctx.fillStyle = '#c8b37a';
    ctx.fillRect(40, 56, 176, 10);
    ctx.fillRect(64, 44, 128, 10);
    weather(ctx, rng, tf, 0.7);
    return { mask: (m) => m.fillRect(52, 90, 152, 166) };
  },
};

/** Builds the facade texture array (RGBA8, mipmapped). */
export function buildFacadeArray(tf: TextureFactory): THREE.DataArrayTexture {
  const data = new Uint8Array(S * S * 4 * FACADE_LAYERS);
  for (let l = 0; l < FACADE_LAYERS; l++) {
    const rng = new RNG(700 + l * 31);
    const [, ctx] = makeCanvas(S, S);
    const res = painters[l](ctx, rng, tf);
    const [, mctx] = makeCanvas(S, S);
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, S, S);
    mctx.fillStyle = '#fff';
    res.mask(mctx);
    const rgb = ctx.getImageData(0, 0, S, S).data;
    const m = mctx.getImageData(0, 0, S, S).data;
    // Flip vertically so v=0 is the bottom of the cell.
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const src = ((S - 1 - y) * S + x) * 4;
        const dst = l * S * S * 4 + (y * S + x) * 4;
        data[dst] = rgb[src];
        data[dst + 1] = rgb[src + 1];
        data[dst + 2] = rgb[src + 2];
        data[dst + 3] = m[src];
      }
  }
  const tex = new THREE.DataArrayTexture(data, S, S, FACADE_LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
