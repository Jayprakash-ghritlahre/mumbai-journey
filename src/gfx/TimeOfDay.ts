import * as THREE from 'three';
import { directionFromBearing, istToUtc, solarPosition } from '../core/Solar';
import { clamp, smoothstep } from '../core/Random';

export type TimePreset = 'morning' | 'afternoon' | 'golden' | 'evening' | 'night';

/**
 * Wall-clock hours (IST) for each preset: day, golden hour (the sun low over the Arabian Sea,
 * ~7° up), evening (just after sunset: the afterglow, the lights coming on), night.
 */
export const PRESET_HOURS: Record<TimePreset, number> = {
  morning: 8.25,
  afternoon: 13.5,
  golden: 18.4,
  evening: 19.15,
  night: 20.75,
};

/** Presets in the order of the day (the menu, and T in explore mode). */
export const PRESET_ORDER: TimePreset[] = ['morning', 'afternoon', 'golden', 'evening', 'night'];

export const PRESET_LABEL: Record<TimePreset, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  golden: 'Golden hour',
  evening: 'Evening',
  night: 'Night',
};

/**
 * 20 April: pre-monsoon haze, and the sun sets at ~282° — straight down Veer Nariman
 * Road (bearing ~280°) towards Marine Drive, as it does each April and August.
 */
export const JOURNEY_DATE = { year: 2026, month: 4, day: 20 };

export interface LightingState {
  hour: number;
  sunDir: THREE.Vector3; // points towards the sun
  sunElevation: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  horizonAnti: THREE.Color;
  ground: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  hazeGlow: number;
  envIntensity: number;
  exposure: number;
  lamps: number; // 0..1 artificial lights
  cloudCover: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  night: number; // 0 day .. 1 full night
  /** Weather (Weather.ts): how overcast the monsoon sky is (0 clear … 1), and the rain falling now. */
  overcast: number;
  rain: number;
  grade: { lift: THREE.Color; gain: THREE.Color; saturation: number; contrast: number };
}

type RGB = [number, number, number];
interface Key {
  h: number;
  sun: RGB;
  zen: RGB;
  hor: RGB;
  ant: RGB;
  fog: RGB;
  fogD: number;
  lamps: number;
  exp: number;
  env: number;
  cloudLit: RGB;
  cloudShade: RGB;
  lift: RGB;
  gain: RGB;
  sat: number;
  con: number;
}

