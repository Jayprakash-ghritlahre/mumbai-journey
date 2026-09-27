import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { GeoBuilder } from '../../gfx/GeoBuilder';
import { addShaderPatch } from '../../gfx/AmbientVolume';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import type { CollisionWorld } from '../../core/Collision';
import type { TextureFactory } from '../../gfx/TextureFactory';
import { InstanceCuller } from '../../gfx/InstanceCuller';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { type SignAtlas, signQuad, fillFitted, fitFont, LATIN, DEVA } from '../../gfx/Signage';
import { Path2, pathStrip, pathWall } from './Path2';
import { H, MD, VN, type RouteLayout } from './RouteLayout';
import { seaWallConcrete, tetrapodConcrete, promenadePavers, kerbBlackWhite } from './RouteTextures';
import { tetrapodGeometry, twinArmLamp, uHoop, barricade, policeChowki, chowkiBoards, drawChowkiBoard, vendorCart, gantry, dustbin, boardFrame, type PropGeo } from './Props';
import type { WalkSurface } from './WalkSurface';

export interface Placed {
  geo: PropGeo;
  mats: THREE.Matrix4[];
  cull?: { radius: number; dist: number; near: number };
  shadow?: boolean;
}

/** Turns a list of placements of one prop into instanced meshes (one per material bucket). */
export function instanceProps(p: Placed, materials: Record<string, THREE.Material>, group: THREE.Group, cullers: InstanceCuller[]): void {
  if (!p.mats.length) return;
  const meshes: THREE.InstancedMesh[] = [];
  for (const [bucket, geo] of Object.entries(p.geo)) {
    if (!geo) continue;
    const mat = materials['prop_' + bucket];
    const mesh = new THREE.InstancedMesh(geo, mat, p.mats.length);
    p.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = p.shadow !== false && bucket !== 'glow';
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    meshes.push(mesh);
  }
  if (p.cull) cullers.push(new InstanceCuller(meshes, p.mats, p.cull.radius, p.cull.dist, p.cull.near));
}

export const at = (x: number, y: number, z: number, ry = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));

/** Materials shared by all route props (vertex coloured). */
export function propMaterials(mats: StationMaterials, leafMap: THREE.Texture): void {
  const m = mats.m;
  if (m.prop_paint) return;
  mats.add('prop_paint', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }), 0.25);
  mats.add('prop_metal', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.85 }));
  const glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 1 });
  addShaderPatch(glow, 'glow-vc', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
  });
  glow.name = 'prop_glow';
  m.prop_glow = glow;
  mats.lampMats.push({ mat: glow, color: new THREE.Color(1, 1, 1), intensity: 5.5 });
  mats.add('prop_leaf', new THREE.MeshStandardMaterial({ vertexColors: true, map: leafMap, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 }), 0.3);
}

export interface MarineDriveResult {
  group: THREE.Group;
  cullers: InstanceCuller[];
  /** Positions of the promenade crowd anchors (sea wall top) for sitters. */
  wallSeats: { x: number; z: number; ry: number }[];
  signals: { x: number; z: number; ry: number; kind: 'vehicle' | 'ped' | 'both' | 'post'; group: string; banded: boolean; extra?: { ry: number; group: string }[] }[];
  lampHeads: THREE.Vector3[];
}

