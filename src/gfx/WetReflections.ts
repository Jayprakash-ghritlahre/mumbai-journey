import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * Screen-space reflections in puddles and on wet ground (MONSOON.md §3). The wet materials mark how
 * mirror-like they are in the frame's alpha (1 − mirror; Wet.ts), so only those pixels march: a ray
 * reflected about the up vector (the ground is flat; a little jitter from the rain rings), stepped
 * through the depth buffer, refined, and the colour it hits blended in by the Fresnel term. Streets
 * pick up the lamps, the headlights and the lit shop signs; on the wet film (not a puddle) the
 * reflection is smeared vertically, as on a real wet road. Runs before the fog, so the reflected
 * light is fogged with the ground it lies on. Off when it is dry, and on low quality.
 */
const frag = /* glsl */ `
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec3 uUpView;
uniform float uStrength;
uniform float uTime;

vec3 wrView(vec2 uv, float d) {
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
vec2 wrProject(vec3 p) {
  vec4 c = uProj * vec4(p, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}
float wrHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float mirror = clamp(1.0 - inputColor.a, 0.0, 1.0) * uStrength;
  outputColor = vec4(inputColor.rgb, 1.0);
  if (mirror < 0.02 || depth >= 0.99999) return;
  vec3 P = wrView(uv, depth);
  vec3 V = normalize(P);
  // A flat reflector, roughened by the rain on it (more on the film than on a puddle).
  float rough = 1.0 - smoothstep(0.35, 0.9, mirror);
  vec2 j = vec2(wrHash(uv * 731.0), wrHash(uv * 197.0)) - 0.5;
  vec3 N = normalize(uUpView + vec3(j.x, 0.0, j.y) * (0.004 + 0.018 * rough));
  vec3 R = reflect(V, N);
  float NdV = max(dot(-V, N), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  float dist = -P.z;
  // March with growing steps; the ray may come back towards the camera (R.z > 0) for near hits.
  float t = 0.05 + 0.02 * dist;
  float stepLen = 0.12 + 0.03 * dist;
  vec2 hit = vec2(-1.0);
  float prevT = 0.0;
  for (int i = 0; i < 26; i++) {
    vec3 Q = P + R * t;
    if (Q.z > -0.21) break;
    vec2 q = wrProject(Q);
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) break;
    float sd = readDepth(q);
    if (sd < 0.99999) {
      float sz = wrView(q, sd).z;
      float behind = sz - Q.z;
      if (behind > 0.0 && behind < 0.6 + t * 0.12) {
        // Refine between the last two samples.
        float a = prevT;
        float b = t;
        for (int k = 0; k < 4; k++) {
          float m = 0.5 * (a + b);
          vec3 M = P + R * m;
          vec2 mq = wrProject(M);
          float mz = wrView(mq, readDepth(mq)).z;
          if (mz > M.z) b = m; else a = m;
        }
        hit = wrProject(P + R * b);
        break;
      }
    }
    prevT = t;
    t += stepLen;
    stepLen *= 1.15;
  }
  if (hit.x < 0.0) return;
  // Fade at the screen's edges and with the length of the ray.
  vec2 e = smoothstep(vec2(0.0), vec2(0.08), hit) * (1.0 - smoothstep(vec2(0.92), vec2(1.0), hit));
  float fade = e.x * e.y * (1.0 - smoothstep(25.0, 70.0, t));
  // The wet film smears the reflection down the screen (streaks under lamps and headlights).
  vec3 refl = vec3(0.0);
  float sp = rough * 0.03;
  refl += texture2D(inputBuffer, hit).rgb * 0.36;
  refl += texture2D(inputBuffer, hit + vec2(0.0, sp)).rgb * 0.2;
  refl += texture2D(inputBuffer, hit - vec2(0.0, sp)).rgb * 0.2;
  refl += texture2D(inputBuffer, hit + vec2(0.0, sp * 2.2)).rgb * 0.12;
  refl += texture2D(inputBuffer, hit - vec2(0.0, sp * 2.2)).rgb * 0.12;
  float w = mirror * fade * mix(fres, 1.0, 0.25) * mix(0.9, 0.55, rough);
  outputColor = vec4(mix(inputColor.rgb, refl, clamp(w, 0.0, 0.95)), 1.0);
}`;

export class WetReflectionEffect extends Effect {
  constructor() {
    super('WetReflectionEffect', frag, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uUpView', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uStrength', new THREE.Uniform(1)],
        ['uTime', new THREE.Uniform(0)],
      ]),
    });
  }

  setCamera(camera: THREE.PerspectiveCamera, strength: number, time: number): void {
    (this.uniforms.get('uProj')!.value as THREE.Matrix4).copy(camera.projectionMatrix);
    (this.uniforms.get('uInvProj')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.uniforms.get('uUpView')!.value as THREE.Vector3).set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    this.uniforms.get('uStrength')!.value = strength;
    this.uniforms.get('uTime')!.value = time % 100;
  }
}
