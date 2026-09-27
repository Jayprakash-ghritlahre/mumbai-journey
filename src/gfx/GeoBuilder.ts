import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Box whose UVs are in metres on every face (so textures keep a constant texel density). */
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z (4 verts each).
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  return g;
}

/** Plane in XZ (facing +Y) with metre UVs. */
export function floorGeo(w: number, d: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  return g;
}

/** Plane facing +Z with metre UVs. */
export function wallGeo(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return g;
}

/** Rewrites UVs from world-space planar projection (after the geometry is placed). */
export function planarUV(g: THREE.BufferGeometry, axis: 'xz' | 'xy' | 'zy', scale = 1, offset: [number, number] = [0, 0]): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (axis === 'xz') uv.setXY(i, x * scale + offset[0], -z * scale + offset[1]);
    else if (axis === 'xy') uv.setXY(i, x * scale + offset[0], y * scale + offset[1]);
    else uv.setXY(i, z * scale + offset[0], y * scale + offset[1]);
  }
  uv.needsUpdate = true;
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * A beam (box) from a to b with the given cross section. `upHint` orients the
 * section's height axis (defaults to world up, or +Z for vertical members).
 */
export function beamGeo(a: THREE.Vector3, b: THREE.Vector3, width: number, height: number, upHint?: THREE.Vector3): THREE.BufferGeometry {
  const dir = _v.subVectors(b, a);
  const len = dir.length();
  const g = boxGeo(len, height, width);
  dir.normalize();
  _up.copy(upHint ?? (Math.abs(dir.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)));
  const zAxis = new THREE.Vector3().crossVectors(dir, _up).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, dir).normalize();
  _m.makeBasis(dir, yAxis, zAxis);
  _m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  g.applyMatrix4(_m);
  return g;
}

/** Cylinder between two points (for rods, poles, handrails). */
export function rodGeo(a: THREE.Vector3, b: THREE.Vector3, radius: number, segments = 6, radiusB = radius): THREE.BufferGeometry {
  const dir = _v.subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(radiusB, radius, len, segments, 1, radius < 0.05);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  _m.compose(_s.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), _q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

/** Ensures a geometry has exactly position/normal/uv(/color) and is indexed, so buckets merge cleanly. */
function normalise(g: THREE.BufferGeometry, withColor: boolean): THREE.BufferGeometry {
  if (!g.index) {
    const idx = new Array(g.attributes.position.count).fill(0).map((_, i) => i);
    g.setIndex(idx);
  }
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (withColor && !g.attributes.color) {
    const c = new Float32Array(g.attributes.position.count * 3).fill(1);
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  if (!withColor && g.attributes.color) g.deleteAttribute('color');
  g.morphAttributes = {};
  return g;
}

/** Paints a constant vertex colour (used for cheap per-part tinting / baked darkening). */
export function tint(g: THREE.BufferGeometry, r: number, gg: number, b: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gg;
    c[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}

/** Collects geometry per material key and merges each bucket into a single mesh. */
export class GeoBuilder {
  private buckets = new Map<string, THREE.BufferGeometry[]>();
  private colored = new Set<string>();

  add(key: string, g: THREE.BufferGeometry, matrix?: THREE.Matrix4): this {
    if (matrix) g.applyMatrix4(matrix);
    if (g.attributes.color) this.colored.add(key);
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(g);
    return this;
  }

  /** Adds a box centred at (x,y,z) with optional rotation about Y. */
  box(key: string, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): this {
    const g = boxGeo(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    return this.add(key, g);
  }

  has(key: string): boolean {
    return this.buckets.has(key);
  }

  merged(key: string): THREE.BufferGeometry | null {
    const list = this.buckets.get(key);
    if (!list || !list.length) return null;
    const withColor = this.colored.has(key);
    const merged = mergeGeometries(list.map((g) => normalise(g, withColor)), false);
    list.forEach((g) => g.dispose());
    this.buckets.delete(key);
    if (merged) merged.computeBoundingSphere();
    return merged;
  }

  build(materials: Record<string, THREE.Material>, opts: { castShadow?: boolean; receiveShadow?: boolean; noShadowKeys?: string[] } = {}): THREE.Group {
    const group = new THREE.Group();
    for (const key of Array.from(this.buckets.keys())) {
      const mat = materials[key];
      if (!mat) throw new Error(`GeoBuilder: no material for "${key}"`);
      const geo = this.merged(key);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = key;
      const shadowOff = opts.noShadowKeys?.includes(key);
      mesh.castShadow = !shadowOff && (opts.castShadow ?? true);
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    return group;
  }
}