export function buildMarineDrive(_layout: RouteLayout, tf: TextureFactory, mats: StationMaterials, atlas: SignAtlas, col: CollisionWorld, av: AmbientVolume, walk: WalkSurface): MarineDriveResult {
  const group = new THREE.Group();
  group.name = 'marine-drive';
  const cullers: InstanceCuller[] = [];
  const rng = new RNG(1920);
  const a = MD.axis;
  const M = mats.m;
  const gb = new GeoBuilder();
  const s0 = MD.sDetail0;
  const s1 = MD.sDetail1;
  const sN = MD.sNorthCrossing;
  const sS = MD.sSouthCrossing;

  // ---- Materials ----------------------------------------------------------------------------
  const rep = (t: THREE.Texture, m: number) => {
    const c = t.clone();
    c.repeat.set(1 / m, 1 / m);
    c.needsUpdate = true;
    return c;
  };
  const prom = promenadePavers(tf);
  mats.add('mdPromenade', new THREE.MeshStandardMaterial({ map: rep(prom.map, 3), normalMap: rep(prom.normalMap!, 3), roughnessMap: rep(prom.roughnessMap!, 3), roughness: 1 }), 0.4);
  const sw = seaWallConcrete(tf);
  const swMap = sw.map.clone();
  swMap.repeat.set(1 / 4, 1 / 2);
  const swN = sw.normalMap!.clone();
  swN.repeat.set(1 / 4, 1 / 2);
  mats.add('mdSeaWall', new THREE.MeshStandardMaterial({ map: swMap, normalMap: swN, roughness: 0.9 }), 0.3);
  const tp = tetrapodConcrete(tf);
  const tpMat = new THREE.MeshStandardMaterial({ map: rep(tp.map, 2), normalMap: rep(tp.normalMap!, 2), normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.95 });
  addShaderPatch(tpMat, 'wet', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWetY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWetY = (modelMatrix * wp).y; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWetY;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float wet = 1.0 - smoothstep(${(H.sea + 0.4).toFixed(2)}, ${(H.sea + 2.2).toFixed(2)}, vWetY);
        diffuseColor.rgb *= mix(1.0, 0.42, wet);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.95, 0.75), wet * (1.0 - smoothstep(${(H.sea - 0.2).toFixed(2)}, ${(H.sea + 0.9).toFixed(2)}, vWetY)));`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, wet);');
  });
  mats.add('mdTetrapod', tpMat, 0.35);
  const kb = kerbBlackWhite(tf).map.clone();
  mats.add('mdKerb', new THREE.MeshStandardMaterial({ map: kb, roughness: 0.8 }));

  // ---- Road ---------------------------------------------------------------------------------
  // North of the detailed stretch the curve is drawn plainly; south of it Nariman Point takes over.
  const far = (fn: (sa: number, sb: number, step: number) => void) => {
    fn(0, s0, 8);
  };
  gb.add('asphalt', pathStrip(a, s0, s1, -MD.kerb, MD.kerb, H.road + 0.004, 2));
  far((sa, sb, st) => gb.add('asphalt', pathStrip(a, sa, sb, -MD.kerb, MD.kerb, H.road + 0.004, st)));

  // Median: raised strip with black-and-white kerbs, open at the junction.
  const medianRuns: [number, number][] = [
    [0, sN - 3.5],
    [sS + 3.5, s1],
  ];
  for (const [ra, rb] of medianRuns) {
    const step = rb - ra > 400 ? 4 : 2;
    gb.add('grass', pathStrip(a, ra, rb, -MD.median, MD.median, H.median, step));
    gb.add('mdKerb', pathWall(a, ra, rb, MD.median, H.road, H.median, 1, step));
    gb.add('mdKerb', pathWall(a, ra, rb, -MD.median, H.road, H.median, -1, step));
    walk.strip(a, ra, rb, -MD.median, MD.median, H.median);
  }
  // Rounded median noses at the junction.
  for (const [sn, dir] of [
    [sN - 3.5, -1],
    [sS + 3.5, 1],
  ] as [number, number][]) {
    const [x, z] = a.point(sn, 0);
    const nose = new THREE.CylinderGeometry(MD.median, MD.median, H.median, 12, 1, false, 0, Math.PI);
    nose.rotateY(a.heading(sn) + (dir < 0 ? 0 : Math.PI) + Math.PI / 2);
    gb.add('mdKerb', nose.translate(x, H.median / 2, z));
  }

  // Lane markings.
  const lane = 13.6 / MD.lanes;
  const dashes = (o: number, sa: number, sb: number, dash = 3, gap = 5, w = 0.12) => {
    for (let s = sa; s < sb; s += dash + gap) gb.add('marking', pathStrip(a, s, Math.min(sb, s + dash), o - w / 2, o + w / 2, H.road + 0.009, dash));
  };
  const solid = (o: number, sa: number, sb: number, w = 0.12) => gb.add('marking', pathStrip(a, sa, sb, o - w / 2, o + w / 2, H.road + 0.009, 4));
  for (const side of [-1, 1]) {
    for (let k = 1; k < MD.lanes; k++) {
      const o = side * (MD.median + lane * k);
      dashes(o, s0, sN - 6);
      dashes(o, sS + 6, s1);
    }
    solid(side * (MD.median + 0.3), s0, sN - 3.5);
    solid(side * (MD.median + 0.3), sS + 3.5, s1);
    solid(side * (MD.kerb - 0.35), s0, s1);
  }
  // Stop lines: southbound (east) before the north crossing, northbound (west) before the south crossing.
  gb.add('marking', pathStrip(a, sN - 3.4, sN - 3.0, MD.median, MD.kerb - 0.2, H.road + 0.009, 1));
  gb.add('marking', pathStrip(a, sS + 3.0, sS + 3.4, -MD.kerb + 0.2, -MD.median, H.road + 0.009, 1));
  // Zebra crossings: bars aligned with the road, full width.
  for (const sc of [sN, sS]) {
    for (let o = -MD.kerb + 0.6; o < MD.kerb - 0.3; o += 1.0) gb.add('marking', pathStrip(a, sc - 2.0, sc + 2.0, o, o + 0.5, H.road + 0.01, 4));
  }
  // Box junction: white criss-cross between the crossings on both carriageways.
  {
    const bs0 = sN + 2.4;
    const bs1 = sS - 2.4;
    const oA = -MD.kerb + 0.4;
    const oB = MD.kerb - 0.4;
    const w = 0.12;
    const line = (p: [number, number], q: [number, number]) => {
      const [x0, z0] = a.point(p[0], p[1]);
      const [x1, z1] = a.point(q[0], q[1]);
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.5) return;
      const g = new THREE.PlaneGeometry(len, w).rotateX(-Math.PI / 2);
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      gb.add('marking', g.translate((x0 + x1) / 2, H.road + 0.011, (z0 + z1) / 2));
    };
    // Outline.
    line([bs0, oA], [bs0, oB]);
    line([bs1, oA], [bs1, oB]);
    line([bs0, oA], [bs1, oA]);
    line([bs0, oB], [bs1, oB]);
    // Diagonals in (s, o) space, clipped to the box.
    const spacing = 2.6;
    for (const sgn of [1, -1]) {
      for (let c = -80; c < 80; c += spacing) {
        // Line: o = sgn * (s - bs0) + c
        const pts: [number, number][] = [];
        const oAt = (s: number) => sgn * (s - bs0) + c;
        const sAt = (o: number) => bs0 + (o - c) * sgn;
        for (const s of [bs0, bs1]) {
          const o = oAt(s);
          if (o >= oA && o <= oB) pts.push([s, o]);
        }
        for (const o of [oA, oB]) {
          const s = sAt(o);
          if (s > bs0 && s < bs1) pts.push([s, o]);
        }
        if (pts.length >= 2) line(pts[0], pts[1]);
      }
    }
  }

  // ---- Promenade, sea wall, step --------------------------------------------------------------
  gb.add('mdPromenade', pathStrip(a, s0, s1, MD.promenade, -MD.kerb, H.promenade, 2));
  far((sa, sb, st) => gb.add('mdPromenade', pathStrip(a, sa, sb, MD.promenade, -MD.kerb, H.promenade, st)));
  // A white line along the promenade (jogging-track edge, visible in the footage).
  solid(-17.8, s0, s1, 0.22);
  gb.add('mdKerb', pathWall(a, 0, s1, -MD.kerb, H.road, H.promenade, 1, 3));
  walk.strip(a, s0 - 40, s1 + 40, MD.promenade, -MD.kerb, H.promenade);
  // Step and wall.
  const wallStep = (sa: number, sb: number, st: number) => {
    gb.add('mdSeaWall', pathStrip(a, sa, sb, MD.stepOuter, MD.promenade, H.step, st));
    gb.add('mdSeaWall', pathWall(a, sa, sb, MD.promenade, H.promenade, H.step, 1, st));
    gb.add('mdSeaWall', pathStrip(a, sa, sb, MD.wallOuter, MD.stepOuter, H.wallTop, st));
    gb.add('mdSeaWall', pathWall(a, sa, sb, MD.stepOuter, H.step, H.wallTop, 1, st));
    gb.add('mdSeaWall', pathWall(a, sa, sb, MD.wallOuter, H.sea - 1.5, H.wallTop, -1, st));
  };
  wallStep(s0, s1, 2);
  far(wallStep);
  walk.strip(a, s0 - 40, s1 + 40, MD.stepOuter, MD.promenade, H.step);
  for (let s = s0 - 40; s < s1 + 40; s += 8) {
    const [x0, z0] = a.point(s, (MD.wallOuter + MD.stepOuter) / 2);
    const [x1, z1] = a.point(s + 8.2, (MD.wallOuter + MD.stepOuter) / 2);
    col.addWall(x0, z0, x1, z1, 0.8, -5, H.wallTop);
  }
  // Ambient: the promenade and sea are wide open; lamps along the median.
  av.paint(-760, -780, -300, 430, (x, z, sky, ceil) => {
    const p = a.project(x, z);
    if (p.o < MD.eastFoot && p.o > MD.tetrapodToe - 20) return [1, 0];
    return [sky, ceil];
  });

  // ---- Tetrapods -----------------------------------------------------------------------------
  const tetraGeo = tetrapodGeometry();
  const tetra: THREE.Matrix4[] = [];
  const band = MD.wallOuter - MD.tetrapodToe;
  const nearS0 = MD.sJunction - 420;
  const nearS1 = MD.sJunction + 320;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let s = nearS0; s < nearS1; s += 1.45) {
    for (let r = 0; r < 5; r++) {
      const t = (r + rng.range(0.1, 0.9)) / 5;
      const o = MD.wallOuter - 0.6 - t * (band - 0.8);
      const [x, z] = a.point(s + rng.range(-0.6, 0.6), o);
      const y = THREE.MathUtils.lerp(0.15, H.sea - 0.9, Math.pow(t, 0.85)) + rng.range(-0.3, 0.2);
      e.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
      q.setFromEuler(e);
      const sc = rng.range(0.85, 1.15);
      tetra.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, sc, sc)));
      // Second, deeper layer.
      if (r < 4 && rng.chance(0.7)) {
        const [x2, z2] = a.point(s + rng.range(-0.7, 0.7), o - 0.8);
        e.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
        tetra.push(new THREE.Matrix4().compose(new THREE.Vector3(x2, y - 1.3, z2), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(sc, sc, sc)));
      }
    }
  }
  const tetraMesh = new THREE.InstancedMesh(tetraGeo, M.mdTetrapod, tetra.length);
  tetra.forEach((m, i) => tetraMesh.setMatrixAt(i, m));
  tetraMesh.castShadow = true;
  tetraMesh.receiveShadow = true;
  group.add(tetraMesh);
  cullers.push(new InstanceCuller([tetraMesh], tetra, 1.6, 95, 25));
  // Beyond the detailed stretch: a rough dark band that reads as tetrapods at a distance.
  const bandGeo = (sa: number, sb: number) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const cols = 6;
    const step = 3;
    const rows = Math.max(1, Math.ceil((sb - sa) / step));
    for (let i = 0; i <= rows; i++) {
      const s = sa + ((sb - sa) * i) / rows;
      for (let j = 0; j <= cols; j++) {
        const t = j / cols;
        const o = MD.wallOuter - t * band;
        const [x, z] = a.point(s, o);
        const bump = Math.sin(s * 1.7 + j * 2.1) * 0.35 + Math.sin(s * 0.63 + j * 5.3) * 0.25;
        const y = THREE.MathUtils.lerp(0.1, H.sea - 0.6, t) + bump;
        pos.push(x, y, z);
        uv.push(s * 0.5, t * band * 0.5);
        if (i > 0 && j > 0) {
          const k = i * (cols + 1) + j;
          idx.push(k - cols - 2, k - 1, k - cols - 1, k - cols - 1, k - 1, k);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  gb.add('mdTetrapod', bandGeo(0, nearS0 + 2));
  gb.add('mdTetrapod', bandGeo(nearS1 - 2, a.length));
  // Under the modelled tetrapods too: it carries the view beyond the tetrapod LOD distance.
  const under = bandGeo(nearS0, nearS1);
  under.translate(0, -0.35, 0);
  gb.add('mdTetrapod', under);

  // ---- Lamps: median twin-arm lights and promenade lights along the whole curve ----------------
  const lampBoth = twinArmLamp(true);
  const medianLamps: THREE.Matrix4[] = [];
  const promLamps: THREE.Matrix4[] = [];
  const lampHeads: THREE.Vector3[] = [];
  for (let s = 12; s < s1 - 5; s += 32) {
    if (s > sN - 6 && s < sS + 6) continue;
    const [x, z] = a.point(s, 0);
    const h = a.heading(s);
    medianLamps.push(at(x, H.median, z, h));
    for (const sd of [-1, 1]) {
      const [hx, hz] = a.point(s, sd * 2.3);
      lampHeads.push(new THREE.Vector3(hx, 11.8, hz));
    }
    {
      const [hx, hz] = a.point(s + 16, -MD.kerb - 0.7 + 2.3);
      lampHeads.push(new THREE.Vector3(hx, 11.8, hz));
    }
    const [px, pz] = a.point(s + 16, -MD.kerb - 0.7);
    promLamps.push(at(px, H.promenade, pz, h));
    if (s > s0 - 30 && s < s1 + 30) {
      av.light(x, z, 22, 0.7);
      av.light(px, pz, 20, 0.85);
    }
  }
  // The median lamps stop short of the junction; single-arm lights on the corners and the
  // promenade side keep the crossings lit.
  const cornerLamps: THREE.Matrix4[] = [];
  for (const [s, o] of [
    [sN - 11, MD.kerb + 0.8],
    [sS + 11, MD.kerb + 0.8],
    [MD.sJunction, -MD.kerb - 0.7],
  ] as const) {
    const [x, z] = a.point(s, o);
    const toRoad = o > 0 ? a.heading(s) + Math.PI : a.heading(s);
    cornerLamps.push(at(x, o > 0 ? H.footpath : H.promenade, z, toRoad));
    col.addSolid(x, z, 0.2, 0.2, 0, -1, 6);
    const [lx, lz] = a.point(s, o - Math.sign(o) * 2.3);
    av.light(lx, lz, 22, 0.75);
    lampHeads.push(new THREE.Vector3(lx, 11.8, lz));
  }
  instanceProps({ geo: twinArmLamp(false), mats: cornerLamps, cull: { radius: 6, dist: 1800, near: 60 } }, M, group, cullers);
  instanceProps({ geo: lampBoth, mats: medianLamps, cull: { radius: 6, dist: 1800, near: 60 } }, M, group, cullers);
  instanceProps({ geo: lampBoth, mats: promLamps, cull: { radius: 6, dist: 1800, near: 60 } }, M, group, cullers);

  // ---- Promenade furniture (detailed stretch) --------------------------------------------------
  const hoops: THREE.Matrix4[] = [];
  for (let s = s0; s < s1; s += 1.55) {
    if (Math.abs(s - sN) < 3.2 || Math.abs(s - sS) < 3.2) continue;
    const [x, z] = a.point(s, -MD.kerb - 0.45);
    hoops.push(at(x, H.promenade, z, a.heading(s) + Math.PI / 2));
  }
  instanceProps({ geo: uHoop(), mats: hoops, cull: { radius: 0.6, dist: 220, near: 30 }, shadow: true }, M, group, cullers);
  for (let i = 0; i < hoops.length; i += 1) {
    const p = new THREE.Vector3().setFromMatrixPosition(hoops[i]);
    col.addSolid(p.x, p.z, 0.4, 0.05, -a.heading(a.project(p.x, p.z).s) + Math.PI / 2, -1, 1.2);
  }
  const bins: THREE.Matrix4[] = [];
  for (let s = s0 + 20; s < s1; s += 62) {
    const [x, z] = a.point(s, -MD.kerb - 1.2);
    bins.push(at(x, H.promenade, z, a.heading(s)));
  }
  instanceProps({ geo: dustbin(), mats: bins, cull: { radius: 0.8, dist: 160, near: 20 } }, M, group, cullers);
  // Police booth, barricades, vendors, gantry.
  {
    const [x, z] = a.point(sS + 14, -20.8);
    // Front towards the road.
    const bm = at(x, H.promenade, z, a.heading(sS) + Math.PI / 2);
    instanceProps({ geo: policeChowki(), mats: [bm] }, M, group, cullers);
    gb.add('routeSigns', chowkiBoards(atlas.add(512, 96, drawChowkiBoard), bm));
    col.addSolid(x, z, 1.15, 1.15, -(a.heading(sS) + Math.PI / 2), -1, 3.5);
    const bar: THREE.Matrix4[] = [];
    for (let i = 0; i < 4; i++) {
      const [bx, bz] = a.point(sN - 5 - i * 1.3, MD.kerb + 1.2);
      bar.push(at(bx, H.footpath, bz, a.heading(sN) + 0.1 * rng.gauss()));
    }
    for (let i = 0; i < 3; i++) {
      const [bx, bz] = a.point(sS + 7 + i * 1.3, -MD.kerb - 1.3);
      bar.push(at(bx, H.promenade, bz, a.heading(sS) + 0.1 * rng.gauss()));
    }
    instanceProps({ geo: barricade(), mats: bar }, M, group, cullers);
    const carts = [a.point(sN - 22, -21.5), a.point(sS + 34, -22.2), a.point(sN - 95, -21.8)].map(([cx, cz], i) => at(cx, H.promenade, cz, a.heading(sN) + (i - 1) * 0.6));
    instanceProps({ geo: vendorCart(), mats: carts }, M, group, cullers);
    for (const m of carts) {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      col.addSolid(p.x, p.z, 0.8, 0.5, 0, -1, 2);
    }
    const [gx, gz] = a.point(sN - 72, -(MD.median + 13.6 / 2));
    instanceProps({ geo: gantry(14.4), mats: [at(gx, H.road, gz, a.heading(sN))] }, M, group, cullers);
  }
  // Police sign boards on the promenade.
  const boards = [
    { s: sN - 9, en: ['RIDE SAFELY', 'WEAR HELMET'] as [string, string], deva: 'हेल्मेट वापरा' },
    { s: sS + 46, en: ['DO NOT CLIMB', 'THE SEA WALL'] as [string, string], deva: 'भिंतीवर चढू नये' },
  ];
  for (const bd of boards) {
    const rect = atlas.add(256, 320, (c, w, h) => {
      c.fillStyle = '#f4f1e8';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#b3261e';
      c.fillRect(0, 0, w, h * 0.2);
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      fillFitted(c, 'MUMBAI TRAFFIC POLICE', w / 2, h * 0.1, '700', LATIN, h * 0.075, w * 0.88);
      c.fillStyle = '#12306b';
      // Both English lines share one size.
      const enPx = Math.min(fitFont(c, bd.en[0], '800', LATIN, h * 0.12, w * 0.84), fitFont(c, bd.en[1], '800', LATIN, h * 0.12, w * 0.84));
      c.font = `800 ${enPx}px ${LATIN}`;
      c.fillText(bd.en[0], w / 2, h * 0.38);
      c.fillText(bd.en[1], w / 2, h * 0.54);
      c.fillStyle = '#b3261e';
      fillFitted(c, bd.deva, w / 2, h * 0.74, '700', DEVA, h * 0.1, w * 0.84);
      c.strokeStyle = '#12306b';
      c.lineWidth = 6;
      c.strokeRect(3, 3, w - 6, h - 6);
    });
    const [x, z] = a.point(bd.s, -19.2);
    const h = a.heading(bd.s) + Math.PI / 2;
    const m = at(x, H.promenade, z, h);
    instanceProps({ geo: boardFrame(0.9, 1.12, 1.0), mats: [m] }, M, group, cullers);
    const face = signQuad(rect, 0.9, 1.12);
    face.translate(0, 1.56, 0.0);
    face.applyMatrix4(m);
    gb.add('routeSigns', face);
    const back = signQuad(rect, 0.9, 1.12).rotateY(Math.PI).translate(0, 1.56, -0.075).applyMatrix4(m);
    gb.add('routeSigns', back);
    col.addSolid(x, z, 0.5, 0.15, -h, -1, 2.2);
  }

  // Seats on the wall for the sunset crowd.
  const wallSeats: MarineDriveResult['wallSeats'] = [];
  for (let s = MD.sJunction - 360; s < MD.sJunction + 260; s += 0.75) {
    const [x, z] = a.point(s, (MD.wallOuter + MD.stepOuter) / 2);
    wallSeats.push({ x, z, ry: a.heading(s) - Math.PI / 2 });
  }

  // Signals around the junction (heads are driven by the signal controller).
  const hN = a.heading(sN);
  const signals: MarineDriveResult['signals'] = [];
  const sig = (s: number, o: number, ry: number, kind: 'vehicle' | 'ped' | 'both' | 'post', grp: string, banded = false, extra?: { ry: number; group: string }[]) => {
    const [x, z] = a.point(s, o);
    signals.push({ x, z, ry, kind, group: grp, banded, extra });
    col.addSolid(x, z, 0.15, 0.15, 0, -1, 6);
  };
  // V.N. Road traffic arrives from the east: the corner poles also carry heads facing it.
  const hVN = VN.axis.heading(VN.sWest + 20);
  // Every corner pole also carries a head for the opposite carriageway (seen across the median),
  // as at most Mumbai junctions, so the lights read from every kerb.
  sig(sN - 3.8, MD.kerb + 0.7, hN + Math.PI, 'both', 'MD_SB', true, [{ ry: hVN, group: 'VN_WB' }, { ry: hN, group: 'MD_NB' }]);
  // Far-side posts: seen across the junction by drivers waiting at the opposite stop line.
  sig(sS + 3.8, MD.kerb + 0.7, hN + Math.PI, 'post', 'MD_SB', false, [{ ry: hVN, group: 'VN_WB' }, { ry: hN, group: 'MD_NB' }]);
  sig(sS + 3.8, -MD.kerb - 0.7, hN, 'both', 'MD_NB', false, [{ ry: hN + Math.PI, group: 'MD_SB' }]);
  sig(sN - 3.8, -MD.kerb - 0.7, hN, 'post', 'MD_NB', false, [{ ry: hN + Math.PI, group: 'MD_SB' }]);
  sig(MD.sJunction, -MD.kerb - 0.9, hVN, 'vehicle', 'VN_WB', false, [{ ry: hN, group: 'MD_NB' }]);
  sig(sN - 3.6, 0, hN + Math.PI, 'vehicle', 'MD_SB');
  sig(sS + 3.6, 0, hN, 'vehicle', 'MD_NB');

  const built = gb.build(M, { noShadowKeys: ['asphalt', 'marking', 'mdPromenade', 'grass', 'mdKerb'] });
  group.add(built);
  return { group, cullers, wallSeats, signals, lampHeads };
}

export { Path2 };
