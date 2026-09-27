import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeCanvas, type TextureFactory } from '../../gfx/TextureFactory';
import type { StationMaterials } from '../churchgate/StationMaterials';
import { LATIN } from '../../gfx/Signage';

/**
 * A group of signal heads that change together. V.N. Road junction: MD_NB, MD_SB, VN_WB, PED and
 * XING; the Air India junction uses the NP_ prefix. Any group ending in XING is the stop line just
 * before a zebra for vehicles already through the junction; any group ending in PED is the green man.
 */
export type SignalGroup = string;
export type Aspect = 'red' | 'amber' | 'green';

export interface Phase {
  dur: number;
  green?: SignalGroup[];
  amber?: SignalGroup[];
  flash?: SignalGroup[];
}

// One cycle of the V.N. Road / Marine Drive junction (seconds).
export const VN_PHASES: Phase[] = [
  { dur: 38, green: ['MD_NB', 'MD_SB'] },
  { dur: 3, amber: ['MD_NB', 'MD_SB'] },
  { dur: 2 },
  { dur: 17, green: ['VN_WB'] },
  { dur: 3, amber: ['VN_WB'] },
  { dur: 2 },
  { dur: 22, green: ['PED'] },
  { dur: 8, flash: ['PED'] },
  { dur: 3 },
];

export interface SignalDef {
  x: number;
  z: number;
  /** Heading the vehicle heads face (towards approaching traffic). */
  ry: number;
  /** Unit vector from the pole towards the road centre (mast arm, pedestrian head). */
  toRoad: [number, number];
  /** vehicle: head + countdown; ped: pedestrian head; post: both on one pole; both: post + mast arm. */
  kind: 'vehicle' | 'ped' | 'both' | 'post';
  group: SignalGroup;
  banded: boolean;
  y: number;
  /** Extra vehicle heads mounted back-to-back on the same pole (facing other approaches). */
  extra?: { ry: number; group: SignalGroup }[];
}

/** Timing of the junction; also answers "is it red?" for traffic and pedestrians. */
export class SignalController {
  private t = 0;
  offset = 0;
  private readonly cycle: number;
  private readonly pedIndex: number;
  private readonly pedStart: number;
  private readonly pedGroup: SignalGroup;

  constructor(private readonly phases: Phase[] = VN_PHASES) {
    this.cycle = phases.reduce((a, p) => a + p.dur, 0);
    this.pedIndex = phases.findIndex((q) => q.green?.some((g) => g.endsWith('PED')));
    this.pedGroup = this.pedIndex >= 0 ? phases[this.pedIndex].green!.find((g) => g.endsWith('PED'))! : 'PED';
    this.pedStart = phases.slice(0, Math.max(0, this.pedIndex)).reduce((a, p) => a + p.dur, 0);
  }

  update(dt: number): void {
    this.t += dt;
  }

  private phaseAt(): { i: number; into: number } {
    const CYCLE = this.cycle;
    let c = (((this.t + this.offset) % CYCLE) + CYCLE) % CYCLE;
    for (let i = 0; i < this.phases.length; i++) {
      if (c < this.phases[i].dur) return { i, into: c };
      c -= this.phases[i].dur;
    }
    return { i: 0, into: 0 };
  }

  aspect(g: SignalGroup): Aspect {
    const { i, into } = this.phaseAt();
    const p = this.phases[i];
    if (g.endsWith('XING')) {
      // Red from the green man until the crossing has cleared; amber in the all-red just before it.
      const ped = this.pedIndex;
      if (i >= ped) return 'red';
      return i === ped - 1 ? 'amber' : 'green';
    }
    if (p.green?.includes(g)) return 'green';
    if (p.amber?.includes(g)) return 'amber';
    if (p.flash?.includes(g)) return Math.floor(into * 2) % 2 === 0 ? 'green' : 'red';
    return 'red';
  }

