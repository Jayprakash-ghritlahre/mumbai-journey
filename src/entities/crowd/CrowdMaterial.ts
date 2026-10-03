import * as THREE from 'three';
import { addShaderPatch, type AmbientVolume } from '../../gfx/AmbientVolume';
import { WX } from '../../gfx/Weather';
import { JOINT } from './HumanGeometry';
import type { Look } from './Looks';

/**
 * Instance attributes (per person). Colours are sRGB hex packed into one float each (24 bits fit
 * a float exactly), which leaves room within WebGL's 16 vertex attributes for body shape and wear.
 */
export const CROWD_ATTRS: [string, number][] = [
  ['aAnim', 4], // phase, walk amplitude, pose code (see POSE), height scale
  ['aCol0', 4], // top, bottom, accent, skin
  ['aCol1', 4], // hair, layer (jacket / overshirt / dupatta), shoes, bag
  ['aFlags', 4], // backpack, bag type (0 none, 1 shoulder bag, 2 sling, 3 tote), long sleeves (men), top pattern
  ['aMisc', 4], // cap (1 white, 2 dark, 3 accent colour), pack colour idx, bottom pattern, width scale (negative: moustache)
  ['aStyle', 4], // shoe type (0 flats, 1 sneakers, 2 sandals), hair style (0 open, 1 ponytail, 2 bun, 3 braid), bottom (Looks.BOTTOM), sleeves (0 none, 1 short, 2 long)
  ['aShape', 4], // chest, hips, belly, face code (width × 100 + length × 10 + jaw, each 0–8)
  ['aWear', 4], // hair length, skirt length, layer (1 open jacket / overshirt, 2 dupatta), extras (bits, see EXTRA)
];

/** Extras bits (aWear.w). */
export const EXTRA = { earrings: 1, bindi: 2, glasses: 4, sunglasses: 8, crop: 16, lipstick: 32, child: 64, collar: 128 } as const;

/**
 * Pose code: base + 8 × side + 32 × act (+ 128 inside a train; a fraction folds the umbrella). base: 0 stand / walk, 1 seated, 2 phone, 3 holding a
 * pole, 4 taking a photo, 5 riding (seated, hands forward on a handlebar; the phase slot turns the
 * head, radians). side: where the partner is (1 on +x, 2 on −x). act: 1 leaning on the partner
 * (head on the shoulder), 2 holding hands, 3 talking.
 */
export const POSE = { stand: 0, sit: 1, phone: 2, grab: 3, photo: 4, drive: 5, partnerPlusX: 8, partnerMinusX: 16, lean: 32, hands: 64, talk: 96, inside: 128 } as const;

/**
 * A pose code for someone stepping aboard: `closing` (0 … 1) folds their umbrella as they reach the
 * door. Add POSE.inside for anyone in a train (umbrellas folded and put away).
 */
export function closingPose(pose: number, closing: number): number {
  return pose + Math.min(1, Math.max(0, closing)) * 0.98;
}

const J = JOINT;

