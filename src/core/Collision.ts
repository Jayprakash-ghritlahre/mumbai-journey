/**
 * Lightweight walkable-world representation for first-person exploration:
 * floors (flat or ramped rectangles) and solid obstacles (oriented boxes),
 * bucketed in a uniform grid.
 */

export interface Floor {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Height at minZ/minX edge and at maxZ/maxX edge (ramps). */
  h0: number;
  h1: number;
  axis: 'x' | 'z';
  /** Oriented ramp (stairs at any angle): start point, unit direction, length, half width. */
  ramp?: { ax: number; az: number; ux: number; uz: number; len: number; hw: number };
}

export interface Solid {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  minY: number;
  maxY: number;
}

const CELL = 8;

export class CollisionWorld {
  private floors: Floor[] = [];
  private solids: Solid[] = [];
  private floorGrid = new Map<number, Floor[]>();
  private solidGrid = new Map<number, Solid[]>();
  /** Height of the open ground where no floor exists. */
  baseHeight = 0;
  /** Optional raster of raised street surfaces (footpaths, promenade…). */
  surface: { sample(x: number, z: number): number } | null = null;

  private key(ix: number, iz: number): number {
    // ±260 km of cells: Mira Road is 38 km from the origin.
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  private insert<T>(grid: Map<number, T[]>, item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(item);
      }
  }

  addFloor(minX: number, minZ: number, maxX: number, maxZ: number, h0: number, h1 = h0, axis: 'x' | 'z' = 'z'): void {
    const f: Floor = { minX, minZ, maxX, maxZ, h0, h1, axis };
    this.floors.push(f);
    this.insert(this.floorGrid, f, minX, minZ, maxX, maxZ);
  }

