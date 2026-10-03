import * as THREE from 'three';
import { wetKind, wetPatch } from './Wet';

/**
 * A top-down "light probe map" standing in for baked global illumination.
 *   R: sky visibility at ground level (1 = open sky, ~0.25 under the shed)
 *   G: artificial light coverage (lamps, tube lights, street lights)
 *   B: ceiling height / 40 (surfaces above it see the full sky)
 * Materials sample it in the fragment shader to scale indirect light.
 */
export class AmbientVolume {
  readonly res: number;
  readonly minX: number;
  readonly minZ: number;
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly sky: Float32Array;
  readonly lamp: Float32Array;
  readonly ceil: Float32Array;
  readonly texture: THREE.DataTexture;
  readonly uniforms = {
    uAVMap: { value: null as THREE.Texture | null },
    uAVBounds: { value: new THREE.Vector4() },
    uAVLamp: { value: new THREE.Color(0, 0, 0) },
    uAVSkyFloor: { value: 0.0 },
  };

  constructor(minX: number, minZ: number, maxX: number, maxZ: number, res = 512) {
    this.res = res;
    this.minX = minX;
    this.minZ = minZ;
    this.sizeX = maxX - minX;
    this.sizeZ = maxZ - minZ;
    this.sky = new Float32Array(res * res).fill(1);
    this.lamp = new Float32Array(res * res);
    this.ceil = new Float32Array(res * res).fill(0);
    const data = new Uint8Array(res * res * 4);
    this.texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.uniforms.uAVMap.value = this.texture;
    this.uniforms.uAVBounds.value.set(minX, minZ, 1 / this.sizeX, 1 / this.sizeZ);
  }

  private cell(x: number, z: number): [number, number] {
    return [Math.floor(((x - this.minX) / this.sizeX) * this.res), Math.floor(((z - this.minZ) / this.sizeZ) * this.res)];
  }

  /** Multiplies sky visibility inside a rectangle and records the ceiling height. */
  cover(minX: number, minZ: number, maxX: number, maxZ: number, skyVis: number, ceiling: number): void {
    const [x0, z0] = this.cell(minX, minZ);
    const [x1, z1] = this.cell(maxX, maxZ);
    for (let z = Math.max(0, z0); z <= Math.min(this.res - 1, z1); z++)
      for (let x = Math.max(0, x0); x <= Math.min(this.res - 1, x1); x++) {
        const i = z * this.res + x;
        this.sky[i] = Math.min(this.sky[i], skyVis);
        this.ceil[i] = Math.max(this.ceil[i], ceiling);
      }
  }

  /** Sets sky visibility / ceiling for every cell centre inside a rectangle via a callback. */
  paint(minX: number, minZ: number, maxX: number, maxZ: number, fn: (x: number, z: number, sky: number, ceil: number) => [number, number]): void {
    const [x0, z0] = this.cell(minX, minZ);
    const [x1, z1] = this.cell(maxX, maxZ);
    for (let z = Math.max(0, z0); z <= Math.min(this.res - 1, z1); z++)
      for (let x = Math.max(0, x0); x <= Math.min(this.res - 1, x1); x++) {
        const i = z * this.res + x;
        const wx = this.minX + ((x + 0.5) / this.res) * this.sizeX;
        const wz = this.minZ + ((z + 0.5) / this.res) * this.sizeZ;
        const [s, c] = fn(wx, wz, this.sky[i], this.ceil[i]);
        this.sky[i] = s;
        this.ceil[i] = c;
      }
  }

  /** Adds artificial light with a smooth radial falloff. */
  light(x: number, z: number, radius: number, amount: number): void {
    const [cx, cz] = this.cell(x, z);
    const rc = Math.ceil((radius / this.sizeX) * this.res);
    for (let dz = -rc; dz <= rc; dz++)
      for (let dx = -rc; dx <= rc; dx++) {
        const px = cx + dx;
        const pz = cz + dz;
        if (px < 0 || pz < 0 || px >= this.res || pz >= this.res) continue;
        const d = Math.hypot(dx, dz) / rc;
        if (d > 1) continue;
        const f = (1 - d * d) * (1 - d * d);
        this.lamp[pz * this.res + px] += amount * f;
      }
  }

  private blurChannel(a: Float32Array, radius: number): void {
    const r = this.res;
    const tmp = new Float32Array(a.length);
    const k = radius;
    for (let z = 0; z < r; z++)
      for (let x = 0; x < r; x++) {
        let s = 0;
        let n = 0;
        for (let i = -k; i <= k; i++) {
          const xx = Math.min(r - 1, Math.max(0, x + i));
          s += a[z * r + xx];
          n++;
        }
        tmp[z * r + x] = s / n;
      }
    for (let z = 0; z < r; z++)
      for (let x = 0; x < r; x++) {
        let s = 0;
        let n = 0;
        for (let i = -k; i <= k; i++) {
          const zz = Math.min(r - 1, Math.max(0, z + i));
          s += tmp[zz * r + x];
          n++;
        }
        a[z * r + x] = s / n;
      }
  }

