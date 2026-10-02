import * as THREE from 'three';
import { RNG } from '../../core/Random';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import { buildHuman, type Variant } from './HumanGeometry';
import { CROWD_ATTRS, createCrowdDepthMaterial, createCrowdMaterial, writeLook } from './CrowdMaterial';
import { POSE, child, jogger, makeLook, makeLookOf, man, policeLook, woman, youngMan, youngWoman, type Look } from './Looks';
import { CAR } from '../train/Livery';
import { TrainSystem, type TrainView } from '../train/TrainSystem';
import { CONCOURSE, EDGE, PLATFORMS, TRACKS, Y } from '../../world/churchgate/Layout';

type State = 'walk' | 'idle' | 'sit' | 'gone';

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
  /** Whom this one keeps pace with (a couple, friends, a family: the others keep pace with the first). */
  partner: Agent | null;
  /** Everyone out together, the first leading; each walks `slot` metres to the left of the route. */
  group: Agent[] | null;
  slot: number;
  /** With the partner: which side they are on and what the two are doing (POSE side + act). */
  bond: number;
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

/** POSE side code for b as seen by a (facing `heading`): +x is a's left. */
function sideOf(ax: number, az: number, heading: number, bx: number, bz: number): number {
  return (bx - ax) * Math.cos(heading) - (bz - az) * Math.sin(heading) > 0 ? POSE.partnerPlusX : POSE.partnerMinusX;
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

const MAX = { man: 900, woman: 450, saree: 380, youth: 650, girl: 850 };
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
      group: null,
      slot: 0,
      bond: 0,
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
    // The sunset crowd on the sea wall: mostly people on their own or with a friend or two; now
    // and then a couple (close together, her head on his shoulder, or turned to each other
    // talking) or a family with a child between them.
    const sitAt = (x: number, z: number, seat: StreetSpot, ry: number, look: Look) => {
      // Hips on the wall top whatever the height; a child sits nearer the edge so the legs hang clear.
      const fwd = Math.max(0, 0.39 - 0.42 * look.scale);
      const a = this.spawn(x + Math.sin(ry) * fwd, z + Math.cos(ry) * fwd, look);
      a.street = true;
      a.state = 'sit';
      a.pose = POSE.sit;
      a.heading = ry;
      a.y = seat.y + 0.49 * (1 - look.scale);
      return a;
    };
    const together = (members: Agent[]) => {
      for (const m of members) m.group = members;
    };
    for (let i = 0; i < cfg.seats.length; i++) {
      const seat = cfg.seats[i];
      if (!rng.chance(cfg.seatOccupancy(seat.x, seat.z))) continue;
      const row = (k: number) => {
        const n = cfg.seats[i + k];
        return n && Math.abs(n.ry - seat.ry) < 0.3 && Math.hypot(n.x - seat.x, n.z - seat.z) < k * 0.8 ? n : null;
      };
      const next = row(1);
      const r = rng.next();
      if (next && r < 0.06) {
        // A couple on two seats.
        const kind = rng.weighted([
          ['close', 3.5],
          ['lean', 3],
          ['talk', 3.5],
        ] as const);
        const half = kind === 'talk' ? 0.28 : 0.205;
        const turn = kind === 'talk' ? 0.42 : kind === 'lean' ? 0.04 : 0.1;
        const mx = (seat.x + next.x) / 2;
        const mz = (seat.z + next.z) / 2;
        const ul = Math.hypot(next.x - seat.x, next.z - seat.z) || 1;
        const ux = (next.x - seat.x) / ul;
        const uz = (next.z - seat.z) / ul;
        const older = rng.chance(0.25);
        const her = makeLookOf(rng, older ? woman : youngWoman);
        const him = makeLookOf(rng, older ? man : (q) => youngMan(q));
        const herFirst = rng.chance(0.5);
        const place = (look: Look, s: number) => {
          const x = mx + ux * half * s;
          const z = mz + uz * half * s;
          const side = sideOf(x, z, seat.ry, mx - ux * half * s, mz - uz * half * s);
          return { a: sitAt(x, z, seat, seat.ry + (side === POSE.partnerPlusX ? turn : -turn), look), side };
        };
        const h = place(her, herFirst ? -1 : 1);
        const m = place(him, herFirst ? 1 : -1);
        if (kind === 'lean') h.a.bond = h.side + POSE.lean;
        else if (kind === 'talk') {
          h.a.bond = h.side + POSE.talk;
          m.a.bond = m.side + POSE.talk;
        }
        h.a.partner = m.a;
        m.a.partner = h.a;
        together([h.a, m.a]);
        i++;
        continue;
      }
      if (next && r < 0.13) {
        // Friends: two or three young people, the middle one chatting to a neighbour.
        const n = row(2) && rng.chance(0.4) ? 3 : 2;
        const mix = rng.weighted([
          ['girls', 4.5],
          ['boys', 3.5],
          ['mixed', 2],
        ] as const);
        const members: Agent[] = [];
        for (let k = 0; k < n; k++) {
          const st = cfg.seats[i + k];
          const girl = mix === 'girls' || (mix === 'mixed' && k % 2 === 0);
          members.push(sitAt(st.x, st.z, st, st.ry + (k === 0 ? 0.12 : k === n - 1 ? -0.12 : 0), makeLookOf(rng, girl ? youngWoman : (q) => youngMan(q))));
        }
        const talker = members[n === 3 ? 1 : 0];
        const listener = members[n === 3 ? (rng.chance(0.5) ? 0 : 2) : 1];
        talker.bond = sideOf(talker.x, talker.z, talker.heading, listener.x, listener.z) + POSE.talk;
        together(members);
        i += n - 1;
        continue;
      }
      if (next && row(2) && r < 0.155) {
        // A family: mother, child, father.
        const st2 = cfg.seats[i + 2];
        const members = [sitAt(seat.x, seat.z, seat, seat.ry, makeLookOf(rng, woman)), sitAt(next.x, next.z, next, next.ry, makeLookOf(rng, child)), sitAt(st2.x, st2.z, st2, st2.ry, makeLookOf(rng, man))];
        together(members);
        i += 2;
        continue;
      }
      sitAt(seat.x + rng.range(-0.12, 0.12), seat.z + rng.range(-0.12, 0.12), seat, seat.ry + rng.range(-0.25, 0.25), makeLook(rng, STREET_YOUTH));
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
    const stand = (x: number, z: number, st: StreetSpot, ry: number, look: Look) => {
      const a = this.spawn(x, z, look);
      a.street = true;
      a.state = 'idle';
      a.timer = 1e9;
      a.onArrive = 'wait';
      a.face = ry;
      a.heading = ry;
      a.y = st.y;
      return a;
    };
    for (const st of cfg.standing) {
      const r = rng.next();
      if (r < 0.12) {
        // A couple at the wall looking out to sea: holding hands, talking, or her head on his shoulder.
        const ax = Math.cos(st.ry);
        const az = -Math.sin(st.ry);
        const act = rng.weighted([
          [POSE.hands, 4.5],
          [POSE.talk, 3],
          [POSE.lean, 2.5],
        ] as const);
        const older = rng.chance(0.2);
        const her = stand(st.x - ax * 0.24, st.z - az * 0.24, st, st.ry, makeLookOf(rng, older ? woman : youngWoman));
        const him = stand(st.x + ax * 0.24, st.z + az * 0.24, st, st.ry, makeLookOf(rng, older ? man : (q) => youngMan(q)));
        const hs = sideOf(her.x, her.z, st.ry, him.x, him.z);
        const ms = sideOf(him.x, him.z, st.ry, her.x, her.z);
        her.bond = hs + act;
        him.bond = act === POSE.lean ? 0 : ms + act;
        if (act === POSE.talk) {
          her.face = her.heading = st.ry + (hs === POSE.partnerPlusX ? 0.35 : -0.35);
          him.face = him.heading = st.ry + (ms === POSE.partnerPlusX ? 0.35 : -0.35);
        }
        her.partner = him;
        him.partner = her;
        together([her, him]);
        continue;
      }
      const tourist = r < 0.2;
      const a = stand(st.x, st.z, st, st.ry, tourist ? makeLookOf(rng, rng.chance(0.55) ? woman : man) : makeLook(rng, STREET_YOUTH));
      // Tourists photograph the sunset; others check their phones.
      a.pose = tourist ? POSE.photo : rng.chance(0.35) ? POSE.phone : POSE.stand;
    }
    for (const st of cfg.loiter) {
      const a = stand(st.x, st.z, st, st.ry, makeLook(rng, STREET_YOUTH));
      a.pose = rng.chance(0.35) ? POSE.phone : POSE.stand;
    }
    // Pre-warm walkers spread along their routes.
    for (let i = 0; i < cfg.walkers; i++) this.spawnStreetWalker(true);
  }

  /** Couples, friends and families out together (test API): where each group is and what the first is doing. */
  groups(): { x: number; z: number; heading: number; n: number; bond: number; state: State }[] {
    const seen = new Set<Agent[]>();
    const out: { x: number; z: number; heading: number; n: number; bond: number; state: State }[] = [];
    for (const a of this.agents)
      if (a.group && !seen.has(a.group)) {
        seen.add(a.group);
        const b = a.group.find((m) => m.bond) ?? a;
        out.push({ x: +a.x.toFixed(2), z: +a.z.toFixed(2), heading: +a.heading.toFixed(3), n: a.group.length, bond: b.bond, state: a.state });
      }
    return out;
  }

  /** For looking over the crowd (test API): n people drawn as on the promenade, in a row at (x, z) facing ry. */
  lineup(x: number, z: number, ry: number, n: number, who: 'women' | 'all' = 'women'): void {
    const ax = Math.cos(ry);
    const az = -Math.sin(ry);
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 0.72;
      const look = who === 'women' ? makeLookOf(this.rng, (q) => (q.chance(0.55) ? youngWoman(q) : woman(q))) : makeLook(this.rng, STREET_YOUTH);
      const a = this.spawn(x + ax * o, z + az * o, look);
      a.street = true;
      a.state = 'idle';
      a.timer = 1e9;
      a.onArrive = 'wait';
      a.face = ry;
      a.heading = ry;
      a.y = this.streetCfg ? this.streetCfg.ground(a.x, a.z) : Y.platform;
    }
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
    // Most walk alone; a few couples, friends and families stroll together; joggers keep to the promenade.
    const kind = into
      ? 'solo'
      : rng.weighted([
          ['solo', 78],
          ['couple', 7],
          ['friends', 7],
          ['family', 3.5],
          ['jog', r.waitAt < 0 && !r.linger && !r.into ? 6 : 0],
        ] as const);
    const pref = kind === 'jog' ? rng.range(2.4, 3.1) : kind === 'family' ? rng.range(0.85, 1.05) : kind === 'solo' ? rng.range(1.05, 1.45) : rng.range(0.95, 1.25);
    const walker = (slot: number, look: Look) => {
      const pts = slot ? offsetPath(r.pts, slot) : r.pts;
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
      a.slot = slot;
      a.y = cfg.ground(a.x, a.z);
      const n = pts[Math.min(pts.length - 1, a.pi)];
      a.heading = Math.atan2(n.x - a.x, n.z - a.z);
      a.intoStation = into ?? r.into ?? null;
      this.streetWalkers++;
      return a;
    };
    if (kind === 'solo') {
      walker(0, makeLook(rng, into ? 0.3 : STREET_YOUTH));
      return;
    }
    if (kind === 'jog') {
      walker(0, makeLookOf(rng, (q) => jogger(q, q.chance(0.45))));
      return;
    }
    let members: Agent[];
    if (kind === 'couple') {
      // Side by side, 0.55 m apart (offsetPath puts the second on the first's left, +x): holding hands, talking, or just walking.
      const older = rng.chance(0.25);
      const herLeft = rng.chance(0.5);
      const her = makeLookOf(rng, older ? woman : youngWoman);
      const him = makeLookOf(rng, older ? man : (q) => youngMan(q));
      members = [walker(0, herLeft ? him : her), walker(0.55, herLeft ? her : him)];
      const act = rng.weighted([
        [POSE.hands, 5],
        [POSE.talk, 2.5],
        [0, 2.5],
      ] as const);
      if (act) {
        members[0].bond = POSE.partnerPlusX + act;
        members[1].bond = POSE.partnerMinusX + act;
      }
    } else if (kind === 'friends') {
      const n = rng.chance(0.4) ? 3 : 2;
      const mix = rng.weighted([
        ['girls', 4.5],
        ['boys', 3.5],
        ['mixed', 2],
      ] as const);
      members = [];
      for (let k = 0; k < n; k++) members.push(walker(k * 0.62, makeLookOf(rng, mix === 'girls' || (mix === 'mixed' && k % 2 === 0) ? youngWoman : (q) => youngMan(q))));
      members[1].bond = POSE.partnerMinusX + POSE.talk;
    } else {
      // A family: father, mother, a child beside her, sometimes another on his other side.
      members = [walker(0, makeLookOf(rng, man)), walker(0.6, makeLookOf(rng, woman)), walker(1.1, makeLookOf(rng, child))];
      if (rng.chance(0.35)) members.push(walker(-0.5, makeLookOf(rng, child)));
    }
    members[0].partner = members[1];
    for (const m of members.slice(1)) m.partner = members[0];
    for (const m of members) m.group = members;
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
      // Talking: the head and a hand move on the phase.
      if (a.state !== 'walk' && Math.floor(a.bond / 32) === 3) a.phase += dt * 1.6;
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
          // Time to go: stroll off along the promenade (a couple or a group leaves together, each
          // keeping their place beside the others).
          const pts = this.streetCfg ? this.streetCfg.leave(a.x, a.z, rng) : [];
          if (pts.length < 2) {
            a.state = 'gone';
            this.streetWalkers--;
            continue;
          }
          const ex = pts[1].x - pts[0].x;
          const ez = pts[1].z - pts[0].z;
          const el = Math.hypot(ex, ez) || 1;
          const going = a.group ? a.group.filter((m) => m === a || (m.state === 'idle' && m.onArrive === 'linger')) : [a];
          for (const m of going) {
            const off = THREE.MathUtils.clamp(((m.x - a.x) * ez - (m.z - a.z) * ex) / el, -1.4, 1.4);
            m.path = m === a ? pts : offsetPath(pts, off);
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
            if (b === a || b === a.partner || (a.group !== null && b.group === a.group)) continue;
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
      // Up the steps into the concourse (from here on everyone goes their own way).
      const into = a.intoStation;
      a.intoStation = null;
      a.partner = null;
      a.group = null;
      a.bond = 0;
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
      // At the wall: a phone out, now and then a photo of the sunset; couples stay as they are.
      a.state = 'idle';
      a.pose = a.bond ? POSE.stand : this.rng.weighted([
        [POSE.stand, 5],
        [POSE.phone, 3.5],
        [POSE.photo, 1.5],
      ] as const);
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
      writeLook(slot.attrs, i, look, phase, amp, pose);
    };
    for (const a of this.agents) {
      // Shorter strides in a saree or a long skirt, longer at a run; with a partner, hand in hand,
      // leaning on a shoulder or turned to talk.
      const amp = Math.min(a.speed > 2.1 ? 1.45 : 1, a.speed / 1.3) * a.look.stride;
      const pose = a.bond && a.pose <= POSE.sit ? a.pose + a.bond : a.pose;
      put(a.look, a.x, a.y, a.z, a.heading, a.phase, a.state === 'sit' ? 0 : amp, pose);
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
