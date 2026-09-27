import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../../core/Random';
import type { GeoRoad } from '../../world/city/City';
import type { StationMaterials } from '../../world/churchgate/StationMaterials';
import { buildVehicle, type VehicleKind } from './VehicleGeometry';

interface Lane {
  id: number;
  pts: THREE.Vector2[];
  cum: number[];
  length: number;
  startKey: string;
  endKey: string;
  roadId: number;
  speed: number;
  next: Lane[];
  vehicles: Vehicle[];
  /** Signal stop lines on this lane (and look-ahead copies from the following lane). */
  stops: { s: number; group: string }[];
}

interface Vehicle {
  kind: VehicleKind;
  lane: Lane;
  s: number;
  speed: number;
  max: number;
  len: number;
  color: THREE.Color;
  parked: boolean;
  pos: THREE.Vector3;
  heading: number;
  /** Lateral offset left over from a lane change at a node; faded out over `blend0` metres. */
  ox: number;
  oz: number;
  blend: number;
  blend0: number;
}

const KINDS: VehicleKind[] = ['taxi', 'cab', 'car', 'suv', 'bus', 'doubleDecker', 'scooter'];
const PALETTE = [0xe9e9e6, 0xdedede, 0xb8bbbf, 0x8a8d91, 0x2b2c2e, 0x151515, 0x8f1d1d, 0x1f3f7a, 0xc8b89a, 0x5a3b2a, 0x3c5a3c];

export interface TrafficOptions {
  center: { x: number; z: number };
  radius: number;
  count: number;
  parked: { x: number; z: number; heading: number; kind: VehicleKind }[];
  /** Areas that should be busy (spawn / respawn pool); defaults to the centre. */
  focus?: { x: number; z: number; r: number }[];
  /** Stop lines controlled by traffic signals. */
  stops?: { x: number; z: number; dx: number; dz: number; group: string }[];
  signals?: { aspect(group: never): 'red' | 'amber' | 'green' };
  /** Adjusts a lane's centre line (e.g. onto a hand-modelled carriageway); null drops the lane. */
  shapeLane?: (pts: THREE.Vector2[], road: GeoRoad, lane: number, lanes: number) => THREE.Vector2[] | null;
  /** True when a pedestrian stands within r metres of (x, z): vehicles near the viewer yield. */
  pedestrianAt?: (x: number, z: number, r: number) => boolean;
  /**
   * True where no car can be (inside a building, a wall, a kerbed island). Lanes and junction turns
   * that would drive through such a place are left out of the network.
   */
  blocked?: (x: number, z: number) => boolean;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const key = (v: THREE.Vector2) => `${Math.round(v.x / 2)},${Math.round(v.y / 2)}`;

/** Left-hand traffic on the OpenStreetMap road network around the station. */
export class Traffic {
  readonly group = new THREE.Group();
  private lanes: Lane[] = [];
  private vehicles: Vehicle[] = [];
  private rng = new RNG(88);
  private meshes = new Map<VehicleKind, { paint: THREE.InstancedMesh; glass: THREE.InstancedMesh; misc: THREE.InstancedMesh; lights: THREE.InstancedMesh }>();
  private lightMat: THREE.MeshBasicMaterial;
  readonly horns: THREE.Vector3[] = [];

