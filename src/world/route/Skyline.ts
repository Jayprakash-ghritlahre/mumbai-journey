import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../../core/Random';
import type { TextureFactory } from '../../gfx/TextureFactory';
import { BuildingBatch } from '../city/BuildingGen';
import { NP_CITY_AREA } from './NarimanPoint';
import { FACADE } from '../../gfx/FacadeTextures';
import type { StationMaterials } from '../churchgate/StationMaterials';
import type { BackBayGeo } from './RouteLayout';

/** OSM ids of Nariman Point buildings modelled by hand. */
const LANDMARK = {
  airIndia: 358470268,
  trident: 753875938,
  express: 356173966,
  oberoi: 753875937,
};

const TINTS: [number, number, number][] = [
  [1, 0.98, 0.93],
  [0.96, 0.95, 0.92],
  [1, 0.94, 0.86],
  [0.9, 0.92, 0.94],
  [0.98, 0.9, 0.84],
  [0.86, 0.85, 0.82],
];

function centroid(fp: number[]): [number, number] {
  let x = 0;
  let z = 0;
  const n = fp.length / 2;
  for (let i = 0; i < n; i++) {
    x += fp[i * 2];
    z += fp[i * 2 + 1];
  }
  return [x / n, z / n];
}

export interface SkylineResult {
  group: THREE.Group;
  /** Positions of red aviation lights on tall towers. */
  beacons: THREE.Vector3[];
  update(time: number, night: number): void;
}

export function buildSkyline(geo: BackBayGeo, _tf: TextureFactory, mats: StationMaterials, facade: THREE.Material, rail?: (x: number, z: number) => number): SkylineResult {
  const group = new THREE.Group();
  group.name = 'skyline';
  const rng = new RNG(4242);
  const tiles = new Map<string, BuildingBatch>();
  const tileOf = (x: number, z: number) => {
    const k = `${Math.floor(x / 900)},${Math.floor(z / 900)}`;
    let b = tiles.get(k);
    if (!b) tiles.set(k, (b = new BuildingBatch()));
    return b;
  };
  const beacons: THREE.Vector3[] = [];
  const imperial: [number, number, number][] = [];
  const skip = new Set(Object.values(LANDMARK));
  let kept = 0;
  for (const b of geo.far) {
    if (skip.has(b.id)) continue;
    const [cx, cz] = centroid(b.fp);
    // The city generator builds Nariman Point.
    if (cx > NP_CITY_AREA.x0 && cx < NP_CITY_AREA.x1 && cz > NP_CITY_AREA.z0 && cz < NP_CITY_AREA.z1) continue;
    // Low-rise blocks far from the route are hidden behind nearer ones: skip them, except along
    // the railway, where the ride passes right by (station buildings on the tracks stay out).
    let railGap = rail ? rail(cx, cz) : Infinity;
    if (rail && railGap < 300) for (let i = 0; i < b.fp.length; i += 2) railGap = Math.min(railGap, rail(b.fp[i], b.fp[i + 1]));
    if (railGap < 1) continue;
    const dist = Math.hypot(cx + 395, cz);
    if (railGap > 160 && b.h < 16 && dist > 1100) continue;
    if (railGap > 160 && b.h < 26 && dist > 2600) continue;
    kept++;
    let h = b.h;
    // The twin Imperial towers (Tardeo): OSM gives 60 floors; the spires take them to ~256 m.
    const isImperial = h >= 200 && h <= 215 && Math.abs(cx + 880) < 40 && cz < -4200 && cz > -4380;
    if (isImperial) {
      h = 232;
      imperial.push([cx, cz, h]);
    }
    const tall = h > 40;
    const style = tall
      ? rng.weighted([
          [FACADE.grille, 4],
          [FACADE.glass, 2],
          [FACADE.office, 2],
          [FACADE.decoBalcony, 1],
        ] as const)
      : rng.weighted([
          [FACADE.deco, 3],
          [FACADE.grille, 3],
          [FACADE.chawl, 2],
          [FACADE.decoBalcony, 2],
        ] as const);
    tileOf(cx, cz).add({
      fp: b.fp,
      height: h,
      floorH: 3.3,
      groundH: 4.2,
      style,
      groundStyle: style,
      tint: rng.pick(TINTS),
      seed: rng.range(0, 100),
      chajjas: false,
      parapet: tall ? 1.4 : 0,
      detail: 0,
    });
    if (h > 70) beacons.push(new THREE.Vector3(cx, h + 2, cz));
  }
  console.info(`skyline: ${kept} of ${geo.far.length} far buildings kept`);
  for (const batch of tiles.values()) {
    if (batch.empty) continue;
    const walls = batch.buildWalls(facade);
    walls.castShadow = false;
    group.add(walls);
    const det = batch.details.build(mats.m, { castShadow: false });
    group.add(det);
  }

  // Imperial Towers' crowns.
  for (const [x, z, h] of imperial) {
    const crown = new THREE.ConeGeometry(9, 26, 8).translate(x, h + 13, z);
    const spire = new THREE.CylinderGeometry(0.3, 0.8, 18, 6).translate(x, h + 34, z);
    const m = new THREE.Mesh(mergeGeometries([crown.toNonIndexed(), spire.toNonIndexed()])!, mats.m.facade);
    group.add(m);
    beacons.push(new THREE.Vector3(x, h + 43, z));
  }

  // Nariman Point's towers are built in detail (NarimanPoint.ts); they keep their aviation lights.
  for (const [x, z, h] of [
    [-653, 525, 110],
    [-796, 621, 122],
    [-655, 564, 109],
  ] as const)
    beacons.push(new THREE.Vector3(x, h, z));

  // ---- Aviation lights --------------------------------------------------------------------------
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1) });
  const beaconMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.6, 6, 4), beaconMat, beacons.length);
  beacons.forEach((p, i) => beaconMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  beaconMesh.visible = false;
  group.add(beaconMesh);

  const update = (time: number, night: number) => {
    beaconMesh.visible = night > 0.4;
    const blink = Math.sin(time * 3.2) > 0.2 ? 1 : 0.15;
    beaconMat.color.setRGB(4 * blink, 0.2 * blink, 0.1 * blink);
  };
  return { group, beacons, update };
}

