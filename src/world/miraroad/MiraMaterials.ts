import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { makeCanvas, rgba, type Ctx, type TextureFactory } from '../../gfx/TextureFactory';
import type { StationMaterials } from '../churchgate/StationMaterials';
import type { SignAtlas } from '../../gfx/Signage';

/**
 * Surfaces Mira Road has and Churchgate does not, painted procedurally after the reference photos
 * (assets/miraroad; used for reconstruction only): the yellow sandstone ashlar of the arcade, the
 * fan-laid granite setts of the forecourt, asphalt, footpath pavers, the booking hall's stone floor
 * and white wall tiles, the corrugated platform canopies and the yellow-and-black painted kerbs.
 */

/** Tileable rectangle: draws it again across the edges it crosses. */
function wrapRect(c: Ctx, S: number, x: number, y: number, w: number, h: number): void {
  for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) if (x + dx < S && x + dx + w > 0 && y + dy < S && y + dy + h > 0) c.fillRect(x + dx, y + dy, w, h);
}

function sandstone(tf: TextureFactory): { map: THREE.Texture; normalMap: THREE.Texture } {
  return tf.memo('miraSandstone', () => {
    // 512 px = 2.4 m: courses 0.3 m high, blocks 0.45–0.9 m long, staggered.
    const S = 512;
    const rng = new RNG(3301);
    const [c, x] = makeCanvas(S, S);
    const [hc, hx] = makeCanvas(S, S);
    x.fillStyle = '#e6d9bb';
    x.fillRect(0, 0, S, S);
    hx.fillStyle = '#404040';
    hx.fillRect(0, 0, S, S);
    const course = 64;
    for (let row = 0; row < S / course; row++) {
      let bx = rng.range(0, 90);
      const end = bx + S;
      while (bx < end) {
        const w = Math.min(end - bx, rng.range(96, 192));
        const l = rng.range(-7, 7);
        const hue = rng.range(-4, 4);
        x.fillStyle = `hsl(${40 + hue}, ${rng.range(42, 55)}%, ${66 + l}%)`;
        wrapRect(x, S, bx + 1.5, row * course + 1.5, w - 3, course - 3);
        hx.fillStyle = '#d0d0d0';
        wrapRect(hx, S, bx + 2, row * course + 2, w - 4, course - 4);
        bx += w;
      }
    }
    // Speckled stone grain and weathering.
    tf.overlayNoise(x, S, S, 0, 3, 0.35, 'overlay', 31);
    tf.overlayNoise(x, S, S, 3, 1, 0.25, 'overlay', 32);
    for (let i = 0; i < 9000; i++) {
      x.fillStyle = rng.chance(0.5) ? rgba(120, 90, 50, rng.range(0.08, 0.25)) : rgba(250, 240, 215, rng.range(0.08, 0.2));
      x.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 2.5), rng.range(1, 2.5));
    }
    tf.overlayNoise(hx, S, S, 3, 1, 0.3, 'overlay', 33);
    const map = tf.tex(c);
    map.repeat.set(1 / 2.4, 1 / 2.4);
    const normalMap = tf.normalFromHeight(hc, 2.2, [1 / 2.4, 1 / 2.4]);
    return { map, normalMap };
  });
}