const vertexHead = /* glsl */ `
attribute float aTag;
attribute vec4 aAnim;
attribute vec4 aCol0;
attribute vec4 aCol1;
attribute vec4 aFlags;
attribute vec4 aMisc;
attribute vec4 aStyle;
attribute vec4 aShape;
attribute vec4 aWear;
varying vec3 vCrowdColor;
varying vec3 vCrowdAccent;
varying vec3 vObjPos;
varying float vPattern;
varying float vRegion;
varying float vPart;
varying float vMoustache;
varying float vExtras;
varying float vCrowdWet;
// The monsoon (MONSOON.md §4): x monsoon, y umbrellas open, z heavy rain; indoors (the coach, the
// auto): umbrellas folded; the light map tells who is out under the open sky.
uniform vec4 uCrowdRain;
uniform float uCrowdIndoor;
uniform sampler2D uAVMap;
uniform vec4 uAVBounds;
/** This person's rain gear: 0 none, 1 an umbrella, 2 a raincoat (fixed for each person). */
float crowdGear = 0.0;
/** Out under the open sky (0 … 1), smoothed over a few metres so a short gap does not flick it. */
float crowdOut = 0.0;
/** How far the umbrella is up (0 folded and carried at the side … 1 open over the head). */
float crowdOpen = 0.0;
float crowdPose = 0.0;

mat3 crowdRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 crowdRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 crowdRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
/** Rotation by a about the unit axis k. */
mat3 crowdRotAxis(vec3 k, float a) {
  float c = cos(a), s = sin(a), t = 1.0 - c;
  return mat3(t * k.x * k.x + c, t * k.x * k.y + s * k.z, t * k.x * k.z - s * k.y,
              t * k.x * k.y - s * k.z, t * k.y * k.y + c, t * k.y * k.z + s * k.x,
              t * k.x * k.z + s * k.y, t * k.y * k.z - s * k.x, t * k.z * k.z + c);
}

float crowdPart() { return mod(floor(aTag + 0.5), 32.0); }
float crowdRegion() { return floor((floor(aTag + 0.5) + 0.5) / 32.0); }
bool crowdBit(float v, float b) { return mod(floor((v + 0.5) / b), 2.0) > 0.5; }

/** A number fixed for each person (from their colours). */
float crowdHash(float k) { return fract(sin(aCol0.x * 0.000123 + aCol1.x * 0.0000917 + aCol0.w * 0.0000371 + aCol0.y * 0.0000213 + k) * 43758.5453); }

/** Sky visibility at a point (1 open sky; under a roof or canopy less), from the light map. */
float crowdSkyAt(vec3 wp) {
  vec2 uv = (wp.xz - uAVBounds.xy) * uAVBounds.zw;
  float inb = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 s = texture2D(uAVMap, clamp(uv, 0.0, 1.0));
  float ceilH = s.b * 40.0;
  float above = ceilH > 0.5 ? step(ceilH, wp.y) : 1.0;
  return mix(1.0, mix(s.r, 1.0, above), inb);
}

/** Out in the rain: the open sky here and a few metres round (people do not open up for a short gap). */
float crowdExposed(bool inside) {
  if (uCrowdIndoor > 0.5 || inside) return 0.0;
  vec3 wp = (modelMatrix * instanceMatrix * vec4(0.0, 1.7, 0.0, 1.0)).xyz;
  float s = crowdSkyAt(wp) * 0.4;
  s += 0.15 * (crowdSkyAt(wp + vec3(2.5, 0.0, 0.0)) + crowdSkyAt(wp - vec3(2.5, 0.0, 0.0)) + crowdSkyAt(wp + vec3(0.0, 0.0, 2.5)) + crowdSkyAt(wp - vec3(0.0, 0.0, 2.5)));
  return smoothstep(0.55, 0.85, s);
}

/**
 * Who has what in the rain (fixed for each person, wherever they are): riders on two-wheelers mostly
 * in raincoats, schoolchildren too, some grown-ups; most of the rest carry an umbrella.
 */
float crowdRainGear(float pose) {
  if (uCrowdRain.x < 0.01) return 0.0;
  float h = crowdHash(1.7);
  bool child = crowdBit(aWear.w, 64.0);
  float pCoat = (pose == 5.0 ? 0.72 : child ? 0.55 : 0.15) * uCrowdRain.x;
  if (h < pCoat) return 2.0;
  if (pose == 5.0 || pose == 4.0) return 0.0;
  return h < pCoat + 0.62 * uCrowdRain.x ? 1.0 : 0.0;
}

/** sRGB hex packed in a float → linear colour. */
vec3 crowdUnpack(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  vec3 c = clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

/** Per-person build, face, hair and hem length, in the rest pose. */
void crowdShape(inout vec3 p, float part, float region) {
  float chest = aShape.x;
  float hips = aShape.y;
  float belly = aShape.z;
  if (part == 0.0 || part == 10.0 || part == 11.0 || part == 12.0) {
    float y = p.y;
    float wc = smoothstep(1.1, 1.22, y) * (1.0 - smoothstep(1.34, 1.45, y));
    float wb = smoothstep(0.88, 0.98, y) * (1.0 - smoothstep(1.1, 1.2, y));
    // Hems (saree, kurta, skirt) widen with the hips all the way down, so the legs stay inside.
    float wh = (part == 10.0 ? 1.0 : smoothstep(0.68, 0.8, y)) * (1.0 - smoothstep(0.96, 1.06, y));
    float front = step(0.0, p.z);
    p.x *= 1.0 + (chest - 1.0) * 0.45 * wc + (belly - 1.0) * 0.55 * wb + (hips - 1.0) * wh;
    p.z *= 1.0 + ((chest - 1.0) * wc + (belly - 1.0) * wb) * front + (hips - 1.0) * 0.8 * wh * (1.0 - front);
  }
  if (part >= 6.0 && part <= 9.0) p.x += sign(p.x) * max(-0.01, (chest - 1.0) * 0.07 + (belly - 1.0) * 0.05);
  if (part >= 2.0 && part <= 5.0) {
    float t = smoothstep(0.45, 0.88, p.y);
    float ax = sign(p.x) * ${J.hipX};
    float k = 1.0 + (hips - 1.0) * 0.6 * t;
    p.x = ax + (p.x - ax) * k + sign(p.x) * (hips - 1.0) * 0.05 * t;
    p.z *= k;
  }
  // Hair and hems: open hair and plaits fall to aWear.x, skirts and kurtis to aWear.y.
  if (region == 10.0 || region == 28.0) {
    if (p.y < 1.56) p.y = 1.56 - (1.56 - p.y) * aWear.x;
  }
  if (region == 13.0) {
    float L = aWear.y;
    if (p.y < 0.88) {
      float d = (0.88 - p.y) * L;
      p.xz *= 1.0 + d * max(0.0, L - 1.0) * 0.45;
      p.y = 0.88 - d;
    }
  }
  if (part == 1.0) {
    float code = aShape.w;
    float fw = 0.9 + floor(code / 100.0) * 0.025;
    float fl = 0.92 + mod(floor(code / 10.0), 10.0) * 0.022;
    float jw = 0.86 + mod(code, 10.0) * 0.035;
    p.x *= fw;
    if (p.y < 1.6) p.y = 1.6 - (1.6 - p.y) * fl;
    p.x *= mix(1.0, jw, clamp((1.56 - p.y) / 0.07, 0.0, 1.0));
    // A child's head is larger for the body.
    if (crowdBit(aWear.w, 64.0)) p = vec3(0.0, 1.47, 0.0) + (p - vec3(0.0, 1.47, 0.0)) * 1.24;
  }
}

bool crowdHidden(float region) {
  // The umbrella: up, or folded and carried at the side while standing or walking (else put away).
  if (region == 29.0 || region == 31.0) return crowdGear != 1.0 || (crowdOpen < 0.01 && crowdPose != 0.0);
  if (region == 30.0) return crowdGear != 2.0;
  // Under the hood: the hair tied up out of sight, no cap or earrings, the dupatta inside.
  if (crowdGear == 2.0 && (region == 10.0 || region == 11.0 || region == 27.0 || region == 28.0 || region == 9.0 || region == 26.0 || region == 20.0)) return true;
  float bagT = floor(aFlags.y + 0.5);
  float hs = floor(aStyle.y + 0.5);
  float bt = floor(aStyle.z + 0.5);
  float shoeT = floor(aStyle.x + 0.5);
  float layer = floor(aWear.z + 0.5);
  if (region == 7.0) return aFlags.x < 0.5;
  if (region == 8.0) return bagT != 1.0;
  if (region == 24.0) return bagT != 2.0;
  if (region == 25.0) return bagT != 3.0;
  if (region == 9.0) return aMisc.x < 0.5;
  if (region == 10.0) return hs != 0.0;
  if (region == 11.0) return hs != 1.0;
  if (region == 27.0) return hs != 2.0;
  if (region == 28.0) return hs != 3.0;
  if (region == 13.0) return bt < 0.5 || bt == 4.0;
  if (region == 16.0) return bt != 4.0 && bt != 5.0;
  if (region == 17.0) return !crowdBit(aWear.w, 128.0);
  if (region == 19.0) return layer != 1.0;
  if (region == 20.0) return layer != 2.0;
  if (region == 21.0 || region == 23.0) return shoeT != 1.0;
  if (region == 3.0 || region == 22.0) return shoeT == 1.0;
  if (region == 26.0) return !crowdBit(aWear.w, 1.0);
  return false;
}

void crowdAnimate(inout vec3 p, inout vec3 n) {
  float part = crowdPart();
  float region = crowdRegion();
  crowdShape(p, part, region);
  float ph = aAnim.x;
  float amp = aAnim.y;
  // Pose code (POSE): + 128 inside a train; a fraction on top folds the umbrella (stepping aboard).
  float code = floor(aAnim.z + 0.002);
  bool inside = code >= 128.0;
  float closing = inside ? 1.0 : fract(aAnim.z + 0.002) / 0.98;
  code = mod(code, 128.0);
  float pose = mod(code, 8.0);
  float side = mod(floor(code / 8.0), 4.0);
  float act = mod(floor(code / 32.0), 4.0);
  crowdPose = pose;
  crowdOut = uCrowdRain.x > 0.01 ? crowdExposed(inside) : 0.0;
  crowdGear = crowdRainGear(pose);
  if (crowdGear == 1.0) crowdOpen = crowdOut * (1.0 - closing);
  float sgn = side == 1.0 ? 1.0 : side == 2.0 ? -1.0 : 0.0;
  float legL = sin(ph) * 0.48 * amp;
  float legR = -legL;
  float kneeL = (0.08 + 0.85 * max(0.0, sin(ph - 1.25))) * amp;
  float kneeR = (0.08 + 0.85 * max(0.0, sin(ph + 3.14159 - 1.25))) * amp;
  float armL = -sin(ph) * 0.36 * min(amp, 1.2);
  float armR = -armL;
  float elbowL = 0.2 + 0.2 * amp;
  float elbowR = elbowL;
  float abdL = 0.0;
  float abdR = 0.0;
  float drop = 0.0;
  float lean = 0.06 * amp;
  float twist = sin(ph) * 0.06 * amp;
  float roll = 0.0;
  float headYaw = 0.0;
  float headPitch = 0.0;
  float headRoll = 0.0;
  if (pose == 1.0) { // seated
    legL = legR = 1.5; kneeL = kneeR = 1.5; armL = armR = 0.3; elbowL = elbowR = 1.0; drop = ${(J.hipY - 0.49).toFixed(3)}; lean = -0.04; twist = 0.0;
  } else if (pose == 2.0) { // phone in the right hand
    armR = 0.35; elbowR = 1.75;
  } else if (pose == 3.0) { // holding an overhead grab / door pole
    armR = 2.7; elbowR = 0.3;
  } else if (pose == 4.0) { // a photo: the phone held up in both hands
    armL = armR = 1.05; elbowL = elbowR = 1.5; abdL = 0.3; abdR = -0.3; headPitch = 0.08;
  } else if (pose == 5.0) { // riding: seated, leaning in, both hands forward on the handlebar; looks where ph says
    legL = legR = 1.35; kneeL = kneeR = 1.25; armL = armR = 0.55; elbowL = elbowR = 0.8; abdL = -0.16; abdR = 0.16;
    drop = ${(J.hipY - 0.49).toFixed(3)}; lean = 0.1; twist = 0.0;
    headYaw = clamp(ph, -1.3, 1.3); headPitch = -0.04;
  }
  if (act == 1.0) { // leaning on the partner, head on the shoulder
    roll = -sgn * 0.17;
    headRoll = -sgn * 0.32;
  } else if (act == 2.0) { // holding hands on the partner's side
    if (sgn > 0.0) { armR *= 0.25; abdR = 0.2; elbowR = 0.12; }
    else { armL *= 0.25; abdL = -0.2; elbowL = 0.12; }
  } else if (act == 3.0) { // talking: turned to the partner, the head moving, a hand now and then
    headYaw = sgn * 0.38 + 0.16 * sin(ph * 0.55);
    headPitch = 0.05 * sin(ph * 1.3);
    float g = max(0.0, sin(ph * 0.37));
    if (sgn > 0.0) { elbowR = max(elbowR, 0.5 + 0.9 * g); armR += 0.25 * g; }
    else { elbowL = max(elbowL, 0.5 + 0.9 * g); armL += 0.25 * g; }
  }
  if (crowdGear == 1.0 && (crowdOpen > 0.0 || pose == 0.0)) {
    // The umbrella held up in the right hand close over the head (a steadier walk under it), or
    // lowered, folded, and carried at the side with a short swing.
    float up = pose == 0.0 ? smoothstep(0.0, 0.4, crowdOpen) : 1.0;
    armR = mix(armR * 0.3, 0.15, up); elbowR = mix(0.22, 1.75, up); abdR = mix(0.0, -0.22, up);
    twist *= mix(1.0, 0.5, up);
  } else if (crowdOut > 0.5 && pose == 0.0 && amp > 0.3) {
    // Caught out in it: head down, shoulders hunched, leaning into the rain.
    lean += (0.07 + 0.08 * uCrowdRain.z) * uCrowdRain.x;
    headPitch += 0.2 * uCrowdRain.x;
    armL *= 1.0 - 0.4 * uCrowdRain.x;
    armR *= 1.0 - 0.4 * uCrowdRain.x;
    elbowL += 0.35 * uCrowdRain.x;
    elbowR += 0.35 * uCrowdRain.x;
  } else if (crowdGear == 2.0) {
    headPitch += 0.08;
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
  if (part == 6.0 || part == 7.0) { R = crowdRotZ(abdL) * crowdRotX(-armL); p = shL + R * (p - shL); n = R * n; }
  if (part == 8.0 || part == 9.0) { R = crowdRotZ(abdR) * crowdRotX(-armR); p = shR + R * (p - shR); n = R * n; }
  if (part == 10.0) { // skirt / kurta hem sways gently; seated, it lies over the lap and hangs past the knees
    float sw = (legL - legR) * 0.12;
    R = crowdRotX(-sw * 0.5); p = vec3(0.0, ${J.hipY}, 0.0) + R * (p - vec3(0.0, ${J.hipY}, 0.0)); n = R * n;
    if (pose == 1.0 || pose == 5.0) {
      float d = ${J.hipY} - p.y;
      if (d > 0.0) {
        float lap = min(d, 0.44);
        // Over the thighs (their tops are ~0.07 above the hip joint), then down past the knees.
        p.z += lap * 0.95;
        p.x *= 1.0 - 0.15 * (lap / 0.44);
        p.y = ${J.hipY} + 0.08 - 0.02 * (lap / 0.44) - max(0.0, d - 0.44);
      }
    }
  }
  if (part == 13.0 && crowdGear == 1.0) {
    // The umbrella (built open, held up): its canopy, sized for this person, folds down along the
    // shaft as it closes; closed, it is lowered to hang from the hand at the side.
    vec3 A = vec3(0.07, 2.03, 0.15);
    vec3 G = vec3(0.14, 1.17, 0.3);
    vec3 D = normalize(A - G);
    float fold = smoothstep(0.3, 1.0, crowdOpen);
    if (region == 29.0) {
      float size = 0.85 + 0.38 * crowdHash(9.1);
      vec3 v = p - A;
      float ax = dot(v, D);
      vec3 rv = v - ax * D;
      float r = length(rv);
      vec3 rn = r > 1e-4 ? rv / r : vec3(1.0, 0.0, 0.0);
      p = A + D * mix(-r * 1.1, ax * size, fold) + rn * mix(0.02 + 0.06 * r, r * size, fold);
      n = normalize(mix(rn, n, fold));
    }
    if (pose == 0.0) {
      float down = 1.0 - smoothstep(0.0, 0.4, crowdOpen);
      if (down > 0.0) {
        mat3 Rl = crowdRotX(down * 3.0);
        p = mix(G, vec3(0.185, 0.86, 0.05), down) + Rl * (p - G);
        n = Rl * n;
      }
    }
    // Someone right beside you tips their open umbrella away from you, as people do passing close.
    if (crowdOpen > 0.0) {
      vec3 camL = (inverse(modelMatrix * instanceMatrix) * vec4(cameraPosition, 1.0)).xyz;
      float dh = length(camL.xz);
      float tip = (1.0 - smoothstep(0.8, 1.8, dh)) * step(camL.y, 2.4) * crowdOpen;
      if (tip > 0.0 && dh > 1e-3) {
        vec2 d = camL.xz / dh;
        mat3 Rt = crowdRotAxis(vec3(-d.y, 0.0, d.x), 0.6 * tip);
        p = G + Rt * (p - G);
        n = Rt * n;
      }
    }
  }
  // Seated, a pallu or dupatta hanging down the back folds onto the seat.
  if ((pose == 1.0 || pose == 5.0) && part == 0.0 && p.z < -0.06) p.y = max(p.y, ${J.hipY} - 0.02);
  if (part == 1.0) {
    vec3 nk = vec3(0.0, 1.47, 0.0);
    R = crowdRotY(headYaw) * crowdRotX(headPitch) * crowdRotZ(headRoll);
    p = nk + R * (p - nk); n = R * n;
  }
  // Upper body: forward lean, counter-twist and a sideways lean.
  bool upper = part == 0.0 || part == 1.0 || part >= 6.0 && part <= 9.0 || part == 11.0 || part == 12.0 || part == 13.0;
  if (upper) {
    R = crowdRotY(twist) * crowdRotX(lean) * crowdRotZ(roll);
    p = vec3(0.0, ${J.hipY}, 0.0) + R * (p - vec3(0.0, ${J.hipY}, 0.0)); n = R * n;
  }
  // Parts this person does not wear collapse to a point.
  if (crowdHidden(region)) p = vec3(0.0, 1.2, 0.0);
  // Walking bob.
  p.y += (1.0 - cos(2.0 * ph)) * 0.014 * min(amp, 1.2) - drop;
  // Body proportions.
  float wScale = abs(aMisc.w);
  p.xz *= vec2(wScale, mix(1.0, wScale, 0.6));
  p *= aAnim.w;
}

vec3 crowdColour(float r) {
  float bt = floor(aStyle.z + 0.5);
  float layer = floor(aWear.z + 0.5);
  float top = aCol0.x;
  float skin = aCol0.w;
  float v = top;
  if (r == 0.0) v = skin;
  else if (r == 2.0 || r == 16.0) v = aCol0.y;
  else if (r == 3.0 || r == 21.0) v = aCol1.z;
  else if (r == 4.0 || r == 10.0 || r == 11.0 || r == 27.0 || r == 28.0) v = aCol1.x;
  else if (r == 5.0 || r == 26.0) v = aCol0.z;
  else if (r == 6.0) v = aFlags.z > 0.5 ? top : skin;
  else if (r == 7.0) return aMisc.y < 0.5 ? vec3(0.02) : aMisc.y < 1.5 ? vec3(0.02, 0.03, 0.08) : aMisc.y < 2.5 ? vec3(0.07, 0.015, 0.02) : vec3(0.08, 0.08, 0.08);
  else if (r == 8.0 || r == 24.0 || r == 25.0) v = aCol1.w;
  else if (r == 9.0) { if (aMisc.x < 1.5) return vec3(0.85, 0.85, 0.82); if (aMisc.x < 2.5) return vec3(0.03, 0.04, 0.09); v = aCol0.z; }
  else if (r == 12.0) v = (bt == 1.0 || bt == 2.0) ? skin : aCol0.y;
  else if (r == 13.0) v = bt == 1.0 ? aCol0.y : top;
  else if (r == 14.0) v = layer == 1.0 ? aCol1.y : aStyle.w > 0.5 ? top : skin;
  else if (r == 15.0) v = layer == 1.0 ? aCol1.y : aStyle.w > 1.5 ? top : skin;
  else if (r == 18.0) v = crowdBit(aWear.w, 16.0) ? skin : top;
  else if (r == 19.0 || r == 20.0) v = aCol1.y;
  else if (r == 22.0) v = floor(aStyle.x + 0.5) == 2.0 ? skin : aCol1.z;
  else if (r == 23.0) return vec3(0.8, 0.8, 0.77);
  else if (r == 29.0) {
    // Umbrellas: mostly the black one, then navy, maroon, a print in the accent colour, pink, green.
    float u = crowdHash(3.1);
    if (u < 0.5) return vec3(0.012, 0.012, 0.014);
    if (u < 0.58) return vec3(0.015, 0.022, 0.07);
    if (u < 0.65) return vec3(0.09, 0.012, 0.018);
    if (u < 0.72) return vec3(0.02, 0.06, 0.3);
    if (u < 0.77) return vec3(0.32, 0.02, 0.02);
    if (u < 0.82) return vec3(0.3, 0.05, 0.13);
    if (u < 0.87) return vec3(0.02, 0.07, 0.035);
    if (u < 0.92) return vec3(0.4, 0.3, 0.02);
    return crowdUnpack(aCol0.z);
  } else if (r == 30.0) {
    // Raincoats: navy, black, olive, maroon, a bright one for a child, royal blue, clear grey plastic.
    float c = crowdHash(5.3);
    if (crowdBit(aWear.w, 64.0) && c < 0.6) return c < 0.3 ? vec3(0.62, 0.42, 0.015) : vec3(0.5, 0.06, 0.08);
    if (c < 0.3) return vec3(0.018, 0.025, 0.07);
    if (c < 0.48) return vec3(0.012, 0.012, 0.014);
    if (c < 0.6) return vec3(0.05, 0.06, 0.028);
    if (c < 0.7) return vec3(0.1, 0.018, 0.022);
    if (c < 0.85) return vec3(0.03, 0.07, 0.24);
    return vec3(0.28, 0.3, 0.31);
  } else if (r == 31.0) return vec3(0.03, 0.028, 0.026);
  return crowdUnpack(v);
}

/** Which print the fragment paints here: the top's (aFlags.w), the bottom's (aMisc.z) or none. */
float crowdPattern(float r) {
  float bt = floor(aStyle.z + 0.5);
  float layer = floor(aWear.z + 0.5);
  bool topLike = r == 1.0 || r == 17.0 || (r == 18.0 && !crowdBit(aWear.w, 16.0)) || (r == 13.0 && bt >= 2.0)
    || (layer != 1.0 && ((r == 14.0 && aStyle.w > 0.5) || (r == 15.0 && aStyle.w > 1.5)));
  bool bottomLike = r == 2.0 || r == 16.0 || (r == 13.0 && bt == 1.0) || (r == 12.0 && bt != 1.0 && bt != 2.0);
  // A few umbrellas have panels in two colours.
  if (r == 29.0) return crowdHash(3.1) > 0.82 ? 9.0 : 0.0;
  return topLike ? aFlags.w : bottomLike ? aMisc.z : 0.0;
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
      ${withColour ? 'vRegion = crowdRegion(); vPart = crowdPart(); vCrowdColor = crowdColour(vRegion); vCrowdAccent = crowdUnpack(aCol0.z); vObjPos = position; vPattern = crowdPattern(vRegion); vMoustache = step(aMisc.w, 0.0); vExtras = aWear.w; vCrowdWet = crowdOpen < 0.5 && crowdGear != 2.0 ? crowdOut * uCrowdRain.x : 0.0;' : ''}`,
    );
}