// Hand-tuned for humid, hazy South Mumbai skies just after the monsoon.
const KEYS: Key[] = [
  { h: 4.5, sun: [1, 0.5, 0.3], zen: [0.004, 0.006, 0.014], hor: [0.05, 0.042, 0.042], ant: [0.03, 0.03, 0.04], fog: [0.035, 0.03, 0.03], fogD: 0.0006, lamps: 1, exp: 1.6, env: 1.0, cloudLit: [0.05, 0.045, 0.05], cloudShade: [0.02, 0.02, 0.025], lift: [0.0, 0.004, 0.012], gain: [1.0, 0.98, 0.96], sat: 0.95, con: 1.05 },
  { h: 5.95, sun: [1, 0.45, 0.22], zen: [0.07, 0.1, 0.2], hor: [0.5, 0.36, 0.3], ant: [0.22, 0.22, 0.3], fog: [0.3, 0.27, 0.27], fogD: 0.0005, lamps: 0.7, exp: 1.3, env: 1.0, cloudLit: [0.7, 0.42, 0.35], cloudShade: [0.18, 0.16, 0.2], lift: [0.01, 0.005, 0.01], gain: [1.02, 0.98, 0.95], sat: 1.0, con: 1.03 },
  { h: 6.5, sun: [1, 0.55, 0.28], zen: [0.14, 0.23, 0.42], hor: [0.95, 0.62, 0.42], ant: [0.45, 0.45, 0.55], fog: [0.6, 0.52, 0.48], fogD: 0.00045, lamps: 0.2, exp: 1.0, env: 1.0, cloudLit: [1.2, 0.75, 0.5], cloudShade: [0.35, 0.3, 0.33], lift: [0.01, 0.005, 0.0], gain: [1.03, 0.99, 0.95], sat: 1.05, con: 1.04 },
  { h: 8.25, sun: [1, 0.86, 0.68], zen: [0.26, 0.38, 0.6], hor: [0.8, 0.78, 0.74], ant: [0.7, 0.72, 0.74], fog: [0.72, 0.71, 0.68], fogD: 0.00028, lamps: 0.0, exp: 0.95, env: 1.0, cloudLit: [1.25, 1.15, 1.05], cloudShade: [0.55, 0.58, 0.64], lift: [0.004, 0.004, 0.008], gain: [1.02, 1.0, 0.98], sat: 1.02, con: 1.04 },
  { h: 12.5, sun: [1, 0.95, 0.86], zen: [0.3, 0.42, 0.62], hor: [0.86, 0.85, 0.82], ant: [0.8, 0.81, 0.8], fog: [0.8, 0.79, 0.76], fogD: 0.00022, lamps: 0.0, exp: 0.82, env: 1.0, cloudLit: [1.4, 1.38, 1.35], cloudShade: [0.62, 0.65, 0.72], lift: [0.0, 0.002, 0.006], gain: [1.0, 1.0, 1.0], sat: 1.0, con: 1.06 },
  { h: 16.9, sun: [1, 0.88, 0.72], zen: [0.26, 0.38, 0.6], hor: [0.86, 0.82, 0.76], ant: [0.74, 0.75, 0.76], fog: [0.78, 0.75, 0.7], fogD: 0.00024, lamps: 0.0, exp: 0.9, env: 1.0, cloudLit: [1.35, 1.2, 1.02], cloudShade: [0.6, 0.58, 0.6], lift: [0.004, 0.003, 0.002], gain: [1.02, 1.0, 0.97], sat: 1.04, con: 1.05 },
  // The evening clears: a clean blue overhead, warm light low down, a thinner, warmer haze
  // (a pleasant sea haze, not the grey of the afternoon) so the sea and the far shore keep
  // their colour.
  { h: 17.7, sun: [1, 0.8, 0.56], zen: [0.18, 0.32, 0.62], hor: [0.98, 0.78, 0.56], ant: [0.58, 0.66, 0.8], fog: [0.72, 0.66, 0.58], fogD: 0.0002, lamps: 0.0, exp: 0.94, env: 1.0, cloudLit: [1.45, 1.15, 0.85], cloudShade: [0.55, 0.52, 0.56], lift: [0.004, 0.003, 0.002], gain: [1.04, 1.0, 0.95], sat: 1.14, con: 1.08 },
  // Golden hour (sun ~7° over the Arabian Sea): gold round the sun, a warm horizon, lilac-pink
  // opposite, peach haze, the promenade and the towers lit warm; the first lamps come on.
  { h: 18.4, sun: [1, 0.64, 0.32], zen: [0.12, 0.24, 0.55], hor: [1.2, 0.62, 0.28], ant: [0.58, 0.56, 0.7], fog: [0.7, 0.52, 0.38], fogD: 0.00015, lamps: 0.25, exp: 1.0, env: 1.0, cloudLit: [1.7, 1.0, 0.56], cloudShade: [0.5, 0.4, 0.46], lift: [0.016, 0.008, 0.0], gain: [1.07, 1.0, 0.9], sat: 1.24, con: 1.12 },
  // Sunset (sun ~1° up): orange at the horizon, pink clouds, half the lamps on.
  { h: 18.82, sun: [1, 0.46, 0.2], zen: [0.08, 0.15, 0.4], hor: [1.2, 0.48, 0.2], ant: [0.52, 0.4, 0.56], fog: [0.6, 0.38, 0.28], fogD: 0.00017, lamps: 0.6, exp: 1.12, env: 1.0, cloudLit: [1.6, 0.7, 0.42], cloudShade: [0.34, 0.25, 0.34], lift: [0.016, 0.007, 0.0], gain: [1.08, 0.98, 0.9], sat: 1.26, con: 1.12 },
  // Evening (the sun just gone): the afterglow over the sea, a deepening blue, the city lights.
  { h: 19.12, sun: [1, 0.38, 0.2], zen: [0.045, 0.085, 0.24], hor: [0.8, 0.34, 0.18], ant: [0.26, 0.2, 0.36], fog: [0.32, 0.22, 0.22], fogD: 0.00026, lamps: 0.9, exp: 1.35, env: 1.0, cloudLit: [1.05, 0.45, 0.42], cloudShade: [0.17, 0.13, 0.2], lift: [0.01, 0.005, 0.006], gain: [1.05, 0.98, 0.95], sat: 1.16, con: 1.1 },
  { h: 19.45, sun: [1, 0.35, 0.2], zen: [0.028, 0.045, 0.12], hor: [0.3, 0.17, 0.19], ant: [0.1, 0.1, 0.18], fog: [0.12, 0.1, 0.13], fogD: 0.00042, lamps: 1.0, exp: 1.6, env: 1.0, cloudLit: [0.32, 0.2, 0.22], cloudShade: [0.08, 0.08, 0.12], lift: [0.004, 0.004, 0.012], gain: [1.02, 0.99, 0.97], sat: 1.02, con: 1.05 },
  // Night: dark, clear, the lights doing the work.
  { h: 20.15, sun: [1, 0.5, 0.3], zen: [0.005, 0.008, 0.02], hor: [0.062, 0.05, 0.048], ant: [0.042, 0.04, 0.046], fog: [0.042, 0.036, 0.036], fogD: 0.00045, lamps: 1.0, exp: 1.6, env: 1.0, cloudLit: [0.06, 0.05, 0.048], cloudShade: [0.026, 0.025, 0.03], lift: [0.0, 0.004, 0.012], gain: [1.0, 0.98, 0.96], sat: 0.95, con: 1.06 },
];

