import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../../core/Random';
import { makeCanvas, rgba, type TextureFactory } from '../../gfx/TextureFactory';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { InstanceCuller } from '../../gfx/InstanceCuller';

/**
 * Alpha-cut foliage sprays painted on canvas. 'rain': the feathery pinnate leaves of the rain trees
 * and gulmohars that shade most South Mumbai streets; 'flower': the same with gulmohar's flame-red
 * April blossom; 'banyan': larger, glossy ovate leaves.
 */
function leafTexture(tf: TextureFactory, kind: 'rain' | 'flower' | 'banyan' = 'rain'): THREE.Texture {
  return tf.memo('leafCards-' + kind, () => {
    const S = 1024;
    const [c, ctx] = makeCanvas(S, S);
    ctx.clearRect(0, 0, S, S);
    const rng = new RNG(kind === 'banyan' ? 919 : 333);
    // Light from above: leaves near the top of the card are brighter.
    const lit = (y: number) => 0.72 + 0.4 * (1 - y / S);
    const leaf = (x: number, y: number, len: number, wid: number, ang: number, base: [number, number, number], glossy: boolean) => {
      const k = lit(y) * rng.range(0.82, 1.12);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = rgba(base[0] * k, base[1] * k, base[2] * k, 1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.45, -wid, len, 0);
      ctx.quadraticCurveTo(len * 0.45, wid, 0, 0);
      ctx.fill();
      if (glossy) {
        ctx.strokeStyle = rgba(base[0] * k * 1.6, base[1] * k * 1.45, base[2] * k * 1.4, 0.7);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(len * 0.1, 0);
        ctx.lineTo(len * 0.85, 0);
        ctx.stroke();
      }
      ctx.restore();
    };
    const cx = S / 2;
    const cy = S * 0.56;
    if (kind === 'banyan') {
      // Twig tips radiating from the centre, each carrying a rosette of ovate leaves.
      for (let t = 0; t < 110; t++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.pow(rng.next(), 0.8) * S * 0.37;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.85;
        ctx.strokeStyle = 'rgba(78,62,44,1)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.42);
        ctx.lineTo(x, y);
        ctx.stroke();
        const n = rng.int(8, 12);
        for (let i = 0; i < n; i++) {
          const la = a + rng.range(-1.8, 1.8);
          leaf(x, y, rng.range(44, 66), rng.range(15, 21), la, rng.chance(0.15) ? [66, 92, 36] : [34, 70, 30], true);
        }
      }
    } else {
      // Sprays: a stem with pairs of small leaflets, forking once or twice.
      const spray = (x: number, y: number, a: number, len: number, depth: number) => {
        const steps = Math.floor(len / 9);
        ctx.strokeStyle = 'rgba(86,78,48,1)';
        ctx.lineWidth = 1.6 + depth;
        let px = x;
        let py = y;
        const curve = rng.range(-0.012, 0.012);
        for (let i = 0; i < steps; i++) {
          a += curve;
          const nx = px + Math.cos(a) * 9;
          const ny = py + Math.sin(a) * 9;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(nx, ny);
          ctx.stroke();
          const t = i / steps;
          const size = (1 - Math.abs(t - 0.55)) * rng.range(18, 26);
          const base: [number, number, number] = rng.chance(0.1) ? [92, 110, 40] : [54, 96, 34];
          for (const sd of [-1, 1]) leaf(nx, ny, size, size * 0.32, a + sd * rng.range(0.9, 1.25), base, false);
          px = nx;
          py = ny;
          if (depth > 0 && rng.chance(0.07)) spray(px, py, a + (rng.chance(0.5) ? 1 : -1) * rng.range(0.4, 0.8), len * 0.55, depth - 1);
        }
      };
      // A dense core so the card reads as a solid mass of foliage (and survives mipmapping).
      for (let i = 0; i < 1400; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.pow(rng.next(), 0.75) * S * 0.3;
        const base: [number, number, number] = rng.chance(0.1) ? [92, 110, 40] : [50, 90, 32];
        leaf(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, rng.range(16, 26), rng.range(5, 8), rng.range(0, Math.PI * 2), base, false);
      }
      for (let i = 0; i < 44; i++) {
        const a = -Math.PI / 2 + rng.range(-1.9, 1.9);
        const r = rng.range(0, S * 0.12);
        spray(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6 + S * 0.06, a, rng.range(S * 0.22, S * 0.38), 1);
      }
      if (kind === 'flower') {
        // Gulmohar in April: flame-red clusters over the feathery leaves.
        for (let i = 0; i < 70; i++) {
          const a = rng.range(0, Math.PI * 2);
          const r = Math.pow(rng.next(), 0.55) * S * 0.36;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r * 0.85;
          for (let k = 0; k < 9; k++) {
            ctx.fillStyle = rgba(rng.range(205, 240), rng.range(45, 95), rng.range(15, 35), 1);
            ctx.beginPath();
            ctx.ellipse(x + rng.range(-16, 16), y + rng.range(-12, 12), rng.range(5, 9), rng.range(4, 7), rng.range(0, Math.PI), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    const t = tf.tex(c, { wrap: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Grey bark detail (vertical furrows and lichen), multiplied over the vertex colours. */
function barkTexture(tf: TextureFactory): THREE.Texture {
  return tf.memo('bark', () => {
    const S = 256;
    const [c, ctx] = makeCanvas(S, S);
    ctx.fillStyle = '#e6e2da';
    ctx.fillRect(0, 0, S, S);
    const rng = new RNG(412);
    for (let i = 0; i < 70; i++) {
      const x = rng.range(0, S);
      ctx.strokeStyle = rgba(90, 84, 76, rng.range(0.35, 0.8));
      ctx.lineWidth = rng.range(1.5, 4.5);
      ctx.beginPath();
      ctx.moveTo(x, -10);
      for (let y = 0; y <= S + 10; y += 16) ctx.lineTo(x + Math.sin(y * 0.05 + i) * rng.range(1, 5), y);
      ctx.stroke();
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rgba(rng.range(150, 190), rng.range(165, 190), rng.range(120, 150), rng.range(0.2, 0.45));
      ctx.beginPath();
      ctx.ellipse(rng.range(0, S), rng.range(0, S), rng.range(4, 14), rng.range(3, 9), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    tf.overlayNoise(ctx, S, S, 2, 2, 0.35, 'multiply');
    return tf.tex(c, { repeat: [2, 2] });
  });
}

type TreeParts = { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry };

/** Bark rods (tapered, open cylinders) and foliage cards shared by the broadleaf trees. */
class TreeBuilder {
  readonly bark: THREE.BufferGeometry[] = [];
  readonly cards: THREE.BufferGeometry[] = [];
  readonly tips: THREE.Vector3[] = [];
  constructor(readonly rng: RNG) {}

  rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 6): void {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-3) return;
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate(a.x, a.y, a.z);
    this.bark.push(g);
  }

  /** A branch and its children; `up`/`out` bias growth towards the light and away from the trunk. */
  grow(from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number, up: number, out: number, hang?: (a: THREE.Vector3, b: THREE.Vector3, depth: number) => void): void {
    const rng = this.rng;
    const to = from.clone().addScaledVector(dir, len);
    this.rod(from, to, r, r * 0.68, depth > 1 ? 6 : 4);
    hang?.(from, to, depth);
    if (depth === 0) {
      this.tips.push(to);
      return;
    }
    const n = rng.chance(0.35) ? 3 : 2;
    const outward = new THREE.Vector3(to.x, 0, to.z).normalize();
    for (let i = 0; i < n; i++) {
      const d = dir.clone();
      d.x += rng.gauss() * 0.55 + outward.x * out;
      d.z += rng.gauss() * 0.55 + outward.z * out;
      d.y += rng.gauss() * 0.25 + up;
      d.normalize();
      this.grow(to, d, len * rng.range(0.62, 0.78), r * 0.64, depth - 1, up, out, hang);
    }
  }

  /** Foliage cards around a centre, facing outwards from the crown (fuller silhouettes). */
  cluster(c: THREE.Vector3, n: number, spread: number, size: [number, number], crown: THREE.Vector3): void {
    const rng = this.rng;
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < n; i++) {
      const p = c.clone().add(new THREE.Vector3(rng.gauss(), rng.gauss() * 0.6, rng.gauss()).multiplyScalar(spread * 0.5));
      const face = new THREE.Vector3().subVectors(p, crown).setY((p.y - crown.y) * 0.6 + 0.6).normalize();
      face.add(new THREE.Vector3(rng.gauss(), rng.gauss(), rng.gauss()).multiplyScalar(0.45)).normalize();
      const sz = rng.range(size[0], size[1]);
      const g = new THREE.PlaneGeometry(sz, sz);
      g.rotateZ(rng.range(0, Math.PI * 2));
      g.applyQuaternion(q.setFromUnitVectors(zAxis, face));
      g.translate(p.x, p.y, p.z);
      this.cards.push(g);
    }
  }

  /**
   * Merges everything. Leaf cards get normals bent out from the crown (soft, rounded shading) and
   * a vertex colour that darkens the inside and underside of the crown (cheap ambient occlusion).
   */
  build(crown: THREE.Vector3, radius: number, height: number, paint: (y: number) => [number, number, number]): TreeParts {
    const rng = this.rng;
    const barkGeo = mergeGeometries(this.bark.map((g) => (g.index ? g.toNonIndexed() : g)))!;
    const bp = barkGeo.attributes.position as THREE.BufferAttribute;
    const bc = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) bc.set(paint(bp.getY(i)), i * 3);
    barkGeo.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    const leaves = mergeGeometries(this.cards.map((g) => g.toNonIndexed()))!;
    const pos = leaves.attributes.position as THREE.BufferAttribute;
    const nor = leaves.attributes.normal as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const tints: [number, number, number][] = [
      [1, 1, 1],
      [1.06, 1.03, 0.88],
      [0.92, 1.0, 0.96],
      [0.97, 0.95, 1.0],
    ];
    const bottom = crown.y - height * 0.5;
    for (let i = 0; i < pos.count; i += 6) {
      // One tint per card (6 vertices).
      const tint = tints[rng.int(0, tints.length - 1)];
      for (let k = i; k < i + 6 && k < pos.count; k++) {
        const x = pos.getX(k) - crown.x;
        const y = pos.getY(k);
        const z = pos.getZ(k) - crown.z;
        const d = new THREE.Vector3(x, (y - crown.y + height * 0.3) * 1.4, z).normalize();
        nor.setXYZ(k, d.x, d.y, d.z);
        const h = THREE.MathUtils.clamp((y - bottom) / height, 0, 1);
        const o = THREE.MathUtils.clamp(Math.hypot(x, z) / radius, 0, 1);
        const ao = THREE.MathUtils.clamp(0.42 + 0.45 * h + 0.3 * o, 0.42, 1.12);
        col.set([ao * tint[0], ao * tint[1], ao * tint[2]], k * 3);
      }
    }
    leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return { bark: barkGeo, leaves };
  }
}

/** Painted base (white, a red ring) as on many Mumbai street trees; natural bark above. */
const paintedBase = (h0: number, h1: number) => (y: number): [number, number, number] => (y < h0 ? [0.86, 0.85, 0.8] : y < h1 ? [0.62, 0.2, 0.09] : [0.38, 0.34, 0.29]);

/**
 * Rain tree / gulmohar / peepal: a short trunk that forks into three or four limbs, branching
 * three times into an umbrella-shaped crown.
 */
function treeVariant(seed: number): TreeParts {
  const rng = new RNG(seed);
  const t = new TreeBuilder(rng);
  const trunkH = rng.range(2.6, 3.6);
  const lean = new THREE.Vector3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3));
  const top = new THREE.Vector3(lean.x, trunkH, lean.z);
  t.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean.x * 0.4, trunkH * 0.5, lean.z * 0.4), 0.34, 0.28, 9);
  t.rod(new THREE.Vector3(lean.x * 0.4, trunkH * 0.5, lean.z * 0.4), top, 0.28, 0.24, 9);
  const limbs = rng.int(3, 4);
  for (let b = 0; b < limbs; b++) {
    const a = (b / limbs) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const elev = rng.range(0.55, 0.95);
    const d = new THREE.Vector3(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev));
    t.grow(top.clone().setY(trunkH - 0.2), d, rng.range(3.0, 3.8), 0.19, 2, -0.05, 0.4);
  }
  // Crown shape from the twig tips.
  const crown = new THREE.Vector3();
  for (const p of t.tips) crown.add(p);
  crown.divideScalar(t.tips.length);
  let radius = 0;
  let yMax = 0;
  for (const p of t.tips) {
    radius = Math.max(radius, Math.hypot(p.x - crown.x, p.z - crown.z));
    yMax = Math.max(yMax, p.y);
  }
  for (const p of t.tips) t.cluster(p, 9, 2.3, [1.8, 2.6], crown);
  // A few inner clusters so the crown has no holes.
  for (let i = 0; i < 6; i++) t.cluster(crown.clone().add(new THREE.Vector3(rng.gauss() * radius * 0.35, rng.range(0, 1.2), rng.gauss() * radius * 0.35)), 5, 2.4, [1.9, 2.6], crown);
  return t.build(crown, radius + 1, (yMax - trunkH) * 2 + 1.5, paintedBase(0.55, 0.75));
}

export interface TreeSpot {
  x: number;
  z: number;
  s: number;
  kind?: 'mixed' | 'banyan' | 'palm' | 'almond';
  /** Ground height (defaults to 0). */
  y?: number;
}

/** Coconut frond: a long pinnate leaf (alpha-cut), rib along the texture's v axis. */
function frondTexture(tf: TextureFactory): THREE.Texture {
  return tf.memo('frond', () => {
    const W = 128;
    const Hh = 512;
    const [c, ctx] = makeCanvas(W, Hh);
    ctx.clearRect(0, 0, W, Hh);
    const rng = new RNG(707);
    ctx.strokeStyle = 'rgba(120,110,60,1)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(W / 2, Hh);
    ctx.lineTo(W / 2, 0);
    ctx.stroke();
    for (let y = Hh - 6; y > 4; y -= 5) {
      const t = 1 - y / Hh;
      const len = (W / 2) * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.6);
      for (const sgn of [-1, 1]) {
        const shade = rng.range(0.7, 1.1);
        ctx.strokeStyle = rgba(70 * shade, 108 * shade, 38 * shade, 1);
        ctx.lineWidth = rng.range(2, 3.4);
        ctx.beginPath();
        ctx.moveTo(W / 2, y);
        ctx.quadraticCurveTo(W / 2 + sgn * len * 0.5, y - 6, W / 2 + sgn * len, y - rng.range(10, 22));
        ctx.stroke();
      }
    }
    const t = tf.tex(c, { wrap: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/**
 * Indian almond (Terminalia catappa), planted along the southern promenade: a straight trunk with
 * tiers of near-horizontal branches (a pagoda outline) and big glossy leaves at the branch ends.
 */
function almondVariant(seed: number): TreeParts {
  const rng = new RNG(seed);
  const t = new TreeBuilder(rng);
  const H = rng.range(5.6, 7.0);
  t.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, H, 0), 0.2, 0.08, 8);
  const tiers = [0.36, 0.52, 0.68, 0.84];
  const crown = new THREE.Vector3(0, H * 0.72, 0);
  let radius = 0;
  tiers.forEach((f, ti) => {
    const y = H * f;
    const n = rng.int(4, 5);
    const reach = (1 - f) * rng.range(3.6, 4.6) + 0.6;
    const a0 = rng.range(0, Math.PI * 2);
    for (let b = 0; b < n; b++) {
      const a = a0 + (b / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const from = new THREE.Vector3(0, y, 0);
      const mid = new THREE.Vector3(Math.cos(a) * reach * 0.6, y + 0.1, Math.sin(a) * reach * 0.6);
      const tip = new THREE.Vector3(Math.cos(a) * reach, y + rng.range(0.25, 0.6), Math.sin(a) * reach);
      t.rod(from, mid, 0.07 - ti * 0.01, 0.045, 5);
      t.rod(mid, tip, 0.045, 0.02, 4);
      radius = Math.max(radius, reach);
      t.cluster(tip.clone().setY(tip.y + 0.25), 7, 1.5, [1.3, 1.9], crown);
      t.cluster(mid.clone().setY(mid.y + 0.3), 4, 1.1, [1.1, 1.6], crown);
    }
  });
  t.cluster(new THREE.Vector3(0, H + 0.3, 0), 4, 0.9, [1.1, 1.5], crown);
  return t.build(crown, radius + 0.8, H * 0.8, paintedBase(0.5, 0.7));
}

/** Banyan: a fused trunk of aerial roots, long spreading limbs trailing curtains of roots, a wide dense crown. */
function banyanVariant(seed: number): TreeParts {
  const rng = new RNG(seed);
  const t = new TreeBuilder(rng);
  const trunkH = rng.range(3.4, 4.2);
  // Fused strands forming the trunk, flaring at the base.
  t.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, trunkH, 0), 0.66, 0.5, 12);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = rng.range(0.5, 0.78);
    t.rod(new THREE.Vector3(Math.cos(a) * r * 1.45, 0, Math.sin(a) * r * 1.45), new THREE.Vector3(Math.cos(a + 0.45) * r * 0.55, trunkH + 0.4, Math.sin(a + 0.45) * r * 0.55), rng.range(0.14, 0.26), 0.1, 5);
  }
  // Aerial roots hang from the older limbs; a few have reached the ground and thickened into props.
  // Only roots close to the trunk reach the ground; the rest are trimmed well above head and
  // roof height, as along Mumbai's streets.
  const hang = (a: THREE.Vector3, b: THREE.Vector3, depth: number) => {
    if (depth < 1) return;
    const n = depth >= 2 ? 5 : 3;
    for (let k = 0; k < n; k++) {
      const p = a.clone().lerp(b, rng.range(0.1, 0.95));
      const near = Math.hypot(p.x, p.z) < 3.0;
      const ground = near && rng.chance(0.35);
      const bottom = ground ? 0 : Math.max(near ? 2.2 : 3.4, p.y - rng.range(0.8, 2.2));
      if (bottom >= p.y - 0.3) continue;
      t.rod(new THREE.Vector3(p.x + rng.range(-0.25, 0.25), bottom, p.z + rng.range(-0.25, 0.25)), p, ground ? rng.range(0.06, 0.12) : rng.range(0.015, 0.035), 0.015, ground ? 5 : 3);
    }
  };
  const limbs = rng.int(6, 7);
  for (let b = 0; b < limbs; b++) {
    const a = (b / limbs) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const elev = rng.range(0.2, 0.45);
    const d = new THREE.Vector3(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev));
    t.grow(new THREE.Vector3(Math.cos(a) * 0.3, trunkH - 0.1, Math.sin(a) * 0.3), d, rng.range(3.8, 4.8), 0.32, 2, 0.12, 0.45, hang);
  }
  const crown = new THREE.Vector3();
  for (const p of t.tips) crown.add(p);
  crown.divideScalar(t.tips.length);
  crown.x = crown.z = 0;
  let radius = 0;
  let yMax = 0;
  for (const p of t.tips) {
    radius = Math.max(radius, Math.hypot(p.x, p.z));
    yMax = Math.max(yMax, p.y);
  }
  for (const p of t.tips) t.cluster(p.clone().setY(p.y + 0.4), 9, 2.6, [2.2, 3.0], crown);
  for (let i = 0; i < 10; i++) t.cluster(new THREE.Vector3(rng.gauss() * radius * 0.4, crown.y + rng.range(0.5, 1.8), rng.gauss() * radius * 0.4), 5, 2.8, [2.3, 3.0], crown);
  return t.build(crown, radius + 1.2, (yMax - trunkH) * 2 + 2, (y) => (y < 0.9 ? [0.86, 0.84, 0.79] : y < 1.1 ? [0.62, 0.2, 0.09] : [0.46, 0.42, 0.37]));
}

/** Coconut palm: curved slender trunk, arching fronds, coconuts. */
function palmVariant(seed: number): TreeParts {
  const rng = new RNG(seed);
  const H = rng.range(10, 14);
  const lean = new THREE.Vector3(rng.range(-1.5, 1.5), 0, rng.range(-1.5, 1.5));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(lean.x * t * t, H * t, lean.z * t * t));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 16, 0.17, 7, false);
  const tp = trunk.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(tp.count * 3);
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const ring = 0.85 + 0.15 * Math.sin(y * 9.0);
    col.set(y < 0.9 ? [0.86, 0.85, 0.8] : [0.52 * ring, 0.47 * ring, 0.39 * ring], i * 3);
  }
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const top = curve.getPoint(1);
  const fronds: THREE.BufferGeometry[] = [];
  const n = rng.int(14, 18);
  for (let f = 0; f < n; f++) {
    const az = (f / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const elev = rng.range(-0.25, 0.75);
    const L = rng.range(3.8, 5.0);
    const seg = 8;
    const g = new THREE.PlaneGeometry(1.2, L, 1, seg);
    // Bend the frond: rib along +Y, curving down with distance.
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = (p.getY(i) + L / 2) / L;
      const along = v * L;
      const droop = along * Math.sin(elev) - 1.4 * v * v * L * 0.3;
      p.setXYZ(i, p.getX(i) * (1 - v * 0.4), droop, along * Math.cos(elev));
    }
    g.computeVertexNormals();
    g.rotateY(az);
    g.translate(top.x, top.y, top.z);
    const nor = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
    fronds.push(g);
  }
  const nuts = new THREE.BufferGeometry();
  const nutParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    nutParts.push(new THREE.SphereGeometry(0.14, 6, 5).translate(top.x + Math.cos(a) * 0.25, top.y - 0.35, top.z + Math.sin(a) * 0.25).toNonIndexed());
  }
  const nutGeo = mergeGeometries(nutParts)!;
  const nc = new Float32Array(nutGeo.attributes.position.count * 3);
  for (let i = 0; i < nutGeo.attributes.position.count; i++) nc.set([0.35, 0.4, 0.12], i * 3);
  nutGeo.setAttribute('color', new THREE.Float32BufferAttribute(nc, 3));
  void nuts;
  const trunkNI = trunk.toNonIndexed();
  return { bark: mergeGeometries([trunkNI, nutGeo])!, leaves: mergeGeometries(fronds)! };
}

