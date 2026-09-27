import * as THREE from 'three';
import type { LightingState } from './TimeOfDay';

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const fragment = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHorizonAnti;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uSunIntensity;
uniform float uHazeGlow;
uniform float uCloudCover;
uniform float uTime;
uniform float uNight;
uniform float uEnvMode;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float mu = dot(d, uSunDir);
  float th = clamp(h, 0.0, 1.0);

  // Horizon colour swings from the sun-side glow to a dustier anti-sun tone.
  vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
  float side = 0.5 + 0.5 * dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), sunFlat);
  vec3 hor = mix(uHorizonAnti, uHorizon, smoothstep(0.0, 1.0, side * side));
  vec3 sky = mix(hor, uZenith, pow(th, 0.42));
  sky += hor * 0.2 * exp(-th * 16.0);

  float g1 = pow(max(mu, 0.0), 6.0);
  float g2 = pow(max(mu, 0.0), 90.0);
  float g3 = pow(max(mu, 0.0), 900.0);
  vec3 glow = uSunColor * (g1 * 0.2 + g2 * 0.55 + g3 * 1.6) * uHazeGlow * (0.3 + 0.7 * exp(-th * 2.5));
  sky += glow * (1.0 - uNight) * smoothstep(-0.12, 0.02, uSunDir.y);

  if (h < 0.0) sky = mix(hor * 0.85, uGround, smoothstep(0.0, 0.2, -h));

  if (h > 0.005) {
    vec2 uv = d.xz / (h + 0.05);
    uv = uv * 0.8 + vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(uv * 0.55);
    float cov = smoothstep(1.0 - uCloudCover - 0.02, 1.0 - uCloudCover + 0.32, n);
    cov *= smoothstep(0.015, 0.16, h);
    float thick = smoothstep(0.55, 1.05, n);
    vec3 cc = mix(uCloudLit, uCloudShade, thick * 0.7);
    cc += uSunColor * pow(max(mu, 0.0), 10.0) * 1.1 * (1.0 - thick) * (1.0 - uNight);
    cc = mix(cc, hor * 1.05, exp(-h * 9.0) * 0.55);
    sky = mix(sky, cc, cov * 0.88);
  }

  if (uEnvMode < 0.5) {
    float disk = smoothstep(0.99986, 0.99993, mu);
    sky += uSunColor * disk * 26.0 * uSunIntensity * smoothstep(-0.02, 0.01, h);
    // Faint stars through the city glow.
    if (uNight > 0.5 && h > 0.15) {
      vec2 sp = floor(d.xz / (h + 0.3) * 420.0);
      float st = step(0.9975, hash(sp));
      sky += vec3(0.6, 0.65, 0.8) * st * (uNight - 0.5) * 0.15 * smoothstep(0.15, 0.5, h);
    }
  }
  gl_FragColor = vec4(sky, 1.0);
}`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly envMaterial: THREE.ShaderMaterial;
  private readonly envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uHorizonAnti: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uCloudLit: { value: new THREE.Color() },
        uCloudShade: { value: new THREE.Color() },
        uSunIntensity: { value: 1 },
        uHazeGlow: { value: 1 },
        uCloudCover: { value: 0.3 },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uEnvMode: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(1000);

    this.envMaterial = this.material.clone();
    this.envMaterial.uniforms = THREE.UniformsUtils.clone(this.material.uniforms);
    this.envMaterial.uniforms.uEnvMode.value = 1;
    const envMesh = new THREE.Mesh(geo, this.envMaterial);
    envMesh.scale.setScalar(100);
    this.envScene.add(envMesh);
  }

  update(s: LightingState, time: number): void {
    for (const m of [this.material, this.envMaterial]) {
      const u = m.uniforms;
      u.uSunDir.value.copy(s.sunDir);
      u.uZenith.value.copy(s.zenith);
      u.uHorizon.value.copy(s.horizon);
      u.uHorizonAnti.value.copy(s.horizonAnti);
      u.uGround.value.copy(s.ground);
      u.uSunColor.value.copy(s.sunColor);
      u.uCloudLit.value.copy(s.cloudLit);
      u.uCloudShade.value.copy(s.cloudShade);
      u.uSunIntensity.value = s.sunIntensity;
      u.uHazeGlow.value = s.hazeGlow;
      u.uCloudCover.value = s.cloudCover;
      u.uNight.value = s.night;
      u.uTime.value = time;
    }
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  /** Re-generates the image based lighting from the current sky. */
  buildEnvironment(pmrem: THREE.PMREMGenerator): THREE.Texture {
    const next = pmrem.fromScene(this.envScene, 0.02, 0.1, 1000);
    this.envTarget?.dispose();
    this.envTarget = next;
    return next.texture;
  }
}
