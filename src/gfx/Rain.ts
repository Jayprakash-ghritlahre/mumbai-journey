import * as THREE from 'three';
import type { AmbientVolume } from './AmbientVolume';
import type { LightingState } from './TimeOfDay';
import { WEATHER, WX } from './Weather';

/**
 * The falling rain (MONSOON.md §2): a box of streaks wrapped round the camera, drawn as one instanced
 * draw, and two thin cylinders of rain sheets further out for the distance.
 *
 * - Each drop falls at its own speed, blown by the monsoon wind; the streak is drawn along its
 *   velocity relative to the camera (a shutter's worth of motion), so from a moving train or auto
 *   the rain slants past the window.
 * - Drops under a roof or canopy (the ambient volume's ceiling) and inside the dry boxes (the coach
 *   being ridden, the auto's cabin) are not drawn: you see the rain through the doors and windows.
 * - The streaks take the light of the air (the fog colour) and, near lamps, the lamps' (the ambient
 *   volume's lamp channel), so they shine under the street lights at night.
 * - Thin streaks are kept at least a pixel wide and faded instead, so the far ones do not shimmer.
 */
const dropVert = /* glsl */ `
attribute vec2 corner;
attribute vec4 aSeed;
uniform vec3 uCam;
uniform vec3 uCamVel;
uniform float uTime;
uniform float uIntensity;
uniform vec2 uWind;
uniform vec3 uBox;
uniform float uPixel;
uniform sampler2D uAVMap;
uniform vec4 uAVBounds;
uniform mat4 uDry[2];
uniform sampler2D uWetNoise;
varying float vAlpha;
varying float vLamp;
varying vec2 vC;

void main() {
  // Each drop its own: speed, size, how far the wind leans it, how bright it catches the light; a
  // few big heavy drops among them.
  float big = step(0.92, fract(aSeed.y * 17.3));
  float speed = 7.0 + aSeed.w * 3.0 + big * 1.5;
  float lean = 0.65 + 0.7 * aSeed.x;
  vec3 vel = vec3(uWind.x * 0.9 * lean, -speed, uWind.y * 0.9 * lean);
  vec3 origin = uCam - uBox * vec3(0.5, 0.6, 0.5);
  vec3 p = aSeed.xyz * uBox + vel * uTime;
  p = origin + mod(p - origin, uBox);
  // Curtains of heavier rain drift through on the wind.
  float curtain = texture2D(uWetNoise, (p.xz - uWind * uTime * 0.8) * 0.025).r;
  float density = uIntensity * (0.45 + 1.1 * curtain);
  float on = step(fract(aSeed.x * 7.31 + aSeed.z * 3.77 + aSeed.y * 1.93), density);
  vec2 uv = (p.xz - uAVBounds.xy) * uAVBounds.zw;
  float inb = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 s = texture2D(uAVMap, clamp(uv, 0.0, 1.0));
  float ceilH = s.b * 40.0;
  if (inb > 0.5 && ceilH > 0.5 && p.y < ceilH + 0.2 && s.r < 0.7) on = 0.0;
  for (int i = 0; i < 2; i++) {
    vec3 q = (uDry[i] * vec4(p, 1.0)).xyz;
    if (max(abs(q.x), max(abs(q.y), abs(q.z))) < 1.0) on = 0.0;
  }
  vec3 rel = vel - uCamVel;
  float rl = max(length(rel), 0.1);
  vec3 axis = rel / rl;
  float len = clamp(rl * 0.032, 0.16, 1.4) * (0.6 + 0.8 * fract(aSeed.w * 7.3)) * (1.0 + 0.4 * big);
  vec3 toCam = uCam - p;
  float d = max(length(toCam), 0.01);
  vec3 side = cross(axis, toCam / d);
  float sl = length(side);
  side = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = mix(0.0025, 0.0065, aSeed.y * aSeed.y) + big * 0.004;
  float wp = max(w, d * uPixel * 0.75);
  float thin = w / wp;
  vec3 pos = p + side * corner.x * wp - axis * corner.y * len;
  vAlpha = on * thin * (0.4 + 0.6 * fract(aSeed.z * 13.1)) * (1.0 + 0.5 * big) * smoothstep(0.25, 0.9, d) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, d));
  vLamp = s.g * inb;
  vC = corner;
  gl_Position = on > 0.5 ? projectionMatrix * viewMatrix * vec4(pos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const dropFrag = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uAVLamp;
uniform float uOpacity;
varying float vAlpha;
varying float vLamp;
varying vec2 vC;
void main() {
  float across = 1.0 - abs(vC.x);
  float along = smoothstep(0.0, 0.2, vC.y) * (1.0 - smoothstep(0.55, 1.0, vC.y));
  float a = vAlpha * across * along * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uLight + uAVLamp * vLamp * 1.6, a);
}`;

