import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, boxGeo, floorGeo, planarUV, rodGeo } from '../../gfx/GeoBuilder';
import { RNG } from '../../core/Random';
import type { CollisionWorld } from '../../core/Collision';
import type { StationMaterials } from './StationMaterials';
import { addShaderPatch } from '../../gfx/AmbientVolume';
import { BUFFER_Z, CONCOURSE, EDGE, GAUGE, PLATFORMS, SHED, TRACKS, TRACK_END_Z, TRACK_NORTH_Z, Y } from './Layout';
import { DECAL } from '../../gfx/Surfaces';
import { InstanceCuller } from '../../gfx/InstanceCuller';

const COPING_W = 0.5;
const TACTILE_W = 0.6;
const LINE_OFF = COPING_W + TACTILE_W + 0.12;
const RAIL_HALF = GAUGE / 2 + 0.036;

export interface PlatformResult {
  group: THREE.Group;
  cullers: InstanceCuller[];
  /** Rest positions of benches (for seated commuters). */
  seats: { x: number; z: number; rot: number }[];
}

export function buildPlatforms(mats: StationMaterials, col: CollisionWorld, rng: RNG): PlatformResult {
  const group = new THREE.Group();
  group.name = 'platforms';
  const gb = new GeoBuilder();
  const seats: PlatformResult['seats'] = [];
  const zHead = CONCOURSE.z0;

  for (const p of PLATFORMS) {
    const zN = p.north;
    const len = zHead - zN;
    const cz = (zHead + zN) / 2;
    const w = p.x1 - p.x0;
    const cx = (p.x0 + p.x1) / 2;
    // Body and surface.
    gb.box('platformSide', w - 0.16, Y.platform - 0.05 - Y.pit, len, cx, (Y.platform - 0.05 + Y.pit) / 2, cz);
    let sx0 = p.x0;
    let sx1 = p.x1;
    if (p.west) sx0 += COPING_W + TACTILE_W;
    if (p.east) sx1 -= COPING_W + TACTILE_W;
    gb.add('concrete', planarUV(floorGeo(sx1 - sx0, len).translate((sx0 + sx1) / 2, Y.platform, cz), 'xz'));
    for (const side of ['west', 'east'] as const) {
      if (!p[side]) continue;
      const s = side === 'west' ? -1 : 1;
      const edgeX = side === 'west' ? p.x0 : p.x1;
      // Coping slab overhanging the platform wall slightly.
      const copX = edgeX - s * (COPING_W / 2) + s * 0.04;
      const cop = boxGeo(COPING_W + 0.08, 0.12, len);
      cop.translate(copX, Y.platform - 0.055, cz);
      remapCopingUV(cop, s);
      gb.add('coping', cop);
      const tact = floorGeo(TACTILE_W, len);
      tact.translate(edgeX - s * (COPING_W + TACTILE_W / 2), Y.platform + 0.004, cz);
      gb.add('tactile', planarUV(tact, 'xz'));
      gb.add('yellowLine', floorGeo(0.1, len).translate(edgeX - s * LINE_OFF, Y.platform + 0.006, cz));
      // Drain channel along the foot of the platform wall.
      gb.box('darkMetal', 0.25, 0.04, len, edgeX - s * 0.02 + s * 0.2, Y.pit + 0.02, cz);
    }
    // Ramp at the north end.
    const ramp = boxGeo(w - 0.4, 0.1, 8);
    ramp.rotateX(-Math.atan2(Y.platform - Y.pit, 8));
    ramp.translate(cx, (Y.platform + Y.pit) / 2 - 0.05, zN - 4);
    gb.add('concrete', planarUV(ramp, 'xz'));
    col.addFloor(p.x0, zN, p.x1, zHead + 0.01, Y.platform);
    col.addFloor(p.x0, zN - 8, p.x1, zN, Y.pit, Y.platform, 'z');
  }

  // Concourse floor (stone slabs) spanning the platform heads, plus exits to the streets.
  const cx0 = CONCOURSE.x0 - 0.9;
  const cx1 = CONCOURSE.x1 + 0.9;
  gb.add('stone', planarUV(floorGeo(cx1 - cx0, CONCOURSE.z1 - zHead).translate((cx0 + cx1) / 2, Y.platform + 0.01, (CONCOURSE.z1 + zHead) / 2), 'xz'));
  gb.box('platformSide', cx1 - cx0, Y.platform - Y.pit, 0.4, (cx0 + cx1) / 2, (Y.platform + Y.pit) / 2 - 0.02, zHead + 0.2);
  col.addFloor(cx0, zHead, cx1, CONCOURSE.z1 + 0.4, Y.platform + 0.01);
  for (const s of [-1, 1]) {
    // Five steps down to the pavement (0.95 → 0.15).
    const x0 = s < 0 ? cx0 : cx1;
    const steps = 5;
    const rise = (Y.platform - Y.sidewalk) / steps;
    for (let k = 0; k < steps; k++) {
      const top = Y.platform - rise * (k + 1) + 0.01;
      const x = x0 + s * (0.34 * k + 0.17);
      const stepGeo = boxGeo(0.34, top - Y.street, 8.6);
      stepGeo.translate(x, (top + Y.street) / 2, CONCOURSE.passageZ);
      gb.add('stone', planarUV(stepGeo, 'xz'));
      gb.box('darkMetal', 0.05, 0.02, 8.6, x - s * 0.15, top + 0.01, CONCOURSE.passageZ);
    }
    const run = 0.34 * steps;
    col.addFloor(Math.min(x0, x0 + s * run), CONCOURSE.passageZ - 4.3, Math.max(x0, x0 + s * run), CONCOURSE.passageZ + 4.3, s < 0 ? Y.sidewalk : Y.platform, s < 0 ? Y.platform : Y.sidewalk, 'x');
    // Side handrails on the steps.
    for (const dz of [-4.15, 4.15]) {
      const z = CONCOURSE.passageZ + dz;
      gb.add('stainless', rodGeo(new THREE.Vector3(x0, Y.platform + 0.95, z), new THREE.Vector3(x0 + s * run, Y.sidewalk + 0.95, z), 0.025, 6));
      for (let k = 0; k <= 2; k++) {
        const t = k / 2;
        const px = x0 + s * run * t;
        const py = Y.platform + (Y.sidewalk - Y.platform) * t;
        gb.add('stainless', rodGeo(new THREE.Vector3(px, py, z), new THREE.Vector3(px, py + 0.95, z), 0.02, 6));
      }
    }
  }

  // Track pits: ballast, pit end walls, stainless railings and buffer stops.
  for (const t of TRACKS) {
    const zS = TRACK_END_Z;
    gb.add('ballast', planarUV(floorGeo(EDGE * 2 + 0.2, zS - TRACK_NORTH_Z).translate(t.x, Y.ballast, (zS + TRACK_NORTH_Z) / 2), 'xz'));
    buildBufferStop(gb, t.x);
    buildRailing(gb, t.x, zHead + 0.02);
    col.addBox(t.x - EDGE, zHead - 0.2, t.x + EDGE, zHead + 0.1, Y.platform - 0.5, Y.platform + 1.2);
  }
  // Open ground north of the platforms (railway corridor).
  gb.add('ballast', planarUV(floorGeo(60, -TRACK_NORTH_Z - 290).translate(0, Y.pit - 0.01, (TRACK_NORTH_Z - 290) / 2), 'xz'));

  // Rails (long boxes) with a polished running surface.
  for (const t of TRACKS) {
    for (const s of [-1, 1]) {
      const x = t.x + s * RAIL_HALF;
      const zS = TRACK_END_Z - 0.4;
      const len = zS - TRACK_NORTH_Z;
      const cz = (zS + TRACK_NORTH_Z) / 2;
      gb.box('rail', 0.15, 0.03, len, x, Y.rail - 0.157, cz);
      gb.box('rail', 0.02, 0.1, len, x, Y.rail - 0.095, cz);
      gb.box('rail', 0.072, 0.036, len, x, Y.rail - 0.026, cz);
      gb.box('railTop', 0.055, 0.006, len, x, Y.rail - 0.004, cz);
    }
  }

  // Overhead line: contact + catenary wires with droppers, hung from the trusses.
  for (const t of TRACKS) {
    const zS = BUFFER_Z - 3;
    const len = zS - TRACK_NORTH_Z;
    const cz = (zS + TRACK_NORTH_Z) / 2;
    gb.box('copper', 0.014, 0.014, len, t.x + 0.1, 5.35, cz);
    gb.box('cable', 0.014, 0.014, len, t.x, 6.45, cz);
    for (let z = zS - 2; z > TRACK_NORTH_Z; z -= 6) gb.box('cable', 0.006, 1.1, 0.006, t.x + 0.05, 5.9, z);
    // Drop tubes and registration arms at each truss inside the shed.
    for (let i = 0; i <= SHED.bays; i++) {
      const z = SHED.south - i * SHED.bay;
      if (z > zS) continue;
      gb.add('steelGrey', rodGeo(new THREE.Vector3(t.x, 6.3, z), new THREE.Vector3(t.x, 10.6 - Math.abs(t.x) * 0.03, z), 0.03, 6));
      gb.add('steelGrey', rodGeo(new THREE.Vector3(t.x - 0.9, 5.45, z), new THREE.Vector3(t.x + 0.1, 5.38, z), 0.02, 6));
      gb.add('plasticWhite', rodGeo(new THREE.Vector3(t.x - 0.9, 5.45, z), new THREE.Vector3(t.x - 0.9, 6.35, z), 0.05, 8));
    }
  }

  // North of the shed: lattice OHE portals spanning all four tracks, and corridor boundary walls.
  const portalMats: THREE.Matrix4[] = [];
  for (let z = SHED.north - 18; z > TRACK_NORTH_Z + 20; z -= 45) portalMats.push(new THREE.Matrix4().makeTranslation(0, 0, z));
  group.add(instancedFrom(makeOhePortal(), mats.m.steelGrey, portalMats));
  for (const s of [-1, 1]) {
    const x = s * 30.5;
    const z0 = SHED.north - 2;
    const len = z0 - TRACK_NORTH_Z;
    gb.box('wallGrey', 0.3, 2.6, len, x, Y.pit + 1.3, z0 - len / 2);
    gb.box('wall', 0.4, 0.15, len, x, Y.pit + 2.65, z0 - len / 2);
    col.addBox(x - 0.2, TRACK_NORTH_Z, x + 0.2, z0, -5, 10);
  }

  // Benches (stainless, back-to-back) along island platform centre lines.
  const benchGeo = makeBench();
  const benchMats: THREE.Matrix4[] = [];
  for (const p of PLATFORMS) {
    if (!(p.west && p.east)) continue;
    const cx = (p.x0 + p.x1) / 2;
    for (let z = -9; z > p.north + 30; z -= 11.5) {
      if (rng.chance(0.18)) continue;
      const m = new THREE.Matrix4().makeTranslation(cx, Y.platform, z);
      benchMats.push(m);
      seats.push({ x: cx - 0.33, z, rot: -Math.PI / 2 }, { x: cx + 0.33, z, rot: Math.PI / 2 });
      col.addBox(cx - 0.55, z - 1, cx + 0.55, z + 1, Y.platform - 0.1, Y.platform + 0.9);
    }
  }
  const benches = new THREE.InstancedMesh(benchGeo, mats.m.stainless, benchMats.length);
  benchMats.forEach((m, i) => benches.setMatrixAt(i, m));
  benches.castShadow = true;
  benches.receiveShadow = true;
  group.add(benches);

  // Green litter bins on posts, and red fire buckets on stands.
  const binPos: THREE.Matrix4[] = [];
  const bucketPos: THREE.Matrix4[] = [];
  for (const p of PLATFORMS) {
    const both = p.west && p.east;
    const bx = both ? (p.x0 + p.x1) / 2 : p.west ? p.x1 - 0.9 : p.x0 + 0.9;
    for (let z = -15; z > p.north + 20; z -= 23) {
      binPos.push(new THREE.Matrix4().makeTranslation(bx + (both ? rng.pick([-1.4, 1.4]) : 0), Y.platform, z + rng.range(-2, 2)));
    }
    for (let z = -40; z > p.north + 40; z -= 70) bucketPos.push(new THREE.Matrix4().makeRotationY(both ? 0 : p.west ? -Math.PI / 2 : Math.PI / 2).setPosition(bx, Y.platform, z));
  }
  group.add(instancedFrom(makeBin(), mats.m.greenBin, binPos));
  group.add(instancedFrom(makeBucketStand(), mats.m.redPaint, bucketPos));

  const built = gb.build(mats.m, { noShadowKeys: ['concrete', 'stone', 'tactile', 'yellowLine', 'ballast', 'copper', 'cable'] });
  group.add(built);

  // Concrete sleepers every 0.6 m.
  const sleeperGeo = boxGeo(2.75, 0.2, 0.26);
  const sleeperMats: THREE.Matrix4[] = [];
  for (const t of TRACKS)
    for (let z = TRACK_END_Z - 0.8; z > TRACK_NORTH_Z; z -= 0.6) {
      const m = new THREE.Matrix4().makeRotationY(rng.range(-0.012, 0.012)).setPosition(t.x + rng.range(-0.02, 0.02), Y.rail - 0.172 - 0.1 - 0.01, z);
      sleeperMats.push(m);
    }
  const sleepers = instancedFrom(sleeperGeo, mats.m.sleeper, sleeperMats);
  sleepers.castShadow = false;
  group.add(sleepers);
  const cullers = [new InstanceCuller([sleepers], sleeperMats, 1.5, 240, 20)];

  group.add(buildDecals(mats, rng));
  return { group, seats, cullers };
}

