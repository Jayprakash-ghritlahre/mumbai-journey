import * as THREE from 'three';

/**
 * A smooth centre line in the XZ plane, resampled every `step` metres for fast
 * arc-length lookups. Offsets are measured along the normal n = (tz, −tx), which is
 * the left-hand side when the map is viewed north-up (x east, z south).
 */
export class Path2 {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly cum: Float32Array;
  readonly length: number;
  private readonly step: number;

  constructor(control: [number, number][], step = 1, smooth = true) {
    let pts: THREE.Vector3[];
    if (smooth && control.length > 2) {
      const curve = new THREE.CatmullRomCurve3(
        control.map(([x, z]) => new THREE.Vector3(x, 0, z)),
        false,
        'centripetal',
      );
      const n = Math.max(2, Math.ceil(curve.getLength() / step));
      pts = curve.getSpacedPoints(n);
    } else {
      pts = [];
      for (let i = 0; i < control.length - 1; i++) {
        const a = new THREE.Vector3(control[i][0], 0, control[i][1]);
        const b = new THREE.Vector3(control[i + 1][0], 0, control[i + 1][1]);
        const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
        for (let k = 0; k < n; k++) pts.push(a.clone().lerp(b, k / n));
      }
      const last = control[control.length - 1];
      pts.push(new THREE.Vector3(last[0], 0, last[1]));
    }
    this.x = new Float32Array(pts.map((p) => p.x));
    this.z = new Float32Array(pts.map((p) => p.z));
    this.cum = new Float32Array(pts.length);
    for (let i = 1; i < pts.length; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]);
    this.length = this.cum[pts.length - 1];
    this.step = this.length / (pts.length - 1);
  }

  private index(s: number): number {
    const i = Math.floor(THREE.MathUtils.clamp(s, 0, this.length) / this.step);
    return Math.min(this.x.length - 2, Math.max(0, i));
  }

  /** Position and unit tangent at arc length s. */
  at(s: number, out = { x: 0, z: 0, tx: 1, tz: 0 }): { x: number; z: number; tx: number; tz: number } {
    const i = this.index(s);
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const t = THREE.MathUtils.clamp((s - this.cum[i]) / seg, 0, 1);
    const dx = this.x[i + 1] - this.x[i];
    const dz = this.z[i + 1] - this.z[i];
    const len = Math.hypot(dx, dz) || 1;
    out.x = this.x[i] + dx * t;
    out.z = this.z[i] + dz * t;
    out.tx = dx / len;
    out.tz = dz / len;
    // Extrapolate beyond the ends along the end tangent.
    if (s < 0) {
      out.x += out.tx * s;
      out.z += out.tz * s;
    } else if (s > this.length) {
      out.x += out.tx * (s - this.length);
      out.z += out.tz * (s - this.length);
    }
    return out;
  }

  /** Point at arc length s, offset o along the normal. */
  point(s: number, o: number): [number, number] {
    const a = this.at(s);
    return [a.x + a.tz * o, a.z - a.tx * o];
  }

  /** Heading (rotation about Y, radians) of the tangent: object +Z aligned with the path. */
  heading(s: number): number {
    const a = this.at(s);
    return Math.atan2(a.tx, a.tz);
  }

  /** Nearest arc length and signed offset of a point. */
  project(px: number, pz: number): { s: number; o: number; d: number } {
    let best = 0;
    let bd = Infinity;
    // Coarse search then local refine.
    const n = this.x.length;
    const stride = Math.max(1, Math.floor(n / 200));
    for (let i = 0; i < n; i += stride) {
      const d = (this.x[i] - px) ** 2 + (this.z[i] - pz) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const lo = Math.max(0, best - stride - 1);
    const hi = Math.min(n - 2, best + stride + 1);
    let bs = 0;
    bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      const ax = this.x[i];
      const az = this.z[i];
      const dx = this.x[i + 1] - ax;
      const dz = this.z[i + 1] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
      const qx = ax + dx * t;
      const qz = az + dz * t;
      const d = (qx - px) ** 2 + (qz - pz) ** 2;
      if (d < bd) {
        bd = d;
        bs = this.cum[i] + t * Math.sqrt(l2);
      }
    }
    const a = this.at(bs);
    const o = (px - a.x) * a.tz - (pz - a.z) * a.tx;
    return { s: bs, o, d: Math.sqrt(bd) };
  }

  /** Arc length (on this path) where this path's offset line crosses another path's offset line. */
  intersectOffsetAt(selfOffset: number, other: Path2, otherOffset: number, s0 = 0, s1 = this.length, step = 0.5): number | null {
    let prev: number | null = null;
    for (let s = s0; s <= s1; s += step) {
      const [x, z] = this.point(s, selfOffset);
      const o = other.project(x, z).o - otherOffset;
      if (prev !== null && Math.sign(o) !== Math.sign(prev)) return s - step * (o / (o - prev));
      prev = o;
    }
    return null;
  }

  /** Arc length where the path crosses another path's offset line (first hit), or null. */
  intersectOffset(other: Path2, otherOffset: number, s0 = 0, s1 = this.length, step = 0.5): number | null {
    let prev: number | null = null;
    for (let s = s0; s <= s1; s += step) {
      const [x, z] = this.point(s, 0);
      const o = other.project(x, z).o - otherOffset;
      if (prev !== null && Math.sign(o) !== Math.sign(prev)) {
        // Linear refine.
        return s - step * (o / (o - prev));
      }
      prev = o;
    }
    return null;
  }
}

/** Flat ribbon following a path between two offsets (normals up, metre UVs: u along, v across). */
export function pathStrip(path: Path2, s0: number, s1: number, o0: number, o1: number, y: number, step = 2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const [ax, az] = path.point(s, o0);
    const [bx, bz] = path.point(s, o1);
    pos.push(ax, y, az, bx, y, bz);
    uv.push(s, o0, s, o1);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  return finishUp(pos, uv, idx);
}

/** Vertical face along a path offset line from y0 to y1; `facing` +1 faces +normal, −1 faces −normal. */
export function pathWall(path: Path2, s0: number, s1: number, o: number, y0: number, y1: number, facing: 1 | -1, step = 2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const [x, z] = path.point(s, o);
    pos.push(x, y0, z, x, y1, z);
    uv.push(s, 0, s, y1 - y0);
    if (i > 0) {
      const k = (i - 1) * 2;
      if (facing > 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Makes sure a strip faces up. */
function finishUp(pos: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  if (nrm.count && nrm.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** Triangulated horizontal polygon (x,z pairs) at height y with planar metre UVs, facing up. */
export function flatPolygon(pts: [number, number][], y: number, holes: [number, number][][] = []): THREE.BufferGeometry {
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const hs = holes.map((h) => {
    const v = h.map(([x, z]) => new THREE.Vector2(x, z));
    if (!THREE.ShapeUtils.isClockWise(v)) v.reverse();
    return v;
  });
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = [...contour, ...hs.flat()];
  const pos: number[] = [];
  const uv: number[] = [];
  for (const t of tris) {
    const [a, b, c] = t.map((i) => all[i]);
    // Upward facing in x/z: counter-clockwise when viewed from +Y means (b-a)×(c-a) has negative y component in x,z terms.
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (const v of cross < 0 ? [a, b, c] : [a, c, b]) {
      pos.push(v.x, y, v.y);
      uv.push(v.x, -v.y);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
