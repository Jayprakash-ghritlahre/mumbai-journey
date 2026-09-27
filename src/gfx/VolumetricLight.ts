import * as THREE from 'three';
import { Pass } from 'postprocessing';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

/**
 * Raymarches the sun's shadow map through the haze at half resolution.
 * Output R = shadowed in-scattering integral (metres of lit, density-weighted air).
 * Where a sample lies outside the shadow frustum the ambient-volume sky visibility is used.
 */
const frag = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
uniform sampler2D tDepth;
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform float uMaxDist;
uniform float uFalloff;
uniform sampler2D uAVMap;
uniform vec4 uAVBounds;
uniform float uEnabled;
varying vec2 vUv;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  if (uEnabled < 0.5) { gl_FragColor = vec4(0.0); return; }
  float d = texture2D(tDepth, vUv).r;
  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc;
  vp.xyz /= vp.w;
  float L = d >= 0.999999 ? uMaxDist : min(length(vp.xyz), uMaxDist);
  vec3 dir = normalize(mat3(uCamWorld) * normalize(vp.xyz));
  vec3 origin = uCamWorld[3].xyz;
  const int N = 22;
  float stepLen = L / float(N);
  float j = ign(gl_FragCoord.xy);
  float acc = 0.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + j) * stepLen;
    vec3 p = origin + dir * t;
    vec4 sc = uShadowMatrix * vec4(p, 1.0);
    sc.xyz /= sc.w;
    float lit;
    if (sc.x > 0.002 && sc.x < 0.998 && sc.y > 0.002 && sc.y < 0.998 && sc.z < 1.0) {
      lit = texture(uShadowMap, vec3(sc.xy, sc.z - 0.0008));
    } else {
      vec2 av = (p.xz - uAVBounds.xy) * uAVBounds.zw;
      vec4 s = texture2D(uAVMap, clamp(av, 0.0, 1.0));
      float ceilH = s.b * 40.0;
      lit = (ceilH > 0.5 && p.y < ceilH) ? s.r * 0.5 : 1.0;
    }
    acc += lit * exp(-max(p.y, 0.0) * uFalloff);
  }
  gl_FragColor = vec4(acc * stepLen, L, 0.0, 1.0);
}`;

/** Half-resolution volumetric sunlight pass; composited by the fog effect. */
export class VolumetricPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly mat: THREE.ShaderMaterial;
  scale = 0.5;

  constructor() {
    super('VolumetricPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tDepth: { value: null },
        uShadowMap: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uMaxDist: { value: 90 },
        uFalloff: { value: 0.02 },
        uAVMap: { value: null },
        uAVBounds: { value: new THREE.Vector4() },
        uEnabled: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.mat;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.mat.uniforms.tDepth.value = depthTexture;
  }

  /** Per-frame inputs. */
  setInputs(camera: THREE.PerspectiveCamera, sun: THREE.DirectionalLight, av: { map: THREE.Texture | null; bounds: THREE.Vector4 } | null, enabled: boolean): void {
    const u = this.mat.uniforms;
    const map = sun.shadow.map as (THREE.WebGLRenderTarget & { depthTexture: THREE.DepthTexture | null }) | null;
    const ok = enabled && !!map?.depthTexture && sun.castShadow;
    u.uEnabled.value = ok ? 1 : 0;
    if (!ok) return;
    u.uShadowMap.value = map!.depthTexture;
    u.uShadowMatrix.value.copy(sun.shadow.matrix);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    if (av) {
      u.uAVMap.value = av.map;
      u.uAVBounds.value.copy(av.bounds);
    }
  }

  override render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(this.target);
    if (this.mat.uniforms.uEnabled.value < 0.5) {
      // No shadow map yet (or sun below the horizon): leave the target black, don't sample.
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      return;
    }
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  override dispose(): void {
    this.target.dispose();
    this.mat.dispose();
    super.dispose();
  }
}
