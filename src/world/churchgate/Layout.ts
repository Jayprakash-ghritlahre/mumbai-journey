/**
 * Churchgate station layout in the local frame (metres, Y up, -Z = north up the tracks).
 * Derived from OpenStreetMap geometry (© OpenStreetMap contributors, ODbL) and reference
 * photographs: 4 terminating tracks ~12 m apart with platforms on BOTH sides of every
 * track (side platform, three islands, side platform), PF1 on the west (Marine Drive) side.
 */

export const Y = {
  rail: 0.0,
  sleeperTop: -0.16,
  ballast: -0.2,
  pit: -0.34,
  platform: 0.95,
  street: 0.0,
  sidewalk: 0.15,
};

export const GAUGE = 1.676;
/** Track centre → platform coping edge. */
export const EDGE = 1.68;

export interface Track {
  pf: number;
  x: number;
}
export const TRACKS: Track[] = [
  { pf: 1, x: -18 },
  { pf: 2, x: -6 },
  { pf: 3, x: 6 },
  { pf: 4, x: 18 },
];

export interface PlatformDef {
  name: string;
  x0: number;
  x1: number;
  /** Platform numbers served on the west (x0) and east (x1) faces. */
  west?: number;
  east?: number;
  north: number;
}

export const PLATFORMS: PlatformDef[] = [
  { name: 'PF 1', x0: -24.4, x1: -18 - EDGE, east: 1, north: -262 },
  { name: 'PF 1-2', x0: -18 + EDGE, x1: -6 - EDGE, west: 1, east: 2, north: -290 },
  { name: 'PF 2-3', x0: -6 + EDGE, x1: 6 - EDGE, west: 2, east: 3, north: -305 },
  { name: 'PF 3-4', x0: 6 + EDGE, x1: 18 - EDGE, west: 3, east: 4, north: -290 },
  { name: 'PF 4', x0: 18 + EDGE, x1: 24.4, west: 4, north: -262 },
];

/** Buffer stop beams face north at this z; tracks end just south of it. */
export const BUFFER_Z = -1.2;
export const TRACK_END_Z = -0.2;
/** Northern limit of the straight platform roads (the throat and line beyond: journey/Corridor). */
export const TRACK_NORTH_Z = -330;

export const SHED = {
  south: 11,
  bays: 43,
  bay: 6,
  get north(): number {
    return this.south - this.bays * this.bay;
  },
  spans: [
    { x0: -24.4, x1: 0 },
    { x0: 0, x1: 24.4 },
  ],
  /** Top chord at the eaves and at the ridge. */
  eaveY: 9.4,
  ridgeY: 16.0,
  /** Bottom chord (arched) at the springing and the crown. */
  springY: 8.2,
  crownY: 12.4,
  sideWallY: 7.4,
};

export const CONCOURSE = {
  z0: TRACK_END_Z,
  z1: 11,
  x0: -24.4,
  x1: 24.4,
  /** Cross passage (OSM "Churchgate Platform" footway) centre line. */
  passageZ: 5.5,
};

/** Station building (9 storeys) south of the shed, simplified from the OSM footprint. */
export const BUILDING = {
  north: 11,
  west: -24.3,
  westStepZ: 63,
  westStepX: -12.8,
  east: 13.3,
  south: 106,
  levels: 9,
  floorH: 3.6,
  groundH: 5.4,
  /** Central passage through the ground floor ("Churchgate Railway Underbridge"). */
  passageX0: -1.5,
  passageX1: 7.5,
};

export const STREETS = {
  imcRoadX: -31.5,
  imcRoadW: 7,
  mkRoadX: 37,
  mkRoadW: 18,
};
