import * as THREE from 'three';
import { RNG, fbm } from '../core/Random';

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  return [c, ctx];
}

export interface TexOpts {
  srgb?: boolean;
  repeat?: [number, number];
  wrap?: boolean;
  mips?: boolean;
}

/**
 * Procedural texture toolkit: tileable noise banks, stain/grime painting and
 * height→normal conversion. Everything is generated at runtime from seeds.
 */
export class TextureFactory {
  readonly noise: HTMLCanvasElement[] = [];
  private anisotropy: number;
  private cache = new Map<string, unknown>();

  constructor(anisotropy: number) {
    this.anisotropy = Math.min(8, anisotropy);
    // Tileable grayscale noise at a few frequencies.
    const periods = [4, 8, 16, 32];
    periods.forEach((p, i) => this.noise.push(this.noiseCanvas(256, p, 5, 101 + i * 17)));
  }

  memo<T>(key: string, fn: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key) as T;
  }

  private noiseCanvas(size: number, period: number, octaves: number, seed: number): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(size, size);
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const s = period / size;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = fbm(x * s, y * s, octaves, seed, period);
        const g = Math.max(0, Math.min(255, (v - 0.5) * 1.9 * 255 + 128));
        const o = (y * size + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = g;
        d[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  tex(canvas: HTMLCanvasElement, o: TexOpts = {}): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (o.wrap !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
    t.anisotropy = this.anisotropy;
    t.generateMipmaps = o.mips !== false;
    t.minFilter = o.mips === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /** Overlays tiled noise with a composite mode. `scale` = how many noise tiles across the canvas. */
  overlayNoise(ctx: Ctx, w: number, h: number, level: number, scale: number, alpha: number, op: GlobalCompositeOperation = 'overlay', offset = 0): void {
    const n = this.noise[Math.max(0, Math.min(this.noise.length - 1, level))];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    const tw = w / scale;
    const th = h / scale;
    const ox = (offset * 37.3) % tw;
    const oy = (offset * 53.1) % th;
    for (let x = -tw; x < w + tw; x += tw) for (let y = -th; y < h + th; y += th) ctx.drawImage(n, x + ox, y + oy, tw, th);
    ctx.restore();
  }

  /** Draws `fn` at (x,y) and at wrapped copies so the texture tiles seamlessly. */
  wrapped(w: number, h: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
    for (const dx of [-w, 0, w])
      for (const dy of [-h, 0, h]) {
        const px = x + dx;
        const py = y + dy;
        if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
        fn(px, py);
      }
  }

  /** Soft irregular stain: several overlapping radial gradients. */
  stain(ctx: Ctx, w: number, h: number, x: number, y: number, r: number, color: string, alpha: number, rng: RNG, blobs = 5): void {
    this.wrapped(w, h, x, y, r * 1.6, (px, py) => {
      for (let i = 0; i < blobs; i++) {
        const bx = px + rng.range(-r, r) * 0.6;
        const by = py + rng.range(-r, r) * 0.6;
        const br = r * rng.range(0.35, 1);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = alpha * rng.range(0.5, 1);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }

  /** Random-walk crack line. */
  crack(ctx: Ctx, w: number, h: number, x: number, y: number, len: number, rng: RNG, color = 'rgba(20,18,16,0.55)', width = 1.2): void {
    this.wrapped(w, h, x, y, len, (px, py) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(px, py);
      let a = rng.range(0, Math.PI * 2);
      let cx = px;
      let cy = py;
      const steps = Math.ceil(len / 4);
      for (let i = 0; i < steps; i++) {
        a += rng.range(-0.6, 0.6);
        cx += Math.cos(a) * 4;
        cy += Math.sin(a) * 4;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    });
  }

  /** Converts a grayscale height canvas into a tangent-space normal map. */
  normalFromHeight(height: HTMLCanvasElement, strength: number, repeat?: [number, number]): THREE.CanvasTexture {
    const w = height.width;
    const h = height.height;
    const src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
    const [c, ctx] = makeCanvas(w, h);
    const out = ctx.createImageData(w, h);
    const d = out.data;
    const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const o = (y * w + x) * 4;
        d[o] = (-dx / len) * 127.5 + 127.5;
        d[o + 1] = (dy / len) * 127.5 + 127.5;
        d[o + 2] = (1 / len) * 127.5 + 127.5;
        d[o + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
    return this.tex(c, { srgb: false, repeat });
  }

  /** Grayscale canvas → roughness map (three reads the G channel). */
  roughnessFrom(canvas: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
    return this.tex(canvas, { srgb: false, repeat });
  }
}

export const rgba = (r: number, g: number, b: number, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