const sheetVert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const sheetFrag = /* glsl */ `
uniform vec3 uCam;
uniform float uTime;
uniform float uIntensity;
uniform vec2 uWind;
uniform vec3 uLight;
uniform float uScale;
uniform float uOpacity;
uniform sampler2D uAVMap;
uniform vec4 uAVBounds;
uniform sampler2D uWetNoise;
varying vec3 vW;
void main() {
  vec3 d = vW - uCam;
  float az = atan(d.x, d.z);
  // Streaks slanted by the wind across the line of sight: a column each, at random, a dash
  // falling down it at its own speed.
  vec2 wdir = normalize(vec2(d.x, d.z));
  float across = uWind.x * wdir.y - uWind.y * wdir.x;
  float u = az * uScale + vW.y * across * 0.012;
  float col = floor(u);
  float fu = fract(u);
  float h = fract(sin(col * 12.9898 + uScale) * 43758.5453);
  float on = step(fract(h * 91.7), 0.3 + 0.5 * uIntensity);
  float v = fract(vW.y * (0.12 + 0.1 * h) + uTime * (1.1 + 0.8 * h) + h * 13.0);
  float dash = smoothstep(0.0, 0.06, v) * (1.0 - smoothstep(0.18, 0.4, v));
  float line = 1.0 - smoothstep(0.0, 0.1, abs(fu - 0.5 - (h - 0.5) * 0.6));
  float streak = on * dash * line * (0.5 + 0.5 * fract(h * 7.3));
  float fadeY = smoothstep(-2.0, 1.0, d.y + 1.6) * (1.0 - smoothstep(6.0, 22.0, d.y));
  vec2 uv = (vW.xz - uAVBounds.xy) * uAVBounds.zw;
  float inb = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 s = texture2D(uAVMap, clamp(uv, 0.0, 1.0));
  float covered = inb * step(0.5, s.b * 40.0) * step(vW.y, s.b * 40.0) * step(s.r, 0.7);
  float a = streak * fadeY * uIntensity * uOpacity * (1.0 - covered);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uLight, a);
}`;

const QUALITY_DROPS = { low: 5000, medium: 11000, high: 16000 };

export class Rain {
  readonly group = new THREE.Group();
  private readonly drops: THREE.Mesh;
  private readonly sheets: THREE.Mesh[] = [];
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly u = {
    uCam: { value: new THREE.Vector3() },
    uCamVel: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uBox: { value: new THREE.Vector3(30, 22, 30) },
    uPixel: { value: 0.001 },
    uLight: { value: new THREE.Color() },
    uOpacity: { value: 0.5 },
  };
  private readonly lastCam = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private max: number;

  constructor(av: AmbientVolume, quality: 'low' | 'medium' | 'high') {
    this.group.name = 'rain';
    this.max = QUALITY_DROPS.high;
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, 1, 1, -1, 1], 2));
    // three needs a position attribute to draw; the shader places everything.
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(this.max * 4).map(() => Math.random());
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo.instanceCount = QUALITY_DROPS[quality];
    const avU = av.uniforms;
    const mat = new THREE.ShaderMaterial({
      vertexShader: dropVert,
      fragmentShader: dropFrag,
      uniforms: { ...this.u, uAVMap: avU.uAVMap, uAVBounds: avU.uAVBounds, uAVLamp: avU.uAVLamp, uDry: WX.uDry, uWetNoise: WX.uWetNoise },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.drops = new THREE.Mesh(this.geo, mat);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 5;
    this.group.add(this.drops);
    // Rain sheets at two distances (open cylinders round the camera).
    for (const [r, scale, op] of [
      [9, 160, 0.16],
      [24, 300, 0.13],
    ] as const) {
      const g = new THREE.CylinderGeometry(r, r, 34, 48, 1, true);
      const sm = new THREE.ShaderMaterial({
        vertexShader: sheetVert,
        fragmentShader: sheetFrag,
        uniforms: {
          uCam: this.u.uCam,
          uTime: this.u.uTime,
          uIntensity: this.u.uIntensity,
          uWind: this.u.uWind,
          uLight: this.u.uLight,
          uScale: { value: scale },
          uOpacity: { value: op },
          uAVMap: avU.uAVMap,
          uAVBounds: avU.uAVBounds,
          uWetNoise: WX.uWetNoise,
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.BackSide,
      });
      const m = new THREE.Mesh(g, sm);
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.sheets.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.geo.instanceCount = QUALITY_DROPS[q];
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, light: LightingState, viewportHeight: number): void {
    const W = WEATHER;
    const on = W.amount > 0.01 && W.rain > 0.01;
    this.group.visible = on;
    const cam = camera.position;
    // The camera's velocity (for the streaks' slant), ignoring cuts and teleports.
    if (dt > 0) {
      const v = cam.clone().sub(this.lastCam).divideScalar(dt);
      if (v.length() < 45) this.vel.lerp(v, 1 - Math.exp(-dt * 8));
      else this.vel.set(0, 0, 0);
    }
    this.lastCam.copy(cam);
    if (!on) return;
    const u = this.u;
    u.uCam.value.copy(cam);
    u.uCamVel.value.copy(this.vel);
    u.uTime.value = time % 1000;
    u.uIntensity.value = Math.min(1.1, 0.2 + 0.85 * W.rain + 0.15 * W.heavy);
    u.uWind.value.copy(W.wind);
    u.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, viewportHeight);
    // Rain is lit by the air around it: brighter than the fog against the dark, quieter by day.
    u.uLight.value.copy(light.fogColor).lerp(light.zenith, 0.3).multiplyScalar(2.1).add(new THREE.Color(0.03, 0.033, 0.036).multiplyScalar(1 + light.lamps));
    u.uOpacity.value = 0.45 + 0.35 * W.rain;
    for (const s of this.sheets) s.position.set(cam.x, cam.y + 6, cam.z);
  }
}