const c3 = (a: RGB, b: RGB, t: number, out: THREE.Color) => out.setRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

export function computeLighting(hour: number, cloudCover = 0.32, out?: LightingState): LightingState {
  const s: LightingState = out ?? {
    hour,
    sunDir: new THREE.Vector3(),
    sunElevation: 0,
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    horizonAnti: new THREE.Color(),
    ground: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogDensity: 0,
    hazeGlow: 1,
    envIntensity: 1,
    exposure: 1,
    lamps: 0,
    cloudCover,
    cloudLit: new THREE.Color(),
    cloudShade: new THREE.Color(),
    night: 0,
    overcast: 0,
    rain: 0,
    grade: { lift: new THREE.Color(), gain: new THREE.Color(), saturation: 1, contrast: 1 },
  };
  s.hour = hour;
  s.cloudCover = cloudCover;
  s.overcast = 0;
  s.rain = 0;
  const { year, month, day } = JOURNEY_DATE;
  const sun = solarPosition(istToUtc(year, month, day, hour));
  s.sunElevation = sun.elevation;
  directionFromBearing(sun.azimuth, sun.elevation, s.sunDir);

  // Evening keys wrap: for hours past the last key use the last, before the first use the first.
  const h = clamp(hour, KEYS[0].h, KEYS[KEYS.length - 1].h);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h < h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smoothstep(0, 1, clamp((h - a.h) / (b.h - a.h), 0, 1));
  c3(a.sun, b.sun, t, s.sunColor);
  c3(a.zen, b.zen, t, s.zenith);
  c3(a.hor, b.hor, t, s.horizon);
  c3(a.ant, b.ant, t, s.horizonAnti);
  c3(a.fog, b.fog, t, s.fogColor);
  c3(a.cloudLit, b.cloudLit, t, s.cloudLit);
  c3(a.cloudShade, b.cloudShade, t, s.cloudShade);
  c3(a.lift, b.lift, t, s.grade.lift);
  c3(a.gain, b.gain, t, s.grade.gain);
  s.grade.saturation = a.sat + (b.sat - a.sat) * t;
  s.grade.contrast = a.con + (b.con - a.con) * t;
  s.fogDensity = a.fogD + (b.fogD - a.fogD) * t;
  s.lamps = a.lamps + (b.lamps - a.lamps) * t;
  s.exposure = a.exp + (b.exp - a.exp) * t;
  s.envIntensity = a.env + (b.env - a.env) * t;
  s.ground.copy(s.horizonAnti).lerp(s.horizon, 0.3).multiplyScalar(0.3 + 0.25 * (1 - s.lamps));

  // Direct sun fades through the horizon; below it the key light is a dim sky/moon fill.
  const el = sun.elevation;
  const above = smoothstep(-0.8, 6, el);
  const airmass = 1 / Math.max(0.08, Math.sin(Math.max(el, 0.5) * (Math.PI / 180)));
  s.sunIntensity = 3.4 * above * Math.exp(-0.035 * (airmass - 1)) + 0.0;
  s.night = 1 - smoothstep(-8, 1, el);
  s.hazeGlow = 0.6 + 1.2 * (1 - smoothstep(4, 35, el)) * above;
  if (s.night > 0.98) {
    // Moonlight: soft, cool, from high in the south-east. No real shadows needed.
    directionFromBearing(140, 55, s.sunDir);
    s.sunColor.setRGB(0.55, 0.65, 0.9);
    s.sunIntensity = 0.06;
  }
  return s;
}

