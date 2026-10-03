import * as THREE from 'three';
import { directionFromBearing } from '../core/Solar';
import { smoothstep } from '../core/Random';

/**
 * Weather, a layer over the time of day (MONSOON.md). The time of day sets the hour and the sun; the
 * weather darkens and greys the light, rains, wets the world, roughens the sea, opens the umbrellas.
 * One preset for now: the Mumbai monsoon (a steady rain with heavier bursts and lulls).
 */
export type WeatherPreset = 'clear' | 'monsoon';

export const WEATHER_ORDER: WeatherPreset[] = ['clear', 'monsoon'];

export const WEATHER_LABEL: Record<WeatherPreset, string> = {
  clear: 'Clear',
  monsoon: 'Mumbai Monsoon',
};

/** A small tileable value-noise texture (R), for puddles and streaks in the wet shaders. */
function noiseTexture(size = 256): THREE.DataTexture {
  const g = 16;
  const grid = new Float32Array(g * g).map(() => Math.random());
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const sample = (x: number, y: number, cells: number) => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const ux = tx * tx * (3 - 2 * tx);
    const uy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => grid[(j % cells) * g + (i % cells)];
    return lerp(lerp(at(ix, iy), at(ix + 1, iy), ux), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), ux), uy);
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = sample(x, y, 4) * 0.5 + sample(x, y, 8) * 0.3 + sample(x, y, 16) * 0.2;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** A transform that puts every point outside the unit box (an unused dry box). */
const NOWHERE = new THREE.Matrix4().makeTranslation(1e6, 0, 0);

/**
 * Uniforms shared by every weather-aware shader. The objects are shared, so one write here reaches
 * every material (the same way the ambient volume's uniforms are shared).
 */
export const WX = {
  /** Surface wetness, 0 dry … 1 soaked. */
  uWet: { value: 0 },
  /** Rain falling now, 0 … 1 (a heavy burst). */
  uRain: { value: 0 },
  /** Seconds, for ripples and drops. */
  uRainTime: { value: 0 },
  /** World → unit box for up to two dry interiors (the coach being ridden, the auto's cabin). */
  uDry: { value: [NOWHERE.clone(), NOWHERE.clone()] },
  uWetNoise: { value: null as THREE.Texture | null },
  /** People: monsoon (clothing), umbrellas open (0–1), heavy rain, unused. */
  uCrowdRain: { value: new THREE.Vector4() },
};

/** Read by systems that change behaviour in rain (crowds, traffic, the sea). */
export const WEATHER = {
  preset: 'clear' as WeatherPreset,
  /** How far the monsoon has set in (0 clear … 1), eased over a few seconds when it changes. */
  amount: 0,
  rain: 0,
  heavy: 0,
  /** Wind (m/s) towards the east-north-east: the south-west monsoon off the Arabian Sea. */
  wind: new THREE.Vector2(),
  windSpeed: 0,
  /** Rough sea, 0 … 1. */
  sea: 0,
};

/** Drives the monsoon's rain: a steady fall that drifts heavier and lighter, with bursts. */
export class Weather {
  private target = 0;
  private t = 0;
  private burst = { start: 20, dur: 30, peak: 1 };
  private readonly windDir = new THREE.Vector3();

  constructor() {
    WX.uWetNoise.value = noiseTexture();
    // Blowing from the west-south-west (≈250°) towards ≈70°.
    directionFromBearing(70, 0, this.windDir);
  }

  get preset(): WeatherPreset {
    return WEATHER.preset;
  }

  set(preset: WeatherPreset, instant = false): void {
    WEATHER.preset = preset;
    this.target = preset === 'monsoon' ? 1 : 0;
    if (instant) WEATHER.amount = this.target;
  }

  /** Marks a dry interior (car-local box `size` centred at `centre`, placed by `frame`), or clears it. */
  setDry(slot: 0 | 1, frame: THREE.Matrix4 | null, centre?: THREE.Vector3, half?: THREE.Vector3): void {
    const m = WX.uDry.value[slot];
    if (!frame || !centre || !half) {
      m.copy(NOWHERE);
      return;
    }
    m.copy(frame).multiply(new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z)).multiply(new THREE.Matrix4().makeScale(half.x, half.y, half.z)).invert();
  }

  update(dt: number): void {
    this.t += dt;
    const W = WEATHER;
    const k = 1 - Math.exp(-dt / 2.2);
    W.amount += (this.target - W.amount) * k;
    if (Math.abs(W.amount - this.target) < 0.002) W.amount = this.target;
    // The fall: drifting between a moderate and a heavy rain over minutes, a burst now and then.
    const t = this.t;
    const base = 0.52 + 0.16 * Math.sin(t * 0.021) + 0.1 * Math.sin(t * 0.057 + 1.3) + 0.05 * Math.sin(t * 0.31);
    const b = this.burst;
    if (t > b.start + b.dur) {
      b.start = t + 35 + Math.random() * 75;
      b.dur = 18 + Math.random() * 28;
      b.peak = 0.85 + Math.random() * 0.15;
    }
    const env = smoothstep(b.start, b.start + 7, t) * (1 - smoothstep(b.start + b.dur - 9, b.start + b.dur, t));
    const rain = Math.max(0.28, base + (b.peak - base) * env);
    W.rain = W.amount * rain;
    W.heavy = W.amount * smoothstep(0.7, 0.92, rain);
    const gust = 0.75 + 0.25 * Math.sin(t * 0.43) * Math.sin(t * 0.17 + 2.1) + 0.2 * env;
    W.windSpeed = W.amount * (3.5 + 5 * rain) * gust;
    W.wind.set(this.windDir.x, this.windDir.z).multiplyScalar(W.windSpeed);
    W.sea = W.amount * (0.8 + 0.2 * smoothstep(0.6, 0.95, rain));
    WX.uWet.value = W.amount;
    WX.uRain.value = W.rain;
    WX.uRainTime.value = t;
    WX.uCrowdRain.value.set(W.amount, smoothstep(0.15, 0.6, W.rain / Math.max(W.amount, 0.01)) * W.amount, W.heavy, 0);
  }
}
