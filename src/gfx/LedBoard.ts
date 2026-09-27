import * as THREE from 'three';
import { makeCanvas, type Ctx, type TextureFactory } from './TextureFactory';
import { LATIN } from './Signage';

// Classic 5×7 dot-matrix glyphs (row bitmasks, bit 4 = leftmost column).
const G: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  ':': [0, 12, 12, 0, 12, 12, 0], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], '/': [0, 1, 2, 4, 8, 16, 0],
  '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], '+': [0, 4, 4, 31, 4, 4, 0], '&': [12, 18, 20, 8, 21, 18, 13],
  "'": [12, 4, 8, 0, 0, 0, 0], ',': [0, 0, 0, 0, 12, 4, 8], ' ': [0, 0, 0, 0, 0, 0, 0],
};

/** The 5×7 dot-matrix font (for other boards drawn in the same style). */
export const LED_GLYPHS: Readonly<Record<string, number[]>> = G;

export interface Departure {
  code: string;
  time: string;
  mode: 'S' | 'F';
  mins: number;
  dest: string;
  cars: number;
  note: string;
}

export interface BoardContent {
  platform: number;
  now: Departure | null;
  next: Departure[];
}

const PITCH = 4;
export const BIG = { w: 768, h: 416 };
export const SMALL = { w: 768, h: 116 };

/**
 * All LED passenger-information boards share one dynamic atlas texture.
 * Boards 0-7 are full platform indicators; 8-13 are single-line repeaters.
 */
export class LedAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private dot: Record<string, HTMLCanvasElement> = {};
  private offPattern: CanvasPattern;
  static readonly SIZE = 2048;

  constructor(tf: TextureFactory) {
    [this.canvas, this.ctx] = makeCanvas(LedAtlas.SIZE, LedAtlas.SIZE);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, LedAtlas.SIZE, LedAtlas.SIZE);
    this.texture = tf.tex(this.canvas, { wrap: false });
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, color: new THREE.Color(2.2, 2.2, 2.2) });
    const [pc, pctx] = makeCanvas(PITCH, PITCH);
    pctx.fillStyle = '#050504';
    pctx.fillRect(0, 0, PITCH, PITCH);
    pctx.fillStyle = '#16150f';
    pctx.beginPath();
    pctx.arc(PITCH / 2, PITCH / 2, 1.2, 0, Math.PI * 2);
    pctx.fill();
    this.offPattern = this.ctx.createPattern(pc, 'repeat')!;
    for (const [name, col] of Object.entries({ green: '#b6ff3c', amber: '#ffb21e', red: '#ff3b2a', yellow: '#ffe14a' })) {
      const [c, x] = makeCanvas(PITCH, PITCH);
      const g = x.createRadialGradient(PITCH / 2, PITCH / 2, 0, PITCH / 2, PITCH / 2, PITCH * 0.55);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, PITCH, PITCH);
      this.dot[name] = c;
    }
  }

  /** Pixel rect of board i. */
  static rect(i: number): { x: number; y: number; w: number; h: number } {
    if (i < 8) return { x: (i % 2) * (BIG.w + 16), y: Math.floor(i / 2) * (BIG.h + 8), ...BIG };
    const k = i - 8;
    return { x: (k % 2) * (SMALL.w + 16), y: 4 * (BIG.h + 8) + Math.floor(k / 2) * (SMALL.h + 8), ...SMALL };
  }

  /** UV rect (u0, v0, u1, v1) for board i. */
  static uv(i: number): [number, number, number, number] {
    const r = LedAtlas.rect(i);
    const S = LedAtlas.SIZE;
    return [r.x / S, 1 - (r.y + r.h) / S, (r.x + r.w) / S, 1 - r.y / S];
  }

  private text(x0: number, y0: number, s: string, color: string, scale = 1, spacing = 1): number {
    const dot = this.dot[color];
    const ctx = this.ctx;
    let cx = 0;
    for (const ch of s.toUpperCase()) {
      const g = G[ch] ?? G[' '];
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 5; c++)
          if (g[r] & (16 >> c))
            for (let sy = 0; sy < scale; sy++)
              for (let sx = 0; sx < scale; sx++) ctx.drawImage(dot, x0 + (cx + c * scale + sx) * PITCH, y0 + (r * scale + sy) * PITCH);
      cx += (5 + spacing) * scale;
    }
    return cx;
  }

  private clear(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = this.offPattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /** Full indicator: printed header, big main row, amber info rows. */
  drawBoard(i: number, c: BoardContent): void {
    const r = LedAtlas.rect(i);
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0a09';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // Printed header labels.
    ctx.fillStyle = '#e8c43a';
    ctx.font = `700 17px ${LATIN}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('DESTINATION', r.x + 14, r.y + 6);
    ctx.fillText('TIME', r.x + 230, r.y + 6);
    ctx.fillText('MODE', r.x + 520, r.y + 6);
    ctx.fillText('EXP. IN MIN.', r.x + 630, r.y + 6);
    // Main row panel.
    const mainY = r.y + 30;
    this.clear(r.x + 8, mainY, r.w - 16, 17 * PITCH);
    if (c.now) {
      const d = c.now;
      this.text(r.x + 14, mainY + PITCH, d.code.padEnd(3, ' '), 'green', 2);
      this.text(r.x + 14 + 3 * 12 * PITCH + 20, mainY + PITCH, d.time, 'green', 2);
      this.text(r.x + 540, mainY + PITCH, d.mode, 'green', 2);
      this.text(r.x + 640, mainY + PITCH, String(Math.max(0, d.mins)).padStart(2, '0'), 'green', 2);
    }
    // Info rows.
    const rowsY = mainY + 17 * PITCH + 10;
    const rowH = 9 * PITCH;
    const rows: [string, string][] = [];
    if (c.now) {
      rows.push([`${c.now.dest.padEnd(16, ' ')}${c.now.cars} COACH`, 'amber']);
      rows.push([c.now.note, 'amber']);
    }
    for (const n of c.next.slice(0, 4)) rows.push([`${n.code.padEnd(4, ' ')}${n.time} ${n.mode}  ${n.dest.slice(0, 11).padEnd(11, ' ')} ${n.cars}C`, 'amber']);
    for (let k = 0; k < 6; k++) {
      const y = rowsY + k * (rowH + 2);
      if (y + rowH > r.y + r.h - 6) break;
      this.clear(r.x + 8, y, r.w - 16, rowH);
      if (rows[k]) this.text(r.x + 12, y + PITCH, rows[k][0].slice(0, 30), rows[k][1] as 'amber');
    }
  }

  /** Single-line repeater board (platform length). */
  drawRepeater(i: number, platform: number, d: Departure | null): void {
    const r = LedAtlas.rect(i);
    this.ctx.fillStyle = '#0a0a09';
    this.ctx.fillRect(r.x, r.y, r.w, r.h);
    this.clear(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    if (!d) return;
    this.text(r.x + 14, r.y + 14, d.code.padEnd(3, ' '), 'green', 2);
    this.text(r.x + 14 + 3 * 12 * PITCH + 16, r.y + 14, d.time, 'green', 2);
    this.text(r.x + 560, r.y + 14, d.mode, 'green', 2);
    this.text(r.x + 650, r.y + 14, String(d.cars), 'red', 2);
    void platform;
  }

  commit(): void {
    this.texture.needsUpdate = true;
  }
}