  /** Pedestrians may start crossing (steady green man only). */
  pedWalk(): boolean {
    const { i } = this.phaseAt();
    return !!this.phases[i].green?.includes(this.pedGroup);
  }

  /**
   * A pedestrian may step off the kerb: the green man is steady and at least `window` seconds of
   * green and flashing green remain, so nobody is still on the zebra when the traffic moves.
   */
  pedCanStart(window: number): boolean {
    const { i, into } = this.phaseAt();
    const P = this.phases;
    if (!P[i].green?.includes(this.pedGroup)) return false;
    const flash = P[i + 1]?.flash?.includes(this.pedGroup) ? P[i + 1].dur : 0;
    return P[i].dur - into + flash >= window;
  }

  /** Seconds left in the current aspect of a group (for countdown timers). */
  remaining(g: SignalGroup): number {
    const now = this.aspect(g);
    let { i, into } = this.phaseAt();
    const P = this.phases;
    let left = P[i].dur - into;
    const same = (k: number) => {
      const p = P[k];
      const a: Aspect = p.green?.includes(g) || p.flash?.includes(g) ? 'green' : p.amber?.includes(g) ? 'amber' : 'red';
      return a === now || (now === 'red' && a === 'red');
    };
    for (let n = 1; n < P.length; n++) {
      i = (i + 1) % P.length;
      if (!same(i)) break;
      left += P[i].dur;
    }
    return left;
  }

  /** Makes the pedestrian phase start `seconds` from now. */
  pedGreenIn(seconds: number): void {
    const CYCLE = this.cycle;
    const cur = (((this.t + this.offset) % CYCLE) + CYCLE) % CYCLE;
    this.offset += this.pedStart - seconds - cur;
  }

  secondsToPedGreen(): number {
    const CYCLE = this.cycle;
    const cur = (((this.t + this.offset) % CYCLE) + CYCLE) % CYCLE;
    return (((this.pedStart - cur) % CYCLE) + CYCLE) % CYCLE;
  }
}

