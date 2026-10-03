import * as THREE from 'three';
import { addShaderPatch } from '../../gfx/AmbientVolume';
import type { TextureFactory } from '../../gfx/TextureFactory';
import { oceanNormals } from './RouteTextures';
import { H } from './RouteLayout';

/** Distance-to-shore field (metres, clamped) over a rectangle, for foam and shallow-water tint. */
export class ShoreField {
  readonly texture: THREE.DataTexture;
  readonly bounds: THREE.Vector4;

  constructor(land: number[][], x0: number, z0: number, x1: number, z1: number, res = 2, maxDist = 60) {
    const w = Math.ceil((x1 - x0) / res);
    const h = Math.ceil((z1 - z0) / res);
    const inside = new Uint8Array(w * h);
    // Scanline polygon fill (even-odd over all rings).
    for (let j = 0; j < h; j++) {
      const z = z0 + (j + 0.5) * res;
      const xs: number[] = [];
      for (const ring of land) {
        const n = ring.length / 2;
        for (let i = 0, k = n - 1; i < n; k = i++) {
          const ax = ring[i * 2];
          const az = ring[i * 2 + 1];
          const bx = ring[k * 2];
          const bz = ring[k * 2 + 1];
          if (az > z !== bz > z) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - x0) / res - 0.5));
        const i1 = Math.min(w - 1, Math.floor((xs[q + 1] - x0) / res - 0.5));
        for (let i = i0; i <= i1; i++) inside[j * w + i] = 1;
      }
    }
    // Two-pass chamfer distance transform from land cells (in cells).
    const INF = 1e9;
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = inside[i] ? 0 : INF;
    const a = 1;
    const b = Math.SQRT2;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) {
          v = Math.min(v, d[k - w] + a);
          if (i > 0) v = Math.min(v, d[k - w - 1] + b);
          if (i < w - 1) v = Math.min(v, d[k - w + 1] + b);
        }
        d[k] = v;
      }
    for (let j = h - 1; j >= 0; j--)
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        let v = d[k];
        if (i < w - 1) v = Math.min(v, d[k + 1] + a);
        if (j < h - 1) {
          v = Math.min(v, d[k + w] + a);
          if (i < w - 1) v = Math.min(v, d[k + w + 1] + b);
          if (i > 0) v = Math.min(v, d[k + w - 1] + b);
        }
        d[k] = v;
      }
    const data = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = Math.min(255, Math.round(((d[i] * res) / maxDist) * 255));
    this.texture = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.bounds = new THREE.Vector4(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0));
    void maxDist;
  }
}