function cobble(tf: TextureFactory): { map: THREE.Texture; normalMap: THREE.Texture } {
  return tf.memo('miraCobble', () => {
    // 1024 px = 4 m: granite setts (≈9 cm) laid in overlapping fans ("fish scales").
    const S = 1024;
    const rng = new RNG(3401);
    const [c, x] = makeCanvas(S, S);
    const [hc, hx] = makeCanvas(S, S);
    x.fillStyle = '#4a4540';
    x.fillRect(0, 0, S, S);
    hx.fillStyle = '#303030';
    hx.fillRect(0, 0, S, S);
    const W = 512;
    const H = 192;
    const R = 300;
    const stone = 23;
    for (let row = -3; row < S / H + 3; row++) {
      for (let col = -1; col <= S / W + 1; col++) {
        const cx = col * W + (row & 1 ? W / 2 : 0);
        const cy = row * H;
        // The fan: rings of setts from the rim inwards, drawn over the fans behind.
        for (let r = R; r > 8; r -= stone) {
          const a0 = -Math.PI / 2 - 1.05;
          const a1 = -Math.PI / 2 + 1.05;
          const n = Math.max(2, Math.round(((a1 - a0) * r) / stone));
          for (let k = 0; k < n; k++) {
            const a = a0 + ((k + 0.5) / n) * (a1 - a0);
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            const warm = rng.chance(0.12);
            const l = rng.range(-9, 9);
            for (const [dx, dy] of [
              [0, 0],
              [S, 0],
              [-S, 0],
              [0, S],
              [0, -S],
            ]) {
              const X = px + dx;
              const Y = py + dy + R * 0.2;
              if (X < -stone || X > S + stone || Y < -stone || Y > S + stone) continue;
              x.save();
              x.translate(X, Y);
              x.rotate(a + Math.PI / 2);
              x.fillStyle = warm ? `hsl(18, 16%, ${50 + l}%)` : `hsl(30, 5%, ${53 + l}%)`;
              x.beginPath();
              x.roundRect(-stone / 2 + 1.5, -stone / 2 + 1.5, stone - 3, stone - 3, 4);
              x.fill();
              x.restore();
              hx.save();
              hx.translate(X, Y);
              hx.rotate(a + Math.PI / 2);
              hx.fillStyle = `rgb(${180 + rng.int(-30, 30)},${180},${180})`;
              hx.beginPath();
              hx.roundRect(-stone / 2 + 2, -stone / 2 + 2, stone - 4, stone - 4, 5);
              hx.fill();
              hx.restore();
            }
          }
        }
      }
    }
    tf.overlayNoise(x, S, S, 1, 2, 0.3, 'overlay', 41);
    // Dust, gum and paan stains.
    for (let i = 0; i < 40; i++) tf.stain(x, S, S, rng.range(0, S), rng.range(0, S), rng.range(10, 50), rng.chance(0.3) ? 'rgba(120,30,25,1)' : 'rgba(40,36,30,1)', rng.range(0.08, 0.2), rng);
    const map = tf.tex(c);
    map.repeat.set(1 / 4, 1 / 4);
    const normalMap = tf.normalFromHeight(hc, 2.5, [1 / 4, 1 / 4]);
    return { map, normalMap };
  });
}

function asphalt(tf: TextureFactory): THREE.Texture {
  return tf.memo('miraAsphalt', () => {
    const S = 512;
    const rng = new RNG(3501);
    const [c, x] = makeCanvas(S, S);
    x.fillStyle = '#56544f';
    x.fillRect(0, 0, S, S);
    tf.overlayNoise(x, S, S, 0, 2, 0.3, 'overlay', 51);
    tf.overlayNoise(x, S, S, 3, 1, 0.45, 'overlay', 52);
    // Patches of newer and older tar, and oil drips down the lane middles.
    for (let i = 0; i < 14; i++) {
      x.fillStyle = rng.chance(0.5) ? rgba(35, 34, 33, rng.range(0.2, 0.45)) : rgba(140, 135, 125, rng.range(0.1, 0.2));
      x.save();
      x.translate(rng.range(0, S), rng.range(0, S));
      x.rotate(rng.range(-0.3, 0.3));
      x.fillRect(-rng.range(20, 90), -rng.range(15, 60), rng.range(40, 180), rng.range(30, 120));
      x.restore();
    }
    for (let i = 0; i < 30; i++) tf.stain(x, S, S, rng.range(0, S), rng.range(0, S), rng.range(6, 26), 'rgba(15,14,12,1)', rng.range(0.15, 0.35), rng);
    for (let i = 0; i < 12; i++) tf.crack(x, S, S, rng.range(0, S), rng.range(0, S), rng.range(30, 120), rng);
    for (let i = 0; i < 3000; i++) {
      x.fillStyle = rgba(200, 195, 185, rng.range(0.05, 0.2));
      x.fillRect(rng.range(0, S), rng.range(0, S), 1.5, 1.5);
    }
    const t = tf.tex(c);
    t.repeat.set(1 / 8, 1 / 8);
    return t;
  });
}

function pavers(tf: TextureFactory): THREE.Texture {
  return tf.memo('miraPavers', () => {
    // 512 px = 2 m: 20 × 10 cm concrete pavers in grey and faded red bands, stretcher bond.
    const S = 512;
    const rng = new RNG(3601);
    const [c, x] = makeCanvas(S, S);
    x.fillStyle = '#3e3b37';
    x.fillRect(0, 0, S, S);
    const pw = 51.2;
    const ph = 25.6;
    for (let r = 0; r < S / ph; r++) {
      const band = Math.floor(r / 4) % 3 === 1;
      for (let k = -1; k < S / pw + 1; k++) {
        const px = k * pw + (r & 1 ? pw / 2 : 0);
        const l = rng.range(-7, 7);
        x.fillStyle = band ? `hsl(8, 30%, ${44 + l}%)` : `hsl(35, 6%, ${58 + l}%)`;
        wrapRect(x, S, px + 1.5, r * ph + 1.5, pw - 3, ph - 3);
      }
    }
    tf.overlayNoise(x, S, S, 1, 2, 0.3, 'overlay', 61);
    for (let i = 0; i < 20; i++) tf.stain(x, S, S, rng.range(0, S), rng.range(0, S), rng.range(8, 40), 'rgba(40,35,30,1)', rng.range(0.1, 0.25), rng);
    const t = tf.tex(c);
    t.repeat.set(1 / 2, 1 / 2);
    return t;
  });
}

