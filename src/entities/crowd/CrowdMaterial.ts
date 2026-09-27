import * as THREE from 'three';
import { addShaderPatch, type AmbientVolume } from '../../gfx/AmbientVolume';
import { JOINT } from './HumanGeometry';

/** Instance attributes (per person). */
export const CROWD_ATTRS: [string, number][] = [
  ['aAnim', 4], // phase, walk amplitude, pose, height scale
  ['aTop', 3],
  ['aBottom', 3],
  ['aAccent', 3],
  ['aSkinHair', 4], // skin rgb, hair lightness
  ['aFlags', 4], // backpack, bag, long sleeves, pattern
  ['aMisc', 4], // cap type, pack colour idx, bag colour idx, width scale
  ['aStyle', 4], // shoe colour idx, hair style (0 open, 1 ponytail), skirt (1) / jeans (0), sleeves (0 none, 1 short, 2 long)
];

const J = JOINT;

const vertexHead = /* glsl */ `
attribute float aTag;
attribute vec4 aAnim;
attribute vec4 aStyle;
attribute vec3 aTop;
attribute vec3 aBottom;
attribute vec3 aAccent;
attribute vec4 aSkinHair;
attribute vec4 aFlags;
attribute vec4 aMisc;
varying vec3 vCrowdColor;
varying vec3 vObjPos;
varying float vPattern;
varying float vRegion;
varying float vPart;
varying float vMoustache;

mat3 crowdRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 crowdRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }

float crowdPart() { return mod(floor(aTag + 0.5), 32.0); }
float crowdRegion() { return floor((floor(aTag + 0.5) + 0.5) / 32.0); }

void crowdAnimate(inout vec3 p, inout vec3 n) {
  float part = crowdPart();
  float region = crowdRegion();
  float ph = aAnim.x;
  float amp = aAnim.y;
  float pose = floor(aAnim.z + 0.5);
  float legL = sin(ph) * 0.48 * amp;
  float legR = -legL;
  float kneeL = (0.08 + 0.85 * max(0.0, sin(ph - 1.25))) * amp;
  float kneeR = (0.08 + 0.85 * max(0.0, sin(ph + 3.14159 - 1.25))) * amp;
  float armL = -sin(ph) * 0.36 * amp;
  float armR = -armL;
  float elbowL = 0.2 + 0.2 * amp;
  float elbowR = elbowL;
  float drop = 0.0;
  float lean = 0.06 * amp;
  float twist = sin(ph) * 0.06 * amp;
  if (pose == 1.0) { // seated
    legL = legR = 1.5; kneeL = kneeR = 1.5; armL = armR = 0.3; elbowL = elbowR = 1.0; drop = ${(J.hipY - 0.49).toFixed(3)}; lean = -0.04; twist = 0.0;
  } else if (pose == 2.0) { // phone in the right hand
    armR = 0.35; elbowR = 1.75;
  } else if (pose == 3.0) { // holding an overhead grab / door pole
    armR = 2.7; elbowR = 0.3;
  }
  vec3 hipL = vec3(-${J.hipX}, ${J.hipY}, 0.0);
  vec3 hipR = vec3(${J.hipX}, ${J.hipY}, 0.0);
  vec3 kneeLp = vec3(-${J.hipX}, ${J.kneeY}, 0.0);
  vec3 kneeRp = vec3(${J.hipX}, ${J.kneeY}, 0.0);
  vec3 shL = vec3(-${J.shoulderX}, ${J.shoulderY}, 0.0);
  vec3 shR = vec3(${J.shoulderX}, ${J.shoulderY}, 0.0);
  vec3 elL = vec3(-${J.shoulderX}, ${J.elbowY}, 0.0);
  vec3 elR = vec3(${J.shoulderX}, ${J.elbowY}, 0.0);
  mat3 R;
  if (part == 3.0) { R = crowdRotX(kneeL); p = kneeLp + R * (p - kneeLp); n = R * n; }
  if (part == 5.0) { R = crowdRotX(kneeR); p = kneeRp + R * (p - kneeRp); n = R * n; }
  if (part == 2.0 || part == 3.0) { R = crowdRotX(-legL); p = hipL + R * (p - hipL); n = R * n; }
  if (part == 4.0 || part == 5.0) { R = crowdRotX(-legR); p = hipR + R * (p - hipR); n = R * n; }
  if (part == 7.0) { R = crowdRotX(-elbowL); p = elL + R * (p - elL); n = R * n; }
  if (part == 9.0) { R = crowdRotX(-elbowR); p = elR + R * (p - elR); n = R * n; }
  if (part == 6.0 || part == 7.0) { R = crowdRotX(-armL); p = shL + R * (p - shL); n = R * n; }
  if (part == 8.0 || part == 9.0) { R = crowdRotX(-armR); p = shR + R * (p - shR); n = R * n; }
  if (part == 10.0) { // skirt / kurta hem sways gently
    float sw = (legL - legR) * 0.12;
    R = crowdRotX(-sw * 0.5); p = vec3(0.0, ${J.hipY}, 0.0) + R * (p - vec3(0.0, ${J.hipY}, 0.0)); n = R * n;
    if (pose == 1.0) { p.z += max(0.0, ${J.hipY} - p.y) * 0.9; p.y = max(p.y, ${J.hipY} - 0.12); }
  }
  // Upper body: forward lean and counter-twist of the torso.
  bool upper = part == 0.0 || part == 1.0 || part >= 6.0 && part <= 9.0 || part == 11.0 || part == 12.0;
  if (upper) {
    R = crowdRotY(twist) * crowdRotX(lean);
    p = vec3(0.0, ${J.hipY}, 0.0) + R * (p - vec3(0.0, ${J.hipY}, 0.0)); n = R * n;
  }
  // Hidden accessories collapse to a point.
  if ((part == 11.0 && aFlags.x < 0.5) || (part == 12.0 && aFlags.y < 0.5) || (region == 9.0 && aMisc.x < 0.5)) p = vec3(0.0, 1.2, 0.0);
  // Open hair or a ponytail; a skirt only over bare legs.
  if ((region == 10.0 && aStyle.y > 0.5) || (region == 11.0 && aStyle.y < 0.5) || (region == 13.0 && aStyle.z < 0.5)) p = vec3(0.0, 1.2, 0.0);
  // Walking bob.
  p.y += (1.0 - cos(2.0 * ph)) * 0.014 * amp - drop;
  // Body proportions.
  float wScale = abs(aMisc.w);
  p.xz *= vec2(wScale, mix(1.0, wScale, 0.6));
  p *= aAnim.w;
}

vec3 crowdColour() {
  float r = crowdRegion();
  vec3 c = aTop;
  // Hair: black greying with age (w > 0) or dark brown (w < 0).
  vec3 hair = aSkinHair.w >= 0.0 ? mix(vec3(0.012, 0.01, 0.009), vec3(0.55, 0.55, 0.52), aSkinHair.w) : mix(vec3(0.012, 0.01, 0.009), vec3(0.2, 0.1, 0.045), -aSkinHair.w);
  if (r == 0.0) c = aSkinHair.rgb;
  else if (r == 2.0 || r == 13.0) c = aBottom;
  else if (r == 3.0) c = aStyle.x < 0.5 ? vec3(0.035, 0.03, 0.028) : aStyle.x < 1.5 ? vec3(0.82, 0.82, 0.8) : aStyle.x < 2.5 ? vec3(0.13, 0.065, 0.03) : vec3(0.38, 0.24, 0.13);
  else if (r == 4.0 || r == 10.0 || r == 11.0) c = hair;
  else if (r == 12.0) c = aStyle.z > 0.5 ? aSkinHair.rgb : aBottom;
  else if (r == 14.0) c = aStyle.w > 0.5 ? aTop : aSkinHair.rgb;
  else if (r == 15.0) c = aStyle.w > 1.5 ? aTop : aSkinHair.rgb;
  else if (r == 5.0) c = aAccent;
  else if (r == 6.0) c = aFlags.z > 0.5 ? aTop : aSkinHair.rgb;
  else if (r == 7.0) c = aMisc.y < 0.5 ? vec3(0.02) : aMisc.y < 1.5 ? vec3(0.02, 0.03, 0.08) : aMisc.y < 2.5 ? vec3(0.07, 0.015, 0.02) : vec3(0.08, 0.08, 0.08);
  else if (r == 8.0) c = aMisc.z < 0.5 ? vec3(0.12, 0.06, 0.025) : aMisc.z < 1.5 ? vec3(0.02) : vec3(0.3, 0.05, 0.08);
  else if (r == 9.0) c = aMisc.x < 1.5 ? vec3(0.85, 0.85, 0.82) : vec3(0.03, 0.04, 0.09);
  return c;
}
`;

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms, withColour: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + vertexHead)
    .replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      vec3 crowdPos = position;
      vec3 crowdNor = objectNormal;
      crowdAnimate(crowdPos, crowdNor);
      objectNormal = crowdNor;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed = crowdPos;
      ${withColour ? 'vCrowdColor = crowdColour(); vObjPos = position; vPattern = aFlags.w; vRegion = crowdRegion(); vPart = crowdPart(); vMoustache = step(aMisc.w, 0.0);' : ''}`,
    );
}

export function createCrowdMaterial(av: AmbientVolume): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 });
  mat.name = 'crowd';
  addShaderPatch(mat, 'crowd', (shader) => {
    patchVertex(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCrowdColor;
        varying vec3 vObjPos;
        varying float vPattern;
        varying float vRegion;
        varying float vPart;
        varying float vMoustache;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 cc = vCrowdColor;
          float reg = floor(vRegion + 0.5);
          if (reg == 1.0) {
            float pat = floor(vPattern + 0.5);
            if (pat == 1.0) cc *= mix(1.0, 0.62, step(0.55, fract(vObjPos.x * 22.0 + vObjPos.z * 22.0)));
            else if (pat == 2.0) {
              float a = step(0.5, fract(vObjPos.x * 11.0 + vObjPos.z * 11.0));
              float b = step(0.5, fract(vObjPos.y * 11.0));
              cc *= 0.62 + 0.38 * abs(a - b) + 0.12 * a * b;
            } else if (pat == 3.0) {
              // Saree / kurta border and print.
              float border = step(vObjPos.y, 0.14) * step(0.05, vObjPos.y);
              cc = mix(cc, vec3(0.62, 0.42, 0.08), border);
              cc *= 0.85 + 0.15 * step(0.7, fract(vObjPos.y * 30.0 + sin(vObjPos.x * 60.0)));
            }
          }
          // Simple face: eyes, brows and (for many men) a moustache.
          if (floor(vPart + 0.5) == 1.0 && reg == 0.0 && vObjPos.z > 0.05) {
            vec2 e = vec2(abs(vObjPos.x) - 0.034, vObjPos.y - 1.598);
            float eye = 1.0 - smoothstep(0.009, 0.013, length(e * vec2(1.0, 1.6)));
            float brow = (1.0 - smoothstep(0.004, 0.007, abs(vObjPos.y - 1.618))) * step(abs(abs(vObjPos.x) - 0.034), 0.02);
            float mouth = (1.0 - smoothstep(0.002, 0.005, abs(vObjPos.y - 1.527))) * step(abs(vObjPos.x), 0.022);
            float stache = vMoustache * (1.0 - smoothstep(0.006, 0.01, abs(vObjPos.y - 1.543))) * step(abs(vObjPos.x), 0.03);
            cc = mix(cc, vec3(0.02, 0.015, 0.012), max(max(eye, brow * 0.8), max(stache, mouth * 0.35)));
          }
          diffuseColor.rgb *= cc;
        }`,
      );
  });
  av.patch(mat);
  return mat;
}

/** Depth material for shadows that runs the same skinning. */
export function createCrowdDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + vertexHead);
    // MeshDepthMaterial has no normal chunks; animate position only.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      { vec3 nn = vec3(0.0, 1.0, 0.0); vec3 pp = position; crowdAnimate(pp, nn); transformed = pp; }`,
    );
  };
  mat.customProgramCacheKey = () => 'crowd-depth';
  return mat;
}