const tmp = new THREE.Color();
const grey = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

/**
 * The monsoon over whatever the time of day is (`m`: how far it has set in, `rain`: the fall now).
 * A low, unbroken deck of rain cloud: the sun goes (a brighter patch where it is), the sky turns a
 * pale grey by day, slate at dusk and a dull orange-grey at night (the city's sodium light on the
 * cloud base); the rain haze closes the distance in; colours go quieter; the lamps and lit shop
 * signs come on early under the dark sky.
 */
export function applyWeather(s: LightingState, m: number, rain: number): LightingState {
  if (m <= 0.001) return s;
  s.overcast = m;
  s.rain = rain;
  const el = s.sunElevation;
  // How much daylight comes through the cloud: full by day, less with the sun low, none at night.
  const day = smoothstep(-7, 10, el);
  const level = day * (0.5 + 0.5 * smoothstep(4, 40, el)) * (1 - 0.22 * rain);
  const dusk = day * (1 - smoothstep(4, 22, el));
  const set = (c: THREE.Color, dayRGB: [number, number, number], nightRGB: [number, number, number], keep: number) => {
    tmp.setRGB(nightRGB[0], nightRGB[1], nightRGB[2]).lerp(new THREE.Color(dayRGB[0] * level, dayRGB[1] * level, dayRGB[2] * level), day);
    // A little of the clear sky's own colour shows through (warmth low in the west at dusk).
    tmp.lerp(c.clone().multiplyScalar(grey(tmp) / Math.max(grey(c), 1e-4)), keep);
    c.lerp(tmp, m);
  };
  // Day: pale grey. Night: charcoal and blue-grey storm cloud, the horizon a little lighter (the
  // city's glow under the cloud base is added by the sky). Dusk keeps a little warmth low down only.
  set(s.zenith, [0.27, 0.29, 0.32], [0.008, 0.0095, 0.0135], 0.06);
  set(s.horizon, [0.33, 0.345, 0.36], [0.036, 0.038, 0.046], 0.1 + 0.22 * dusk);
  set(s.horizonAnti, [0.3, 0.315, 0.33], [0.026, 0.029, 0.037], 0.04);
  set(s.fogColor, [0.29, 0.305, 0.315], [0.02, 0.022, 0.028], 0.05 + 0.08 * dusk);
  set(s.cloudLit, [0.36, 0.375, 0.39], [0.038, 0.041, 0.05], 0.06 + 0.14 * dusk);
  set(s.cloudShade, [0.13, 0.14, 0.152], [0.008, 0.009, 0.013], 0.03);
  s.ground.copy(s.horizonAnti).lerp(s.horizon, 0.3).multiplyScalar(0.3 + 0.25 * (1 - s.lamps));
  s.cloudCover += (1 - s.cloudCover) * m;
  // The sun: a dim, diffuse key through the cloud (soft shading, faint shadows).
  s.sunIntensity *= 1 - 0.86 * m;
  s.sunColor.lerp(tmp.setRGB(0.85, 0.88, 0.92), 0.6 * m * day);
  s.hazeGlow *= 1 - 0.85 * m;
  // Rain haze: the far shore and the towers fade into grey.
  // (The streets close by stay clear; the far-off city greys out in the rain: FogEffect's far haze.)
  s.fogDensity += (0.00035 + 0.0006 * rain - s.fogDensity) * m;
  s.envIntensity *= 1 + 0.2 * m * day;
  // Lamps and lit signs on early under the dark sky.
  s.lamps += (Math.max(s.lamps, 0.3 + 0.7 * (1 - smoothstep(-2, 16, el))) - s.lamps) * m;
  // The eye opens up to the gloom (it stays darker than a clear day).
  s.exposure *= 1 + 0.18 * m * day;
  const g = s.grade;
  g.saturation *= 1 - 0.2 * m;
  g.contrast += (1.02 - g.contrast) * m;
  g.lift.lerp(tmp.setRGB(0.004, 0.008, 0.011), m);
  g.gain.lerp(tmp.setRGB(0.97, 1.0, 1.03), m);
  return s;
}