/** Lattice floodlight masts around a stadium outline (Wankhede, Brabourne). */
export function buildFloodlights(stadium: number[], count: number, height: number, mats: StationMaterials): THREE.Group {
  const group = new THREE.Group();
  const [cx, cz] = centroid(stadium);
  const pts: [number, number][] = [];
  for (let i = 0; i < stadium.length; i += 2) pts.push([stadium[i], stadium[i + 1]]);
  // Pick `count` outline points spread by angle around the centre.
  const chosen: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    const ang = (k / count) * Math.PI * 2 + Math.PI / count;
    let best = pts[0];
    let bd = -Infinity;
    for (const p of pts) {
      const a = Math.atan2(p[1] - cz, p[0] - cx);
      const d = Math.cos(a - ang) * Math.hypot(p[0] - cx, p[1] - cz);
      if (d > bd) {
        bd = d;
        best = p;
      }
    }
    chosen.push([cx + (best[0] - cx) * 0.93, cz + (best[1] - cz) * 0.93]);
  }
  const parts: THREE.BufferGeometry[] = [];
  const base = 3.2;
  const topW = 1.2;
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate(a.x, a.y, a.z);
    parts.push(g.toNonIndexed());
  };
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (sx: number, sz: number, y: number) => {
    const w = base + (topW - base) * (y / height);
    return new THREE.Vector3((sx * w) / 2, y, (sz * w) / 2);
  };
  for (const [sx, sz] of corners) rod(at(sx, sz, 0), at(sx, sz, height), 0.12);
  const levels = 14;
  for (let l = 0; l < levels; l++) {
    const y0 = (l / levels) * height;
    const y1 = ((l + 1) / levels) * height;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c];
      const [bx, bz] = corners[(c + 1) % 4];
      rod(at(ax, az, y0), at(bx, bz, y1), 0.05);
      rod(at(ax, az, y1), at(bx, bz, y1), 0.05);
    }
  }
  // Floodlight head: a tilted frame of lamps.
  const head = new THREE.BoxGeometry(7, 5, 0.5);
  head.rotateX(-0.45);
  head.translate(0, height + 1.5, 0.8);
  parts.push(head.toNonIndexed());
  const mastGeo = mergeGeometries(parts.map((p) => {
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal') p.deleteAttribute(k);
    return p;
  }))!;
  const mat = mats.m.steelGrey;
  const mesh = new THREE.InstancedMesh(mastGeo, mat, chosen.length);
  chosen.forEach(([x, z], i) => {
    const ry = Math.atan2(cx - x, cz - z);
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));
  });
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  return group;
}