function housingGeo(lamps: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.34, 0.32 * lamps + 0.06, 0.24).translate(0, 0, -0.04)];
  for (let i = 0; i < lamps; i++) {
    const y = (i - (lamps - 1) / 2) * 0.32;
    const visor = new THREE.CylinderGeometry(0.14, 0.14, 0.18, 10, 1, true, -Math.PI / 2, Math.PI);
    visor.rotateX(Math.PI / 2);
    visor.translate(0, y + 0.02, 0.14);
    parts.push(visor);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

/** Signal poles, heads, pedestrian lamps and countdowns, driven by a controller. */
export class SignalVisuals {
  readonly group = new THREE.Group();
  private lamps: { mesh: THREE.InstancedMesh; halo: THREE.InstancedMesh; entries: { group: SignalGroup; color: 'red' | 'amber' | 'green'; ped: boolean }[] }[] = [];
  private countdown: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; last: string };
  private readonly slots: SignalGroup[];
  private haloMat!: THREE.ShaderMaterial;

  /** `slots`: the four groups shown on the countdown displays (the last is the green man). */
  constructor(defs: SignalDef[], mats: StationMaterials, tf: TextureFactory, slots: SignalGroup[] = ['MD_NB', 'MD_SB', 'VN_WB', 'PED']) {
    this.slots = slots;
    const pedGroup = slots[3];
    this.group.name = 'signals';
    const M = mats.m;
    const poleParts: THREE.BufferGeometry[] = [];
    const bandParts: THREE.BufferGeometry[] = [];
    const housings: THREE.BufferGeometry[] = [];
    const lampSpecs: Record<string, { pos: THREE.Matrix4[]; group: SignalGroup[]; ped: boolean; color: 'red' | 'amber' | 'green' }> = {};
    const addLamp = (key: 'red' | 'amber' | 'green' | 'pedRed' | 'pedGreen', m: THREE.Matrix4, g: SignalGroup) => {
      const color = key === 'pedRed' ? 'red' : key === 'pedGreen' ? 'green' : key;
      const spec = (lampSpecs[key] ??= { pos: [], group: [], ped: key.startsWith('ped'), color });
      spec.pos.push(m);
      spec.group.push(g);
    };
    const cdQuads: THREE.BufferGeometry[] = [];
    const head = (px: number, py: number, pz: number, ry: number, g: SignalGroup, ped: boolean) => {
      const lampsN = ped ? 2 : 3;
      const hm = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
      housings.push(housingGeo(lampsN).applyMatrix4(hm));
      const keys = ped ? (['pedRed', 'pedGreen'] as const) : (['red', 'amber', 'green'] as const);
      keys.forEach((k, i) => {
        const y = ((lampsN - 1) / 2 - i) * 0.32;
        addLamp(k, hm.clone().multiply(new THREE.Matrix4().makeTranslation(0, y, 0.085)), ped ? pedGroup : g);
      });
    };
    const countdownQuad = (px: number, py: number, pz: number, ry: number, g: SignalGroup) => {
      const slot = this.slots.indexOf(g);
      const q = new THREE.PlaneGeometry(0.46, 0.26);
      const uv = q.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (slot + uv.getX(i)) / 4, uv.getY(i));
      q.rotateY(ry);
      cdQuads.push(q.translate(px, py, pz));
      housings.push(new THREE.BoxGeometry(0.52, 0.32, 0.14).rotateY(ry).translate(px - Math.sin(ry) * 0.08, py, pz - Math.cos(ry) * 0.08));
    };
    for (const d of defs) {
      const [tx, tz] = d.toRoad;
      const poleH = d.kind === 'ped' ? 3.0 : 4.6;
      const pole = new THREE.CylinderGeometry(0.075, 0.1, poleH, 10).translate(d.x, d.y + poleH / 2, d.z);
      (d.banded ? bandParts : poleParts).push(pole);
      const fx = Math.sin(d.ry);
      const fz = Math.cos(d.ry);
      if (d.kind !== 'ped') {
        // Near-side head on the pole, countdown below it.
        head(d.x + fx * 0.15, d.y + 3.4, d.z + fz * 0.15, d.ry, d.group, false);
        countdownQuad(d.x + fx * 0.22, d.y + 2.55, d.z + fz * 0.22, d.ry, d.group);
      }
      for (const e of d.extra ?? []) {
        // Extra heads stand off the pole on short brackets so heads at right angles clear each other.
        const ex = Math.sin(e.ry);
        const ez = Math.cos(e.ry);
        head(d.x + ex * 0.36, d.y + 3.4, d.z + ez * 0.36, e.ry, e.group, false);
        for (const by of [3.05, 3.75]) housings.push(new THREE.BoxGeometry(0.05, 0.05, 0.22).rotateY(e.ry).translate(d.x + ex * 0.13, d.y + by, d.z + ez * 0.13));
      }
      if (d.kind === 'both') {
        // Mast arm over the carriageway with a second head.
        const L = 6.2;
        const ax = d.x + tx * L;
        const az = d.z + tz * L;
        const arm = new THREE.CylinderGeometry(0.05, 0.07, L, 8);
        arm.rotateZ(Math.PI / 2);
        arm.rotateY(-Math.atan2(tz, tx));
        poleParts.push(arm.translate(d.x + (tx * L) / 2, d.y + poleH - 0.15, d.z + (tz * L) / 2));
        head(ax + fx * 0.1, d.y + poleH - 0.7, az + fz * 0.1, d.ry, d.group, false);
      }
      if (d.kind === 'ped' || d.kind === 'both' || d.kind === 'post') {
        const pry = Math.atan2(tx, tz);
        head(d.x + tx * 0.18, d.y + 2.35, d.z + tz * 0.18, pry, pedGroup, true);
      }
    }
    const metal = mergeGeometries(poleParts.map((p) => p.toNonIndexed()))!;
    const poles = new THREE.Mesh(metal, M.steelGrey);
    poles.castShadow = true;
    this.group.add(poles);
    if (bandParts.length) {
      const bandTex = tf.memo('signalBands', () => {
        const [c, ctx] = makeCanvas(16, 128);
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = i % 2 ? '#111' : '#e0b92a';
          ctx.fillRect(0, i * 16, 16, 16);
        }
        return tf.tex(c);
      });
      const banded = new THREE.Mesh(mergeGeometries(bandParts.map((p) => p.toNonIndexed()))!, new THREE.MeshStandardMaterial({ map: bandTex, roughness: 0.6 }));
      mats.add('signalBanded', banded.material as THREE.Material);
      banded.castShadow = true;
      this.group.add(banded);
    }
    const hous = new THREE.Mesh(mergeGeometries(housings.map((p) => (p.index ? p.toNonIndexed() : p)))!, M.blackPaint);
    hous.castShadow = true;
    this.group.add(hous);
    // Lamp lenses: instanced discs whose colour is switched every frame.
    const lens = new THREE.CircleGeometry(0.125, 16);
    const pedIcon = this.pedIconTexture(tf);
    // A soft additive glow on each lit lens, so a signal reads from a block away and at night. It is
    // a camera-facing card that fades out towards the back of the head: from the pavement beside the
    // pole you still see which lamp is lit, as the light spills out of the visor.
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.haloTexture(tf) }, uGain: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uGain;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          mat4 m = modelMatrix * instanceMatrix;
          vec4 c = m * vec4(0.0, 0.0, 0.04, 1.0);
          vec3 fwd = normalize((m * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
          vec3 toCam = cameraPosition - c.xyz;
          float dist = length(toCam);
          float facing = smoothstep(-0.2, 0.55, dot(fwd, toCam / dist));
          // Close up the lens itself is enough; the glow is for reading a signal from afar.
          vCol = instanceColor * facing * uGain * mix(0.25, 1.0, smoothstep(4.0, 30.0, dist));
          vec4 mv = viewMatrix * c;
          // Grows gently with distance so a far signal is still a readable point of colour.
          mv.xy += position.xy * 0.6 * (1.0 + dist * 0.014);
          vUv = uv;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          gl_FragColor = vec4(vCol * texture2D(map, vUv).r, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.haloMat = haloMat;
    const mkHalo = (spec: { pos: THREE.Matrix4[] }) => {
      const h = new THREE.InstancedMesh(haloGeo, haloMat, spec.pos.length);
      spec.pos.forEach((m, i) => h.setMatrixAt(i, m));
      h.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spec.pos.length * 3), 3);
      h.renderOrder = 2;
      h.frustumCulled = false;
      this.group.add(h);
      return h;
    };
    for (const [key, spec] of Object.entries(lampSpecs)) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: spec.ped ? pedIcon : null });
      if (spec.ped) {
        // Two icons in one texture: left half standing (red), right half walking (green).
        const g = lens.clone();
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (key === 'pedGreen' ? 0.5 : 0));
        const mesh = new THREE.InstancedMesh(g, mat, spec.pos.length);
        spec.pos.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spec.pos.length * 3), 3);
        this.group.add(mesh);
        this.lamps.push({ mesh, halo: mkHalo(spec), entries: spec.group.map((g2) => ({ group: g2, color: spec.color, ped: true })) });
      } else {
        const mesh = new THREE.InstancedMesh(lens, mat, spec.pos.length);
        spec.pos.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spec.pos.length * 3), 3);
        this.group.add(mesh);
        this.lamps.push({ mesh, halo: mkHalo(spec), entries: spec.group.map((g2) => ({ group: g2, color: spec.color, ped: false })) });
      }
      void key;
    }
    // Countdown displays share one canvas with a slot per group.
    const [canvas, ctx] = makeCanvas(256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.countdown = { canvas, ctx, tex, last: '' };
    const cdMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2) });
    this.group.add(new THREE.Mesh(mergeGeometries(cdQuads)!, cdMat));
  }

  private haloTexture(tf: TextureFactory): THREE.Texture {
    return tf.memo('signalHalo', () => {
      const [c, ctx] = makeCanvas(64, 64);
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return tf.tex(c, { wrap: false });
    });
  }

  private pedIconTexture(tf: TextureFactory): THREE.Texture {
    return tf.memo('pedIcon', () => {
      const [c, ctx] = makeCanvas(128, 64);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 128, 64);
      const man = (ox: number, walking: boolean) => {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ox + 32, 12, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(ox + 32, 21);
        ctx.lineTo(ox + 32, 38);
        if (walking) {
          ctx.moveTo(ox + 32, 38);
          ctx.lineTo(ox + 22, 55);
          ctx.moveTo(ox + 32, 38);
          ctx.lineTo(ox + 42, 54);
          ctx.moveTo(ox + 32, 25);
          ctx.lineTo(ox + 22, 35);
          ctx.moveTo(ox + 32, 25);
          ctx.lineTo(ox + 42, 33);
        } else {
          ctx.moveTo(ox + 28, 38);
          ctx.lineTo(ox + 28, 56);
          ctx.moveTo(ox + 36, 38);
          ctx.lineTo(ox + 36, 56);
          ctx.moveTo(ox + 32, 24);
          ctx.lineTo(ox + 23, 38);
          ctx.moveTo(ox + 32, 24);
          ctx.lineTo(ox + 41, 38);
        }
        ctx.stroke();
      };
      man(0, false);
      man(64, true);
      return tf.tex(c, { wrap: false });
    });
  }

  /** `lamps`: 0 by day … 1 at night (the glow carries further in the dark). */
  update(ctrl: SignalController, lamps = 0): void {
    this.haloMat.uniforms.uGain.value = 0.55 + 0.9 * lamps;
    const on = { red: new THREE.Color(6.0, 0.25, 0.1), amber: new THREE.Color(5.5, 2.2, 0.1), green: new THREE.Color(0.2, 5.2, 2.2) };
    const black = new THREE.Color(0, 0, 0);
    const glow = new THREE.Color();
    const off = { red: new THREE.Color(0.07, 0.015, 0.01), amber: new THREE.Color(0.07, 0.04, 0.01), green: new THREE.Color(0.01, 0.06, 0.03) };
    for (const l of this.lamps) {
      l.entries.forEach((e, i) => {
        const a = ctrl.aspect(e.group);
        const lit = a === e.color;
        // The pedestrian icons are large and would bloom into a disc at full signal brightness.
        l.mesh.setColorAt(i, lit ? glow.copy(on[e.color]).multiplyScalar(e.ped ? 0.45 : 1) : off[e.color]);
        l.halo.setColorAt(i, lit ? glow.copy(on[e.color]).multiplyScalar(e.ped ? 0.08 : 0.2) : black);
      });
      if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
      if (l.halo.instanceColor) l.halo.instanceColor.needsUpdate = true;
    }
    // Countdown digits (red when stopped, green when moving).
    const text = this.slots.map((g) => `${ctrl.aspect(g)[0]}${Math.min(99, Math.ceil(ctrl.remaining(g)))}`).join('|');
    if (text !== this.countdown.last) {
      this.countdown.last = text;
      const { ctx, tex } = this.countdown;
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, 256, 64);
      this.slots.forEach((g, i) => {
        const a = ctrl.aspect(g);
        ctx.fillStyle = a === 'green' ? '#39ff6a' : a === 'amber' ? '#ffb020' : '#ff2a1a';
        ctx.font = `700 46px ${LATIN}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.min(99, Math.ceil(ctrl.remaining(g)))).padStart(2, '0'), i * 64 + 32, 34);
      });
      tex.needsUpdate = true;
    }
  }
}