type TreeSets = { kind: TreeSpot['kind']; variants: { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry; mat: THREE.Material }[] }[];
const treeKits = new WeakMap<StationMaterials, { barkMat: THREE.Material; sets: TreeSets }>();

/** Materials and variant geometry, built once per material library. */
function treeKit(tf: TextureFactory, mats: StationMaterials): { barkMat: THREE.Material; sets: TreeSets } {
  let kit = treeKits.get(mats);
  if (kit) return kit;
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(tf), alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.82, vertexColors: true });
  mats.add('treeLeaves', leafMat, 0.4);
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTexture(tf), roughness: 0.95, vertexColors: true });
  mats.add('treeBark', barkMat, 0.5);
  const flowerMat = new THREE.MeshStandardMaterial({ map: leafTexture(tf, 'flower'), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, vertexColors: true });
  mats.add('treeFlowers', flowerMat, 0.3);
  const frondMat = new THREE.MeshStandardMaterial({ map: frondTexture(tf), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, color: 0xe8f0d8 });
  mats.add('treeFronds', frondMat, 0.3);
  const banyanLeaf = new THREE.MeshStandardMaterial({ map: leafTexture(tf, 'banyan'), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.6, vertexColors: true });
  mats.add('treeBanyan', banyanLeaf, 0.4);
  const almondLeaf = new THREE.MeshStandardMaterial({ map: leafTexture(tf, 'banyan'), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.55, vertexColors: true, color: 0xc8e0a0 });
  mats.add('treeAlmond', almondLeaf, 0.4);
  const sets: TreeSets = [
    { kind: 'mixed', variants: [11, 23, 37, 51].map((s, i) => ({ ...treeVariant(s), mat: i === 3 ? flowerMat : leafMat })) },
    { kind: 'banyan', variants: [61, 73].map((s) => ({ ...banyanVariant(s), mat: banyanLeaf })) },
    { kind: 'palm', variants: [81, 93, 97].map((s) => ({ ...palmVariant(s), mat: frondMat })) },
    { kind: 'almond', variants: [101, 113, 127].map((s) => ({ ...almondVariant(s), mat: almondLeaf })) },
  ];
  kit = { barkMat, sets };
  treeKits.set(mats, kit);
  return kit;
}

