import * as THREE from 'three';
import { RNG } from '../../core/Random';
import { addShaderPatch, type AmbientVolume } from '../../gfx/AmbientVolume';
import { WEATHER, WX } from '../../gfx/Weather';
import { RAIN_DECL } from '../../gfx/Wet';
import { DEVA, LATIN } from '../../gfx/Signage';
import type { StationMaterials } from '../../world/churchgate/StationMaterials';
import { Riders } from '../crowd/Riders';
import { POSE, man, type Look } from '../crowd/Looks';
import { BLACK, Parts, SHELL, buildShell, rearOutline, walls, wheelGeometry, windowHoles, type RGB } from './AutoShell';

/**
 * The auto you ride (AUTO_RIDE.md §4): a Mumbai black-and-yellow auto-rickshaw of the Bajaj RE kind,
 * after the reference photos in assets/auto (exterior 1–6, interior 1–5). Black lower body and nose
 * with twin headlamps, the yellow cowl and windscreen frame, a black rexine hood with white piping and
 * a quilted liner (a pink LED strip along its front edge), round mirrors on stalks, the driver on his
 * seat behind the handlebar, the steel rail behind him, the passenger bench, the bar across the right
 * side (you get in and out on the left), the digital fare meter on its bracket at the driver's left,
 * turned to the passenger, the plate "MH 04", a sticker strip across the top of the windscreen.
 *
 * The body is the one every auto in the streets has (AutoShell); this one adds the cabin, glass,
 * lamps that light, the textured plates and stickers, and wheels that turn.
 *
 * Frame: +z forward, +x left, y up, ground at y = 0, centred between the axles. The body sits on
 * its springs (pitch, roll, heave); the wheels turn, the front one steers.
 */

const KHAKI = 0xa8915f;

