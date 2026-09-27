import * as THREE from 'three';
import { RNG } from '../../core/Random';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import { buildHuman, type Variant } from './HumanGeometry';
import { CROWD_ATTRS, createCrowdDepthMaterial, createCrowdMaterial } from './CrowdMaterial';
import { CAR } from '../train/Livery';
import { TrainSystem, type TrainView } from '../train/TrainSystem';
import { CONCOURSE, EDGE, PLATFORMS, TRACKS, Y } from '../../world/churchgate/Layout';

type State = 'walk' | 'idle' | 'sit' | 'gone';

export interface Look {
  /** 0 man, 1 woman (salwar kurta), 2 saree, 3 young man, 4 young woman (see HumanGeometry). */
  variant: 0 | 1 | 2 | 3 | 4;
  top: [number, number, number];
  bottom: [number, number, number];
  accent: [number, number, number];
  skin: [number, number, number];
  hair: number;
  flags: [number, number, number, number];
  misc: [number, number, number, number];
  /** Shoe colour, hair style, skirt, sleeves (see CrowdMaterial aStyle). */
  style: [number, number, number, number];
  scale: number;
}

interface Agent {
  id: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  pref: number;
  phase: number;
  state: State;
  path: { x: number; z: number }[];
  pi: number;
  lane: number;
  timer: number;
  pose: number;
  look: Look;
  onArrive: 'despawn' | 'wait' | 'board' | 'loiter' | 'linger';
  targetPf: number;
  door: { x: number; z: number; side: -1 | 1 } | null;
  face: number | null;
  region: number;
  /** Street agents live outside the station and take their height from the street surface. */
  street: boolean;
  /** Waypoint index at which to wait for the pedestrian signal (−1: none). */
  waitAt: number;
  /** Walks briskly up to this waypoint index (across a road on the green man). */
  hurryUntil: number;
  /** The other half of a couple walking together. */
  partner: Agent | null;
  /** Station agent leaving by the west exit: carries on as a street walker. */
  exitW: boolean;
  /** Street agent walking to the west exit: 'board' goes on to a platform, 'cross' through the concourse. */
  intoStation: 'board' | 'cross' | null;
}

export interface StreetSpot {
  x: number;
  z: number;
  y: number;
  ry: number;
}

export interface StreetRoute {
  pts: { x: number; z: number }[];
  waitAt: number;
  linger?: { ry: number; seconds: number };
  /** The route ends at the west-exit steps and the walker goes into the station. */
  into?: 'board' | 'cross';
}

export interface StreetConfig {
  ground: (x: number, z: number) => number;
  pedWalk: () => boolean;
  /** Returns a walking route (waypoints) and the index of the kerb waypoint where the walker waits for the signal. */
  makeRoute: (rng: RNG) => StreetRoute;
  /** A route from the foot of the west-exit steps out into the streets. */
  fromStation: (rng: RNG) => StreetRoute;
  /** A route through the streets that ends at the foot of the west-exit steps. */
  toStation: (rng: RNG) => StreetRoute;
  /** A stroll away from where someone has been standing (after lingering at the sea wall). */
  leave: (x: number, z: number, rng: RNG) => { x: number; z: number }[];
  walkers: number;
  seats: StreetSpot[];
  standing: StreetSpot[];
  loiter: StreetSpot[];
  /** Policemen on duty (cap 1: white traffic-police cap, 2: dark cap). */
  guards: (StreetSpot & { cap: 1 | 2 })[];
  seatOccupancy: (x: number, z: number) => number;
}

const lin = (hex: number): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

const SHIRTS = [0xf4f4f0, 0xe9eef7, 0xbcd2ec, 0x9fc0e6, 0xd9c7e6, 0xf0cfd6, 0xd8d8d2, 0xe8e0c8, 0x7aa0c8, 0x2d3e63, 0x1c1c1e, 0x6a7b5a, 0xc9a86a, 0xb33a3a, 0x3f7fb5, 0xf2d15c, 0x5c8f6b, 0x8e3b5f, 0x2f6f73, 0xd9773a, 0x4b4f8a, 0x9c2a2a];
const TROUSERS = [0x1d1d20, 0x2a2b2e, 0x232a3e, 0x3b3f47, 0x8d7b5e, 0xb5a27f, 0x34496e, 0x2e4d7a, 0x4a4a4a, 0x5a4a3a];
const KURTAS = [0xc2185b, 0xd84315, 0xf9a825, 0x00897b, 0x6a1b9a, 0x1565c0, 0xad1457, 0x2e7d32, 0xef6c00, 0xf5f5f5, 0x8d6e63, 0x5d4037, 0xe57373, 0x4dd0e1, 0xfff176, 0x7986cb];
const SAREES = [0xd32f2f, 0xf57c00, 0x2e7d32, 0x1565c0, 0xc2185b, 0x6a1b9a, 0x00838f, 0xfbc02d, 0x8e24aa, 0xbf360c];
const LEGGINGS = [0xf5f5f0, 0x1b1b1b, 0xd7ccc8, 0xf0e2c8, 0x37474f];
const SKIN = [0x8d5a3b, 0x7a4b2e, 0xa46a45, 0xb77b54, 0x6b4028, 0x9a6444, 0xc08a62, 0x5c3822];
/** T-shirts, polos and casual shirts. */
const TEES = [0x111111, 0xf5f5f5, 0xc62828, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xff7043, 0x26c6da, 0x3949ab, 0x6d4c41, 0x9e9e9e, 0x5d6d3a, 0x546e7a, 0xe0e0d8, 0x0d47a1, 0xad1457, 0xffb300];
/** Denim washes, black jeans, chinos, cargo. */
const DENIM = [0x1f3a5f, 0x2c4f7c, 0x3d5f8f, 0x16223a, 0x5b7fae, 0x7896bf, 0x222222, 0xcbbf9f, 0x4e5b31, 0x3a3a3a];
const GIRL_TOPS = [0xffffff, 0xf8bbd0, 0xffcdd2, 0xb3e5fc, 0xfff59d, 0xc5e1a5, 0x111111, 0xd81b60, 0x7e57c2, 0xff8a65, 0x4db6ac, 0xe1bee7, 0xfbe9e7, 0x90caf9, 0xef5350, 0xffca28, 0x26a69a, 0xf06292];
const SKIRTS = [0x212121, 0x1a237e, 0xad1457, 0xf48fb1, 0xfafafa, 0x6d4c41, 0xc2185b, 0x00695c, 0xffe082, 0x5d4037, 0x283593, 0xe53935];

