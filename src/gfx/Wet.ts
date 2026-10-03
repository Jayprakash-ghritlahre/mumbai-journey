import type * as THREE from 'three';
import { WX } from './Weather';

/**
 * Rain on the world's surfaces (MONSOON.md §3), patched into every material the ambient volume
 * lights, so the streets, platforms, tracks, vehicles and walls of every place get it at once:
 *
 * - where the sky is open (the ambient volume's sky visibility; under a roof or canopy stays dry,
 *   and so does the inside of the coach being ridden and the auto's cabin: Weather's dry boxes),
 * - ground and other flat surfaces darken (porous ones most) and turn glossy; walls darken in streaks;
 * - puddles collect on the flat ground: dark, mirror-smooth water with rain rings spreading on it;
 * - near lamps the wet ground glints with their light, and the puddles and wet ground mark themselves
 *   in the frame's alpha for the screen-space reflections (WetReflections).
 *
 * Kinds: 'surface' (ground, platforms, walls: puddles), 'porous' (ballast, soil, grass, bark: dark,
 * no puddles), 'object' (vehicles, leaves, train roofs: glossier, a little darker), 'none'.
 */
export type WetKind = 'surface' | 'porous' | 'object' | 'none';

const NONE = new Set(['ocean', 'sea', 'creekWater', 'crowd', 'autoGlass', 'emuGlass', 'vehGlass', 'glassDark', 'npGlassDark', 'decals', 'miraShopGlow', 'heroCeiling', 'heroWall', 'heroSeat', 'heroFloor', 'heroSigns', 'heroSteel', 'heroPaint', 'emuInterior', 'autoLiner', 'autoSeat', 'autoMat', 'autoCards', 'autoPicture']);
const POROUS = new Set(['ballast', 'corrBallast', 'grass', 'ground', 'corrGround', 'treeBark', 'trunk', 'wood', 'corrShack', 'corrSleeper', 'corrBridgeSleeper', 'sleeper']);
const OBJECT = new Set(['vehPaint', 'vehMisc', 'autoPaint', 'autoMetal', 'autoRexine', 'autoMirror', 'emuBody', 'emuCab', 'emuRoof', 'emuDoors', 'emuMetal', 'emuMetalLite', 'emuSteel', 'emuCore', 'heroBody', 'heroRoof', 'heroDoors', 'heroMetal', 'heroBarsOut', 'prop_metal', 'prop_paint', 'leaves', 'treeLeaves', 'treeFlowers', 'treeFronds', 'treeAlmond', 'treeBanyan', 'prop_leaf', 'corrMangrove', 'corrTarp', 'railTop', 'rail', 'mdSeaWall', 'mdKerb']);

export function wetKind(name: string): WetKind {
  if (NONE.has(name)) return 'none';
  if (POROUS.has(name)) return 'porous';
  if (OBJECT.has(name)) return 'object';
  return 'surface';
}

const KIND_ID: Record<WetKind, number> = { none: 0, surface: 1, porous: 2, object: 3 };

/** The rain's uniforms, declared once whichever patches a material has (the auto's glass has two). */
export const RAIN_DECL = /* glsl */ `
#ifndef WX_RAIN_DECL
#define WX_RAIN_DECL
uniform float uRain;
uniform float uRainTime;
#endif
`;

const pars = /* glsl */ `
uniform float uWet;
${RAIN_DECL}
uniform mat4 uDry[2];
uniform sampler2D uWetNoise;
float wxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
/** Rain rings on standing water: two layers of cells, each with a drop landing now and then. */
vec2 wxRipples(vec2 p, float t, float density) {
  vec2 acc = vec2(0.0);
  for (int l = 0; l < 2; l++) {
    float sc = l == 0 ? 1.9 : 3.3;
    vec2 q = p * sc + float(l) * vec2(0.37, 0.71);
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float h = wxHash(cell + float(l) * 17.0);
    if (fract(h * 91.7) > density) continue;
    float rate = 0.6 + 0.7 * fract(h * 3.31);
    float ph = fract(t * rate + h * 7.0);
    vec2 c = 0.5 + (vec2(h, fract(h * 13.7)) - 0.5) * 0.36;
    vec2 d = f - c;
    float r = length(d);
    float k = r - ph * (0.22 + 0.2 * fract(h * 5.9));
    float ring = sin(k * 70.0) * (1.0 - smoothstep(0.0, 0.045, abs(k))) * (1.0 - ph) * (1.0 - ph) * (1.0 - ph);
    acc += d / max(r, 1e-3) * ring;
  }
  return acc;
}
`;