  /** A floor rising from (ax, az) at h0 to (bx, bz) at h1, hw either side of the line (stairs, slanted platforms). */
  addRamp(ax: number, az: number, bx: number, bz: number, hw: number, h0: number, h1 = h0): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) return;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const ex = Math.abs(uz) * hw;
    const ez = Math.abs(ux) * hw;
    const f: Floor = { minX: Math.min(ax, bx) - ex, minZ: Math.min(az, bz) - ez, maxX: Math.max(ax, bx) + ex, maxZ: Math.max(az, bz) + ez, h0, h1, axis: 'z', ramp: { ax, az, ux, uz, len, hw } };
    this.floors.push(f);
    this.insert(this.floorGrid, f, f.minX, f.minZ, f.maxX, f.maxZ);
  }

  /** Axis-aligned solid box. */
  addBox(minX: number, minZ: number, maxX: number, maxZ: number, minY = -10, maxY = 100): void {
    this.addSolid((minX + maxX) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2, (maxZ - minZ) / 2, 0, minY, maxY);
  }

  /** Oriented solid box: centre, half extents, rotation about Y (radians). */
  addSolid(cx: number, cz: number, hx: number, hz: number, angle: number, minY = -10, maxY = 100): void {
    const s: Solid = { cx, cz, hx, hz, cos: Math.cos(angle), sin: Math.sin(angle), minY, maxY };
    this.solids.push(s);
    const r = Math.hypot(hx, hz);
    this.insert(this.solidGrid, s, cx - r, cz - r, cx + r, cz + r);
  }

  /** Solid wall along a polyline segment with a given thickness. */
  addWall(x0: number, z0: number, x1: number, z1: number, thickness: number, minY = -10, maxY = 100): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const angle = Math.atan2(-dz, dx);
    this.addSolid((x0 + x1) / 2, (z0 + z1) / 2, len / 2, thickness / 2, angle, minY, maxY);
  }

  private floorHeight(f: Floor, x: number, z: number): number {
    const r = f.ramp;
    if (r) {
      const lx = x - r.ax;
      const lz = z - r.az;
      const t = lx * r.ux + lz * r.uz;
      if (t < -0.05 || t > r.len + 0.05 || Math.abs(lz * r.ux - lx * r.uz) > r.hw) return -Infinity;
      return f.h0 + ((f.h1 - f.h0) * Math.max(0, Math.min(r.len, t))) / r.len;
    }
    if (f.h0 === f.h1) return f.h0;
    const t = f.axis === 'z' ? (z - f.minZ) / (f.maxZ - f.minZ) : (x - f.minX) / (f.maxX - f.minX);
    return f.h0 + (f.h1 - f.h0) * Math.min(1, Math.max(0, t));
  }

  /** Highest walkable surface at (x,z) not more than `maxStep` above `feetY`. */
  groundAt(x: number, z: number, feetY: number, maxStep = 0.5): number {
    let best = this.surface ? this.surface.sample(x, z) : this.baseHeight;
    const list = this.floorGrid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list)
      for (const f of list) {
        if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
        const h = this.floorHeight(f, x, z);
        if (h <= feetY + maxStep && h > best) best = h;
      }
    return best;
  }

  /** Pushes a circle (radius r) at feet height out of all overlapping solids. Returns true if it collided. */
  resolve(pos: { x: number; y: number; z: number }, r: number, height = 1.75): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const ix0 = Math.floor((pos.x - r) / CELL);
      const ix1 = Math.floor((pos.x + r) / CELL);
      const iz0 = Math.floor((pos.z - r) / CELL);
      const iz1 = Math.floor((pos.z + r) / CELL);
      const seen = new Set<Solid>();
      for (let ix = ix0; ix <= ix1; ix++)
        for (let iz = iz0; iz <= iz1; iz++) {
          const list = this.solidGrid.get(this.key(ix, iz));
          if (!list) continue;
          for (const s of list) {
            if (seen.has(s)) continue;
            seen.add(s);
            if (pos.y + height < s.minY || pos.y + 0.3 > s.maxY) continue;
            // Into box local space.
            const dx = pos.x - s.cx;
            const dz = pos.z - s.cz;
            const lx = dx * s.cos - dz * s.sin;
            const lz = dx * s.sin + dz * s.cos;
            const qx = Math.max(-s.hx, Math.min(s.hx, lx));
            const qz = Math.max(-s.hz, Math.min(s.hz, lz));
            let ox = lx - qx;
            let oz = lz - qz;
            const d2 = ox * ox + oz * oz;
            if (d2 >= r * r) continue;
            let push: number;
            if (d2 < 1e-10) {
              // Centre inside the box: push out along the smallest penetration axis.
              const px = s.hx - Math.abs(lx);
              const pz = s.hz - Math.abs(lz);
              if (px < pz) {
                ox = Math.sign(lx) || 1;
                oz = 0;
                push = px + r;
              } else {
                ox = 0;
                oz = Math.sign(lz) || 1;
                push = pz + r;
              }
            } else {
              const d = Math.sqrt(d2);
              ox /= d;
              oz /= d;
              push = r - d;
            }
            // Back to world space (inverse rotation).
            const wx = ox * s.cos + oz * s.sin;
            const wz = -ox * s.sin + oz * s.cos;
            pos.x += wx * push;
            pos.z += wz * push;
            moved = true;
            hit = true;
          }
        }
      if (!moved) break;
    }
    return hit;
  }

  /** True if (x, z) lies inside a solid (grown by `pad`) whose top is at least `minTop` high. */
  solidAt(x: number, z: number, pad: number, minTop = 1): boolean {
    const list = this.solidGrid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const s of list) {
      if (s.maxY < minTop || s.minY > 1) continue;
      const dx = x - s.cx;
      const dz = z - s.cz;
      const lx = dx * s.cos - dz * s.sin;
      const lz = dx * s.sin + dz * s.cos;
      if (Math.abs(lx) < s.hx + pad && Math.abs(lz) < s.hz + pad) return true;
    }
    return false;
  }

  get counts(): { floors: number; solids: number } {
    return { floors: this.floors.length, solids: this.solids.length };
  }
}
