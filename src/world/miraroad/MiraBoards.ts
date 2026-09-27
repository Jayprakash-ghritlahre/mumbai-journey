import * as THREE from 'three';
import { LED_GLYPHS } from '../../gfx/LedBoard';
import { DEVA, LATIN } from '../../gfx/Signage';
import { makeCanvas, type Ctx, type TextureFactory } from '../../gfx/TextureFactory';

/**
 * Mira Road's timetable and its passenger information boards, in the style of the reference
 * photos (assets/miraroad): the booking hall's all-platform board (Hindi header grid, one block
 * per platform, yellow and cyan rows, a red digital clock), and the single-line green indicators
 * hung under the platform canopies ("गंतव्य · समय · गति · मिनट में अपेक्षित": C 17:15 F 03).
 *
 * The platform pattern follows the hall board photo: PF 1 down slow (Virar), PF 2 up slow
 * (Andheri, Borivali), PF 3 down fast (Virar), PF 4 up fast (Churchgate). Frequencies,
 * destinations and times are made up ⚠.
 */

export interface MiraTrain {
  pf: number;
  /** Indicator code (C = Churchgate, V = Virar, BO = Borivali …). */
  code: string;
  dest: string;
  /** Game hour it stands at the platform. */
  time: number;
  mode: 'S' | 'F';
  cars: number;
}

type Svc = { every: number; offset: number; dests: [string, string, 'S' | 'F'][] };
const SERVICES: Record<number, Svc> = {
  1: {
    every: 7,
    offset: 2,
    dests: [
      ['V', 'VIRAR', 'S'],
      ['BYR', 'BHAYANDAR', 'S'],
      ['NSP', 'NALASOPARA', 'S'],
      ['V', 'VIRAR', 'S'],
      ['BSR', 'VASAI ROAD', 'S'],
    ],
  },
  2: {
    every: 6,
    offset: 4,
    dests: [
      ['A', 'ANDHERI', 'S'],
      ['BO', 'BORIVALI', 'S'],
      ['C', 'CHURCHGATE', 'S'],
      ['DDR', 'DADAR', 'S'],
      ['BO', 'BORIVALI', 'S'],
    ],
  },
  3: {
    every: 11,
    offset: 6,
    dests: [
      ['V', 'VIRAR', 'F'],
      ['NSP', 'NALASOPARA', 'F'],
      ['V', 'VIRAR', 'F'],
    ],
  },
  4: {
    every: 10,
    offset: 1,
    dests: [
      ['C', 'CHURCHGATE', 'F'],
      ['DDR', 'DADAR', 'F'],
      ['C', 'CHURCHGATE', 'F'],
      ['A', 'ANDHERI', 'F'],
    ],
  },
};

export class MiraTimetable {
  /** The Churchgate fast the player can ride (PF 4), as a game hour; null when none is due. */
  rideAt: number | null = null;

  private scheduled(pf: number, k: number): MiraTrain {
    const s = SERVICES[pf];
    // A minute either way, the same every day.
    const jitter = (((k * 7919 + pf * 104729) % 5) - 2) * 0.4;
    const minute = s.offset + k * s.every + jitter;
    const [code, dest, mode] = s.dests[((k % s.dests.length) + s.dests.length) % s.dests.length];
    return { pf, code, dest, time: minute / 60, mode, cars: 12 };
  }

  /** The next n trains at platform pf from `hour` (a train standing there now included). */
  upcoming(pf: number, hour: number, n: number): MiraTrain[] {
    const out: MiraTrain[] = [];
    if (pf === 4 && this.rideAt !== null) {
      if (this.rideAt > hour - 1.2 / 60) out.push({ pf, code: 'C', dest: 'CHURCHGATE', time: this.rideAt, mode: 'F', cars: 12 });
      const after = Math.max(hour, this.rideAt + 8 / 60);
      for (const t of this.regular(pf, after, n)) if (out.length < n) out.push(t);
      return out;
    }
    return this.regular(pf, hour, n);
  }

  private regular(pf: number, hour: number, n: number): MiraTrain[] {
    const s = SERVICES[pf];
    const out: MiraTrain[] = [];
    let k = Math.floor((hour * 60 - s.offset) / s.every) - 1;
    const k0 = k;
    while (out.length < n) {
      if (k - k0 > 500 || !Number.isFinite(k)) throw new Error(`MiraTimetable.regular: runaway at pf ${pf}, hour ${hour}`);
      const t = this.scheduled(pf, k++);
      if (t.time > hour - 0.6 / 60) out.push(t);
    }
    return out;
  }

