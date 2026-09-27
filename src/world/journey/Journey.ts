import * as THREE from 'three';
import type { Churchgate } from '../churchgate/Churchgate';
import { CorridorKit, buildStretch, type Stretch, type StretchSpec } from './Corridor';
import type { Railway } from './Railway';
import { buildMiraRoad, type MiraRoad } from './MiraRoad';
import { buildHalt, type HaltStation } from './Halts';
import type { AmbientVolume } from '../../gfx/AmbientVolume';

/** Stretches in ride order: Mira Road, Borivali (halt), Malad, Mahim Creek, Dadar (halt), Lower Parel, the approach. */
export type StretchKey = 'A' | 'BO' | 'B' | 'C' | 'DA' | 'D' | 'E';

/**
 * The stretches of the ride along the real alignment (LOCAL_TRAIN.md §4, HALTS.md), as path
 * ranges. u: metres from the Churchgate throat (OSM). Scenery is dressed per region; ⚠ generic.
 */
export function stretchSpecs(r: Railway): Record<StretchKey, StretchSpec> {
  const u = (x: number) => r.dOfU(x);
  const halt = (k: 'BO' | 'DA') => r.halts.find((h) => h.key === k)!;
  return {
    // Mira Road → the creek before Dahisar: salt pans and mangroves.
    A: {
      key: 'A',
      dA: r.dMiraRoad - 760,
      dB: u(38150) + 650,
      region: (d) => (d < r.dMiraRoad + 220 ? 'mira' : 'saltpan'),
      seed: 11,
      bridges: [{ d: u(39050), len: 77 }],
      groundY: -0.9,
      station: [r.dMiraRoad - 440, r.dMiraRoad + 60],
    },
    // The stop at Borivali (PF 5): its station is built by Halts.ts.
    BO: { key: 'BO', dA: halt('BO').d - 1150, dB: halt('BO').d + 1350, region: () => 'suburb', seed: 16, groundY: -0.5 },
    // Through Malad: dense suburbs, trackside homes, a road over-bridge, Malad's platforms.
    B: { key: 'B', dA: u(30250) - 650, dB: u(28450) + 650, region: () => 'suburb', seed: 12, robs: [u(29760)], groundY: -0.5 },
    // Out of Bandra over Mahim Creek.
    C: {
      key: 'C',
      dA: u(14330) - 650,
      dB: u(13250) + 650,
      region: (d) => (Math.abs(d - u(14020)) < 380 ? 'creek' : 'suburb'),
      seed: 13,
      bridges: [{ d: u(14020), len: 62 }],
      groundY: -0.7,
    },
    // The stop at Dadar (PF 4), with Tilak Bridge over the north end ⚠.
    DA: { key: 'DA', dA: halt('DA').d - 1150, dB: halt('DA').d + 1350, region: () => 'suburb', seed: 17, robs: [halt('DA').d - halt('DA').half - 70], groundY: -0.5 },
    // Lower Parel: mill chimneys and sheds, glass towers.
    D: { key: 'D', dA: u(8000) - 650, dB: u(6650) + 650, region: () => 'mills', seed: 14, robs: [u(7640)], groundY: -0.5 },
    // Charni Road → Marine Lines → Churchgate: the real city (OSM) is already built.
    E: { key: 'E', dA: u(3400), dB: r.dThroat, region: () => 'city', seed: 15, cityBase: true, groundY: -0.34 },
  };
}

/** Builds and shows the ride's scenery; stretch E belongs to the Churchgate world and stays. */
export class Journey {
  readonly group = new THREE.Group();
  readonly kit: CorridorKit;
  readonly specs: Record<StretchKey, StretchSpec>;
  private readonly built = new Map<StretchKey, Stretch>();
  current: StretchKey | null = null;
  /** Mira Road station (shown with stretch A). */
  mira: MiraRoad | null = null;
  /** Borivali and Dadar (built with their stretches). */
  private readonly halts = new Map<StretchKey, HaltStation>();

  constructor(
    readonly world: Churchgate,
    readonly railway: Railway,
  ) {
    this.group.name = 'journey';
    this.kit = new CorridorKit(world.tf, world.mats, world.city.facadeMaterial);
    this.specs = stretchSpecs(railway);
  }

  /** The Churchgate approach (throat to Grant Road), part of the station's surroundings. */
  buildApproach(): THREE.Group {
    const s = buildStretch(this.kit, this.railway, this.specs.E);
    this.built.set('E', s);
    return s.group;
  }

  stretch(key: StretchKey): Stretch {
    let s = this.built.get(key);
    if (!s) {
      const t0 = performance.now();
      s = buildStretch(this.kit, this.railway, this.specs[key]);
      const h = this.railway.halts.find((x) => x.key === key);
      if (h) {
        const st = buildHalt(this.kit, this.railway, h, this.world.av);
        const a = this.railway.path.at(h.d);
        st.group.position.set(a.x - s.group.position.x, 0, a.z - s.group.position.z);
        s.group.add(st.group);
        this.halts.set(key, st);
      }
      console.info(`journey: stretch ${key} built in ${(performance.now() - t0).toFixed(0)} ms`);
      this.built.set(key, s);
      if (key !== 'E') this.group.add(s.group);
    }
    return s;
  }

  /** The light map of the halt being shown, if any (the materials read it there, as at Mira Road). */
  haltAV(): AmbientVolume | null {
    const k = this.current;
    return k === 'BO' || k === 'DA' ? (this.halts.get(k)?.av ?? null) : null;
  }

  /** The halt station of a stretch (Borivali, Dadar), building it if needed. */
  halt(key: StretchKey): HaltStation | null {
    if (key !== 'BO' && key !== 'DA') return null;
    this.stretch(key);
    return this.halts.get(key) ?? null;
  }

  async loadMira(): Promise<MiraRoad> {
    if (!this.mira) {
      const t0 = performance.now();
      this.mira = await buildMiraRoad(this.kit, this.railway, this.world, import.meta.env.BASE_URL);
      this.mira.group.visible = this.current === 'A';
      this.group.add(this.mira.group);
      console.info(`journey: Mira Road built in ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return this.mira;
  }

  /** Shows one far stretch (A–D) or none (at Churchgate, E is always there). */
  show(key: StretchKey | null): void {
    this.current = key;
    for (const [k, s] of this.built) if (k !== 'E') s.group.visible = k === key;
    if (key && key !== 'E') this.stretch(key).group.visible = true;
    if (this.mira) this.mira.group.visible = key === 'A';
  }

  update(time: number, dt = 0, hour = 0, camera?: THREE.Camera): void {
    const s = this.current ? this.built.get(this.current) : null;
    s?.update(time);
    this.built.get('E')?.update(time);
    if (this.mira?.group.visible && camera) this.mira.update(dt, hour, camera);
  }
}