/**
 * Instanced street trees with alpha-cut foliage and dappled shadows. With `cullers` null the
 * meshes are culled whole by three.js (for groups placed away from the origin).
 */
export function buildTrees(tf: TextureFactory, mats: StationMaterials, spots: TreeSpot[], cullers: InstanceCuller[] | null, seed = 5): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const rng = new RNG(seed);
  const { barkMat, sets } = treeKit(tf, mats);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const set of sets) {
    const mine = spots.filter((t) => (t.kind ?? 'mixed') === set.kind);
    const buckets: TreeSpot[][] = set.variants.map(() => []);
    for (const t of mine) buckets[rng.int(0, set.variants.length - 1)].push(t);
    set.variants.forEach((v, i) => {
      const list = buckets[i];
      if (!list.length) return;
      const bark = new THREE.InstancedMesh(v.bark, barkMat, list.length);
      const leaves = new THREE.InstancedMesh(v.leaves, v.mat, list.length);
      const mats4: THREE.Matrix4[] = [];
      list.forEach((t, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
        m.compose(new THREE.Vector3(t.x, t.y ?? 0, t.z), q, new THREE.Vector3(t.s, t.s * rng.range(0.92, 1.1), t.s));
        bark.setMatrixAt(k, m);
        leaves.setMatrixAt(k, m);
        mats4.push(m.clone());
      });
      if (cullers) cullers.push(new InstanceCuller([bark, leaves], mats4, set.kind === 'banyan' ? 12 : 9, 380, 50));
      for (const mesh of [bark, leaves]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    });
  }
  return group;
}
