import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { GeoBuilder, boxGeo, tint } from '../../gfx/GeoBuilder';
import { FACADE } from '../../gfx/FacadeTextures';
import { addShaderPatch, type AmbientVolume } from '../../gfx/AmbientVolume';

export interface BuildingSpec {
  /** Footprint ring [x0,z0,x1,z1,...], counter-clockwise viewed from above (negative shoelace in x/z). */
  fp: number[];
  height: number;
  floorH: number;
  groundH: number;
  style: number;
  groundStyle: number;
  tint: [number, number, number];
  seed: number;
  chajjas: boolean;
  parapet: number;
  detail: 0 | 1 | 2;
  /** Skip generating walls for ground floor edges (custom frontage supplied elsewhere). */
  noGround?: boolean;
  baseY?: number;
}

/** Accumulates building walls (facade-array shaded) plus roofs and details (vertex coloured). */
export class BuildingBatch {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private style: number[] = [];
  private tint: number[] = [];
  private seed: number[] = [];
  readonly details = new GeoBuilder();
  private rng = new RNG(77);

  private wallQuad(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, u0: number, u1: number, v0: number, v1: number, style: number, tint: [number, number, number], seed: number): void {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const P = [
      [ax, y0, az, u0, v0],
      [bx, y0, bz, u1, v0],
      [bx, y1, bz, u1, v1],
      [ax, y0, az, u0, v0],
      [bx, y1, bz, u1, v1],
      [ax, y1, az, u0, v1],
    ];
    for (const [x, y, z, u, v] of P) {
      this.pos.push(x, y, z);
      this.nor.push(nx, 0, nz);
      this.uv.push(u, v);
      this.style.push(style);
      this.tint.push(...tint);
      this.seed.push(seed);
    }
  }