/** Dimensions (m). */
export const AUTO = {
  length: 2.64,
  half: 0.66,
  wheelbase: 1.95,
  wheelR: SHELL.wheelR,
  /** The passenger's eyes when seated (slightly to the left of centre), in the body frame. */
  eye: new THREE.Vector3(0.1, 1.4, -0.6),
  /** The left doorway (centre at standing eye height outside, and just inside). */
  doorOut: new THREE.Vector3(1.15, 1.62, -0.35),
  doorIn: new THREE.Vector3(0.42, 1.2, -0.42),
  /** Bench cushion top. */
  benchY: 0.72,
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function quiltTexture(base: string, line: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = base;
  c.fillRect(0, 0, 256, 256);
  const rng = new RNG(31);
  // Puffed diamonds: a soft highlight in each, stitched lines between.
  for (let i = -1; i < 9; i++)
    for (let j = -1; j < 9; j++) {
      const x = i * 32 + (j % 2) * 16;
      const y = j * 32;
      const g = c.createRadialGradient(x + 16, y + 10, 2, x + 16, y + 16, 22);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x + 16, y);
      c.lineTo(x + 32, y + 16);
      c.lineTo(x + 16, y + 32);
      c.lineTo(x, y + 16);
      c.closePath();
      c.fill();
    }
  c.strokeStyle = line;
  c.lineWidth = 1.5;
  c.setLineDash([3, 3]);
  for (let k = -256; k < 512; k += 32) {
    c.beginPath();
    c.moveTo(k, 0);
    c.lineTo(k + 256, 256);
    c.stroke();
    c.beginPath();
    c.moveTo(k + 256, 0);
    c.lineTo(k, 256);
    c.stroke();
  }
  for (let i = 0; i < 300; i++) {
    c.fillStyle = `rgba(0,0,0,${rng.range(0.02, 0.06)})`;
    c.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(1, 6), rng.range(1, 6));
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function plateTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f2c81a';
  c.fillRect(0, 0, 256, 96);
  c.strokeStyle = '#111';
  c.lineWidth = 5;
  c.strokeRect(4, 4, 248, 88);
  c.fillStyle = '#111';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `800 34px ${LATIN}`;
  c.fillText('MH 04', 128, 30);
  c.fillText('GN 2758', 128, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stickerTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 64;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 512, 0);
  g.addColorStop(0, '#d32f2f');
  g.addColorStop(0.5, '#ff6f00');
  g.addColorStop(1, '#d32f2f');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 64);
  c.fillStyle = '#fff6c8';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `700 36px ${DEVA}`;
  c.fillText('॥ श्री गणेशाय नमः ॥', 256, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tufted maroon rexine: pleats, piping, a sheen. */
function seatTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#5a1411';
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) {
    const g = c.createLinearGradient(i * 32, 0, i * 32 + 32, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(0.5, 'rgba(255,200,190,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = g;
    c.fillRect(i * 32, 0, 32, 256);
  }
  c.fillStyle = 'rgba(230,205,170,0.9)';
  c.fillRect(0, 0, 256, 5);
  c.fillRect(0, 251, 256, 5);
  const rng = new RNG(77);
  for (let i = 0; i < 160; i++) {
    c.fillStyle = `rgba(0,0,0,${rng.range(0.03, 0.1)})`;
    c.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(2, 12), rng.range(1, 3));
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ribbed black rubber floor mat, scuffed. */
function matTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#1a1a1b';
  c.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    c.fillStyle = '#2e2e30';
    c.fillRect(0, y, 128, 3);
    c.fillStyle = '#0c0c0d';
    c.fillRect(0, y + 3, 128, 1);
  }
  const rng = new RNG(78);
  for (let i = 0; i < 90; i++) {
    c.fillStyle = `rgba(150,140,120,${rng.range(0.05, 0.2)})`;
    c.fillRect(rng.range(0, 128), rng.range(0, 128), rng.range(2, 10), rng.range(1, 4));
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/** A small devotional picture in a gilt frame (a haloed figure, flowers; generic). */
function pictureTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 80;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(32, 30, 4, 32, 36, 44);
  g.addColorStop(0, '#ffe08a');
  g.addColorStop(1, '#c2410c');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 80);
  c.fillStyle = '#fff3c4';
  c.beginPath();
  c.arc(32, 28, 14, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#e65100';
  c.beginPath();
  c.ellipse(32, 52, 15, 20, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#6d3a14';
  c.beginPath();
  c.arc(32, 29, 7, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#d4a017';
  c.lineWidth = 6;
  c.strokeRect(3, 3, 58, 74);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The fare chart card and a no-smoking sticker side by side. */
function stickerCards(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff7d1';
  c.fillRect(0, 0, 330, 128);
  c.fillStyle = '#b71c1c';
  c.font = `700 22px ${DEVA}`;
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillText('भाडे पत्रक · FARE CARD', 10, 6);
  c.fillStyle = '#222';
  c.font = `400 16px ${LATIN}`;
  const rows = ['1.5 km  ₹26 · then ₹17.14/km', 'Night (12–5 am) +25%', 'Luggage ₹6 per piece', 'Helpline: RTO Thane'];
  rows.forEach((r, i) => c.fillText(r, 10, 36 + i * 22));
  c.fillStyle = '#ffffff';
  c.fillRect(344, 0, 168, 128);
  c.strokeStyle = '#d32f2f';
  c.lineWidth = 10;
  c.beginPath();
  c.arc(428, 64, 46, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#333';
  c.fillRect(392, 58, 70, 12);
  c.strokeStyle = '#d32f2f';
  c.beginPath();
  c.moveTo(396, 32);
  c.lineTo(460, 96);
  c.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The fare meter's face: dark housing, red seven-segment style readings (repainted when they change). */
class MeterFace {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private last = '';

  constructor() {
    this.canvas.width = 256;
    this.canvas.height = 320;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw(0, 0, false);
  }

  draw(fare: number, waitS: number, hired: boolean): void {
    const k = `${fare.toFixed(2)}|${Math.floor(waitS / 60)}:${Math.floor(waitS % 60)}|${hired}`;
    if (k === this.last) return;
    this.last = k;
    const c = this.canvas.getContext('2d')!;
    const W = 256;
    const H = 320;
    c.fillStyle = '#16171a';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#2a2c31';
    c.fillRect(10, 10, W - 20, H - 20);
    // Brand strip and labels (fictional maker).
    c.fillStyle = '#c62828';
    c.fillRect(22, 22, W - 44, 34);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 22px ${LATIN}`;
    c.fillText('MEGHA  TAXIMETER', W / 2, 40);
    // Readout windows.
    const win = (y: number, h: number) => {
      c.fillStyle = '#080404';
      c.fillRect(24, y, W - 48, h);
    };
    win(70, 92);
    win(176, 56);
    c.fillStyle = '#d9d9d9';
    c.textAlign = 'left';
    c.font = `700 15px ${LATIN}`;
    c.fillText('FARE ₹', 30, 80);
    c.fillText('WAIT', 30, 186);
    c.fillText('HIRED', 30, 258);
    c.fillText('STOP', 128, 258);
    // Digits, glowing red.
    c.shadowColor = '#ff2a10';
    c.shadowBlur = 12;
    c.fillStyle = hired ? '#ff3a1c' : '#5a1208';
    c.textAlign = 'right';
    c.font = `700 64px "Noto Sans", monospace`;
    c.fillText(hired ? fare.toFixed(2) : '- - -', W - 30, 124);
    c.font = `700 40px "Noto Sans", monospace`;
    const m = Math.floor(waitS / 60);
    const sec = Math.floor(waitS % 60);
    c.fillText(hired ? `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : '00:00', W - 30, 206);
    c.shadowBlur = 0;
    // HIRED / STOP lamps.
    c.fillStyle = hired ? '#ff9a1c' : '#3a2410';
    c.beginPath();
    c.arc(96, 258, 8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = !hired ? '#2bd94a' : '#10301a';
    c.beginPath();
    c.arc(184, 258, 8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#777';
    c.textAlign = 'center';
    c.font = `400 12px ${LATIN}`;
    c.fillText('Approved · Govt. of Maharashtra', W / 2, 296);
    this.texture.needsUpdate = true;
  }
}

/** The wiper: pivot (body-local), arm length, parked angle (in the screen's plane, from +x) and sweep. */
const WIPE = { pivot: [0.18, 1.08, 0.955] as const, len: 0.58, rest: Math.atan2(0.42, -0.4), sweep: 1.55 };
const WIPE_BINS = 16;

/**
 * Rain on the auto's glass (MONSOON.md §6): beads of water gathering on the windscreen and the clear
 * vinyl windows, catching the light; where the wiper has just passed the screen is clear and the
 * drops gather again until the next sweep. Beyond its arc they come and go on their own.
 */
function rainOnGlass(glass: THREE.MeshStandardMaterial, wipe: { uWipePass: { value: number[] }; uWipeOn: { value: number } }): void {
  addShaderPatch(glass, 'rain-glass', (shader) => {
    Object.assign(shader.uniforms, wipe, { uRain: WX.uRain, uRainTime: WX.uRainTime });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlassP;\nvarying vec3 vGlassN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlassP = position;\nvGlassN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGlassP;
        varying vec3 vGlassN;
        uniform float uWipePass[${WIPE_BINS}];
        uniform float uWipeOn;
        ${RAIN_DECL}
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float gDrop = 0.0;
        float gRim = 0.0;
        float gHi = 0.0;
        if (uWipeOn > 0.01) {
          vec3 an = abs(vGlassN);
          vec2 gp = an.z > 0.5 ? vGlassP.xy : an.x > 0.5 ? vGlassP.zy : vGlassP.xy;
          // How long since this part of the screen was last wiped (or a slow come-and-go elsewhere).
          vec2 rel = vGlassP.xy - vec2(${WIPE.pivot[0]}, ${WIPE.pivot[1]});
          float ang = ${WIPE.rest.toFixed(4)} - atan(rel.y, rel.x);
          float rr = length(rel);
          bool screen = an.z > 0.5 && vGlassP.z > 0.5;
          float age = 1e3;
          if (screen && rr > 0.05 && rr < ${WIPE.len + 0.02} && ang >= 0.0 && ang <= ${WIPE.sweep.toFixed(3)}) {
            int bin = int(clamp(ang / ${WIPE.sweep.toFixed(3)} * ${WIPE_BINS}.0, 0.0, ${WIPE_BINS - 1}.0));
            for (int i = 0; i < ${WIPE_BINS}; i++) if (i == bin) age = uRainTime - uWipePass[i];
          }
          float fill = 1.6 / (0.15 + uRain);
          for (int l = 0; l < 2; l++) {
            float sc = l == 0 ? 0.012 : 0.0075;
            vec2 q = gp / sc + float(l) * 0.37;
            vec2 cell = floor(q);
            vec2 f = fract(q) - 0.5;
            float h = gHash(cell + float(l) * 7.1);
            float here = age < 900.0 ? step(h * fill, age) : step(fract(uRainTime * (0.05 + 0.08 * h) + h * 3.7), 0.55 + 0.3 * uRain);
            here *= step(fract(h * 17.3), 0.5 + 0.4 * uRain);
            vec2 c = (vec2(fract(h * 3.1), fract(h * 5.7)) - 0.5) * 0.45;
            float r = 0.15 + 0.2 * fract(h * 7.9);
            vec2 dv = (f - c) * vec2(1.0, 0.85) / r;
            float d = length(dv);
            float inside = (1.0 - smoothstep(0.8, 1.0, d)) * here;
            // A bead of water: clear in the middle, a dark rim where it bends the light, a highlight.
            gDrop = max(gDrop, inside);
            gRim = max(gRim, inside * smoothstep(0.5, 0.95, d));
            gHi = max(gHi, inside * (1.0 - smoothstep(0.0, 0.32, length(dv - vec2(-0.32, 0.36)))));
          }
          gDrop *= uWipeOn;
          gRim *= uWipeOn;
          gHi *= uWipeOn;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.13, 0.14), gRim * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gHi * 0.85);
        diffuseColor.a = mix(diffuseColor.a, 0.5, max(gRim * 0.7, gHi * 0.9)) + gDrop * 0.06;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.0, gDrop);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.5) * gHi * gHi;');
  });
}

export class HeroAuto {
  /** On the ground under the auto's centre, turned to its heading (the owner sets position, rotation.y). */
  readonly root = new THREE.Group();
  /** On its springs: pitch (nose up +), roll (left side down +), heave. */
  readonly body = new THREE.Group();
  readonly driver: Riders;
  readonly driverLook: Look;
  private readonly steer = new THREE.Group();
  private readonly handlebar = new THREE.Group();
  private readonly frontWheel: THREE.Mesh;
  private readonly rearWheels: THREE.Mesh[] = [];
  private readonly meter = new MeterFace();
  private readonly headMat: THREE.MeshStandardMaterial;
  private readonly tailMat: THREE.MeshStandardMaterial;
  private readonly ledMat: THREE.MeshStandardMaterial;
  private readonly meterMat: THREE.MeshStandardMaterial;
  private readonly beam: THREE.SpotLight;
  private spin = 0;
  /** Where the driver is looking (radians, + left). */
  driverHead = 0;
  /** The windscreen wiper (pivot group) and its sweep: the blade's angle, when it last passed each part of the glass. */
  private readonly wiper = new THREE.Group();
  private readonly wipe = { uWipePass: { value: new Array(WIPE_BINS).fill(-100) }, uWipeOn: { value: 0 } };
  private wipeT = 0;
  private wipeLast = 0;
  private wipeStage = 0;
  /** Sweeps so far (each end of the arc), for the sound. */
  wipes = 0;

  constructor(mats: StationMaterials, av: AmbientVolume) {
    this.root.name = 'hero-auto';
    this.root.add(this.body);
    const reg = (name: string, m: THREE.MeshStandardMaterial, macro = 0) => mats.add(name, m, macro) as THREE.MeshStandardMaterial;
    const paint = reg('autoPaint', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.12, side: THREE.DoubleSide }));
    const rexine = reg('autoRexine', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.02, side: THREE.DoubleSide }), 0.15);
    const metal = reg('autoMetal', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85 }));
    const liner = reg('autoLiner', new THREE.MeshStandardMaterial({ map: quiltTexture('#1d2b78', 'rgba(170,190,255,0.55)'), roughness: 0.62 }));
    (liner.map as THREE.Texture).repeat.set(2.4, 2.4);
    const glass = new THREE.MeshStandardMaterial({ color: 0xa8bcc8, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
    mats.add('autoGlass', glass);
    rainOnGlass(glass, this.wipe);
    const mirror = new THREE.MeshStandardMaterial({ color: 0x6f777e, roughness: 0.12, metalness: 1 });
    mats.add('autoMirror', mirror);
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xdedcd2, emissive: 0xfff1d0, emissiveIntensity: 0.05, roughness: 0.15, metalness: 0.4 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0805, emissive: 0xff2010, emissiveIntensity: 0.1, roughness: 0.3 });
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x401020, emissive: 0xff3c9a, emissiveIntensity: 0.6, roughness: 0.4 });
    this.meterMat = new THREE.MeshStandardMaterial({ color: 0x222222, map: this.meter.texture, emissive: 0xffffff, emissiveMap: this.meter.texture, emissiveIntensity: 0.9, roughness: 0.35 });
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 });
    const stickerMat = new THREE.MeshStandardMaterial({ map: stickerTexture(), roughness: 0.5, transparent: true, opacity: 0.92 });
    for (const [n, m] of [
      ['autoPlate', plateMat],
      ['autoSticker', stickerMat],
    ] as const)
      mats.add(n, m);

    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.body, shadow = true) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // ---- The body, shared with the other autos (AutoShell): paint, the hood, bright trim ------------
    const shell = { paint: new Parts(), hood: new Parts(), trim: new Parts() };
    buildShell('hero', shell);
    add(shell.paint.build(), paint);
    add(shell.hood.build(), rexine);
    add(shell.trim.build(), metal);
    const W = SHELL.ws;
    const tube: RGB = [0.04, 0.04, 0.045];
    // The roof rails inside the hood's skirt, the rail behind the driver (passengers hold it) and the
    // bar across the right-hand side.
    const F = new Parts();
    for (const s of [-1, 1]) F.rod(V(s * 0.63, 1.62, 0.88), V(s * 0.63, 1.62, -1.2), 0.02, tube);
    F.rod(V(-0.6, 0.98, 0.13), V(0.6, 0.98, 0.13), 0.019, [0.62, 0.62, 0.6]);
    F.rod(V(-0.63, 0.86, -0.55), V(-0.63, 0.86, 0.12), 0.017, [0.62, 0.62, 0.6]);
    add(F.build(), paint);
    // Mirror faces on their black backs.
    const M = SHELL.mirror;
    for (const s of [-1, 1]) add(new THREE.CircleGeometry(M.r - 0.005, 18).rotateY(Math.PI).translate(s * M.x, M.y, M.z - 0.016), mirror, this.body, false);
    // Windscreen and its wiper, the sticker strip across its top.
    const ws = new THREE.PlaneGeometry(1.1, W.y1 - W.y0 - 0.06);
    ws.rotateX(-0.11).translate(0, (W.y0 + W.y1) / 2 + 0.01, (W.z0 + W.z1) / 2);
    add(ws, glass, this.body, false);
    add(new THREE.PlaneGeometry(1.08, 0.08).rotateY(Math.PI).rotateX(0.11).translate(0, W.y1 - 0.08, W.z1 + 0.01), stickerMat, this.body, false);
    // The wiper: an arm and its blade on a pivot below the screen, parked up to the left; it sweeps in
    // the rain (updateWiper).
    const arm = new Parts().rod(V(0, 0, 0), V(Math.cos(WIPE.rest) * WIPE.len, Math.sin(WIPE.rest) * WIPE.len, 0), 0.008, BLACK).build();
    this.wiper.position.set(WIPE.pivot[0], WIPE.pivot[1], WIPE.pivot[2]);
    this.wiper.rotation.order = 'XYZ';
    this.wiper.rotation.x = -0.11;
    this.body.add(this.wiper);
    add(arm, paint, this.wiper);

    // ---- The hood's finish: white piping, the quilted liner, the LED strip, clear vinyl windows -----
    const roofY = SHELL.hood.y1 - 0.06;
    const hw = SHELL.hw;
    const back = SHELL.hood.back;
    const sw = SHELL.sideWin;
    const bw = SHELL.backWin;
    const pipe = new Parts();
    const white: RGB = [0.85, 0.85, 0.82];
    const pr = 0.007;
    for (const s of [-1, 1]) {
      const x = s * (hw + 0.004);
      // Along the skirt over the openings, down the quarter's front edge, round its window.
      pipe.rod(V(x, SHELL.hood.y0 + 0.075, 0.95), V(x, SHELL.hood.y0 + 0.075, SHELL.quarterZ), pr, white, 4);
      pipe.rod(V(x, SHELL.beltY + 0.04, SHELL.quarterZ), V(x, SHELL.hood.y0 + 0.075, SHELL.quarterZ), pr, white, 4);
      pipe.rod(V(x, sw.y0, sw.z0), V(x, sw.y0, sw.z1), pr, white, 4);
      pipe.rod(V(x, sw.y1, sw.z0), V(x, sw.y1, sw.z1), pr, white, 4);
      pipe.rod(V(x, sw.y0, sw.z0), V(x, sw.y1, sw.z0), pr, white, 4);
      pipe.rod(V(x, sw.y0, sw.z1), V(x, sw.y1, sw.z1), pr, white, 4);
    }
    for (const y of [bw.y0, bw.y1]) pipe.rod(V(-bw.x, y, back - 0.004), V(bw.x, y, back - 0.004), pr, white, 4);
    for (const x of [-bw.x, bw.x]) pipe.rod(V(x, bw.y0, back - 0.004), V(x, bw.y1, back - 0.004), pr, white, 4);
    add(pipe.build(), paint, this.body, false);
    // The liner, quilted (uv in metres): under the roof, and inside the quarters and the back.
    const lin = new THREE.PlaneGeometry(1.22, 2.18);
    const luv = lin.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < luv.count; i++) luv.setXY(i, luv.getX(i) * 1.22, luv.getY(i) * 2.18);
    lin.rotateX(Math.PI / 2).translate(0, roofY, -0.16);
    add(lin, liner, this.body, false);
    const inset = hw - 0.018;
    const inner = rearOutline(inset, SHELL.quarterZ, back + 0.018, SHELL.hood.r - 0.018, 5).reverse();
    add(walls(inner, SHELL.beltY + 0.03, SHELL.hood.y0 + 0.1, windowHoles(inset, back + 0.018)), liner, this.body, false);
    // Pink LED strip along the front of the hood, above the driver, and down its sides.
    add(new THREE.BoxGeometry(1.14, 0.016, 0.016).translate(0, W.y1 - 0.06, W.z1 - 0.06), this.ledMat, this.body, false);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.016, 0.016, 1.9).translate(s * 0.6, roofY - 0.06, -0.15), this.ledMat, this.body, false);
    // Windows (clear vinyl) in the quarters and the back.
    for (const s of [-1, 1]) add(new THREE.PlaneGeometry(sw.z1 - sw.z0, sw.y1 - sw.y0).rotateY((s * Math.PI) / 2).translate(s * (hw - 0.004), (sw.y0 + sw.y1) / 2, (sw.z0 + sw.z1) / 2), glass, this.body, false);
    add(new THREE.PlaneGeometry(bw.x * 2, bw.y1 - bw.y0).translate(0, (bw.y0 + bw.y1) / 2, back + 0.004), glass, this.body, false);

    // ---- Seats, the dash, the floor of the cabin ------------------------------------------------
    const S = new Parts();
    const maroon: RGB = [0.28, 0.06, 0.05];
    // Passenger bench: cushion with a rolled front edge, the backrest leaning back, the base panel.
    // (The cushion and backrest are tufted rexine, below; here the base and the side bolsters.)
    S.box(1.16, 0.31, 0.44, 0, 0.51, -0.72, [0.06, 0.06, 0.06]);
    for (const sx of [-1, 1]) S.box(0.06, 0.16, 0.46, sx * 0.6, AUTO.benchY - 0.03, -0.7, [0.05, 0.05, 0.05]);
    void maroon;
    // The driver's seat on its pedestal, with a hump of a backrest.
    S.box(0.5, 0.1, 0.38, 0, 0.69, 0.4, [0.06, 0.06, 0.07]);
    S.box(0.42, 0.24, 0.07, 0, 0.84, 0.2, [0.06, 0.06, 0.07], -0.12);
    S.box(0.3, 0.32, 0.3, 0, 0.5, 0.42, [0.08, 0.08, 0.08]);
    // The dash: teal-green inside the cowl (interior photos 4, 5), the cluster.
    const teal: RGB = [0.07, 0.3, 0.26];
    S.box(1.12, 0.5, 0.04, 0, 0.74, 0.85, teal, -0.2);
    S.box(1.1, 0.04, 0.12, 0, 0.98, 0.88, teal);
    for (const s of [-1, 1]) S.box(0.04, 0.6, 0.28, s * 0.57, 0.66, 0.75, teal);
    add(S.build(), rexine);

    // ---- The cabin's finish: tufted bench, rubber mat, frame hoops, the driver's things -------------
    const seatMat = reg('autoSeat', new THREE.MeshStandardMaterial({ map: seatTexture(), roughness: 0.4, metalness: 0.02 }));
    const cushion = new THREE.BoxGeometry(1.12, 0.11, 0.44, 1, 1, 1);
    add(cushion.translate(0, AUTO.benchY - 0.05, -0.7), seatMat);
    add(new THREE.CylinderGeometry(0.058, 0.058, 1.12, 12).rotateZ(Math.PI / 2).translate(0, AUTO.benchY - 0.055, -0.48), seatMat);
    add(new THREE.BoxGeometry(1.12, 0.5, 0.11).rotateX(0.16).translate(0, 1.0, -0.98), seatMat);
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.12, 12).rotateZ(Math.PI / 2).translate(0, 1.255, -1.02), seatMat);
    // Ribbed rubber mat on the floor, an aluminium strip at the doorway's step.
    const matMat = reg('autoMat', new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.9 }));
    add(new THREE.PlaneGeometry(1.14, 1.0).rotateX(-Math.PI / 2).translate(0, 0.37, -0.12), matMat, this.body, false);
    add(new Parts().box(0.05, 0.02, 0.72, 0.6, 0.372, -0.18, [0.7, 0.72, 0.74]).build(), metal, this.body, false);
    // The hood's frame: hoops across under the liner, a chrome handle by the doorway.
    const hoops = new Parts();
    for (const z of [-0.28, -0.88]) hoops.tube([V(-0.6, 1.64, z), V(-0.4, 1.675, z), V(0, 1.69, z), V(0.4, 1.675, z), V(0.6, 1.64, z)], 0.013, [0.05, 0.05, 0.05]);
    hoops.tube([V(0.6, 1.2, -0.56), V(0.53, 1.24, -0.56), V(0.53, 1.44, -0.56), V(0.6, 1.48, -0.56)], 0.012, [0.7, 0.7, 0.68]);
    add(hoops.build(), metal, this.body, false);
    // A towel over the driver's seat back.
    const towel = new Parts();
    towel.box(0.36, 0.3, 0.012, 0, 0.86, 0.165, [0.85, 0.85, 0.8], -0.12);
    for (let k = 0; k < 4; k++) towel.box(0.36, 0.022, 0.014, 0, 0.75 + k * 0.07, 0.162, [0.75, 0.2, 0.18], -0.12);
    add(towel.build(), rexine, this.body, false);
    // On the dash: a framed picture with a marigold string; from the windscreen, lemon and chillies.
    const dash = new Parts();
    dash.box(0.13, 0.16, 0.015, 0.1, 1.08, 0.885, [0.75, 0.55, 0.15], -0.2);
    for (let k = 0; k < 9; k++) {
      const a = (k / 8) * Math.PI;
      dash.add(new THREE.SphereGeometry(0.013, 6, 4).translate(0.1 + Math.cos(a) * 0.08, 1.0 + Math.sin(a) * 0.1, 0.875), k % 2 ? [0.95, 0.55, 0.05] : [0.98, 0.78, 0.1]);
    }
    dash.rod(V(0, 1.6, 0.86), V(0, 1.43, 0.86), 0.003, [0.85, 0.85, 0.8], 3);
    dash.add(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 0.85, 1).translate(0, 1.4, 0.86), [0.92, 0.85, 0.15]);
    for (let k = 0; k < 6; k++) dash.add(new THREE.ConeGeometry(0.008, 0.075, 5).rotateX(Math.PI).translate(-0.03 + k * 0.012, 1.34, 0.86), [0.15, 0.5, 0.1]);
    add(dash.build(), rexine, this.body, false);
    const pic = new THREE.MeshStandardMaterial({ map: pictureTexture(), roughness: 0.5, emissive: 0x332211, emissiveIntensity: 0.2 });
    mats.add('autoPicture', pic);
    add(new THREE.PlaneGeometry(0.11, 0.14).rotateY(Math.PI).rotateX(0.2).translate(0.1, 1.08, 0.876), pic, this.body, false);
    // The fare chart and a no-smoking sticker on the rail behind the driver, facing you.
    const stick = new THREE.MeshStandardMaterial({ map: stickerCards(), roughness: 0.6 });
    mats.add('autoCards', stick);
    const cards = new THREE.PlaneGeometry(0.42, 0.105);
    cards.rotateY(Math.PI).translate(-0.12, 1.06, 0.115);
    add(cards, stick, this.body, false);

    // ---- Steering: column, handlebar with grips, speedometer pod ----------------------------------
    this.handlebar.position.set(0, 1.0, 0.72);
    this.body.add(this.handlebar);
    const HB = new Parts();
    HB.rod(V(0, -0.62, 0.22), V(0, 0, 0), 0.025, [0.1, 0.1, 0.1]);
    HB.tube([V(-0.34, 0.03, -0.05), V(-0.2, 0.02, 0.02), V(0, 0.01, 0.03), V(0.2, 0.02, 0.02), V(0.34, 0.03, -0.05)], 0.014, [0.55, 0.55, 0.55]);
    for (const s of [-1, 1]) HB.rod(V(s * 0.3, 0.03, -0.035), V(s * 0.38, 0.035, -0.07), 0.021, [0.05, 0.05, 0.05]);
    HB.box(0.16, 0.1, 0.07, 0, 0.06, 0.03, [0.05, 0.05, 0.05]);
    add(HB.build(), metal, this.handlebar);
    add(new THREE.CircleGeometry(0.035, 16).rotateY(Math.PI).rotateX(-0.3).translate(0, 0.07, -0.006), this.headMat, this.handlebar, false);

    // ---- Lamps, plates -------------------------------------------------------------------------------
    const L = SHELL.headlamp;
    const T = SHELL.tail;
    for (const s of [-1, 1]) {
      add(new THREE.CircleGeometry(L.r - 0.016, 20).translate(s * L.x, L.y, L.z + 0.027), this.headMat, this.body, false);
      add(new THREE.BoxGeometry(T.w, T.h, 0.02).translate(s * T.x, T.y, T.z - 0.006), this.tailMat, this.body, false);
    }
    const PR = SHELL.plateRear;
    add(new THREE.PlaneGeometry(PR.w, PR.h).rotateY(Math.PI).translate(0, PR.y, PR.z - 0.004), plateMat, this.body, false);
    const PF = SHELL.plateFront;
    add(new THREE.PlaneGeometry(PF.w, PF.h).rotateX(PF.tilt).translate(0, PF.y, PF.z + 0.006), plateMat, this.body, false);

    // ---- The fare meter on its bracket, turned to the passenger -------------------------------------
    const meter = new THREE.Group();
    meter.position.set(0.44, 1.12, 0.2);
    meter.rotation.y = Math.PI - 0.5;
    meter.rotation.x = 0.12;
    this.body.add(meter);
    const MB = new Parts();
    MB.box(0.17, 0.22, 0.09, 0, 0, 0, [0.08, 0.08, 0.09]);
    MB.box(0.19, 0.03, 0.11, 0, 0.12, 0, [0.06, 0.06, 0.06]);
    add(MB.build(), paint, meter);
    add(new THREE.PlaneGeometry(0.15, 0.19).translate(0, -0.005, 0.046), this.meterMat, meter, false);
    add(new Parts().rod(V(0.44, 0.98, 0.15), V(0.44, 1.02, 0.18), 0.012, [0.3, 0.3, 0.3]).rod(V(0.44, 0.98, 0.15), V(0.6, 0.98, 0.13), 0.012, [0.3, 0.3, 0.3]).build(), metal);

    // ---- Wheels ------------------------------------------------------------------------------------
    const wheelGeo = wheelGeometry('hero');
    this.steer.position.set(0, AUTO.wheelR, SHELL.frontZ);
    this.root.add(this.steer);
    this.frontWheel = add(wheelGeo, metal, this.steer);
    add(new Parts().rod(V(0, 0, 0), V(0, 0.42, -0.1), 0.025, [0.08, 0.08, 0.08]).rod(V(0.07, 0, 0), V(0.05, 0.4, -0.1), 0.02, [0.5, 0.5, 0.5]).build(), metal, this.steer);
    for (const s of [-1, 1]) {
      const w = add(wheelGeo, metal, this.root);
      w.position.set(s * SHELL.rearX, AUTO.wheelR, SHELL.rearZ);
      this.rearWheels.push(w);
    }

    // ---- Headlamp beam at night --------------------------------------------------------------------
    this.beam = new THREE.SpotLight(0xfff0d0, 0, 28, 0.42, 0.55, 1.6);
    this.beam.position.set(0, SHELL.headlamp.y, SHELL.headlamp.z + 0.05);
    this.beam.target.position.set(0, 0, 9);
    this.beam.castShadow = false;
    this.body.add(this.beam, this.beam.target);

    // ---- The driver: khaki uniform, seated, hands on the bar ---------------------------------------
    this.driver = new Riders(av, 2, { lod: 0, shadows: true, indoor: true });
    this.body.add(this.driver.group);
    const look = man(new RNG(1979));
    look.top = KHAKI;
    look.bottom = 0x7d6c48;
    look.style = [2, 0, 0, 1];
    look.misc = [0, look.misc[1], 0, -Math.abs(look.misc[3] || 1)];
    look.hair = 0x141210;
    look.flags = [0, 0, 0, 0];
    look.bag = 0;
    this.driverLook = look;
  }

  /** Lamps by the light of day (0 day … 1 night), the meter's readings. */
  setLights(night: number, braking: boolean): void {
    this.headMat.emissiveIntensity = 0.05 + night * 3.2;
    this.tailMat.emissiveIntensity = 0.1 + night * 1.6 + (braking ? 2.2 : 0);
    this.ledMat.emissiveIntensity = 0.18 + night * 1.5;
    this.meterMat.emissiveIntensity = 0.75 + night * 0.4;
    this.beam.intensity = night > 0.15 ? night * 9 : 0;
  }

  /**
   * The wiper in the rain: steady sweeps in a downpour, now and then in a lighter fall, parked when it
   * is dry. Records when the blade crosses each part of its arc (the glass shader clears the drops there).
   */
  updateWiper(dt: number, time: number): void {
    const rain = WEATHER.rain;
    const on = WEATHER.amount > 0.3 && rain > 0.15;
    this.wipe.uWipeOn.value = WEATHER.amount;
    const period = 1.3;
    // Light rain: a sweep every few seconds; heavy: continuous.
    const pause = rain > 0.75 ? 0 : THREE.MathUtils.lerp(3.5, 0.6, rain / 0.75);
    if (on || this.wipeT > 0) {
      this.wipeT += dt;
      if (this.wipeT > period + (on ? pause : 0)) this.wipeT = on ? 0.0001 : 0;
    }
    const k = Math.min(1, this.wipeT / period);
    // The blade reaches each end of its arc (the sound counts them).
    const stage = this.wipeT <= 0 ? 0 : k < 0.5 ? 1 : k < 1 ? 2 : 3;
    if (stage !== this.wipeStage) {
      if (stage >= 2) this.wipes++;
      this.wipeStage = stage;
    }
    const s = (1 - Math.cos(k * Math.PI * 2)) / 2;
    const angle = s * WIPE.sweep;
    this.wiper.rotation.z = -angle;
    // Mark the bins the blade passed over since the last frame.
    const a0 = Math.min(angle, this.wipeLast);
    const a1 = Math.max(angle, this.wipeLast);
    if (a1 - a0 > 1e-4)
      for (let i = 0; i < WIPE_BINS; i++) {
        const b = ((i + 0.5) / WIPE_BINS) * WIPE.sweep;
        if (b >= a0 - 0.03 && b <= a1 + 0.03) this.wipe.uWipePass.value[i] = time;
      }
    this.wipeLast = angle;
  }

  setMeter(fare: number, waitS: number, hired: boolean): void {
    this.meter.draw(fare, waitS, hired);
  }

  /** Per frame: wheels turn with the distance covered, the front steers, the body sits on its springs. */
  update(ds: number, steer: number, pitch: number, roll: number, heave: number, time: number): void {
    this.spin += ds / AUTO.wheelR;
    this.frontWheel.rotation.x = this.spin;
    for (const w of this.rearWheels) w.rotation.x = this.spin;
    this.steer.rotation.y = steer;
    this.handlebar.rotation.y = steer * 0.9;
    this.body.position.y = heave;
    this.body.rotation.set(-pitch, 0, roll, 'YXZ');
    // The driver sits, hands on the bar, head where he looks.
    const D = this.driver;
    D.begin();
    D.put(this.driverLook, 0, 0.27, 0.36, 0, this.driverHead, 0, POSE.drive);
    D.end();
    void time;
  }
}
