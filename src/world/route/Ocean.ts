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

// Waves travel towards the Marine Drive shore (local +x ≈ east).
const WAVES = [
  { dir: [0.96, 0.18], len: 31, amp: 0.2, q: 0.45 },
  { dir: [0.82, -0.52], len: 17, amp: 0.11, q: 0.5 },
  { dir: [0.9, 0.42], len: 9.5, amp: 0.055, q: 0.55 },
  { dir: [0.72, -0.68], len: 5.5, amp: 0.028, q: 0.55 },
];

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
  };

  constructor(tf: TextureFactory, shore: ShoreField) {
    const normal = oceanNormals(tf);
    normal.repeat.set(1, 1);
    this.uniforms.uShore.value = shore.texture;
    this.uniforms.uShoreB.value.copy(shore.bounds);
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
          uniform vec2 uWaveDir[4];
          uniform float uWaveK[4];
          uniform float uWaveA[4];
          uniform float uWaveQ[4];
          uniform float uWaveW[4];
          varying vec3 vOceanW;
          varying float vCrest;
          varying float vDist;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 oceanP = (modelMatrix * vec4(position, 1.0)).xyz;
          float oceanD = length(oceanP.xz - uOrigin.xz);
          float oceanFade = 1.0 - smoothstep(120.0, 700.0, oceanD);
          vec3 oceanDisp = vec3(0.0);
          vec3 oceanN = vec3(0.0, 1.0, 0.0);
          float crest = 0.0;
          for (int i = 0; i < 4; i++) {
            // Short waves only shade (normals); long waves also displace.
            float kk = uWaveK[i];
            float ph = kk * dot(uWaveDir[i], oceanP.xz) - uWaveW[i] * uTime;
            float c = cos(ph);
            float s = sin(ph);
            float amp = uWaveA[i] * oceanFade;
            if (i < 2) {
              oceanDisp.xz += uWaveQ[i] * amp * uWaveDir[i] * c;
              oceanDisp.y += amp * s;
            }
            oceanN.xz -= uWaveDir[i] * kk * amp * c;
            oceanN.y -= uWaveQ[i] * kk * amp * s;
            crest += s * amp;
          }
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
          // Silty, greener water close to the shore.
          diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, (1.0 - smoothstep(4.0, 45.0, shoreD)) * 0.55);
          // Foam: churned water around the tetrapods, pulsing with the swell.
          float pulse = 0.5 + 0.5 * sin(uTime * 0.9 - shoreD * 0.35 + oNoise(vOceanW.xz * 0.05) * 6.0);
          float foamBand = 1.0 - smoothstep(0.0, 9.0 + 5.0 * pulse, shoreD);
          float foamTex = oNoise(vOceanW.xz * 0.9 + vec2(uTime * 0.25, uTime * 0.1)) * 0.6 + oNoise(vOceanW.xz * 3.1 - uTime * 0.3) * 0.4;
          float foam = smoothstep(0.45, 0.8, foamTex * (0.6 + 0.8 * foamBand)) * foamBand;
          // Sparse whitecaps on crests.
          foam += smoothstep(0.16, 0.3, vCrest) * smoothstep(0.62, 0.9, oNoise(vOceanW.xz * 0.35 + uTime * 0.05)) * 0.35 * (1.0 - smoothstep(80.0, 400.0, vDist));
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

  update(time: number, camera: THREE.Camera, lamps: number): void {
    const snap = 4;
    this.mesh.position.x = Math.round(camera.position.x / snap) * snap;
    this.mesh.position.z = Math.round(camera.position.z / snap) * snap;
    this.uniforms.uTime.value = time;
    this.uniforms.uOrigin.value.copy(camera.position);
    this.uniforms.uNightGlow.value = lamps;
  }
}