function remapCopingUV(g: THREE.BufferGeometry, s: number): void {
  // Top face: u along z (1.2 m slabs), v across (white band towards the track edge).
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  for (let i = 0; i < p.count; i++) {
    if (n.getY(i) > 0.5) {
      const across = s > 0 ? (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x) : (bb.max.x - p.getX(i)) / (bb.max.x - bb.min.x);
      uv.setXY(i, -p.getZ(i), across * 0.58);
    } else if (Math.abs(n.getX(i)) > 0.5) {
      uv.setXY(i, -p.getZ(i), 0.6 - (bb.max.y - p.getY(i)) * 0.3);
    }
  }
}

function instancedFrom(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = mats.length;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Two lattice masts with a lattice boom across the four tracks, drop tubes and cantilevers. */
function makeOhePortal(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const H = 9.2;
  const X = 27;
  for (const s of [-1, 1]) {
    const x = s * X;
    for (const dx of [-0.22, 0.22]) for (const dz of [-0.22, 0.22]) parts.push(boxGeo(0.07, H, 0.07).translate(x + dx, Y.pit + H / 2, dz));
    for (let k = 0; k < 12; k++) {
      const y0 = Y.pit + 0.3 + k * 0.75;
      for (const dz of [-0.22, 0.22]) parts.push(rodGeo(new THREE.Vector3(x - 0.22, y0, dz), new THREE.Vector3(x + 0.22, y0 + 0.75, dz), 0.02, 3));
      for (const dx of [-0.22, 0.22]) parts.push(rodGeo(new THREE.Vector3(x + dx, y0, -0.22), new THREE.Vector3(x + dx, y0 + 0.75, 0.22), 0.02, 3));
    }
    parts.push(boxGeo(0.9, 0.3, 0.9).translate(x, Y.pit + 0.15, 0));
  }
  // Boom: two chords with zig-zag lacing.
  for (const y of [H - 0.1, H - 0.9]) for (const dz of [-0.2, 0.2]) parts.push(boxGeo(2 * X + 0.6, 0.08, 0.08).translate(0, Y.pit + y, dz));
  for (let x = -X; x < X; x += 1.2) for (const dz of [-0.2, 0.2]) parts.push(rodGeo(new THREE.Vector3(x, Y.pit + H - 0.9, dz), new THREE.Vector3(x + 0.6, Y.pit + H - 0.1, dz), 0.02, 3), rodGeo(new THREE.Vector3(x + 0.6, Y.pit + H - 0.1, dz), new THREE.Vector3(x + 1.2, Y.pit + H - 0.9, dz), 0.02, 3));
  // Drop tube, cantilever and insulators for each track.
  for (const t of TRACKS) {
    parts.push(rodGeo(new THREE.Vector3(t.x - 0.8, Y.pit + H - 0.9, 0), new THREE.Vector3(t.x - 0.8, 6.3, 0), 0.04, 6));
    parts.push(rodGeo(new THREE.Vector3(t.x - 0.8, 6.3, 0), new THREE.Vector3(t.x + 0.1, 5.4, 0), 0.025, 5));
    parts.push(rodGeo(new THREE.Vector3(t.x - 0.8, 6.9, 0), new THREE.Vector3(t.x, 6.45, 0), 0.025, 5));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

function makeBench(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const L = 1.9;
  for (const s of [-1, 1]) {
    // Seat pans (three perforated seats) and backrests.
    for (let k = 0; k < 3; k++) {
      const seat = boxGeo(0.44, 0.03, 0.56);
      seat.translate(s * 0.3, 0.45, -L / 2 + 0.33 + k * 0.62);
      parts.push(seat);
      const back = boxGeo(0.03, 0.42, 0.56);
      back.rotateZ(s * 0.12);
      back.translate(s * 0.06, 0.72, -L / 2 + 0.33 + k * 0.62);
      parts.push(back);
    }
  }
  for (const z of [-L / 2 + 0.03, L / 2 - 0.03]) {
    for (const s of [-1, 1]) parts.push(rodGeo(new THREE.Vector3(s * 0.35, 0, z), new THREE.Vector3(s * 0.25, 0.45, z), 0.025, 6));
    parts.push(boxGeo(0.8, 0.04, 0.05).translate(0, 0.43, z));
    parts.push(rodGeo(new THREE.Vector3(0, 0.44, z), new THREE.Vector3(0, 0.95, z), 0.025, 6));
  }
  parts.push(boxGeo(0.05, 0.05, L).translate(0, 0.94, 0));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  return g;
}

function makeBin(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(0.22, 0.2, 0.55, 12, 1, true);
  body.translate(0, 0.62, 0);
  parts.push(body);
  const bottom = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12);
  bottom.translate(0, 0.35, 0);
  parts.push(bottom);
  parts.push(boxGeo(0.06, 0.95, 0.06).translate(0, 0.47, -0.24));
  parts.push(boxGeo(0.3, 0.02, 0.3).translate(0, 0.01, -0.24));
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

function makeBucketStand(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(boxGeo(1.2, 0.06, 0.08).translate(0, 1.35, 0));
  parts.push(boxGeo(0.06, 1.4, 0.06).translate(-0.58, 0.7, 0));
  parts.push(boxGeo(0.06, 1.4, 0.06).translate(0.58, 0.7, 0));
  for (let k = 0; k < 4; k++) {
    const b = new THREE.CylinderGeometry(0.14, 0.1, 0.24, 10, 1, false);
    b.translate(-0.42 + k * 0.28, 1.12, 0.06);
    parts.push(b);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

function buildBufferStop(gb: GeoBuilder, x: number): void {
  const z = BUFFER_Z;
  // Hydraulic buffer beam with two buffers facing north, on a steel frame sitting on the rails.
  gb.box('bufferRed', 2.9, 0.42, 0.35, x, 1.05, z + 0.25);
  for (const s of [-1, 1]) {
    const bx = x + s * 0.87;
    const buf = new THREE.CylinderGeometry(0.2, 0.2, 0.18, 14);
    buf.rotateX(Math.PI / 2);
    buf.translate(bx, 1.05, z - 0.02);
    gb.add('darkMetal', buf);
    const ram = new THREE.CylinderGeometry(0.1, 0.1, 0.35, 10);
    ram.rotateX(Math.PI / 2);
    ram.translate(bx, 1.05, z + 0.2);
    gb.add('steelGrey', ram);
    // Raking struts down to the rails.
    gb.add('darkMetal', rodGeo(new THREE.Vector3(bx, 1.2, z + 0.4), new THREE.Vector3(bx, Y.rail - 0.1, z + 1.0), 0.07, 6));
    gb.box('darkMetal', 0.2, 1.2, 0.2, bx, 0.45, z + 0.5);
  }
  gb.box('darkMetal', 2.6, 0.2, 0.25, x, 0.1, z + 0.9);
  // Pit end wall below the concourse edge.
  gb.box('platformSide', EDGE * 2, Y.platform - Y.pit, 0.3, x, (Y.platform + Y.pit) / 2, TRACK_END_Z + 0.15);
}

function buildRailing(gb: GeoBuilder, x: number, z: number): void {
  const w = EDGE * 2 - 0.1;
  const y0 = Y.platform;
  const h = 1.05;
  gb.add('stainless', rodGeo(new THREE.Vector3(x - w / 2, y0 + h, z), new THREE.Vector3(x + w / 2, y0 + h, z), 0.03, 8));
  gb.add('stainless', rodGeo(new THREE.Vector3(x - w / 2, y0 + 0.12, z), new THREE.Vector3(x + w / 2, y0 + 0.12, z), 0.02, 6));
  const panels = 3;
  for (let k = 0; k <= panels; k++) {
    const px = x - w / 2 + (w * k) / panels;
    gb.add('stainless', rodGeo(new THREE.Vector3(px, y0, z), new THREE.Vector3(px, y0 + h, z), 0.03, 8));
    if (k < panels) {
      // Diamond motif in each panel.
      const mx = px + w / panels / 2;
      const my = y0 + 0.6;
      const r = 0.22;
      const pts = [
        new THREE.Vector3(mx, my + r, z),
        new THREE.Vector3(mx + r, my, z),
        new THREE.Vector3(mx, my - r, z),
        new THREE.Vector3(mx - r, my, z),
      ];
      for (let i = 0; i < 4; i++) gb.add('stainless', rodGeo(pts[i], pts[(i + 1) % 4], 0.012, 5));
      for (let v = 0; v < 5; v++) {
        const vx = px + ((v + 0.5) * (w / panels)) / 5;
        gb.add('stainless', rodGeo(new THREE.Vector3(vx, y0 + 0.12, z), new THREE.Vector3(vx, y0 + h, z), 0.01, 4));
      }
    }
  }
}

/** Instanced ground decals (stains, litter, paan, gum) with atlas lookup. */
function buildDecals(mats: StationMaterials, rng: RNG): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const items: { x: number; y: number; z: number; s: number; r: number; tile: number }[] = [];
  const onPlatform: [number, number][] = [
    [DECAL.gum, 6],
    [DECAL.wet, 3],
    [DECAL.paan, 2],
    [DECAL.smear, 4],
    [DECAL.cup, 1.5],
    [DECAL.butts, 1],
    [DECAL.paper, 0.7],
    [DECAL.crack, 1.5],
    [DECAL.spill, 1],
    [DECAL.dust, 2],
    [DECAL.dropping, 0.6],
    [DECAL.bag, 0.5],
  ];
  for (const p of PLATFORMS) {
    const n = Math.floor((p.x1 - p.x0) * (-p.north) * 0.035);
    for (let i = 0; i < n; i++) {
      const tile = rng.weighted(onPlatform);
      const z = rng.range(p.north + 5, -1);
      const x = rng.range(p.x0 + 0.3, p.x1 - 0.3);
      const big = tile === DECAL.wet || tile === DECAL.dust || tile === DECAL.smear;
      items.push({ x, y: Y.platform + 0.012, z, s: big ? rng.range(0.8, 2.2) : rng.range(0.3, 0.8), r: rng.range(0, Math.PI * 2), tile });
    }
    // Paan stains cluster near the platform ends and walls.
    for (let i = 0; i < 12; i++) items.push({ x: rng.range(p.x0 + 0.3, p.x1 - 0.3), y: Y.platform + 0.013, z: rng.range(p.north + 5, -5), s: rng.range(0.25, 0.6), r: rng.range(0, 6.3), tile: DECAL.paan });
  }
  for (let i = 0; i < 160; i++) {
    const tile = rng.weighted(onPlatform);
    items.push({ x: rng.range(CONCOURSE.x0, CONCOURSE.x1), y: Y.platform + 0.022, z: rng.range(0.5, CONCOURSE.z1), s: rng.range(0.3, 1.2), r: rng.range(0, 6.3), tile });
  }
  // Litter in the track pits.
  for (const t of TRACKS)
    for (let i = 0; i < 90; i++)
      items.push({ x: t.x + rng.range(-1.5, 1.5), y: Y.ballast + 0.03, z: rng.range(-280, -1), s: rng.range(0.25, 0.7), r: rng.range(0, 6.3), tile: rng.pick([DECAL.bag, DECAL.paper, DECAL.cup, DECAL.butts, DECAL.oil, DECAL.leaves]) });

  const mesh = new THREE.InstancedMesh(geo, mats.m.decals, items.length);
  const tiles = new Float32Array(items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  items.forEach((it, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.r);
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.s, 1, it.s));
    mesh.setMatrixAt(i, m);
    tiles[i] = it.tile;
  });
  geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 1));
  addShaderPatch(mats.m.decals, 'decal-atlas', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTile;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (uv + vec2(mod(aTile, 4.0), 3.0 - floor(aTile / 4.0))) * 0.25;');
  });
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 1;
  return mesh;
}