/**
 * A random passer-by. `youth` is the share of young people (college students, couples): about a
 * third at the station, more on the evening promenade.
 */
export function makeLook(rng: RNG, youth = 0.3): Look {
  const skin = lin(rng.pick(SKIN));
  if (rng.chance(youth)) return rng.chance(0.52) ? youngMan(rng, skin) : youngWoman(rng, skin);
  const v = rng.weighted([
    [0, 62],
    [1, 26],
    [2, 12],
  ] as const) as 0 | 1 | 2;
  const old = rng.chance(0.14);
  const hair = old ? rng.range(0.45, 0.8) : rng.range(0, 0.06);
  const scaleBase = v === 0 ? rng.range(0.97, 1.07) : rng.range(0.9, 0.99);
  if (v === 0) {
    const pattern = rng.weighted([
      [0, 55],
      [1, 20],
      [2, 25],
    ] as const);
    return {
      variant: 0,
      top: lin(rng.pick(SHIRTS)),
      bottom: lin(rng.chance(0.3) ? rng.pick(DENIM) : rng.pick(TROUSERS)),
      accent: lin(rng.pick(SHIRTS)),
      skin,
      hair,
      flags: [rng.chance(0.42) ? 1 : 0, rng.chance(0.18) ? 1 : 0, rng.chance(0.45) ? 1 : 0, pattern],
      misc: [old && rng.chance(0.3) ? 1 : rng.chance(0.04) ? 2 : 0, rng.int(0, 3), rng.int(0, 2), rng.range(0.95, 1.12) * (rng.chance(0.5) ? -1 : 1)],
      style: [rng.weighted([[0, 60], [2, 25], [3, 15]] as const), 0, 0, 0],
      scale: scaleBase,
    };
  }
  if (v === 1) {
    return {
      variant: 1,
      top: lin(rng.pick(KURTAS)),
      bottom: lin(rng.pick(LEGGINGS)),
      accent: lin(rng.pick(KURTAS)),
      skin,
      hair: old ? rng.range(0.3, 0.6) : 0.0,
      flags: [rng.chance(0.2) ? 1 : 0, rng.chance(0.65) ? 1 : 0, 0, rng.chance(0.35) ? 3 : 0],
      misc: [0, rng.int(0, 3), rng.int(0, 2), rng.range(0.95, 1.08)],
      style: [rng.chance(0.6) ? 3 : 0, 0, 0, 0],
      scale: scaleBase,
    };
  }
  return {
    variant: 2,
    top: lin(rng.pick(SAREES)),
    bottom: lin(0x222222),
    accent: lin(rng.pick(KURTAS)),
    skin,
    hair: old ? rng.range(0.3, 0.6) : 0.0,
    flags: [0, rng.chance(0.7) ? 1 : 0, 0, 3],
    misc: [0, 0, rng.int(0, 2), rng.range(0.98, 1.12)],
    style: [3, 0, 0, 0],
    scale: scaleBase,
  };
}

/** Mumbai Police: khaki shirt and trousers, a cap, a moustache more often than not. */
function policeLook(rng: RNG, cap: 1 | 2): Look {
  const khaki = lin(0xa89066);
  return {
    variant: 0,
    top: khaki,
    bottom: lin(0x9c855c),
    accent: khaki,
    skin: lin(rng.pick(SKIN)),
    hair: rng.range(0, 0.2),
    flags: [0, 0, 0, 0],
    misc: [cap, 0, 0, rng.range(1.02, 1.12) * (rng.chance(0.7) ? -1 : 1)],
    style: [2, 0, 0, 0],
    scale: rng.range(1.0, 1.06),
  };
}

/** T-shirt or casual shirt, jeans, sneakers; a backpack or sling bag, now and then a cap. */
function youngMan(rng: RNG, skin: [number, number, number]): Look {
  const tee = rng.pick(TEES);
  const shirt = rng.chance(0.25);
  return {
    variant: 3,
    top: lin(tee),
    bottom: lin(rng.pick(DENIM)),
    accent: lin(rng.chance(0.6) ? tee : rng.pick(TEES)),
    skin,
    hair: rng.chance(0.12) ? -rng.range(0.25, 0.6) : rng.range(0, 0.02),
    flags: [rng.chance(0.4) ? 1 : 0, rng.chance(0.25) ? 1 : 0, 0, shirt ? rng.weighted([[1, 50], [2, 50]] as const) : rng.chance(0.12) ? 1 : 0],
    misc: [rng.chance(0.1) ? (rng.chance(0.5) ? 1 : 2) : 0, rng.int(0, 3), rng.int(0, 2), rng.range(0.93, 1.05) * (rng.chance(0.25) ? -1 : 1)],
    style: [rng.weighted([[1, 55], [0, 30], [2, 15]] as const), 0, 0, shirt ? rng.weighted([[2, 60], [1, 40]] as const) : rng.chance(0.12) ? 2 : 1],
    scale: rng.range(0.98, 1.07),
  };
}

/** Fitted top with jeans, a skirt or a dress; hair open or in a ponytail; a handbag. */
function youngWoman(rng: RNG, skin: [number, number, number]): Look {
  const skirt = rng.chance(0.35);
  const top = rng.pick(GIRL_TOPS);
  // A one-piece dress now and then.
  const bottom = skirt ? (rng.chance(0.4) ? top : rng.pick(SKIRTS)) : rng.pick(DENIM);
  return {
    variant: 4,
    top: lin(top),
    bottom: lin(bottom),
    accent: lin(rng.pick([0xd4af37, 0xc0c0c0, 0x111111, 0xf5f5f5])),
    skin,
    hair: rng.chance(0.3) ? -rng.range(0.3, 0.8) : rng.range(0, 0.02),
    flags: [rng.chance(0.22) ? 1 : 0, rng.chance(0.55) ? 1 : 0, 0, rng.chance(0.12) ? 1 : 0],
    misc: [0, rng.int(0, 3), rng.int(0, 2), rng.range(0.92, 1.02)],
    style: [skirt ? rng.weighted([[3, 40], [1, 30], [0, 30]] as const) : rng.weighted([[1, 50], [3, 25], [0, 25]] as const), rng.chance(0.35) ? 1 : 0, skirt ? 1 : 0, rng.weighted([[1, 55], [0, 25], [2, 20]] as const)],
    scale: rng.range(0.9, 0.98),
  };
}