const fragmentPatch = /* glsl */ `
{
  vec3 cc = vCrowdColor;
  vec3 q = vObjPos;
  float reg = floor(vRegion + 0.5);
  float pat = floor(vPattern + 0.5);
  if (pat == 1.0) cc *= mix(1.0, 0.62, step(0.55, fract(q.x * 22.0 + q.z * 22.0)));
  else if (pat == 2.0) {
    float a = step(0.5, fract(q.x * 11.0 + q.z * 11.0));
    float b = step(0.5, fract(q.y * 11.0));
    cc *= 0.62 + 0.38 * abs(a - b) + 0.12 * a * b;
  } else if (pat == 3.0) {
    // Saree / kurta border and print.
    float border = step(q.y, 0.14) * step(0.05, q.y);
    cc = mix(cc, vec3(0.62, 0.42, 0.08), border);
    cc *= 0.85 + 0.15 * step(0.7, fract(q.y * 30.0 + sin(q.x * 60.0)));
  } else if (pat == 4.0 || pat == 6.0) {
    // Floral print (small blossoms and leaves) or polka dots, in the accent colour.
    vec2 uv = vec2(q.x * 0.8 + q.z, q.y) * (pat == 4.0 ? 24.0 : 30.0);
    vec2 cell = floor(uv);
    vec2 f = fract(uv) - 0.5;
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    vec2 o = pat == 4.0 ? (vec2(h, fract(h * 7.13)) - 0.5) * 0.4 : vec2(0.25 * mod(cell.y, 2.0), 0.0);
    float d = length(f - o);
    float blossom = 1.0 - smoothstep(pat == 4.0 ? 0.15 : 0.2, pat == 4.0 ? 0.23 : 0.26, d);
    if (pat == 4.0) {
      blossom *= step(0.3, h);
      float leaf = (1.0 - smoothstep(0.07, 0.11, length(f - o + vec2(0.21, -0.13)))) * step(0.3, h);
      cc = mix(cc, cc * 0.5 + vec3(0.02, 0.06, 0.02), leaf * 0.7);
    }
    cc = mix(cc, vCrowdAccent, blossom);
  } else if (pat == 5.0) {
    // Horizontal stripes.
    cc = mix(cc, vCrowdAccent, step(0.55, fract(q.y * 26.0)));
  } else if (pat == 7.0) {
    // Denim: a fine twill, lighter down the front of the thighs.
    cc *= 0.9 + 0.1 * step(0.5, fract((q.x + q.y + q.z) * 160.0));
    cc *= 1.0 + 0.18 * smoothstep(0.02, 0.09, q.z) * smoothstep(0.4, 0.75, q.y);
  } else if (pat == 8.0) {
    // Fine vertical stripes / ribbed knit.
    cc *= 0.84 + 0.16 * step(0.5, fract(atan(q.x, q.z) * 4.8 + q.x * 30.0));
  } else if (pat == 9.0) {
    // An umbrella's panels, every other one in the accent colour.
    float panel = floor((atan(q.x - 0.07, q.z - 0.15) + 3.14159) / 0.7854);
    cc = mix(cc, vCrowdAccent, mod(panel, 2.0));
  }
  // Faces: eyes, brows and mouth; a moustache on many men; a bindi, spectacles or sunglasses, lipstick.
  if (floor(vPart + 0.5) == 1.0 && reg == 0.0 && q.z > 0.05) {
    vec2 e = vec2(abs(q.x) - 0.034, q.y - 1.598);
    float eye = 1.0 - smoothstep(0.009, 0.013, length(e * vec2(1.0, 1.6)));
    float brow = (1.0 - smoothstep(0.004, 0.007, abs(q.y - 1.618))) * step(abs(abs(q.x) - 0.034), 0.02);
    float mouth = (1.0 - smoothstep(0.002, 0.005, abs(q.y - 1.527))) * step(abs(q.x), 0.022);
    float stache = vMoustache * (1.0 - smoothstep(0.006, 0.01, abs(q.y - 1.543))) * step(abs(q.x), 0.03);
    float ex = vExtras;
    if (mod(floor((ex + 0.5) / 32.0), 2.0) > 0.5) {
      float lips = (1.0 - smoothstep(0.003, 0.006, abs(q.y - 1.527))) * (1.0 - smoothstep(0.013, 0.019, abs(q.x)));
      cc = mix(cc, cc * vec3(0.72, 0.36, 0.38), lips * 0.8);
      mouth *= 0.3;
    }
    cc = mix(cc, vec3(0.02, 0.015, 0.012), max(max(eye, brow * 0.8), max(stache, mouth * 0.35)));
    if (mod(floor((ex + 0.5) / 2.0), 2.0) > 0.5) cc = mix(cc, vec3(0.45, 0.015, 0.03), 1.0 - smoothstep(0.004, 0.0065, length(vec2(q.x, q.y - 1.63))));
    float rim = length(e * vec2(1.0, 1.3));
    float bridge = step(abs(q.x), 0.016) * (1.0 - smoothstep(0.002, 0.004, abs(q.y - 1.601)));
    if (mod(floor((ex + 0.5) / 8.0), 2.0) > 0.5) cc = mix(cc, vec3(0.015, 0.015, 0.02), max(1.0 - smoothstep(0.02, 0.023, rim), bridge));
    else if (mod(floor((ex + 0.5) / 4.0), 2.0) > 0.5) cc = mix(cc, vec3(0.03, 0.025, 0.02), max(smoothstep(0.018, 0.02, rim) * (1.0 - smoothstep(0.023, 0.026, rim)), bridge));
  }
  diffuseColor.rgb *= cc;
}`;

