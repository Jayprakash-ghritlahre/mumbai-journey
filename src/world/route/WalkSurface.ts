import type { Path2 } from './Path2';

/**
 * Walkable ground heights for the street route: a raster (0.4 m cells, cm precision) of raised
 * surfaces — footpaths, medians, the promenade, the sea-wall step. Unset cells are road
 * level. Writes keep the maximum, so order does not matter.
 */
export class WalkSurface {
  /** Heights in centimetres above `base`. */
  readonly data: Uint8Array;
  readonly w: number;
  readonly h: number;

  constructor(
    readonly x0: number,
    readonly z0: number,
    x1: number,
    z1: number,
    readonly res = 0.5,
    readonly base = 0,
  ) {
    this.w = Math.ceil((x1 - x0) / res);
    this.h = Math.ceil((z1 - z0) / res);
    this.data = new Uint8Array(this.w * this.h);
  }

  private set(x: number, z: number, y: number): void {
    const i = Math.floor((x - this.x0) / this.res);
    const j = Math.floor((z - this.z0) / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    const k = j * this.w + i;
    const v = Math.max(0, Math.min(255, Math.round((y - this.base) * 100)));
    if (v > this.data[k]) this.data[k] = v;
  }

  /** Raises the area between two offsets of a path. */
  strip(path: Path2, s0: number, s1: number, o0: number, o1: number, y: number): void {
    const st = this.res * 0.6;
    const lo = Math.min(o0, o1);
    const hi = Math.max(o0, o1);
    for (let s = Math.max(-50, s0); s <= Math.min(path.length + 50, s1); s += st)
      for (let o = lo; o <= hi; o += st) {
        const [x, z] = path.point(s, o);
        this.set(x, z, y);
      }
  }

  /** Raises the inside of a polygon (x,z pairs). */
  polygon(pts: [number, number][], y: number): void {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [, z] of pts) {
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    for (let z = minZ; z <= maxZ; z += this.res * 0.5) {
      const xs: number[] = [];
      for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[k];
        if (az > z !== bz > z) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) for (let x = xs[q]; x <= xs[q + 1]; x += this.res * 0.5) this.set(x, z, y);
    }
  }

  sample(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.res);
    const j = Math.floor((z - this.z0) / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return this.base;
    return this.base + this.data[j * this.w + i] / 100;
  }
}