/** The wet chunk for one kind (WX_KIND: 0 none, 1 surface, 2 porous, 3 object). */
const main = /* glsl */ `
#if WX_KIND > 0
if (uWet > 0.001) {
  vec3 wxN = inverseTransformDirection(wxGeoN, viewMatrix);
  vec2 wxUV = (vAVPos.xz - uAVBounds.xy) * uAVBounds.zw;
  float wxIn = step(0.0, wxUV.x) * step(wxUV.x, 1.0) * step(0.0, wxUV.y) * step(wxUV.y, 1.0);
  vec4 wxS = texture2D(uAVMap, clamp(wxUV, 0.0, 1.0));
  float wxCeil = wxS.b * 40.0;
  float wxAbove = wxCeil > 0.5 ? smoothstep(wxCeil - 0.3, wxCeil + 0.4, vAVPos.y) : 1.0;
  float wxSky = mix(1.0, mix(wxS.r, 1.0, wxAbove), wxIn);
  float wxE = smoothstep(0.5, 0.85, wxSky);
  for (int i = 0; i < 2; i++) {
    vec3 q = (uDry[i] * vec4(vAVPos, 1.0)).xyz;
    if (max(abs(q.x), max(abs(q.y), abs(q.z))) < 1.0) wxE = 0.0;
  }
  float wxUp = wxN.y;
  wxH = smoothstep(0.6, 0.95, wxUp);
  float wxSide = (1.0 - wxH) * smoothstep(-0.3, 0.1, wxUp);
  float wxStreak = texture2D(uWetNoise, vec2((vAVPos.x + vAVPos.z) * 0.33, vAVPos.y * 0.05)).r;
  wxW = uWet * wxE * (wxH + wxSide * (0.3 + 0.55 * wxStreak));
  #if WX_KIND == 3
    diffuseColor.rgb *= mix(1.0, 0.82, wxW);
    roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.4, wxW);
  #else
    float wxPor = WX_KIND == 2 ? 1.0 : clamp((roughnessFactor - 0.3) * 1.5, 0.25, 1.0) * (1.0 - metalnessFactor * 0.8);
    diffuseColor.rgb *= mix(1.0, 0.52, wxW * wxPor);
    roughnessFactor = mix(roughnessFactor, WX_KIND == 2 ? 0.45 : mix(0.4, 0.17, wxH), wxW);
  #endif
  #if WX_KIND == 1
    if (wxH > 0.0) {
      float pn = texture2D(uWetNoise, vAVPos.xz * 0.041).r * 0.62 + texture2D(uWetNoise, vAVPos.zx * 0.163 + 0.31).r * 0.38;
      // Puddles in the low spots (a fifth of the open ground or so; a little more in a downpour).
      float lvl = 0.6 - 0.03 * uWet - 0.035 * uRain;
      wxP = smoothstep(lvl, lvl + 0.045, pn) * smoothstep(0.985, 0.997, wxUp) * wxE * uWet * step(vAVPos.y, 14.0);
      diffuseColor.rgb *= mix(1.0, 0.42, wxP);
      roughnessFactor = mix(roughnessFactor, 0.03, wxP);
      metalnessFactor = mix(metalnessFactor, 0.0, wxP);
    }
    float wxRk = uRain * (wxP * 0.75 + wxW * wxH * 0.05);
    if (wxRk > 0.01) {
      vec2 rs = wxRipples(vAVPos.xz, uRainTime, 0.3 + 0.65 * uRain);
      vec3 nW = normalize(vec3(-rs.x * wxRk, 1.0, -rs.y * wxRk));
      vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      normal = normalize(mix(normal, nV, max(wxP, wxRk)));
    }
  #endif
}
#endif
`;

/** The onBeforeCompile patch for one kind (registered with the ambient volume's patch). */
export function wetPatch(kind: WetKind): (shader: THREE.WebGLProgramParametersWithUniforms) => void {
  const id = KIND_ID[kind];
  return (shader) => {
    Object.assign(shader.uniforms, { uWet: WX.uWet, uRain: WX.uRain, uRainTime: WX.uRainTime, uDry: WX.uDry, uWetNoise: WX.uWetNoise });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#define WX_KIND ${id}\n${pars}`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nvec3 wxGeoN = normal;\nfloat wxW = 0.0;\nfloat wxP = 0.0;\nfloat wxH = 0.0;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${main}`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        #if defined(OPAQUE) && WX_KIND == 1
          gl_FragColor.a = 1.0 - clamp(wxP * 0.92 + wxW * wxH * 0.3, 0.0, 1.0);
        #endif`,
      );
  };
}