  add(b: BuildingSpec): void {
    const fp = b.fp;
    const n = fp.length / 2;
    const base = b.baseY ?? 0;
    const H = base + b.height;
    const floors = Math.max(1, Math.round((b.height - b.groundH) / b.floorH));
    let u = 0;
    for (let i = 0; i < n; i++) {
      const ax = fp[i * 2];
      const az = fp[i * 2 + 1];
      const bx = fp[((i + 1) % n) * 2];
      const bz = fp[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      const bayW = b.style === FACADE.office || b.style === FACADE.glass ? 3.2 : 3.6;
      const bays = Math.max(1, Math.round(len / bayW));
      const u0 = Math.round(u);
      const u1 = u0 + bays;
      u = u1;
      const blankEdge = len < 2.2;
      const style = blankEdge ? FACADE.blank : b.style;
      if (!b.noGround) this.wallQuad(ax, az, bx, bz, base, base + b.groundH, u0, u1, 0, 1, blankEdge ? FACADE.blank : b.groundStyle, b.tint, b.seed);
      this.wallQuad(ax, az, bx, bz, base + b.groundH, H, u0, u1, 0, floors, style, b.tint, b.seed + 0.37);
      if (b.parapet > 0) this.wallQuad(ax, az, bx, bz, H, H + b.parapet, u0, u1, 0.02, 0.25, FACADE.blank, b.tint, b.seed);
      if (b.detail >= 1 && b.chajjas && len > 2.5) {
        // Projecting sunshades / floor bands (the classic Art Deco eyebrow lines).
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        const ang = Math.atan2(-(bz - az), bx - ax);
        for (let k = 0; k < floors; k++) {
          const y = base + b.groundH + k * b.floorH + b.floorH * 0.8;
          if (y > H - 0.5) break;
          const g = boxGeo(len + 0.2, 0.09, 0.55);
          g.rotateY(ang);
          g.translate((ax + bx) / 2 + nx * 0.26, y, (az + bz) / 2 + nz * 0.26);
          this.details.add('cityDetail', tint(g, 0.86, 0.83, 0.76));
        }
        // Canopy over the ground floor shops.
        const g = boxGeo(len, 0.12, 1.4);
        g.rotateY(ang);
        g.translate((ax + bx) / 2 + nx * 0.7, base + b.groundH - 0.2, (az + bz) / 2 + nz * 0.7);
        this.details.add('cityDetail', tint(g, 0.8, 0.78, 0.72));
      }
    }
    // Flat roof with parapet inner face.
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(fp[i * 2], fp[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const rp: number[] = [];
    for (const t of tris) {
      const [a, c, d] = t.map((k) => contour[k]);
      // Ensure upward winding.
      const cross = (c.x - a.x) * (d.y - a.y) - (c.y - a.y) * (d.x - a.x);
      const order = cross < 0 ? [a, c, d] : [a, d, c];
      for (const v of order) rp.push(v.x, H + 0.02, v.y);
    }
    if (rp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      g.computeVertexNormals();
      const uvs = new Float32Array((rp.length / 3) * 2);
      for (let i = 0; i < rp.length / 3; i++) {
        uvs[i * 2] = rp[i * 3];
        uvs[i * 2 + 1] = rp[i * 3 + 2];
      }
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const rt = 0.24 + this.rng.next() * 0.1;
      this.details.add('cityDetail', tint(g, rt, rt * 0.97, rt * 0.93));
    }
    if (b.detail >= 1) this.rooftop(b, contour, H);
  }

  private rooftop(b: BuildingSpec, contour: THREE.Vector2[], H: number): void {
    const rng = this.rng;
    let cx = 0;
    let cz = 0;
    for (const p of contour) {
      cx += p.x;
      cz += p.y;
    }
    cx /= contour.length;
    cz /= contour.length;
    const inside = (x: number, z: number) => {
      let c = false;
      for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
        const a = contour[i];
        const d = contour[j];
        if (a.y > z !== d.y > z && x < ((d.x - a.x) * (z - a.y)) / (d.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    // Lift machine room.
    if (inside(cx, cz) && b.height > 12) this.details.add('cityDetail', tint(boxGeo(3.2, 2.8, 3.6).translate(cx, H + 1.4, cz), 0.62, 0.6, 0.56));
    // Black water tanks (Sintex), the most Mumbai of rooftop clutter.
    const tanks = rng.int(1, 4);
    for (let i = 0; i < tanks; i++) {
      const x = cx + rng.range(-6, 6);
      const z = cz + rng.range(-6, 6);
      if (!inside(x, z)) continue;
      const r = rng.range(0.55, 0.8);
      const t = new THREE.CylinderGeometry(r, r, r * 2.1, 10);
      t.translate(x, H + 0.4 + r * 1.05, z);
      this.details.add('cityDetail', tint(t, 0.035, 0.035, 0.035));
      this.details.add('cityDetail', tint(boxGeo(r * 2.2, 0.4, r * 2.2).translate(x, H + 0.2, z), 0.5, 0.48, 0.45));
    }
    if (rng.chance(0.4)) {
      const x = cx + rng.range(-5, 5);
      const z = cz + rng.range(-5, 5);
      if (inside(x, z) && b.height > 0) {
        const d = new THREE.CylinderGeometry(0.5, 0.2, 0.2, 10);
        d.rotateX(0.9);
        d.translate(x, H + 1.1, z);
        this.details.add('cityDetail', tint(d, 0.7, 0.7, 0.7));
      }
    }
  }

  buildWalls(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.style, 1));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.seed, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }
}

/** Facade material: samples the texture array per style, tints, varies per window and lights windows at night. */
export function createFacadeMaterial(tex: THREE.DataArrayTexture, av: AmbientVolume): { material: THREE.MeshStandardMaterial; uniforms: { uNight: { value: number } } } {
  const uniforms = { uNight: { value: 0 }, uFacades: { value: tex } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, emissive: 0xffffff });
  mat.name = 'facade';
  addShaderPatch(mat, 'facade', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStyle;\nattribute vec3 aTint;\nattribute float aSeed;\nvarying vec2 vFacUv;\nvarying float vStyle;\nvarying vec3 vTint;\nvarying float vSeed;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFacUv = uv; vStyle = aStyle; vTint = aTint; vSeed = aSeed;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2DArray uFacades;
        uniform float uNight;
        varying vec2 vFacUv;
        varying float vStyle;
        varying vec3 vTint;
        varying float vSeed;
        float facHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 facS = texture(uFacades, vec3(vFacUv, floor(vStyle + 0.5)));
        vec2 facCell = floor(vFacUv);
        float facR = facHash(facCell + vSeed * 17.0);
        float facR2 = facHash(facCell.yx + vSeed * 3.1 + 5.0);
        diffuseColor.rgb *= facS.rgb * vTint * mix(0.9 + 0.2 * facR, 0.96 + 0.08 * facR, facS.a);
        float facMask = facS.a;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, facMask);')
      .replace(
        '#include <emissivemap_fragment>',
        `{
          float lit = step(0.52, facR2) * facMask * uNight;
          // Mostly warm tungsten / curtains, a few cool tube lights and TV-blue flicker.
          vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.8, 0.55), facR);
          warm = mix(warm, vec3(0.75, 0.88, 1.0), step(0.85, facR));
          totalEmissiveRadiance = warm * lit * (0.18 + 0.75 * facR * facR) * (0.55 + 0.9 * dot(facS.rgb, vec3(0.33)));
        }`,
      );
  });
  av.patch(mat);
  return { material: mat, uniforms };
}