function hallFloor(tf: TextureFactory): THREE.Texture {
  return tf.memo('miraHallFloor', () => {
    // 512 px = 2.4 m: 60 cm grey-green Kota stone slabs.
    const S = 512;
    const rng = new RNG(3701);
    const [c, x] = makeCanvas(S, S);
    x.fillStyle = '#2f302c';
    x.fillRect(0, 0, S, S);
    const t = S / 4;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const l = rng.range(-6, 6);
        x.fillStyle = `hsl(${95 + rng.range(-15, 15)}, ${rng.range(6, 12)}%, ${50 + l}%)`;
        x.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3);
      }
    tf.overlayNoise(x, S, S, 1, 3, 0.3, 'overlay', 71);
    tf.overlayNoise(x, S, S, 3, 1, 0.2, 'overlay', 72);
    for (let i = 0; i < 26; i++) tf.stain(x, S, S, rng.range(0, S), rng.range(0, S), rng.range(8, 50), 'rgba(35,32,28,1)', rng.range(0.1, 0.25), rng);
    const tex = tf.tex(c);
    tex.repeat.set(1 / 2.4, 1 / 2.4);
    return tex;
  });
}

function wallTiles(tf: TextureFactory): THREE.Texture {
  return tf.memo('miraWallTiles', () => {
    // 256 px = 1.2 m: 30 cm white glazed tiles, grime collecting low down.
    const S = 256;
    const rng = new RNG(3801);
    const [c, x] = makeCanvas(S, S);
    x.fillStyle = '#9d9a92';
    x.fillRect(0, 0, S, S);
    const t = S / 4;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        x.fillStyle = `hsl(45, 12%, ${86 + rng.range(-3, 3)}%)`;
        x.fillRect(i * t + 1.2, j * t + 1.2, t - 2.4, t - 2.4);
      }
    tf.overlayNoise(x, S, S, 2, 1, 0.12, 'overlay', 81);
    for (let i = 0; i < 6; i++) tf.stain(x, S, S, rng.range(0, S), rng.range(0, S), rng.range(10, 40), 'rgba(90,80,60,1)', rng.range(0.05, 0.12), rng);
    const tex = tf.tex(c);
    tex.repeat.set(1 / 1.2, 1 / 1.2);
    return tex;
  });
}

function corrugated(tf: TextureFactory): THREE.Texture {
  return tf.memo('miraCorrugated', () => {
    // 256 px = 1 m across the corrugations (u), 1 m along them (v); painted blue-grey, rusting.
    const S = 256;
    const rng = new RNG(3901);
    const [c, x] = makeCanvas(S, S);
    const n = 13;
    for (let i = 0; i < n; i++) {
      const g = x.createLinearGradient((i * S) / n, 0, ((i + 1) * S) / n, 0);
      g.addColorStop(0, '#7f939b');
      g.addColorStop(0.5, '#b6c5c9');
      g.addColorStop(1, '#7f939b');
      x.fillStyle = g;
      x.fillRect((i * S) / n, 0, S / n + 1, S);
    }
    tf.overlayNoise(x, S, S, 1, 2, 0.1, 'overlay', 91);
    for (let i = 0; i < 9; i++) {
      const px = rng.range(0, S);
      const len = rng.range(30, 200);
      const g = x.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(140,70,35,0.28)');
      g.addColorStop(1, 'rgba(140,70,35,0)');
      x.fillStyle = g;
      x.fillRect(px, rng.range(0, S - len), rng.range(3, 10), len);
    }
    for (let i = 0; i < 4; i++) tf.stain(x, S, S, rng.range(0, S), rng.range(0, S), rng.range(8, 24), 'rgba(120,60,30,1)', 0.18, rng);
    return tf.tex(c);
  });
}

