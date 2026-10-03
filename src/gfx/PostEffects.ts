import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * Analytic exponential height fog with directional in-scattering towards the sun.
 * Works in linear HDR before tone mapping, so it tints lamps and sky consistently.
 */
const fogFrag = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uFogColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uDensity;
uniform float uFalloff;
uniform float uBaseHeight;
uniform float uSunScatter;
uniform float uLocalHaze;
uniform vec3 uLocalHazeColor;
uniform float uExposure;
uniform sampler2D uVolTex;
uniform vec2 uVolTexel;
uniform float uVolStrength;
uniform float uSunDirect;
uniform float uVolG;
uniform float uVolIso;
uniform float uFarHaze;

float hgPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc;
  vp.xyz /= vp.w;
  bool sky = depth >= 0.999999;
  vec3 viewDir = normalize(vp.xyz);
  float L = sky ? 2500.0 : length(vp.xyz);
  vec3 dir = normalize(mat3(uCamWorld) * viewDir);
  vec3 camPos = uCamWorld[3].xyz;

  float k = uFalloff;
  float dy = dir.y * L * k;
  float base = uDensity * exp(-(camPos.y - uBaseHeight) * k);
  float integral = abs(dy) > 1e-4 ? (1.0 - exp(-dy)) / dy : 1.0;
  float amount = base * L * integral;
  // A thin local haze (dust in the station air, humidity) that saturates quickly.
  amount += uLocalHaze * (1.0 - exp(-L / 60.0));
  float T = exp(-amount);
  if (sky) T = mix(1.0, T, 0.55);

  float muS = dot(dir, uSunDir);
  float mu = max(muS, 0.0);
  vec3 scatter = uFogColor + uSunColor * (pow(mu, 6.0) * 0.32 + pow(mu, 40.0) * 0.55) * uSunScatter;
  vec3 hazeCol = mix(scatter, uLocalHazeColor, clamp(uLocalHaze * 6.0, 0.0, 1.0) * (1.0 - exp(-L / 60.0)) * 0.5);
  vec3 farCol = inputColor.rgb;
  if (uFarHaze > 0.0 && !sky) {
    // Rain haze: beyond the near streets the city greys and pales with distance; lit windows and
    // lamps (bright in HDR) still show through it.
    float lum = dot(farCol, vec3(0.2126, 0.7152, 0.0722));
    float farK = smoothstep(60.0, 900.0, L) * uFarHaze * (1.0 - smoothstep(1.5, 5.0, lum * uExposure));
    farCol = mix(farCol, mix(vec3(lum), uFogColor, 0.45), farK * 0.75);
  }
  vec3 col = farCol * T + hazeCol * (1.0 - T);
  if (uVolStrength > 0.0) {
    // Shadowed sunlight scattered by the humid air (light shafts), lightly blurred.
    float v = texture2D(uVolTex, uv).r * 0.4;
    v += texture2D(uVolTex, uv + vec2(uVolTexel.x, 0.0)).r * 0.15;
    v += texture2D(uVolTex, uv - vec2(uVolTexel.x, 0.0)).r * 0.15;
    v += texture2D(uVolTex, uv + vec2(0.0, uVolTexel.y)).r * 0.15;
    v += texture2D(uVolTex, uv - vec2(0.0, uVolTexel.y)).r * 0.15;
    float phase = mix(hgPhase(muS, uVolG), 1.0 / (4.0 * PI), uVolIso) * 4.0 * PI;
    col += uSunColor * uSunDirect * v * uVolStrength * phase;
  }
  outputColor = vec4(col * uExposure, inputColor.a);

}`;

export class FogEffect extends Effect {
  constructor() {
    super('FogEffect', fogFrag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uFogColor', new THREE.Uniform(new THREE.Color(0.7, 0.7, 0.7))],
        ['uSunColor', new THREE.Uniform(new THREE.Color(1, 0.8, 0.6))],
        ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uDensity', new THREE.Uniform(0.0015)],
        ['uFalloff', new THREE.Uniform(0.012)],
        ['uBaseHeight', new THREE.Uniform(0)],
        ['uSunScatter', new THREE.Uniform(1)],
        ['uLocalHaze', new THREE.Uniform(0)],
        ['uLocalHazeColor', new THREE.Uniform(new THREE.Color(0.5, 0.45, 0.4))],
        ['uExposure', new THREE.Uniform(1)],
        ['uVolTex', new THREE.Uniform(null)],
        ['uVolTexel', new THREE.Uniform(new THREE.Vector2(1, 1))],
        ['uVolStrength', new THREE.Uniform(0)],
        ['uSunDirect', new THREE.Uniform(1)],
        ['uVolG', new THREE.Uniform(0.6)],
        ['uVolIso', new THREE.Uniform(0.2)],
        ['uFarHaze', new THREE.Uniform(0)],
      ]),
    });
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    (this.uniforms.get('uInvProj')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.uniforms.get('uCamWorld')!.value as THREE.Matrix4).copy(camera.matrixWorld);
  }

  u<T>(name: string): { value: T } {
    return this.uniforms.get(name) as unknown as { value: T };
  }
}

/** Display-referred grade: lift/gain, contrast, saturation, vignette and film grain. */
const gradeFrag = /* glsl */ `
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;

float grainHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  c = c * uGain + uLift * (1.0 - c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  vec2 q = uv - 0.5;
  q.x *= resolution.x / resolution.y * 0.72;
  float v = smoothstep(0.95, 0.25, length(q));
  c *= mix(1.0, v, uVignette);
  float g = grainHash(uv * resolution + fract(time * 13.37) * 1000.0) - 0.5;
  c += g * uGrain * (0.35 + 0.65 * (1.0 - l));
  c *= uFade;
  outputColor = vec4(max(c, 0.0), inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uLift', new THREE.Uniform(new THREE.Color(0, 0, 0))],
        ['uGain', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['uSaturation', new THREE.Uniform(1)],
        ['uContrast', new THREE.Uniform(1)],
        ['uVignette', new THREE.Uniform(0.35)],
        ['uGrain', new THREE.Uniform(0.018)],
        ['uFade', new THREE.Uniform(1)],
      ]),
    });
  }

  u<T>(name: string): { value: T } {
    return this.uniforms.get(name) as unknown as { value: T };
  }
}