/** Share of young people on the street (evening crowd at Marine Drive). */
const STREET_YOUTH = 0.45;

/** A polyline shifted sideways (to the left of travel) by `off` metres. */
function offsetPath(pts: { x: number; z: number }[], off: number): { x: number; z: number }[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dz / l) * off, z: p.z - (dx / l) * off };
  });
}

/** Rectangles people may stand in (platforms inset from the edge, concourse, exits). */
interface Region {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  /** Steps: the height runs from y (at x0) to y1 (at x1). */
  y1?: number;
}

const EXITS = {
  W: [
    { x: -21, z: CONCOURSE.passageZ },
    { x: -25.4, z: CONCOURSE.passageZ },
    { x: -29, z: CONCOURSE.passageZ },
  ],
  E: [
    { x: 21, z: CONCOURSE.passageZ },
    { x: 25.4, z: CONCOURSE.passageZ },
    { x: 29, z: CONCOURSE.passageZ },
  ],
  S: [
    { x: 3, z: 8.5 },
    { x: 3, z: 12.5 },
    { x: 3, z: 18 },
  ],
};

const MAX = { man: 900, woman: 380, saree: 200, youth: 560, girl: 520 };
const LOD_DIST = 16;
const MAX_DIST = 200;

/** Crowd simulation and instanced rendering for the station. */
export class Crowd {
  readonly group = new THREE.Group();
  private agents: Agent[] = [];
  private rng = new RNG(2024);
  private nextId = 1;
  private meshes: { mesh: THREE.InstancedMesh; attrs: Record<string, THREE.InstancedBufferAttribute> }[][] = [];
  private regions: Region[] = [];
  private grid = new Map<number, Agent[]>();
  private spawnAcc = 0;
  private occupantLooks: Look[] = [];
  private boarded = new Map<number, number>();
  /** Scales spawn rates and caps (quality setting). */
  density = 1;
  private cap = 520;
  private seats: { x: number; z: number; rot: number }[];
  private seatUsed: boolean[];

  constructor(
    av: AmbientVolume,
    private readonly trains: TrainSystem,
    seats: { x: number; z: number; rot: number }[],
  ) {
    this.group.name = 'crowd';
    this.seats = seats;
    this.seatUsed = seats.map(() => false);
    const mat = createCrowdMaterial(av);
    const depth = createCrowdDepthMaterial();
    const variants: Variant[] = ['man', 'woman', 'saree', 'youth', 'girl'];
    variants.forEach((v) => {
      const caps = MAX[v];
      const lods: { mesh: THREE.InstancedMesh; attrs: Record<string, THREE.InstancedBufferAttribute> }[] = [];
      for (const lod of [0, 1] as const) {
        const geo = buildHuman(v, lod);
        const attrs: Record<string, THREE.InstancedBufferAttribute> = {};
        for (const [name, size] of CROWD_ATTRS) {
          const a = new THREE.InstancedBufferAttribute(new Float32Array(caps * size), size);
          a.setUsage(THREE.DynamicDrawUsage);
          geo.setAttribute(name, a);
          attrs[name] = a;
        }
        const mesh = new THREE.InstancedMesh(geo, mat, caps);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = lod === 0;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = depth;
        this.group.add(mesh);
        lods.push({ mesh, attrs });
      }
      this.meshes.push(lods);
    });
    for (const p of PLATFORMS) {
      const inW = p.west ? 0.55 : 0.4;
      const inE = p.east ? 0.55 : 0.4;
      this.regions.push({ x0: p.x0 + inW, x1: p.x1 - inE, z0: p.north + 12, z1: 0.6, y: Y.platform });
    }
    this.regions.push({ x0: CONCOURSE.x0 + 0.5, x1: CONCOURSE.x1 - 0.5, z0: -0.2, z1: CONCOURSE.z1 - 0.4, y: Y.platform + 0.01 });
    // Each side exit: the landing at the concourse edge, five steps down (see Platforms), the pavement.
    // The rectangles share their edges so people pass from one to the next.
    const zp0 = CONCOURSE.passageZ - 4;
    const zp1 = CONCOURSE.passageZ + 4;
    const edge = CONCOURSE.x1 + 0.9;
    const run = 0.34 * 5;
    for (const sd of [-1, 1]) {
      const lo = (a: number, b: number) => Math.min(sd * a, sd * b);
      const hi = (a: number, b: number) => Math.max(sd * a, sd * b);
      this.regions.push({ x0: lo(CONCOURSE.x1 - 0.6, edge), x1: hi(CONCOURSE.x1 - 0.6, edge), z0: zp0, z1: zp1, y: Y.platform + 0.01 });
      this.regions.push({ x0: lo(edge, edge + run), x1: hi(edge, edge + run), z0: zp0 + 0.2, z1: zp1 - 0.2, y: sd < 0 ? Y.sidewalk : Y.platform, y1: sd < 0 ? Y.platform : Y.sidewalk });
      this.regions.push({ x0: lo(edge + run, 31), x1: hi(edge + run, 31), z0: zp0, z1: zp1, y: Y.sidewalk });
    }
    this.regions.push({ x0: -1, x1: 7, z0: CONCOURSE.z1 - 1, z1: 20, y: Y.platform + 0.01 });
    for (let i = 0; i < 64; i++) this.occupantLooks.push(makeLook(this.rng));
    trains.on((e) => {
      if (e.type === 'arrived') this.onArrival(e.train);
    });
  }

  setCap(n: number): void {
    this.cap = n;
  }

  /** Removes standing / waiting commuters inside a circle (keeps cinematic framings clear). */
  clearZone(x: number, z: number, r: number): void {
    for (const a of this.agents) if ((a.state === 'idle' || a.state === 'sit') && (a.x - x) ** 2 + (a.z - z) ** 2 < r * r) a.state = 'gone';
    this.agents = this.agents.filter((a) => a.state !== 'gone');
  }

  /** The camera / player: commuters step around it. */
  private player: { x: number; z: number } | null = null;
  setPlayer(p: { x: number; z: number } | null): void {
    this.player = p ? { x: p.x, z: p.z } : null;
  }