function kerbStripes(tf: TextureFactory): THREE.Texture {
  return tf.memo('miraKerb', () => {
    // One metre of kerb per repeat: yellow and black halves, scuffed.
    const [c, x] = makeCanvas(128, 32);
    x.fillStyle = '#d9ab1f';
    x.fillRect(0, 0, 64, 32);
    x.fillStyle = '#1d1c1a';
    x.fillRect(64, 0, 64, 32);
    tf.overlayNoise(x, 128, 32, 2, 1, 0.35, 'overlay', 95);
    const rng = new RNG(96);
    for (let i = 0; i < 60; i++) {
      x.fillStyle = rgba(120, 115, 105, rng.range(0.2, 0.5));
      x.fillRect(rng.range(0, 128), rng.range(0, 32), rng.range(2, 8), rng.range(1, 4));
    }
    return tf.tex(c);
  });
}

/**
 * Four shop interiors side by side (grocery shelves, clothes on racks, a sweet shop's counter, a
 * phone shop's glass cases), seen through the open shutters; lit at night.
 */
function shopInteriors(tf: TextureFactory): THREE.Texture {
  return tf.memo('miraShopInteriors', () => {
    const W = 256;
    const H = 256;
    const rng = new RNG(4101);
    const [c, x] = makeCanvas(W * 5, H);
    const pal = ['#c62828', '#1565c0', '#f9a825', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457', '#fafafa', '#5d4037'];
    for (let k = 0; k < 4; k++) {
      const x0 = k * W;
      const wall = ['#d9cdb0', '#e9e2d6', '#f1e3c8', '#dfe8ec'][k];
      x.fillStyle = wall;
      x.fillRect(x0, 0, W, H);
      // A tube light along the top.
      x.fillStyle = '#fffbe8';
      x.fillRect(x0 + 40, 14, W - 80, 6);
      if (k === 0 || k === 3) {
        // Shelves stacked with packets and bottles.
        for (let row = 0; row < 5; row++) {
          const y = 40 + row * 34;
          x.fillStyle = '#6d5a44';
          x.fillRect(x0 + 8, y + 26, W - 16, 4);
          for (let px = x0 + 10; px < x0 + W - 14; px += rng.range(8, 16)) {
            x.fillStyle = rng.pick(pal);
            const h = rng.range(12, 24);
            x.fillRect(px, y + 26 - h, rng.range(6, 12), h);
          }
        }
      } else if (k === 1) {
        // Clothes on rails, a mannequin.
        for (let row = 0; row < 2; row++) {
          const y = 50 + row * 70;
          x.fillStyle = '#555';
          x.fillRect(x0 + 10, y, W - 20, 3);
          for (let px = x0 + 14; px < x0 + W - 20; px += 7) {
            x.fillStyle = rng.pick(pal);
            x.fillRect(px, y + 3, 6, rng.range(40, 60));
          }
        }
        x.fillStyle = '#e8c9a8';
        x.fillRect(x0 + W / 2 - 10, 190, 20, 50);
      } else {
        // Sweets in trays behind a glass counter.
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 6; col++) {
            x.fillStyle = rng.pick(['#f9a825', '#fff3e0', '#ef6c00', '#8d6e63', '#fce4ec', '#c8e6c9']);
            x.fillRect(x0 + 16 + col * 38, 60 + row * 36, 32, 24);
          }
      }
      // The counter in front.
      x.fillStyle = k === 2 ? 'rgba(200,230,240,0.55)' : '#7b6a55';
      x.fillRect(x0, H - 70, W, 70);
      x.fillStyle = 'rgba(0,0,0,0.25)';
      x.fillRect(x0, H - 72, W, 3);
    }
    // Fifth: the booking office behind its windows (pale green walls, a clerk's desk, the ticket
    // printer, files and a calendar).
    {
      const x0 = 4 * W;
      x.fillStyle = '#c9dccb';
      x.fillRect(x0, 0, W, H);
      x.fillStyle = '#fffbe8';
      x.fillRect(x0 + 40, 14, W - 80, 6);
      x.fillStyle = '#8a7a62';
      x.fillRect(x0 + 20, 40, 70, 90);
      for (let i = 0; i < 6; i++) {
        x.fillStyle = rng.pick(['#c62828', '#1565c0', '#2e7d32', '#f9a825']);
        x.fillRect(x0 + 24 + i * 11, 50, 9, 32);
        x.fillRect(x0 + 24 + i * 11, 90, 9, 32);
      }
      x.fillStyle = '#f5f5f5';
      x.fillRect(x0 + 150, 45, 60, 70);
      x.fillStyle = '#c62828';
      x.fillRect(x0 + 150, 45, 60, 14);
      x.fillStyle = '#222';
      x.fillRect(x0 + 95, 120, 70, 50);
      x.fillStyle = '#3b6fb6';
      x.fillRect(x0 + 100, 125, 60, 40);
      x.fillStyle = '#d7d2c4';
      x.fillRect(x0 + 175, 150, 50, 30);
      x.fillStyle = '#6d5a44';
      x.fillRect(x0, H - 76, W, 76);
    }
    tf.overlayNoise(x, W * 5, H, 2, 1, 0.12, 'overlay', 42);
    const t = tf.tex(c);
    t.wrapS = THREE.ClampToEdgeWrapping;
    return t;
  });
}