  commit(skyBlur = 3, lampBlur = 2): void {
    this.blurChannel(this.sky, skyBlur);
    this.blurChannel(this.lamp, lampBlur);
    const d = this.texture.image.data as Uint8Array;
    for (let i = 0; i < this.sky.length; i++) {
      d[i * 4] = Math.round(Math.min(1, this.sky[i]) * 255);
      d[i * 4 + 1] = Math.round(Math.min(1, this.lamp[i]) * 255);
      d[i * 4 + 2] = Math.round(Math.min(1, this.ceil[i] / 40) * 255);
      d[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }

  /** Samples sky visibility on the CPU (used for exposure adaptation and audio). */
  sampleSky(x: number, z: number): number {
    const [cx, cz] = this.cell(x, z);
    if (cx < 0 || cz < 0 || cx >= this.res || cz >= this.res) return 1;
    return this.sky[cz * this.res + cx];
  }

  sampleCeil(x: number, z: number): number {
    const [cx, cz] = this.cell(x, z);
    if (cx < 0 || cz < 0 || cx >= this.res || cz >= this.res) return 0;
    return this.ceil[cz * this.res + cx];
  }

  /**
   * Points every material patched by this volume at another volume's map (Mira Road has its own,
   * 38 km away), or back at this one (null). The uniform objects are shared, so this is instant.
   */
  useSource(other: AmbientVolume | null): void {
    const src = other ?? this;
    this.uniforms.uAVMap.value = src.texture;
    this.uniforms.uAVBounds.value.set(src.minX, src.minZ, 1 / src.sizeX, 1 / src.sizeZ);
  }

  setLamps(color: THREE.Color, intensity: number): void {
    this.uniforms.uAVLamp.value.copy(color).multiplyScalar(intensity);
  }

  /**
   * Injects ambient-volume lighting into a built-in lit material.
   * `mode`: 'default' | 'roof' (front faces see sky, back faces are interior) | 'none-sky' (lamps only)
   */
  patch(material: THREE.Material, mode: 'default' | 'roof' = 'default'): void {
    addShaderPatch(material, 'av-' + mode, (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAVPos;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 avWP = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            avWP = batchingMatrix * avWP;
          #endif
          #ifdef USE_INSTANCING
            avWP = instanceMatrix * avWP;
          #endif
          vAVPos = (modelMatrix * avWP).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vAVPos;
          uniform sampler2D uAVMap;
          uniform vec4 uAVBounds;
          uniform vec3 uAVLamp;`,
        )
        .replace(
          '#include <aomap_fragment>',
          `{
            vec2 avUV = (vAVPos.xz - uAVBounds.xy) * uAVBounds.zw;
            float avIn = step(0.0, avUV.x) * step(avUV.x, 1.0) * step(0.0, avUV.y) * step(avUV.y, 1.0);
            vec4 avS = texture2D(uAVMap, clamp(avUV, 0.0, 1.0));
            float avCeil = avS.b * 40.0;
            float avAbove = avCeil > 0.5 ? smoothstep(avCeil + 0.2, avCeil + 1.2, vAVPos.y) : 1.0;
            float avSky = mix(1.0, mix(avS.r, 1.0, avAbove), avIn);
            ${mode === 'roof' ? 'avSky = gl_FrontFacing ? 1.0 : min(avSky, 0.22);' : ''}
            reflectedLight.indirectDiffuse *= avSky;
            reflectedLight.indirectSpecular *= mix(avSky, 1.0, 0.1);
            float avLamp = avS.g * avIn * (1.0 - avAbove * 0.8);
            ${mode === 'roof' ? 'avLamp *= gl_FrontFacing ? 0.0 : 0.6;' : ''}
            reflectedLight.indirectDiffuse += uAVLamp * avLamp * diffuseColor.rgb;
            // Wet ground and puddles glint with the lamps' light (Wet.ts).
            reflectedLight.indirectSpecular += uAVLamp * avLamp * (wxW * 0.03 + wxP * 0.06) * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0);
          }
          #include <aomap_fragment>`,
        );
    });
    // Rain on it (the monsoon): by what the material is (its name).
    const kind = wetKind(material.name);
    addShaderPatch(material, 'wet-' + kind, wetPatch(kind));
  }
}

type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

/** Composable onBeforeCompile patches with a stable program cache key. */
export function addShaderPatch(material: THREE.Material, key: string, patch: ShaderPatch): void {
  const m = material as THREE.Material & { __patches?: { key: string; fn: ShaderPatch }[] };
  if (!m.__patches) {
    m.__patches = [];
    material.onBeforeCompile = (shader, renderer) => {
      for (const p of m.__patches!) p.fn(shader, renderer);
    };
    material.customProgramCacheKey = () => m.__patches!.map((p) => p.key).join('|');
  }
  if (m.__patches.some((p) => p.key === key)) return;
  m.__patches.push({ key, fn: patch });
  material.needsUpdate = true;
}