  // ---------------------------------------------------------------------------
  private spawn(x: number, z: number, look?: Look): Agent {
    const a: Agent = {
      id: this.nextId++,
      x,
      z,
      y: Y.platform,
      heading: 0,
      speed: 0,
      pref: this.rng.range(1.15, 1.6),
      phase: this.rng.range(0, 6.28),
      state: 'walk',
      path: [],
      pi: 0,
      lane: this.rng.gauss() * 0.9,
      timer: 0,
      pose: 0,
      look: look ?? makeLook(this.rng),
      onArrive: 'despawn',
      targetPf: 0,
      door: null,
      face: null,
      region: -1,
      street: false,
      waitAt: -1,
      hurryUntil: -1,
      partner: null,
      exitW: false,
      intoStation: null,
    };
    this.agents.push(a);
    return a;
  }

  // ---- Street life (Churchgate → Marine Drive) --------------------------------------------------
  private streetCfg: StreetConfig | null = null;
  private streetWalkers = 0;

  configureStreet(cfg: StreetConfig): void {
    this.streetCfg = cfg;
    const rng = this.rng;
    // Sunset crowd sitting on the sea wall; Marine Drive is where couples come to sit together.
    const sitAt = (x: number, z: number, y: number, ry: number, look: Look) => {
      const a = this.spawn(x, z, look);
      a.street = true;
      a.state = 'sit';
      a.pose = 1;
      a.heading = ry;
      a.y = y;
      return a;
    };
    for (let i = 0; i < cfg.seats.length; i++) {
      const seat = cfg.seats[i];
      if (!rng.chance(cfg.seatOccupancy(seat.x, seat.z))) continue;
      const next = cfg.seats[i + 1];
      if (next && Math.abs(next.ry - seat.ry) < 0.3 && rng.chance(0.3)) {
        // A couple sharing two seats, close together, turned slightly towards each other.
        const mx = (seat.x + next.x) / 2;
        const mz = (seat.z + next.z) / 2;
        const dx = (next.x - seat.x) / 2;
        const dz = (next.z - seat.z) / 2;
        const k = 0.27 / (Math.hypot(dx, dz) || 1);
        const lad = rng.chance(0.5);
        sitAt(mx - dx * k, mz - dz * k, seat.y, seat.ry + 0.12, lad ? youngMan(rng, lin(rng.pick(SKIN))) : youngWoman(rng, lin(rng.pick(SKIN))));
        sitAt(mx + dx * k, mz + dz * k, seat.y, seat.ry - 0.12, lad ? youngWoman(rng, lin(rng.pick(SKIN))) : youngMan(rng, lin(rng.pick(SKIN))));
        i++;
        continue;
      }
      sitAt(seat.x + rng.range(-0.12, 0.12), seat.z + rng.range(-0.12, 0.12), seat.y, seat.ry + rng.range(-0.25, 0.25), makeLook(rng, STREET_YOUTH));
    }
    for (const g of cfg.guards) {
      const a = this.spawn(g.x, g.z, policeLook(rng, g.cap));
      a.street = true;
      a.state = 'idle';
      a.timer = 1e9;
      a.onArrive = 'wait';
      a.face = g.ry;
      a.heading = g.ry;
      a.y = g.y;
    }
    for (const st of [...cfg.standing, ...cfg.loiter]) {
      const a = this.spawn(st.x, st.z, makeLook(rng, STREET_YOUTH));
      a.street = true;
      a.state = 'idle';
      a.timer = 1e9;
      a.onArrive = 'wait';
      a.face = st.ry;
      a.heading = st.ry;
      a.y = st.y;
      a.pose = rng.chance(0.35) ? 2 : 0;
    }
    // Pre-warm walkers spread along their routes.
    for (let i = 0; i < cfg.walkers; i++) this.spawnStreetWalker(true);
  }

  private spawnStreetWalker(prewarm: boolean, into: 'board' | 'cross' | null = null): void {
    const cfg = this.streetCfg!;
    const rng = this.rng;
    // New walkers never appear out of thin air near the viewer: routes starting close by and in
    // view are redrawn.
    let r = into ? cfg.toStation(rng) : cfg.makeRoute(rng);
    for (let tries = 0; !prewarm && tries < 8 && r.pts.length && this.inSight(r.pts[0].x, r.pts[0].z); tries++) r = into ? cfg.toStation(rng) : cfg.makeRoute(rng);
    if (!prewarm && r.pts.length && this.inSight(r.pts[0].x, r.pts[0].z)) return;
    if (r.pts.length < 2) return;
    let start = 0;
    if (prewarm) start = rng.int(0, r.pts.length - 2);
    // Nobody starts out in the middle of the zebra: they begin at the kerb and wait for the green man.
    if (r.waitAt >= 0 && start >= r.waitAt && start <= r.waitAt + 1) start = Math.max(0, r.waitAt - 1);
    const couple = !into && rng.chance(0.16);
    const pref = couple ? rng.range(0.95, 1.2) : rng.range(1.05, 1.45);
    const walker = (pts: { x: number; z: number }[], look: Look) => {
      const p0 = pts[start];
      const a = this.spawn(p0.x, p0.z, look);
      a.street = true;
      a.path = pts;
      a.pi = start + 1;
      a.waitAt = r.waitAt;
      a.onArrive = r.linger ? 'linger' : 'despawn';
      if (r.linger) {
        a.face = r.linger.ry;
        a.timer = r.linger.seconds;
      }
      a.pref = pref;
      a.y = cfg.ground(a.x, a.z);
      const n = pts[Math.min(pts.length - 1, a.pi)];
      a.heading = Math.atan2(n.x - a.x, n.z - a.z);
      this.streetWalkers++;
      return a;
    };
    if (!couple) {
      walker(r.pts, makeLook(rng, into ? 0.3 : STREET_YOUTH)).intoStation = into ?? r.into ?? null;
      return;
    }
    // A couple strolls side by side: the same route, 0.55 m apart.
    const a = walker(r.pts, youngMan(rng, lin(rng.pick(SKIN))));
    const b = walker(offsetPath(r.pts, 0.55), youngWoman(rng, lin(rng.pick(SKIN))));
    a.intoStation = b.intoStation = r.into ?? null;
    a.partner = b;
    b.partner = a;
    if (r.linger) b.face = r.linger.ry;
  }

  private readonly sight = { frustum: new THREE.Frustum(), pos: new THREE.Vector3(1e9, 0, 0), sphere: new THREE.Sphere(new THREE.Vector3(), 1.2) };

  /** Close to the viewer (70 m) and inside the last frame's view. */
  private inSight(x: number, z: number): boolean {
    const v = this.sight;
    if ((x - v.pos.x) ** 2 + (z - v.pos.z) ** 2 > 70 * 70) return false;
    v.sphere.center.set(x, 1, z);
    return v.frustum.intersectsSphere(v.sphere);
  }