  constructor(mats: StationMaterials, roads: GeoRoad[], private readonly opts: TrafficOptions) {
    this.group.name = 'traffic';
    this.buildLanes(roads);
    this.registerStops(opts.stops ?? []);
    const paintMat = mats.add('vehPaint', new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.45 }));
    const glassMat = mats.add('vehGlass', new THREE.MeshStandardMaterial({ color: 0x151a1f, roughness: 0.08, metalness: 0.8 }));
    const miscMat = mats.add('vehMisc', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }));
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const cap = opts.count + opts.parked.length + 8;
    for (const kind of KINDS) {
      const p = buildVehicle(kind);
      const accentCol = kind === 'taxi' ? [0.85, 0.6, 0.05] : kind === 'bus' || kind === 'doubleDecker' ? [0.85, 0.82, 0.72] : kind === 'scooter' ? [0.2, 0.25, 0.45] : [0.6, 0.6, 0.6];
      const misc = mergeGeometries([colour(p.accent, accentCol), colour(p.dark, [0.03, 0.03, 0.03])])!;
      const lights = mergeGeometries([colour(p.lightsFront, [3, 2.9, 2.6]), colour(p.lightsRear, [2.6, 0.12, 0.08])])!;
      const mk = (g: THREE.BufferGeometry, m: THREE.Material, shadow: boolean) => {
        const mesh = new THREE.InstancedMesh(g, m, cap);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        return mesh;
      };
      const paint = mk(p.paint, paintMat, true);
      paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      this.meshes.set(kind, { paint, glass: mk(p.glass, glassMat, true), misc: mk(misc, miscMat, true), lights: mk(lights, this.lightMat, false) });
    }
    this.spawnAll();
  }

  private buildLanes(roads: GeoRoad[]): void {
    const drivable = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk']);
    const { center, radius } = this.opts;
    let id = 0;
    for (const r of roads) {
      if (!drivable.has(r.k) || r.tun) continue;
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < r.p.length; i += 2) pts.push(new THREE.Vector2(r.p[i], r.p[i + 1]));
      if (pts.length < 2 || !pts.some((p) => Math.hypot(p.x - center.x, p.y - center.z) < radius)) continue;
      // Untagged one-way streets: a single moving lane when narrow (parking both sides), otherwise
      // two (the default OSM width overstates most carriageways of South Mumbai's dual roads).
      const lanesTotal = r.ow && !r.ln ? (r.w < 7 ? 1 : 2) : Math.max(1, r.ln ?? Math.round(r.w / 3.2));
      const speed = r.k === 'primary' ? 9 : r.k === 'secondary' ? 8 : r.k === 'tertiary' ? 7 : 5;
      const dirs = r.ow ? [1] : [1, -1];
      const perDir = r.ow ? lanesTotal : Math.max(1, Math.floor(lanesTotal / 2));
      for (const d of dirs) {
        const base = d > 0 ? pts : [...pts].reverse();
        for (let l = 0; l < perDir; l++) {
          // Offset to the left of travel (India drives on the left).
          const lw = Math.min(3.3, (r.ow ? r.w : r.w / 2) / perDir);
          const off = r.ow ? (l + 0.5 - perDir / 2) * lw : r.w / 2 - ((l + 0.5) * (r.w / 2)) / perDir;
          let lp: THREE.Vector2[] | null = offsetLine(base, off);
          // Lane 0 is the one nearest the centre of the road (the median on a dual carriageway).
          if (this.opts.shapeLane) lp = this.opts.shapeLane(lp, r, r.ow ? l : perDir - 1 - l, perDir);
          if (!lp || lp.length < 2) continue;
          if (this.opts.blocked && runBlocked(lp, this.opts.blocked)) {
            this.dropped.push({ road: r.n ?? `way ${r.id}`, pts: lp });
            continue;
          }
          const cum = [0];
          for (let i = 1; i < lp.length; i++) cum.push(cum[i - 1] + lp[i].distanceTo(lp[i - 1]));
          if (cum[cum.length - 1] < 8) continue;
          this.lanes.push({ id: id++, pts: lp, cum, length: cum[cum.length - 1], startKey: key(base[0]), endKey: key(base[base.length - 1]), roadId: r.id, speed, next: [], vehicles: [], stops: [] });
        }
      }
    }
    const byStart = new Map<string, Lane[]>();
    for (const l of this.lanes) {
      let a = byStart.get(l.startKey);
      if (!a) byStart.set(l.startKey, (a = []));
      a.push(l);
    }
    for (const l of this.lanes) l.next = (byStart.get(l.endKey) ?? []).filter((n) => n.roadId !== l.roadId || n.endKey !== l.startKey);
    // A turn eases from the end of one lane onto the start of the next (see update); drop the turns
    // whose eased path would cut through a building corner or over a kerb.
    const blocked = this.opts.blocked;
    if (blocked) {
      const p = new THREE.Vector3();
      for (const l of this.lanes) {
        const end = l.pts[l.pts.length - 1];
        l.next = l.next.filter((n) => {
          const st = n.pts[0];
          const d = Math.hypot(end.x - st.x, end.y - st.y);
          const b0 = Math.min(26, 5 + d * 2.5);
          const path: THREE.Vector2[] = [];
          for (let s = 0; s <= Math.min(b0, n.length); s += 1) {
            this.sample(n, s, p);
            const u = 1 - s / b0;
            const f = d > 0.05 ? u * u * (3 - 2 * u) : 0;
            path.push(new THREE.Vector2(p.x + (end.x - st.x) * f, p.z + (end.y - st.y) * f));
          }
          return !runBlocked(path, blocked);
        });
      }
    }
  }

  /** Lanes left out because they run through buildings or walls (for diagnostics). */
  readonly dropped: { road: string; pts: THREE.Vector2[] }[] = [];

  /** Attaches each signal stop line to the lanes that pass through it, travelling the same way. */
  private registerStops(stops: NonNullable<TrafficOptions['stops']>): void {
    for (const st of stops) {
      for (const l of this.lanes) {
        let best = -1;
        let bd = 2.4;
        let bs = 0;
        for (let i = 0; i < l.pts.length - 1; i++) {
          const a = l.pts[i];
          const b = l.pts[i + 1];
          const dx = b.x - a.x;
          const dz = b.y - a.y;
          const len2 = dx * dx + dz * dz || 1;
          const t = THREE.MathUtils.clamp(((st.x - a.x) * dx + (st.z - a.y) * dz) / len2, 0, 1);
          const d = Math.hypot(a.x + dx * t - st.x, a.y + dz * t - st.z);
          if (d < bd) {
            const len = Math.sqrt(len2);
            if ((dx * st.dx + dz * st.dz) / len < 0.7) continue;
            bd = d;
            best = i;
            bs = l.cum[i] + t * len;
          }
        }
        if (best < 0 || l.stops.some((x) => Math.abs(x.s - bs) < 1 && x.group === st.group)) continue;
        l.stops.push({ s: bs, group: st.group });
        // Vehicles on the lanes feeding this one must see the stop line ahead too.
        for (const p of this.lanes) if (p.next.includes(l) && !p.stops.some((x) => Math.abs(x.s - (p.length + bs)) < 1)) p.stops.push({ s: p.length + bs, group: st.group });
      }
    }
  }

  private pickKind(): VehicleKind {
    return this.rng.weighted([
      ['taxi', 24],
      ['cab', 18],
      ['car', 32],
      ['suv', 12],
      ['bus', 4],
      ['doubleDecker', 2],
      ['scooter', 8],
    ] as const);
  }

  private colourFor(kind: VehicleKind): THREE.Color {
    if (kind === 'taxi') return new THREE.Color(0x121212);
    if (kind === 'cab') return new THREE.Color(0xeeeeec).multiplyScalar(this.rng.range(0.92, 1));
    if (kind === 'bus' || kind === 'doubleDecker') return new THREE.Color(0xb3261e);
    return new THREE.Color(this.rng.pick(PALETTE));
  }

  private spawnAll(): void {
    // Favour the busy roads around the station (V.N. Road, M.K. Road, the junction).
    const pool = this.pool();
    for (let i = 0; i < this.opts.count; i++) {
      const lane = this.rng.pick(pool);
      const kind = this.pickKind();
      const v: Vehicle = { kind, lane, s: this.rng.range(0, lane.length), speed: 0, max: lane.speed * this.rng.range(0.75, 1.1) * (kind === 'bus' || kind === 'doubleDecker' ? 0.75 : 1), len: buildLen(kind), color: this.colourFor(kind), parked: false, pos: new THREE.Vector3(), heading: 0, ox: 0, oz: 0, blend: 0, blend0: 1 };
      v.speed = v.max * 0.6;
      if (lane.vehicles.some((o) => Math.abs(o.s - v.s) < 9)) continue;
      lane.vehicles.push(v);
      this.vehicles.push(v);
    }
    for (const p of this.opts.parked) {
      const v: Vehicle = { kind: p.kind, lane: this.lanes[0], s: 0, speed: 0, max: 0, len: buildLen(p.kind), color: this.colourFor(p.kind), parked: true, pos: new THREE.Vector3(p.x, 0, p.z), heading: p.heading, ox: 0, oz: 0, blend: 0, blend0: 1 };
      this.vehicles.push(v);
    }
  }

  private poolCache: Lane[] | null = null;
  private pool(): Lane[] {
    if (this.poolCache) return this.poolCache;
    const c = this.opts.center;
    const focus = this.opts.focus ?? [{ x: c.x, z: c.z, r: 260 }];
    const main = this.lanes.filter((l) => l.speed >= 7 && l.pts.some((p) => focus.some((f) => Math.hypot(p.x - f.x, p.y - f.z) < f.r)));
    this.poolCache = main.length ? main : this.lanes;
    return this.poolCache;
  }

  private sample(lane: Lane, s: number, out: THREE.Vector3): number {
    // First index with cum[i] >= s (lanes are densely sampled, so search rather than scan).
    let lo = 1;
    let hi = lane.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lane.cum[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;
    const a = lane.pts[i - 1];
    const b = lane.pts[i];
    const seg = lane.cum[i] - lane.cum[i - 1] || 1;
    const t = THREE.MathUtils.clamp((s - lane.cum[i - 1]) / seg, 0, 1);
    out.set(a.x + (b.x - a.x) * t, 0, a.y + (b.y - a.y) * t);
    return Math.atan2(b.x - a.x, b.y - a.y);
  }

  update(dt: number, lamps: number, camera?: THREE.Camera): void {
    dt = Math.min(dt, 0.05);
    const cam = camera?.position;
    const yieldTo = this.opts.pedestrianAt;
    const probe = new THREE.Vector3();
    for (const l of this.lanes) l.vehicles.sort((a, b) => a.s - b.s);
    for (const l of this.lanes) {
      const vs = l.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        let gap = Infinity;
        if (i + 1 < vs.length) gap = vs[i + 1].s - v.s - (vs[i + 1].len + v.len) / 2;
        else if (l.next.length) {
          const nx = l.next[0].vehicles[0];
          if (nx) gap = l.length - v.s + nx.s - (nx.len + v.len) / 2;
        }
        if (l.stops.length && this.opts.signals) {
          const front = v.s + v.len / 2;
          for (const st of l.stops) {
            const dist = st.s - front;
            if (dist < -0.5) continue;
            const asp = this.opts.signals.aspect(st.group as never);
            if (asp === 'green') continue;
            // On amber, keep going if stopping in time is impossible.
            if (asp === 'amber' && dist < (v.speed * v.speed) / 9 + 0.5) continue;
            gap = Math.min(gap, dist + 1.5);
          }
        }
        // Near the viewer, slow down and stop for anyone stepping in front of the bumper.
        if (yieldTo && cam && v.pos.distanceToSquared(cam) < 110 * 110) {
          const ahead = v.s + v.len / 2 + 1.2 + v.speed * 0.45;
          if (ahead < l.length) {
            this.sample(l, ahead, probe);
            if (yieldTo(probe.x, probe.z, 1.5)) gap = Math.min(gap, ahead - v.s - v.len / 2 + 1.0);
          }
        }
        const want = Math.min(v.max, Math.max(0, (gap - 2.5) * 0.9));
        const acc = want > v.speed ? 1.6 : 4.5;
        v.speed += THREE.MathUtils.clamp(want - v.speed, -acc * dt, acc * dt);
        v.s += v.speed * dt;
        if (v.blend > 0) v.blend = Math.max(0, v.blend - v.speed * dt);
      }
    }
    // Hand over vehicles at the end of their lane.
    for (const v of this.vehicles) {
      if (v.parked || v.s < v.lane.length) continue;
      const old = v.lane;
      old.vehicles.splice(old.vehicles.indexOf(v), 1);
      let next = this.pickNext(old);
      const cx = this.opts.center.x;
      const cz = this.opts.center.z;
      if (next && Math.hypot(next.pts[0].x - cx, next.pts[0].y - cz) > this.opts.radius) next = null;
      if (!next) {
        // Respawn on a random main-road lane start (keeps the streets busy near the station), out of
        // sight and never just before a stop line it could not brake for.
        const pool = this.pool().filter((l) => !l.vehicles.some((o) => o.s < 12) && !l.stops.some((st) => st.s < 30) && (!cam || (l.pts[0].x - cam.x) ** 2 + (l.pts[0].y - cam.z) ** 2 > 90 * 90));
        next = pool.length ? this.rng.pick(pool) : this.rng.pick(this.lanes);
        v.s = 0;
        v.blend = 0;
      } else {
        v.s = v.s - old.length;
        // Carry on from where the car actually is and ease across to the new lane.
        const end = old.pts[old.pts.length - 1];
        const start = next.pts[0];
        const d = Math.hypot(end.x - start.x, end.y - start.y);
        if (d > 0.05) {
          v.ox = end.x - start.x;
          v.oz = end.y - start.y;
          v.blend0 = v.blend = Math.min(26, 5 + d * 2.5);
        }
      }
      v.lane = next;
      next.vehicles.push(v);
    }
    this.render(lamps, camera);
  }

  /** Next lane at a node: no U-turns, and preferably the lane that lines up with this one. */
  private pickNext(l: Lane): Lane | null {
    if (!l.next.length) return null;
    const n = l.pts.length;
    const end = l.pts[n - 1];
    const dx = end.x - l.pts[n - 2].x;
    const dz = end.y - l.pts[n - 2].y;
    const dl = Math.hypot(dx, dz) || 1;
    const scored = l.next
      .map((c) => {
        const a = c.pts[0];
        const b = c.pts[1];
        const cl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { c, d: Math.hypot(a.x - end.x, a.y - end.y), turn: ((b.x - a.x) * dx + (b.y - a.y) * dz) / (cl * dl) };
      })
      .filter((o) => o.turn > -0.5);
    if (!scored.length) return null;
    // One candidate per destination road: the lane closest to this lane's end.
    const best = new Map<number, { c: Lane; d: number }>();
    for (const o of scored) {
      const cur = best.get(o.c.roadId);
      if (!cur || o.d < cur.d) best.set(o.c.roadId, o);
    }
    return this.rng.pick([...best.values()]).c;
  }

  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 7);

  private render(lamps: number, camera?: THREE.Camera): void {
    const counts = new Map<VehicleKind, number>();
    let cam: THREE.Vector3 | null = null;
    if (camera) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      cam = camera.position;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const v of this.vehicles) {
      if (!v.parked) {
        v.heading = this.sample(v.lane, v.s, v.pos);
        if (v.blend > 0) {
          // Smoothstep fade of the node offset; the heading follows the resulting path.
          const u = v.blend / v.blend0;
          const f = u * u * (3 - 2 * u);
          v.pos.x += v.ox * f;
          v.pos.z += v.oz * f;
          const k = (6 * u * (1 - u)) / v.blend0;
          v.heading = Math.atan2(Math.sin(v.heading) - v.ox * k, Math.cos(v.heading) - v.oz * k);
        }
      }
      if (cam) {
        // Only vehicles near the viewer and inside the view are drawn.
        const d2 = v.pos.distanceToSquared(cam);
        if (d2 > 420 * 420) continue;
        if (d2 > 100) {
          this.sphere.center.copy(v.pos).setY(1.5);
          if (!this.frustum.intersectsSphere(this.sphere)) continue;
        }
      }
      const set = this.meshes.get(v.kind)!;
      const i = counts.get(v.kind) ?? 0;
      counts.set(v.kind, i + 1);
      q.setFromAxisAngle(up, v.heading);
      m.compose(v.pos, q, one);
      set.paint.setMatrixAt(i, m);
      set.glass.setMatrixAt(i, m);
      set.misc.setMatrixAt(i, m);
      set.lights.setMatrixAt(i, v.parked ? ZERO : m);
      set.paint.setColorAt(i, v.color);
    }
    this.lightMat.color.setScalar(0.25 + lamps * 1.2);
    for (const [kind, set] of this.meshes) {
      const n = counts.get(kind) ?? 0;
      for (const mesh of [set.paint, set.glass, set.misc, set.lights]) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (set.paint.instanceColor) set.paint.instanceColor.needsUpdate = true;
    }
  }

  /** Positions of vehicles near a point (for horn / engine audio). */
  nearby(p: THREE.Vector3, r: number): { pos: THREE.Vector3; speed: number; kind: VehicleKind }[] {
    return this.vehicles.filter((v) => v.pos.distanceToSquared(p) < r * r).map((v) => ({ pos: v.pos, speed: v.speed, kind: v.kind }));
  }

  get count(): number {
    return this.vehicles.length;
  }
}

function buildLen(kind: VehicleKind): number {
  return kind === 'bus' ? 11.8 : kind === 'doubleDecker' ? 11.2 : kind === 'scooter' ? 1.5 : kind === 'suv' ? 4.4 : 4.0;
}

function colour(g: THREE.BufferGeometry, c: number[]): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return g;
}

/** True if a polyline runs through blocked ground for 1.5 m or more (sampled every 0.5 m). */
function runBlocked(pts: THREE.Vector2[], blocked: (x: number, z: number) => boolean): boolean {
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = a.distanceTo(b);
    for (let d = 0; d < len; d += 0.5) {
      run = blocked(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len) ? run + 0.5 : 0;
      if (run >= 1.5) return true;
    }
  }
  return false;
}

function offsetLine(pts: THREE.Vector2[], off: number): THREE.Vector2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const d = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
    // Left of travel in x/z (z south): (dz, -dx).
    return new THREE.Vector2(p.x + d.y * off, p.y - d.x * off);
  });
}