/** Polar grid: dense near the centre, sparse to the horizon. */
function polarGrid(radius: number, rings: number, segs: number, power: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  for (let r = 1; r <= rings; r++) {
    const rad = radius * Math.pow(r / rings, power);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs;
    const b0 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}

// Waves travel towards the Marine Drive shore (local +x ≈ east). The fifth is the monsoon's long
// swell off the Arabian Sea (none in fair weather).
const WAVES = [
  { dir: [0.96, 0.18], len: 31, amp: 0.2, q: 0.45 },
  { dir: [0.82, -0.52], len: 17, amp: 0.11, q: 0.5 },
  { dir: [0.9, 0.42], len: 9.5, amp: 0.055, q: 0.55 },
  { dir: [0.72, -0.68], len: 5.5, amp: 0.028, q: 0.55 },
  { dir: [0.97, -0.22], len: 62, amp: 0, q: 0.3 },
];

/** How much higher the sea stands at a monsoon high tide (m, ⚠ an estimate for the wall's look). */
export const MONSOON_TIDE = 1.5;

/** A big wave running in to the wall: impact point, when it hits (s), how big; its direction. */
export interface Surge {
  x: number;
  z: number;
  at: number;
  strength: number;
  /** Landward unit normal and the shore's direction. */
  nx: number;
  nz: number;
}

/** Shared by the vertex and fragment stages: a surge's height (and its whitewater) at p. */
const surgeGLSL = /* glsl */ `
uniform vec4 uSurge[4];
uniform vec2 uSurgeN[4];
float oceanSurge(vec2 p, float t, out float foam) {
  float h = 0.0;
  foam = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 s = uSurge[i];
    if (s.w <= 0.0) continue;
    vec2 n = uSurgeN[i];
    vec2 rel = p - s.xy;
    float off = -dot(rel, n);
    float lat = dot(rel, vec2(-n.y, n.x));
    float dt = s.z - t;
    float crest = max(dt, 0.0) * 6.5;
    float x = off - crest;
    float side = exp(-lat * lat / (2.0 * 26.0 * 26.0)) * smoothstep(-0.5, 2.5, off);
    float grow = 0.35 + 0.65 * (1.0 - smoothstep(10.0, 75.0, crest));
    float alive = smoothstep(-1.6, 0.0, dt) * (1.0 - smoothstep(80.0, 95.0, crest));
    // Steep in front (landward), long behind.
    float shape = x < 0.0 ? exp(-x * x / (2.0 * 3.5 * 3.5)) : exp(-x * x / (2.0 * 9.0 * 9.0));
    h += s.w * 1.7 * grow * side * shape * alive;
    // Whitewater on the crest as it steepens, then the churned water left at the wall.
    foam += side * shape * alive * smoothstep(45.0, 5.0, crest) * s.w * 1.3;
    float age = -dt;
    foam += side * (1.0 - smoothstep(0.0, 9.0, age)) * step(0.0, age) * (1.0 - smoothstep(4.0, 26.0, off)) * s.w * 1.2;
  }
  return h;
}`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly uniforms = {
    uTime: { value: 0 },
    uOrigin: { value: new THREE.Vector3() },
    uShore: { value: null as THREE.Texture | null },
    uShoreB: { value: new THREE.Vector4() },
    uWaveDir: { value: WAVES.map((w) => new THREE.Vector2(w.dir[0], w.dir[1]).normalize()) },
    uWaveK: { value: WAVES.map((w) => (2 * Math.PI) / w.len) },
    uWaveA: { value: WAVES.map((w) => w.amp) },
    uWaveQ: { value: WAVES.map((w) => w.q) },
    uWaveW: { value: WAVES.map((w) => Math.sqrt(9.81 * ((2 * Math.PI) / w.len))) },
    uFoamColor: { value: new THREE.Color(0.9, 0.9, 0.86) },
    uShallow: { value: new THREE.Color(0.2, 0.22, 0.16) },
    uNightGlow: { value: 0 },
    uRough: { value: 0 },
    uTide: { value: 0 },
    /** East of the shore field is inland Churchgate (no sea there, whatever the field says). */
    uInlandX: { value: 0 },
    uSurge: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    uSurgeN: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(1, 0)) },
  };
  private readonly baseAmp = WAVES.map((w) => w.amp);

  constructor(tf: TextureFactory, shore: ShoreField) {
    const normal = oceanNormals(tf);
    normal.repeat.set(1, 1);
    this.uniforms.uShore.value = shore.texture;
    this.uniforms.uShoreB.value.copy(shore.bounds);
    this.uniforms.uInlandX.value = shore.bounds.x + 1 / shore.bounds.z;
    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.022, 0.045, 0.05),
      roughness: 0.1,
      metalness: 0,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      envMapIntensity: 0.75,
    });
    this.material.name = 'ocean';
    const u = this.uniforms;
    addShaderPatch(this.material, 'ocean', (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec3 uOrigin;
          uniform vec2 uWaveDir[5];
          uniform float uWaveK[5];
          uniform float uWaveA[5];
          uniform float uWaveQ[5];
          uniform float uWaveW[5];
          varying vec3 vOceanW;
          varying float vCrest;
          varying float vDist;
          uniform sampler2D uShore;
          uniform vec4 uShoreB;
          uniform float uTide;
          uniform float uInlandX;
          ${surgeGLSL}`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 oceanP = (modelMatrix * vec4(position, 1.0)).xyz;
          float oceanD = length(oceanP.xz - uOrigin.xz);
          // Only the sea rises and heaves (the plane runs on under the land, out of sight).
          vec2 shoreUVv = (oceanP.xz - uShoreB.xy) * uShoreB.zw;
          bool shoreInV = shoreUVv.x >= 0.0 && shoreUVv.x <= 1.0 && shoreUVv.y >= 0.0 && shoreUVv.y <= 1.0;
          float seaMask = shoreInV ? smoothstep(0.015, 0.06, texture2D(uShore, shoreUVv).r) : step(oceanP.x, uInlandX);
          float oceanFade = (1.0 - smoothstep(120.0, 700.0, oceanD)) * seaMask;
          vec3 oceanDisp = vec3(0.0);
          vec3 oceanN = vec3(0.0, 1.0, 0.0);
          float crest = 0.0;
          for (int i = 0; i < 5; i++) {
            // Short waves only shade (normals); long waves also displace.
            float kk = uWaveK[i];
            float ph = kk * dot(uWaveDir[i], oceanP.xz) - uWaveW[i] * uTime;
            float c = cos(ph);
            float s = sin(ph);
            float amp = uWaveA[i] * oceanFade;
            if (i < 2 || i == 4) {
              oceanDisp.xz += uWaveQ[i] * amp * uWaveDir[i] * c;
              oceanDisp.y += amp * s;
            }
            oceanN.xz -= uWaveDir[i] * kk * amp * c;
            oceanN.y -= uWaveQ[i] * kk * amp * s;
            crest += s * amp;
          }
          // A big wave running in to the wall (the slope from neighbouring samples).
          {
            float sf;
            float sh = oceanSurge(oceanP.xz, uTime, sf);
            if (sh > 0.001) {
              float hx = oceanSurge(oceanP.xz + vec2(0.6, 0.0), uTime, sf);
              float hz = oceanSurge(oceanP.xz + vec2(0.0, 0.6), uTime, sf);
              oceanDisp.y += sh * seaMask;
              oceanN.xz -= vec2(hx - sh, hz - sh) / 0.6 * seaMask;
              crest += sh * 0.25;
            }
          }
          // The monsoon's high tide; never up through the land (its ground is at road level).
          oceanDisp.y = min(oceanDisp.y + uTide * seaMask, ${(-0.3 - H.sea).toFixed(2)});
          vCrest = crest;
          vec3 objectNormal = normalize(oceanN);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position) + oceanDisp;
          vOceanW = oceanP + oceanDisp;
          vDist = oceanD;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform sampler2D uShore;
          uniform vec4 uShoreB;
          uniform vec3 uFoamColor;
          uniform vec3 uShallow;
          uniform float uNightGlow;
          uniform float uRough;
          ${surgeGLSL}
          varying vec3 vOceanW;
          varying float vCrest;
          varying float vDist;
          float oHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float oNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(oHash(i), oHash(i + vec2(1, 0)), u.x), mix(oHash(i + vec2(0, 1)), oHash(i + vec2(1, 1)), u.x), u.y);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 shoreUV = (vOceanW.xz - uShoreB.xy) * uShoreB.zw;
          float shoreIn = step(0.0, shoreUV.x) * step(shoreUV.x, 1.0) * step(0.0, shoreUV.y) * step(shoreUV.y, 1.0);
          float shoreD = mix(60.0, texture2D(uShore, clamp(shoreUV, 0.0, 1.0)).r * 60.0, shoreIn);
          // The monsoon sea: churned grey-green, browner with silt near the shore.
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.048, 0.042), uRough * 0.8);
          vec3 shallow = mix(uShallow, vec3(0.17, 0.16, 0.11), uRough);
          // Silty, greener water close to the shore.
          diffuseColor.rgb = mix(diffuseColor.rgb, shallow, (1.0 - smoothstep(4.0, 45.0 + 30.0 * uRough, shoreD)) * (0.55 + 0.2 * uRough));
          // Foam: churned water around the tetrapods, pulsing with the swell.
          float pulse = 0.5 + 0.5 * sin(uTime * 0.9 - shoreD * 0.35 + oNoise(vOceanW.xz * 0.05) * 6.0);
          float foamBand = 1.0 - smoothstep(0.0, 9.0 + 5.0 * pulse + 16.0 * uRough * pulse, shoreD);
          float foamTex = oNoise(vOceanW.xz * 0.9 + vec2(uTime * 0.25, uTime * 0.1)) * 0.6 + oNoise(vOceanW.xz * 3.1 - uTime * 0.3) * 0.4;
          float foam = smoothstep(0.45 - 0.05 * uRough, 0.8, foamTex * (0.6 + 0.8 * foamBand)) * foamBand;
          // Whitecaps on crests (many in the monsoon, streaked by the wind).
          float capN = oNoise(vOceanW.xz * vec2(0.35, 0.9) + uTime * 0.05);
          foam += smoothstep(0.16 + 0.12 * uRough, 0.42 + 0.25 * uRough, vCrest) * smoothstep(0.66 - 0.08 * uRough, 0.92, capN) * (0.35 + 0.25 * uRough) * (1.0 - smoothstep(80.0, 400.0 + 300.0 * uRough, vDist));
          // The big waves: whitewater on the breaking crest and churned at the wall after.
          float surgeFoam;
          oceanSurge(vOceanW.xz, uTime, surgeFoam);
          foam += clamp(surgeFoam, 0.0, 1.0) * smoothstep(0.3, 0.75, foamTex + 0.25);
          foam = clamp(foam, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFoamColor, foam);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
            // Two scrolling ripple octaves in world space; fade with distance to avoid sparkle aliasing.
            vec2 w1 = vOceanW.xz / 13.0 + vec2(uTime * 0.021, uTime * 0.013);
            vec2 w2 = vOceanW.xz / 4.1 + vec2(-uTime * 0.034, uTime * 0.027);
            vec3 n1 = texture2D(normalMap, w1).xyz * 2.0 - 1.0;
            vec3 n2 = texture2D(normalMap, w2).xyz * 2.0 - 1.0;
            vec3 nd = normalize(vec3((n1.xy * 0.7 + n2.xy * 0.45) * normalScale * (1.0 - smoothstep(60.0, 900.0, vDist) * 0.75), 1.0));
            // Tangent frame for a horizontal surface (normal close to view-space up).
            vec3 upV = normal;
            vec3 tV = normalize(cross(upV, (viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz));
            vec3 bV = cross(tV, upV);
            normal = normalize(tV * nd.x + bV * nd.y + upV * nd.z);
          }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.28, smoothstep(40.0, 1600.0, vDist));
          roughnessFactor = mix(roughnessFactor, 0.2, uRough * 0.6);
          roughnessFactor = mix(roughnessFactor, 0.85, foam);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += uFoamColor * foam * uNightGlow * 0.04;`,
        );
    });
    // The normal map is sampled manually; keep USE_NORMALMAP defined for the uniforms.
    this.mesh = new THREE.Mesh(polarGrid(14000, 170, 160, 3.0), this.material);
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.position.y = H.sea;
    this.mesh.renderOrder = -1;
  }

  update(time: number, camera: THREE.Camera, lamps: number, rough = 0, surges: Surge[] = []): void {
    const snap = 4;
    this.mesh.position.x = Math.round(camera.position.x / snap) * snap;
    this.mesh.position.z = Math.round(camera.position.z / snap) * snap;
    // The monsoon: a high tide, the swell up, the long Arabian Sea swell rolling in.
    const u = this.uniforms;
    u.uTide.value = MONSOON_TIDE * rough;
    u.uTime.value = time;
    u.uOrigin.value.copy(camera.position);
    u.uNightGlow.value = lamps;
    u.uRough.value = rough;
    u.uWaveA.value = this.baseAmp.map((a, i) => (i === 4 ? 0.62 * rough : a * (1 + (i < 2 ? 1.9 : 1.2) * rough)));
    for (let i = 0; i < 4; i++) {
      const s = surges[i];
      if (s) {
        u.uSurge.value[i].set(s.x, s.z, s.at, s.strength);
        u.uSurgeN.value[i].set(s.nx, s.nz);
      } else u.uSurge.value[i].w = 0;
    }
  }

  /** The sea level now (the monsoon's high tide). */
  level(rough: number): number {
    return H.sea + MONSOON_TIDE * rough;
  }
}