  private platformsFor(pf: number): number[] {
    // PLATFORMS index: 0 PF1 side, 1 island 1/2, 2 island 2/3, 3 island 3/4, 4 PF4 side.
    return [pf - 1, pf];
  }

  private pathToExit(x: number, z: number, exit: keyof typeof EXITS): { x: number; z: number }[] {
    const path: { x: number; z: number }[] = [];
    if (z < -0.5) {
      // On a platform: walk along it to the head, then onto the concourse.
      const p = PLATFORMS.find((pp) => x >= pp.x0 - 0.5 && x <= pp.x1 + 0.5) ?? PLATFORMS[2];
      const cx = THREE.MathUtils.clamp(x, p.x0 + 0.8, p.x1 - 0.8);
      path.push({ x: cx, z: -1.5 }, { x: THREE.MathUtils.lerp(cx, (p.x0 + p.x1) / 2, 0.5), z: 2.5 });
    }
    return [...path, ...EXITS[exit].map((p) => ({ x: p.x + this.rng.range(-0.6, 0.6), z: p.z + this.rng.range(-2.8, 2.8) }))];
  }

  private pickExit(): keyof typeof EXITS {
    return this.rng.weighted([
      ['W', 45],
      ['S', 32],
      ['E', 23],
    ] as const);
  }

  /** Alighting passengers pour out of every door, onto both platforms. */
  private onArrival(t: TrainView): void {
    const doors = this.trains.doorways(t);
    const n = Math.round(this.rng.range(70, 120) * this.density);
    for (let i = 0; i < n; i++) {
      const d = this.rng.pick(doors);
      const a = this.spawn(d.x + d.side * 0.35, d.z + this.rng.range(-0.5, 0.5));
      a.state = 'idle';
      a.timer = this.rng.range(0, 14); // stagger the exodus
      a.heading = d.side > 0 ? Math.PI / 2 : -Math.PI / 2;
      const step = { x: d.x + d.side * this.rng.range(1.2, 2.6), z: d.z + this.rng.range(-1, 1) };
      const exit = this.pickExit();
      a.path = [step, ...this.pathToExit(step.x, step.z, exit)];
      a.onArrive = 'despawn';
      a.exitW = exit === 'W';
      a.pref = this.rng.range(1.3, 1.75);
    }
    this.boarded.set(t.pf, 0);
  }

  /** Commuters arriving at the station heading for a platform to wait. */
  private spawnBoarder(from?: keyof typeof EXITS): void {
    const exit = from ?? this.pickExit();
    // From the west the commuters come up IMC Road from the streets.
    if (exit === 'W' && this.streetCfg && !this.populating) {
      this.spawnStreetWalker(false, 'board');
      return;
    }
    const e = EXITS[exit];
    const start = e[e.length - 1];
    const a = this.spawn(start.x + this.rng.range(-0.5, 0.5), start.z + this.rng.range(-2.5, 2.5));
    this.board(a, exit);
  }

  /** Sends a commuter from an exit to a platform with a departure soon, to wait for the train. */
  private board(a: Agent, exit: keyof typeof EXITS): void {
    const e = EXITS[exit];
    // Choose a platform with a departure soon.
    const views = this.trains.views;
    const scores = views.map((v) => {
      const s = v.service;
      if (!s) return 0.2;
      return v.state === 'dwell' ? 3 : v.state === 'arriving' ? 2 : 1;
    });
    const pf = this.rng.weighted(views.map((v, i) => [v.pf, scores[i]] as const));
    const pIdx = this.rng.pick(this.platformsFor(pf));
    const P = PLATFORMS[pIdx];
    const cx = (P.x0 + P.x1) / 2;
    // Most people crowd the front half of the train (closest to the exits).
    const zWait = -Math.pow(this.rng.next(), 1.6) * 210 - 4;
    const face = pIdx === pf - 1 ? 1 : -1; // towards the track
    const wx = THREE.MathUtils.clamp(cx + this.rng.gauss() * 1.6 + face * 1.0, P.x0 + 1.4, P.x1 - 1.4);
    a.path = [...e.slice(0, e.length - 1).reverse().map((p) => ({ x: p.x, z: p.z + this.rng.range(-2, 2) })), { x: THREE.MathUtils.clamp(cx, P.x0 + 1, P.x1 - 1), z: 1.5 }, { x: wx, z: -1.5 }, { x: wx, z: zWait }];
    a.onArrive = 'wait';
    a.targetPf = pf;
    a.face = face > 0 ? Math.PI / 2 : -Math.PI / 2;
    if (this.rng.chance(0.15)) a.pref = this.rng.range(2.2, 3.2); // running for the train
  }

  private spawnCrosser(): void {
    const w2e = this.rng.chance(0.5);
    if (w2e && this.streetCfg && !this.populating) {
      this.spawnStreetWalker(false, 'cross');
      return;
    }
    const a = this.spawn(w2e ? -29 : 29, CONCOURSE.passageZ + this.rng.range(-3, 3));
    this.cross(a, w2e);
  }

  /** Through the concourse from one side exit to the other (or out to the south). */
  private cross(a: Agent, w2e: boolean): void {
    const toSouth = this.rng.chance(0.4);
    const via = toSouth ? [{ x: 3 + this.rng.range(-1, 1), z: 9 }, ...EXITS.S.slice(1)] : w2e ? EXITS.E : EXITS.W;
    a.path = [{ x: w2e ? -20 : 20, z: CONCOURSE.passageZ + this.rng.range(-4, 4) }, ...via.map((p) => ({ x: p.x, z: p.z + this.rng.range(-2.5, 2.5) }))];
    a.pi = 0;
    a.onArrive = 'despawn';
    a.exitW = !w2e && !toSouth;
  }

  /** Initial population so the station is alive on the first frame. */
  private populating = false;