export function createCrowdMaterial(av: AmbientVolume, opts: { indoor?: boolean } = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 });
  mat.name = 'crowd';
  const indoor = { value: opts.indoor ? 1 : 0 };
  addShaderPatch(mat, 'crowd', (shader) => {
    Object.assign(shader.uniforms, { uCrowdRain: WX.uCrowdRain, uCrowdIndoor: indoor });
    patchVertex(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCrowdColor;
        varying vec3 vCrowdAccent;
        varying vec3 vObjPos;
        varying float vPattern;
        varying float vRegion;
        varying float vPart;
        varying float vMoustache;
        varying float vExtras;
        varying float vCrowdWet;`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + fragmentPatch)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Raincoats and umbrellas shine wet; clothes out in the rain go darker.
        roughnessFactor = mix(roughnessFactor, 0.3, step(28.5, vRegion));
        diffuseColor.rgb *= 1.0 - 0.2 * vCrowdWet * step(0.5, vRegion) * step(vRegion, 28.5);`,
      );
  });
  av.patch(mat);
  return mat;
}

/** Depth material for shadows that runs the same skinning. */
export function createCrowdDepthMaterial(av: AmbientVolume, opts: { indoor?: boolean } = {}): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uCrowdRain: WX.uCrowdRain, uCrowdIndoor: { value: opts.indoor ? 1 : 0 }, uAVMap: av.uniforms.uAVMap, uAVBounds: av.uniforms.uAVBounds });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + vertexHead);
    // MeshDepthMaterial has no normal chunks; animate position only.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      { vec3 nn = vec3(0.0, 1.0, 0.0); vec3 pp = position; crowdAnimate(pp, nn); transformed = pp; }`,
    );
  };
  mat.customProgramCacheKey = () => (opts.indoor ? 'crowd-depth-3-in' : 'crowd-depth-3');
  return mat;
}

/** Writes one person's look and animation state into instance slot i. */
export function writeLook(A: Record<string, THREE.InstancedBufferAttribute>, i: number, look: Look, phase: number, amp: number, pose: number): void {
  A.aAnim.setXYZW(i, phase, amp, pose, look.scale);
  A.aCol0.setXYZW(i, look.top, look.bottom, look.accent, look.skin);
  A.aCol1.setXYZW(i, look.hair, look.layer, look.shoe, look.bag);
  A.aFlags.setXYZW(i, ...look.flags);
  A.aMisc.setXYZW(i, ...look.misc);
  A.aStyle.setXYZW(i, ...look.style);
  A.aShape.setXYZW(i, ...look.shape);
  A.aWear.setXYZW(i, ...look.wear);
}