export interface MiraMats {
  m: Record<string, THREE.Material>;
  /** Street-facing signs that light up at night (shop boards, hoardings). */
  signsLit: THREE.MeshStandardMaterial;
}

export function miraMaterials(tf: TextureFactory, mats: StationMaterials, signs: SignAtlas): MiraMats {
  const std = (name: string, p: THREE.MeshStandardMaterialParameters, macro = 0) => mats.add(name, new THREE.MeshStandardMaterial(p), macro) as THREE.MeshStandardMaterial;
  const ss = sandstone(tf);
  const cb = cobble(tf);
  const M = mats.m;
  const signsLit = new THREE.MeshStandardMaterial({ map: signs.texture, emissiveMap: signs.texture, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.55 });
  mats.add('miraSignsLit', signsLit);
  mats.lampMats.push({ mat: signsLit, color: new THREE.Color(1, 1, 1), intensity: 0.75 });
  const interiors = shopInteriors(tf);
  const shopGlow = new THREE.MeshStandardMaterial({ color: 0x9a948a, map: interiors, emissive: 0xfff0d8, emissiveMap: interiors, emissiveIntensity: 0.2, roughness: 0.6, vertexColors: true });
  mats.add('miraShopGlow', shopGlow);
  mats.lampMats.push({ mat: shopGlow, color: new THREE.Color(0xfff0d8), intensity: 0.85 });
  const m: Record<string, THREE.Material> = {
    sandstone: std('miraSandstone', { map: ss.map, normalMap: ss.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.92 }, 0.25),
    cobble: std('miraCobble', { map: cb.map, normalMap: cb.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.9 }, 0.35),
    asphalt: std('miraAsphalt', { map: asphalt(tf), vertexColors: true, roughness: 0.93 }, 0.5),
    pavers: std('miraPavers', { map: pavers(tf), vertexColors: true, roughness: 0.9 }, 0.45),
    hallFloor: std('miraHallFloor', { map: hallFloor(tf), roughness: 0.55, metalness: 0.02 }, 0.3),
    wallTiles: std('miraWallTiles', { map: wallTiles(tf), roughness: 0.35 }, 0.25),
    canopy: std('miraCanopy', { map: corrugated(tf), roughness: 0.7, metalness: 0.35, side: THREE.DoubleSide }, 0.2),
    roofSheet: std('miraRoofSheet', { map: corrugated(tf), color: 0xe6ddcc, roughness: 0.75, metalness: 0.3, side: THREE.DoubleSide }, 0.2),
    jet: new THREE.MeshStandardMaterial({ color: 0xe8f2f6, transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.1 }),
    kerb: std('miraKerb', { map: kerbStripes(tf), roughness: 0.8 }, 0.3),
    granite: std('miraGranite', { color: 0xa6a39d, map: (M.concrete as THREE.MeshStandardMaterial).map, vertexColors: true, roughness: 0.8 }, 0.35),
    // The arcade's white columns, arches, entablature and pediment: fresh paint (photos).
    white: std('miraWhite', { color: 0xf1eee7, roughness: 0.82 }, 0.12),
    signs: std('miraSigns', { map: signs.texture, roughness: 0.6 }),
    signsLit,
    shopGlow,
    stainless: M.stainless,
    skyGreen: std('miraSkyGreen', { color: 0x357a5a, roughness: 0.55, metalness: 0.35 }, 0.1),
    glass: M.glassDark,
    tube: M.lampTube,
    sodium: M.lampSodium,
    warm: M.lampWarm,
    tactile: M.tactile,
    coping: M.coping,
    yellowLine: M.yellowLine,
    steelGreen: M.steelGreen,
    blackPaint: M.blackPaint,
    rubber: M.rubber,
  };
  return { m, signsLit };
}