  populate(hour: number): void {
    void hour;
    this.populating = true;
    const n = Math.round(260 * this.density);
    for (let i = 0; i < n; i++) {
      this.spawnBoarder();
      const a = this.agents[this.agents.length - 1];
      // Teleport most of them to their waiting spot.
      if (this.rng.chance(0.8)) {
        const last = a.path[a.path.length - 1];
        a.x = last.x + this.rng.gauss() * 0.4;
        a.z = last.z + this.rng.gauss() * 1.5;
        a.pi = a.path.length;
        a.state = 'idle';
        a.timer = 1e9;
        a.onArrive = 'wait';
        a.heading = a.face ?? 0;
        a.pose = this.rng.chance(0.35) ? 2 : 0;
      } else {
        a.pi = this.rng.int(0, a.path.length - 1);
        const p = a.path[a.pi];
        a.x = p.x;
        a.z = p.z;
      }
    }
    for (let i = 0; i < 40 * this.density; i++) {
      this.spawnCrosser();
      const a = this.agents[this.agents.length - 1];
      a.x = this.rng.range(-22, 22);
      a.pi = 1;
    }
    // Benches: roughly half the seats taken.
    this.seats.forEach((s, i) => {
      if (!this.rng.chance(0.55)) return;
      for (const dz of [-0.62, 0, 0.62]) {
        if (!this.rng.chance(0.6)) continue;
        const a = this.spawn(s.x, s.z + dz);
        a.state = 'sit';
        a.pose = 1;
        a.heading = s.rot;
        a.y = Y.platform;
        this.seatUsed[i] = true;
      }
    });
    this.populating = false;
  }

  // ---------------------------------------------------------------------------
  private cell(x: number, z: number): number {
    return (Math.floor(x / 1.5) + 1000) * 4000 + (Math.floor(z / 1.5) + 2000);
  }