/**
 * Reflections of shore lights on the water at night: thin additive streaks lying on the sea
 * surface, running from below each light towards the viewer (re-oriented every frame).
 */
export class WaterStreaks {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly m = new THREE.Matrix4();

  constructor(private readonly sources: THREE.Vector3[], seaY: number, color: THREE.Color) {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uIntensity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          vUv = uv;
          vSeed = float(gl_InstanceID);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uTime;
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float along = vUv.y;
          // Broken by ripples: bands that drift.
          float ripple = 0.55 + 0.45 * sin(along * 90.0 - uTime * 2.2 + vSeed * 7.1) * sin(along * 37.0 + uTime * 1.3 + vSeed);
          float a = pow(across, 3.0) * (1.0 - smoothstep(0.0, 1.0, along)) * ripple * uIntensity;
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, sources.length);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.seaY = seaY;
  }

  private seaY: number;

  update(camera: THREE.Camera, intensity: number, time: number, shore: (x: number, z: number) => [number, number]): void {
    this.mat.uniforms.uIntensity.value = intensity;
    this.mat.uniforms.uTime.value = time;
    this.mesh.visible = intensity > 0.01;
    if (!this.mesh.visible) return;
    const cam = camera.position;
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const p of this.sources) {
      // Start at the water's edge below the light, run towards the camera.
      const [sx, sz] = shore(p.x, p.z);
      const dx = cam.x - sx;
      const dz = cam.z - sz;
      const d = Math.hypot(dx, dz);
      if (d < 20 || d > 5000) continue;
      const len = Math.min(d * 0.8, 40 + d * 0.12);
      const width = 2.0 + d * 0.006;
      q.setFromAxisAngle(up, Math.atan2(dx, dz));
      this.m.compose(new THREE.Vector3(sx, this.seaY + 0.05, sz), q, new THREE.Vector3(width, 1, len));
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Night glows: soft additive points for street lights far away (the Queen's Necklace)
 * whose poles are too small to see. Size is clamped in pixels so they read at any distance.
 */
export class Glows {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;

  constructor(positions: THREE.Vector3[], color: THREE.Color, size: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions.flatMap((p) => [p.x, p.y, p.z]), 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uSize: { value: size }, uIntensity: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uSize;
        uniform float uPixel;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = clamp(uSize * 900.0 / d, 3.0, 34.0) * uPixel;
          vFade = smoothstep(30.0, 90.0, d);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying float vFade;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float r = length(q) * 2.0;
          float core = exp(-r * r * 14.0) * 1.6;
          float halo = exp(-r * r * 3.0) * 0.45;
          float a = (core + halo) * uIntensity * vFade;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  update(intensity: number, pixelRatio: number): void {
    this.mat.uniforms.uIntensity.value = intensity;
    this.mat.uniforms.uPixel.value = pixelRatio;
    this.points.visible = intensity > 0.01;
  }
}