  /** Trains at platform pf standing between h0 and h1 (for the running service). */
  between(pf: number, h0: number, h1: number): MiraTrain[] {
    const s = SERVICES[pf];
    const out: MiraTrain[] = [];
    const k0 = Math.floor((h0 * 60 - s.offset) / s.every) - 1;
    for (let k = k0; ; k++) {
      if (k - k0 > 500 || !Number.isFinite(k0)) throw new Error(`MiraTimetable.between: runaway at pf ${pf}, ${h0}..${h1}`);
      const t = this.scheduled(pf, k);
      if (t.time > h1) break;
      if (t.time >= h0) out.push(t);
    }
    return out;
  }
}

export const fmtHour = (h: number): string => {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const PITCH = 4;

/** Board slots in the Mira LED canvas (pixels). */
export const MIRA_LED = {
  w: 1024,
  h: 1280,
  /** The booking hall's all-platform board, with its red clock along the bottom. */
  hall: { x: 0, y: 0, w: 1024, h: 560 },
  /** Single-line platform indicators, one per platform (PF 1–4). */
  line: (pf: number) => ({ x: 0, y: 568 + (pf - 1) * 176, w: 768, h: 168 }),
};

export class MiraBoards {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private dots: Record<string, HTMLCanvasElement> = {};
  private off: CanvasPattern;
  private lastSecond = -1;
  private lastMinute = -1;

  constructor(
    tf: TextureFactory,
    readonly timetable: MiraTimetable,
  ) {
    [this.canvas, this.ctx] = makeCanvas(MIRA_LED.w, MIRA_LED.h);
    this.ctx.fillStyle = '#050505';
    this.ctx.fillRect(0, 0, MIRA_LED.w, MIRA_LED.h);
    this.texture = tf.tex(this.canvas, { wrap: false });
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, color: new THREE.Color(2.0, 2.0, 2.0) });
    const [pc, px] = makeCanvas(PITCH, PITCH);
    px.fillStyle = '#060605';
    px.fillRect(0, 0, PITCH, PITCH);
    px.fillStyle = '#17160f';
    px.beginPath();
    px.arc(PITCH / 2, PITCH / 2, 1.1, 0, Math.PI * 2);
    px.fill();
    this.off = this.ctx.createPattern(pc, 'repeat')!;
    for (const [name, col] of Object.entries({ green: '#a8ff38', yellow: '#ffe13a', cyan: '#4ff0ff', red: '#ff3422', amber: '#ffb21e' })) {
      const [c, x] = makeCanvas(PITCH, PITCH);
      const g = x.createRadialGradient(PITCH / 2, PITCH / 2, 0, PITCH / 2, PITCH / 2, PITCH * 0.55);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, PITCH, PITCH);
      this.dots[name] = c;
    }
  }

  /** UV rect (u0, v0, u1, v1) of a slot. */
  static uv(r: { x: number; y: number; w: number; h: number }): [number, number, number, number] {
    const W = MIRA_LED.w;
    const H = MIRA_LED.h;
    return [r.x / W, 1 - (r.y + r.h) / H, (r.x + r.w) / W, 1 - r.y / H];
  }

  /** Dot-matrix text: glyph dots `scale` LEDs square, LEDs `pitch` pixels apart. */
  private text(x0: number, y0: number, s: string, color: string, scale = 1, pitch = PITCH): number {
    const dot = this.dots[color];
    let cx = 0;
    for (const ch of s.toUpperCase()) {
      const g = LED_GLYPHS[ch] ?? LED_GLYPHS[' '];
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 5; c++)
          if (g[r] & (16 >> c)) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.ctx.drawImage(dot, x0 + (cx + c * scale + sx) * pitch, y0 + (r * scale + sy) * pitch, pitch, pitch);
      cx += 6 * scale;
    }
    return cx * pitch;
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.fillStyle = this.off;
    c.fillRect(0, 0, w, h);
    c.restore();
  }

  /** The booking hall board: a printed header grid in Hindi, then two trains per platform. */
  private drawHall(hour: number): void {
    const r = MIRA_LED.hall;
    const c = this.ctx;
    c.fillStyle = '#070707';
    c.fillRect(r.x, r.y, r.w, r.h);
    const cols = [
      ['प्लेटफार्म', 0, 150],
      ['गंतव्य', 150, 470],
      ['नियत समय', 470, 640],
      ['मिनट मे अपेक्षित', 640, 800],
      ['धीमी/तेज', 800, 900],
      ['डिब्बे', 900, 1024],
    ] as const;
    c.strokeStyle = '#e2c230';
    c.lineWidth = 2;
    c.strokeRect(r.x + 4, r.y + 4, r.w - 8, 56);
    c.fillStyle = '#e2c230';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const [t, a, b] of cols) {
      c.font = `700 22px ${DEVA}`;
      c.fillText(t, r.x + (a + b) / 2, r.y + 32);
      if (a > 0) {
        c.beginPath();
        c.moveTo(r.x + a, r.y + 4);
        c.lineTo(r.x + a, r.y + 60);
        c.stroke();
      }
    }
    this.panel(r.x + 8, r.y + 66, r.w - 16, 400);
    for (let pf = 1; pf <= 4; pf++) {
      const y0 = r.y + 70 + (pf - 1) * 100;
      const col = pf <= 2 ? 'yellow' : 'cyan';
      this.text(r.x + 50, y0 + 8, String(pf), col, 3, 4);
      const list = this.timetable.upcoming(pf, hour, 2);
      list.forEach((t, k) => {
        const y = y0 + 6 + k * 46;
        const mins = Math.max(0, Math.round((t.time - hour) * 60));
        this.text(r.x + 156, y + 4, t.dest.slice(0, 11), col, 1, 4);
        this.text(r.x + 480, y, fmtHour(t.time), col, 1, 5);
        this.text(r.x + 680, y, String(mins).padStart(2, '0'), col, 1, 5);
        this.text(r.x + 832, y, t.mode, col, 1, 5);
        this.text(r.x + 910, y, `${t.mode === 'F' ? 'F' : 'S'}${t.cars}`, col, 1, 5);
      });
    }
    // The red clock under the grid.
    const s = Math.floor((((hour % 24) + 24) % 24) * 3600);
    const txt = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    c.fillStyle = '#1a0605';
    c.fillRect(r.x + 380, r.y + 478, 264, 72);
    c.fillStyle = '#ff2a1a';
    c.font = `700 54px ${LATIN}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(txt, r.x + 512, r.y + 516);
  }

  /** A platform's single-line indicator: printed header, one green row. */
  private drawLine(pf: number, hour: number): void {
    const r = MIRA_LED.line(pf);
    const c = this.ctx;
    c.fillStyle = '#0b0b0a';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = '#e8b83a';
    c.font = `700 17px ${DEVA}`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.font = `700 22px ${DEVA}`;
    c.fillText('गंतव्य', r.x + 20, r.y + 18);
    c.fillText('समय', r.x + 250, r.y + 18);
    c.fillText('गति', r.x + 520, r.y + 18);
    c.font = `700 18px ${DEVA}`;
    c.fillText('मिनट में अपेक्षित', r.x + 612, r.y + 18);
    this.panel(r.x + 4, r.y + 36, r.w - 8, r.h - 40);
    const t = this.timetable.upcoming(pf, hour, 1)[0];
    if (!t) return;
    const mins = Math.max(0, Math.round((t.time - hour) * 60));
    const y = r.y + 44;
    this.text(r.x + 10, y, t.code.slice(0, 2), 'green', 3, 4);
    this.text(r.x + 168, y, fmtHour(t.time), 'green', 3, 4);
    this.text(r.x + 540, y, t.mode, 'green', 3, 4);
    this.text(r.x + 616, y, String(mins).padStart(2, '0'), 'green', 3, 4);
  }

  /** Redraws what changed: the hall board (and its clock) every second, the indicators every minute. */
  update(hour: number, force = false): void {
    const sec = Math.floor(hour * 3600);
    if (sec === this.lastSecond && !force) return;
    this.lastSecond = sec;
    this.drawHall(hour);
    const minute = Math.floor(hour * 60);
    if (minute !== this.lastMinute || force) {
      this.lastMinute = minute;
      for (let pf = 1; pf <= 4; pf++) this.drawLine(pf, hour);
    }
    this.texture.needsUpdate = true;
  }
}

/** A quad (front +Z) mapped to a Mira LED slot. */
export function ledQuad(r: { x: number; y: number; w: number; h: number }, width: number, height: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = MiraBoards.uv(r);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}