  /** True if anyone is within r metres of (x, z); traffic yields to them. */
  occupied(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    if (this.player && (this.player.x - x) ** 2 + (this.player.z - z) ** 2 < r2) return true;
    for (let ix = Math.floor((x - r) / 1.5); ix <= Math.floor((x + r) / 1.5); ix++)
      for (let iz = Math.floor((z - r) / 1.5); iz <= Math.floor((z + r) / 1.5); iz++) {
        const l = this.grid.get((ix + 1000) * 4000 + (iz + 2000));
        if (l) for (const b of l) if ((b.x - x) ** 2 + (b.z - z) ** 2 < r2 && b.y < 1.2) return true;
      }
    return false;
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const a of this.agents) {
      if (a.state === 'gone') continue;
      const k = this.cell(a.x, a.z);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(a);
    }
  }

  private clampToRegions(a: Agent): void {
    // Keep people on walkable floor (platform, concourse, exits); boarding people may reach the door.
    let best: Region | null = null;
    let bestD = Infinity;
    for (const r of this.regions) {
      const cx = THREE.MathUtils.clamp(a.x, r.x0, r.x1);
      const cz = THREE.MathUtils.clamp(a.z, r.z0, r.z1);
      const d = (cx - a.x) ** 2 + (cz - a.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
      if (d === 0) break;
    }
    if (best && bestD > 0) {
      a.x = THREE.MathUtils.clamp(a.x, best.x0, best.x1);
      a.z = THREE.MathUtils.clamp(a.z, best.z0, best.z1);
    }
    if (best) a.y = best.y1 === undefined ? best.y : THREE.MathUtils.lerp(best.y, best.y1, THREE.MathUtils.clamp((a.x - best.x0) / (best.x1 - best.x0), 0, 1));
  }

  update(dt: number, hour: number, camera: THREE.Camera): void {
    dt = Math.min(dt, 0.05);
    const rng = this.rng;
    // Evening rush: a steady stream of commuters heading for the trains.
    let alive = 0;
    for (const a of this.agents) if (!a.street) alive++;
    this.spawnAcc += dt * 1.35 * this.density * (alive < this.cap ? 1 : 0);
    while (this.spawnAcc > 1) {
      this.spawnAcc -= 1;
      if (rng.chance(0.78)) this.spawnBoarder();
      else this.spawnCrosser();
    }
    if (this.streetCfg) {
      let n = 0;
      while (this.streetWalkers < this.streetCfg.walkers * this.density && n++ < 3) this.spawnStreetWalker(false);
    }
    this.rebuildGrid();
    // Waiting commuters board once their train is standing.
    const views = this.trains.views;
    for (const a of this.agents) {
      if (a.state === 'gone') continue;
      if (a.onArrive === 'wait' && a.state === 'idle' && a.pi >= a.path.length) {
        const v = views[a.targetPf - 1];
        if (v && v.state === 'dwell' && v.phaseTime > 6 + (a.id % 23)) {
          const doors = this.trains.doorways(v).filter((d) => Math.sign(d.x - v.x) === Math.sign(a.x - v.x));
          let best = doors[0];
          let bd = Infinity;
          for (const d of doors) {
            const dd = Math.abs(d.z - a.z) + Math.abs(d.x - a.x) * 0.3;
            if (dd < bd) {
              bd = dd;
              best = d;
            }
          }
          if (best && bd < 40) {
            a.door = best;
            a.path = [{ x: best.x - best.side * 0.9, z: best.z + rng.range(-0.3, 0.3) }, { x: best.x - best.side * 0.1, z: best.z }];
            a.pi = 0;
            a.state = 'walk';
            a.onArrive = 'board';
            a.pose = 0;
            a.pref = rng.range(1.4, 2.4);
          }
        }
      }
    }
    for (const a of this.agents) {
      if (a.state === 'gone') continue;
      if (a.state === 'sit') continue;
      if (a.state === 'idle') {
        a.timer -= dt;
        a.speed *= 0.85;
        if (this.player) {
          const ox = a.x - this.player.x;
          const oz = a.z - this.player.z;
          const d2 = ox * ox + oz * oz;
          if (d2 < 1.6 && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            a.x += (ox / d) * dt * 0.9;
            a.z += (oz / d) * dt * 0.9;
          }
        }
        if (a.face !== null) a.heading = THREE.MathUtils.lerp(a.heading, a.face, 1 - Math.exp(-dt * 2));
        if (a.onArrive === 'linger' && a.timer <= 0 && a.pi >= a.path.length) {
          // Time to go: stroll off along the promenade (a couple leaves together).
          const pts = this.streetCfg ? this.streetCfg.leave(a.x, a.z, rng) : [];
          if (pts.length < 2) {
            a.state = 'gone';
            this.streetWalkers--;
            continue;
          }
          const mate = a.partner;
          for (const m of mate && mate.state === 'idle' && mate.onArrive === 'linger' ? [a, mate] : [a]) {
            m.path = m === a ? pts : offsetPath(pts, (m.x - a.x) * (pts[1].z - pts[0].z) - (m.z - a.z) * (pts[1].x - pts[0].x) > 0 ? 0.55 : -0.55);
            m.pi = 0;
            m.onArrive = 'despawn';
            m.state = 'walk';
            m.face = null;
            m.pose = 0;
          }
          continue;
        }
        if (a.waitAt >= 0 && a.pi === a.waitAt) {
          if (this.streetCfg?.pedWalk()) {
            a.hurryUntil = a.waitAt + 2;
            a.waitAt = -1;
            a.state = 'walk';
          }
          continue;
        }
        if (a.timer <= 0 && a.pi < a.path.length) a.state = 'walk';
        continue;
      }
      // Steering towards the next waypoint.
      const target = a.path[a.pi];
      if (!target) {
        this.arrive(a);
        continue;
      }
      let dx = target.x - a.x;
      let dz = target.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist < (a.onArrive === 'board' ? 0.3 : 0.9)) {
        if (a.street && a.waitAt === a.pi && this.streetCfg && !this.streetCfg.pedWalk()) {
          a.state = 'idle';
          a.timer = 1e9;
          const nx = a.path[a.pi + 1] ?? target;
          a.face = Math.atan2(nx.x - a.x, nx.z - a.z);
          continue;
        }
        if (a.street && a.waitAt === a.pi) {
          a.hurryUntil = a.waitAt + 2;
          a.waitAt = -1;
        }
        a.pi++;
        if (a.pi >= a.path.length) this.arrive(a);
        continue;
      }
      dx /= dist;
      dz /= dist;
      // Separation from neighbours.
      let sx = 0;
      let sz = 0;
      const cx = Math.floor(a.x / 1.5);
      const cz = Math.floor(a.z / 1.5);
      for (let ix = cx - 1; ix <= cx + 1; ix++)
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const l = this.grid.get((ix + 1000) * 4000 + (iz + 2000));
          if (!l) continue;
          for (const b of l) {
            if (b === a || b === a.partner) continue;
            const ox = a.x - b.x;
            const oz = a.z - b.z;
            const d2 = ox * ox + oz * oz;
            if (d2 < 0.55 && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const f = (0.75 - d) / d;
              sx += ox * f;
              sz += oz * f;
            }
          }
        }
      if (this.player) {
        const ox = a.x - this.player.x;
        const oz = a.z - this.player.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 4.4 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const f = (2.1 - d) / d;
          sx += ox * f * 2.2;
          sz += oz * f * 2.2;
        }
      }
      // Across the road people walk briskly and keep going.
      let pref = a.pi <= a.hurryUntil ? Math.max(a.pref, 1.75) : a.pref;
      // Couples keep pace: whoever gets ahead eases off, whoever falls behind catches up.
      const mate = a.partner;
      if (mate && mate.state !== 'gone') {
        const ahead = (a.x - mate.x) * dx + (a.z - mate.z) * dz;
        if (mate.state !== 'walk' && ahead > 0.2) pref *= 0.3;
        else pref *= THREE.MathUtils.clamp(1 - ahead * 0.6, 0.55, 1.35);
      }
      let vx = dx * pref + sx * (a.pi <= a.hurryUntil ? 0.6 : 1.6);
      let vz = dz * pref + sz * (a.pi <= a.hurryUntil ? 0.6 : 1.6);
      const vl = Math.hypot(vx, vz);
      if (vl > pref) {
        vx = (vx / vl) * pref;
        vz = (vz / vl) * pref;
      }
      const spd = Math.hypot(vx, vz);
      a.speed += (spd - a.speed) * (1 - Math.exp(-dt * 5));
      a.x += vx * dt;
      a.z += vz * dt;
      if (spd > 0.05) {
        const want = Math.atan2(vx, vz);
        let dh = want - a.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        a.heading += dh * (1 - Math.exp(-dt * 8));
      }
      if (a.street) a.y = this.streetCfg ? this.streetCfg.ground(a.x, a.z) : a.y;
      else if (a.onArrive !== 'board') this.clampToRegions(a);
      a.phase += (a.speed * dt * Math.PI * 2) / 1.45;
    }
    this.agents = this.agents.filter((a) => a.state !== 'gone');
    this.render(camera, hour);
  }

  private arrive(a: Agent): void {
    const cfg = this.streetCfg;
    if (cfg && a.exitW && !a.street && a.onArrive === 'despawn') {
      // Out of the west exit and on into the streets (IMC Road, V.N. Road, the sea).
      const r = cfg.fromStation(this.rng);
      a.exitW = false;
      a.street = true;
      a.path = r.pts;
      a.pi = 0;
      a.waitAt = r.waitAt;
      a.onArrive = r.linger ? 'linger' : 'despawn';
      if (r.linger) {
        a.face = r.linger.ry;
        a.timer = r.linger.seconds;
      }
      a.pref = Math.min(a.pref, 1.5);
      this.streetWalkers++;
      return;
    }
    if (a.street && a.intoStation) {
      // Up the steps into the concourse.
      const into = a.intoStation;
      a.intoStation = null;
      a.street = false;
      this.streetWalkers--;
      a.state = 'walk';
      a.waitAt = -1;
      if (into === 'board') this.board(a, 'W');
      else this.cross(a, true);
      a.pi = 0;
      return;
    }
    if (a.street && a.onArrive === 'despawn') {
      // Still in plain view: walk on along the footpath rather than vanish.
      const n = a.path.length;
      if (cfg && n >= 2 && this.inSight(a.x, a.z) && a.path.length < 400) {
        const p = a.path[n - 1];
        const q = a.path[n - 2];
        const d = Math.hypot(p.x - q.x, p.z - q.z) || 1;
        const nx = p.x + ((p.x - q.x) / d) * 20;
        const nz = p.z + ((p.z - q.z) / d) * 20;
        if (cfg.ground(nx, nz) > 0.1 && cfg.ground((p.x + nx) / 2, (p.z + nz) / 2) > 0.1) {
          a.path.push({ x: nx, z: nz });
          return;
        }
      }
      a.state = 'gone';
      this.streetWalkers--;
      return;
    }
    if (a.onArrive === 'linger') {
      a.state = 'idle';
      a.pose = this.rng.chance(0.4) ? 2 : 0;
      return;
    }
    if (a.onArrive === 'despawn') a.state = 'gone';
    else if (a.onArrive === 'board') {
      a.state = 'gone';
      this.boarded.set(a.targetPf, (this.boarded.get(a.targetPf) ?? 0) + 1);
    } else if (a.onArrive === 'wait') {
      a.state = 'idle';
      a.timer = 1e9;
      a.pose = this.rng.chance(0.4) ? 2 : 0;
    } else {
      a.state = 'idle';
      a.timer = this.rng.range(5, 30);
    }
  }

  // ---------------------------------------------------------------------------
  private render(camera: THREE.Camera, hour: number): void {
    void hour;
    const counts = this.meshes.map(() => [0, 0]);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const cam = camera.position;
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.sight.frustum.copy(frustum);
    this.sight.pos.copy(cam);
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    const put = (look: Look, x: number, y: number, z: number, heading: number, phase: number, amp: number, pose: number) => {
      const dx = x - cam.x;
      const dz = z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > MAX_DIST * MAX_DIST) return;
      if (d2 > 36) {
        sphere.center.set(x, y + 0.9, z);
        if (!frustum.intersectsSphere(sphere)) return;
      }
      const lod = d2 < LOD_DIST * LOD_DIST ? 0 : 1;
      const v = look.variant;
      const slot = this.meshes[v][lod];
      const i = counts[v][lod];
      if (i >= slot.mesh.instanceMatrix.count) return;
      counts[v][lod]++;
      q.setFromAxisAngle(up, heading);
      p.set(x, y, z);
      m.compose(p, q, one);
      slot.mesh.setMatrixAt(i, m);
      const A = slot.attrs;
      A.aAnim.setXYZW(i, phase, amp, pose, look.scale);
      A.aTop.setXYZ(i, ...look.top);
      A.aBottom.setXYZ(i, ...look.bottom);
      A.aAccent.setXYZ(i, ...look.accent);
      A.aSkinHair.setXYZW(i, ...look.skin, look.hair);
      A.aFlags.setXYZW(i, ...look.flags);
      A.aMisc.setXYZW(i, ...look.misc);
      A.aStyle.setXYZW(i, ...look.style);
    };
    for (const a of this.agents) {
      // Shorter strides in a saree.
      const amp = Math.min(1, a.speed / 1.3) * (a.look.variant === 2 ? 0.6 : 1);
      put(a.look, a.x, a.y, a.z, a.heading, a.phase, a.state === 'sit' ? 0 : amp, a.pose);
    }
    // Passengers inside standing / departing trains (and hanging out of doorways).
    for (const v of this.trains.views) {
      if (v.state !== 'dwell' && v.state !== 'departing') continue;
      const boarded = this.boarded.get(v.pf) ?? 0;
      const load = v.state === 'departing' ? Math.max(boarded, 140) : boarded;
      this.renderOccupants(v, Math.min(load, 180), put, cam, frustum);
    }
    for (let v = 0; v < this.meshes.length; v++)
      for (let l = 0; l < 2; l++) {
        const s = this.meshes[v][l];
        s.mesh.count = counts[v][l];
        s.mesh.instanceMatrix.needsUpdate = true;
        for (const k in s.attrs) s.attrs[k].needsUpdate = true;
      }
  }

  private renderOccupants(v: TrainView, n: number, put: (look: Look, x: number, y: number, z: number, h: number, ph: number, amp: number, pose: number) => void, cam: THREE.Vector3, frustum: THREE.Frustum): void {
    const perCar = Math.ceil(n / 12);
    const moving = v.state === 'departing';
    const carSphere = new THREE.Sphere(new THREE.Vector3(), 11);
    const skip = this.trains.skipCar.get(v.pf) ?? -1;
    for (let c = 0; c < 12; c++) {
      if (c === skip) continue;
      const cz = TrainSystem.carZ(v.headZ, c);
      carSphere.center.set(v.x, 2, cz);
      if ((v.x - cam.x) ** 2 + (cz - cam.z) ** 2 > 75 * 75 || !frustum.intersectsSphere(carSphere)) continue;
      for (let k = 0; k < perCar; k++) {
        const seed = v.pf * 1000 + c * 37 + k;
        const look = this.occupantLooks[seed % this.occupantLooks.length];
        const r = ((seed * 9301 + 49297) % 233280) / 233280;
        const r2 = ((seed * 4271 + 1231) % 9973) / 9973;
        let x: number;
        let z: number;
        let h: number;
        let pose: number;
        if (k < 10) {
          // Seated in the bench bays.
          const side = k % 2 ? 1 : -1;
          x = v.x + side * (CAR.halfW - 0.8 + (r - 0.5) * 0.7);
          z = cz + (-8 + Math.floor(k / 2) * 3.9) + (r2 > 0.5 ? 0.55 : -0.55);
          h = r2 > 0.5 ? Math.PI : 0;
          pose = 1;
        } else if (k < 14 && moving) {
          // Door hangers: standing in the doorway, holding the pole, leaning out.
          const door = CAR.doors[k % 3];
          const side = k % 2 ? 1 : -1;
          x = v.x + side * (CAR.halfW - 0.12);
          z = cz + door + (r - 0.5) * 0.6;
          h = side > 0 ? Math.PI / 2 + 0.3 : -Math.PI / 2 - 0.3;
          pose = 3;
        } else {
          // Standing in the aisle, holding the grab rails.
          x = v.x + (r - 0.5) * 1.2;
          z = cz + (r2 - 0.5) * 18;
          h = r > 0.5 ? 0 : Math.PI;
          pose = r2 > 0.3 ? 3 : 2;
        }
        put(look, x, CAR.floorY - (pose === 1 ? 0 : 0), z, h, 0, 0, pose);
      }
    }
    void EDGE;
    void TRACKS;
  }

  get count(): number {
    return this.agents.length;
  }

  /** Population breakdown (for diagnostics). */
  census(): Record<string, number> {
    const c: Record<string, number> = { station: 0, street: 0, streetWalkers: this.streetWalkers, sitting: 0, idle: 0, walking: 0 };
    for (const a of this.agents) {
      c[a.street ? 'street' : 'station']++;
      c[a.state === 'sit' ? 'sitting' : a.state === 'idle' ? 'idle' : 'walking']++;
    }
    return c;
  }

  /** People within r metres of p (for audio). */
  peopleNear(p: THREE.Vector3, r: number): { pos: THREE.Vector3; walking: boolean }[] {
    const out: { pos: THREE.Vector3; walking: boolean }[] = [];
    const r2 = r * r;
    for (const a of this.agents) {
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      if (dx * dx + dz * dz < r2) out.push({ pos: new THREE.Vector3(a.x, a.y, a.z), walking: a.state === 'walk' && a.speed > 0.3 });
    }
    return out;
  }
}
