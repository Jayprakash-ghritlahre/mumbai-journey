import * as THREE from 'three';
import { Path2 } from './Path2';

/**
 * Geometry of the Churchgate → Marine Drive route in the local frame (metres).
 * See CHURCHGATE_TO_MARINE_DRIVE.md. All positions are derived from OpenStreetMap
 * (© OpenStreetMap contributors, ODbL) and fitted to reference photographs.
 */

export interface BackBayGeo {
  attribution: string;
  land: number[][];
  far: { id: number; n: string | null; t: string; h: number; e: number; fp: number[] }[];
  stadiums: { n: string | null; p: number[] }[];
  roads: { n: string | null; k: string; p: number[] }[];
  rect: { x0: number; x1: number; z0: number; z1: number };
}

/** Surface heights (road = 0). */
export const H = {
  road: 0,
  footpath: 0.15,
  promenade: 0.2,
  median: 0.2,
  step: 0.62,
  wallTop: 1.05,
  sea: -3.0,
};

/**
 * Veer Nariman Road: a dual carriageway. Offsets are from the centre of the median,
 * positive to the north (towards the IMC building / restaurants).
 */
export const VN = {
  axis: new Path2([
    [-404, 4.2],
    [-380, 12.3],
    [-360, 18.5],
    [-340, 24.8],
    [-310, 34.3],
    [-280, 43.6],
    [-250, 53.2],
    [-220, 62.7],
    [-190, 72.3],
    [-160, 81.6],
    [-130, 91.3],
    [-100, 100.7],
    [-70, 109.9],
    [-45, 117.9],
    [-20, 126.7],
  ]),
  median: 1.75,
  carriage: 11.75,
  kerb: 14.5,
  footpath: 20.5,
  frontage: 26,
  /** Arc length where the corridor starts (just west of IMC Road); set by RouteLayout.build. */
  sEast: 0,
  /** Arc length where V.N. Road meets the Marine Drive east kerb. */
  sWest: 0,
};

/** One edge of the IMC Road mouth where it crosses V.N. Road's north footpath. */
export interface MouthEdge {
  /** Offset of this edge from the IMC centre line. */
  off: number;
  /** Arc lengths on IMC.axis where the edge meets V.N. Road's kerb and frontage lines. */
  tKerb: number;
  tFront: number;
  /** The same points as arc lengths on V.N. Road. */
  sKerb: number;
  sFront: number;
}

/**
 * Indian Merchants' Chamber (IMC) Road, the street along the station's west side, from the
 * west exit down to V.N. Road (OSM way 151497954). Offsets are positive to the east (station side).
 * Its mouth cuts through V.N. Road's north footpath.
 */
export const IMC = {
  axis: new Path2(
    [
      [-34.2, 6],
      [-30.3, 47.3],
      [-29.1, 56.6],
      [-28.3, 62.7],
      [-28.1, 75],
      [-32.8, 87.4],
      [-35.6, 89.6],
      [-39.8, 93],
      [-47.1, 98.3],
      [-58.3, 106.6],
    ],
    1,
    false,
  ),
  half: 3.6,
  /** Mouth edges, sorted west → east along V.N. Road (set by RouteLayout.build). */
  edges: [] as MouthEdge[],
  /** V.N. Road arc-length span of the mouth at offset o (between the kerb and the frontage). */
  span(o: number, margin = 0): [number, number] {
    const [w, e] = IMC.edges;
    const t = THREE.MathUtils.clamp((o - VN.kerb) / (VN.frontage - VN.kerb), 0, 1.4);
    return [w.sKerb + (w.sFront - w.sKerb) * t - margin, e.sKerb + (e.sFront - e.sKerb) * t + margin];
  },
  /**
   * Pedestrian line down the west side of IMC Road (in front of the Express and IMC buildings),
   * from the west exit to V.N. Road's north footpath, west of the mouth.
   */
  westWalk: [
    [-27.5, 6.4],
    [-33.5, 9.2],
    [-39.2, 12],
    [-38.8, 30],
    [-36.6, 47],
    [-35.8, 62],
    [-36.2, 74],
    [-38.6, 84],
    [-44.6, 89.2],
    [-51.5, 95.6],
  ] as [number, number][],
  inMouth(s: number, o: number, margin = 0): boolean {
    const [lo, hi] = IMC.span(o, margin);
    return o > VN.kerb - 3 && s > lo && s < hi;
  },
};

/**
 * Marine Drive: offsets from the median centre line, positive landward (east).
 * 4 lanes each way (~13.6 m), median 2.5 m, promenade ~10 m, wall, tetrapods.
 */
export const MD = {
  axis: null as unknown as Path2,
  median: 1.25,
  kerb: 14.85,
  eastFoot: 19.85,
  promenade: -24.85,
  stepOuter: -25.35,
  wallOuter: -26.1,
  tetrapodToe: -34,
  lanes: 4,
  /** Detailed corridor range (arc length) and the junction. */
  sDetail0: 0,
  sDetail1: 0,
  sNorthCrossing: 0,
  sSouthCrossing: 0,
  sJunction: 0,
};

/**
 * Nariman Point (milestone 3): Marine Drive's 4+4 lanes end at the Air India junction (Madame Cama
 * Road); beyond it Sir Dorab Tata Road runs on as two 2-lane carriageways to a turning loop by the
 * NCPA, and the promenade continues to the tip. Carriageway centre lines (OSM ways 1240765606,
 * 1444852907, 1178037700, 1240765607, 1452271236, 1452271231) as (s, o) knots are set by NarimanPoint.
 */
export const NP = {
  sJunction: 0,
  sRoadEnd: 0,
  sEnd: 0,
  /** Half width of each carriageway (2 lanes of 3.2 m). */
  half: 3.2,
};

// OSM median samples near the junction (z every 40 m), derived from both carriageways.
const MEDIAN_SAMPLES: [number, number][] = [
  [-248.7, -660],
  [-250.5, -620],
  [-253.5, -580],
  [-257.1, -540],
  [-262.7, -500],
  [-268.8, -460],
  [-274.9, -420],
  [-280.7, -380],
  [-290.4, -340],
  [-301.1, -300],
  [-311.9, -260],
  [-323.1, -220],
  [-334.6, -180],
  [-348.3, -140],
  [-363.3, -100],
  [-379.0, -60],
  [-394.7, -20],
  [-412.2, 20],
  [-431.1, 60],
  [-450.8, 100],
  [-472.5, 140],
  [-496.6, 180],
  [-521.8, 220],
  [-548.0, 260],
  [-575.6, 300],
  [-604.1, 340],
  [-635.4, 380],
];

/** Land-polygon vertex range of the Marine Drive shore (Chowpatty → NCPA), see tools/build-skyline-geo. */
const SHORE_RANGE = [150, 184];
const COAST_TO_MEDIAN = 35;

export interface Zone {
  id: string;
  en: string;
  deva: string;
  test: (x: number, z: number, y: number) => boolean;
}

export class RouteLayout {
  /** The land polygon with the Marine Drive shore moved to the sea wall's outer face. */
  land: number[][] = [];
  /** Original shoreline (tetrapod toe) for the Marine Drive stretch, north → south. */
  shore: [number, number][] = [];
  /** Walking line from the concourse to the sea wall (y = eye-level-free ground points). */
  walk!: THREE.CatmullRomCurve3;
  zones: Zone[] = [];

  constructor(readonly geo: BackBayGeo) {
    this.buildMarineDrive();
    this.buildVN();
    this.buildLand();
    this.buildWalk();
    this.buildZones();
  }

  private buildMarineDrive(): void {
    const poly = this.geo.land[0];
    const shore: [number, number][] = [];
    for (let i = SHORE_RANGE[0]; i <= SHORE_RANGE[1]; i++) shore.push([poly[i * 2], poly[i * 2 + 1]]);
    this.shore = shore;
    // Shore-derived median points outside the OSM sample range, offset landward.
    const shorePath = new Path2(shore, 2, false);
    const far = (zMin: number, zMax: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let s = 0; s <= shorePath.length; s += 60) {
        const [x, z] = shorePath.point(s, COAST_TO_MEDIAN);
        if (z >= zMin && z <= zMax) out.push([x, z]);
      }
      return out;
    };
    const north = far(-99999, -760);
    // South: along the straight last stretch of coast to ~45 m short of the tip (milestone 3).
    const south = far(430, 99999).filter(([x]) => x > -1095);
    MD.axis = new Path2([...north, ...MEDIAN_SAMPLES, ...south], 1);
    const a = MD.axis;
    // OSM crossing nodes, nudged so each zebra lands on a straight kerb clear of the rounded
    // V.N. Road corners (the kerb geometry here is fitted, see CHURCHGATE_TO_MARINE_DRIVE.md §9).
    MD.sNorthCrossing = a.project(-404.6, -16.7).s - 6;
    MD.sSouthCrossing = a.project(-402.2, 17).s + 10;
    MD.sJunction = (MD.sNorthCrossing + MD.sSouthCrossing) / 2;
    MD.sDetail0 = a.project(-250, -700).s;
    // Nariman Point (NARIMAN_POINT.md): the Air India junction, the road's end at the NCPA, the tip.
    NP.sJunction = a.project(-667, 419).s;
    MD.sDetail1 = NP.sJunction - 34;
    NP.sRoadEnd = a.project(-1062, 800).s;
    NP.sEnd = a.length;
  }

  private buildVN(): void {
    const a = VN.axis;
    VN.sEast = a.project(-34, 122).s;
    // Where the V.N. Road axis meets the Marine Drive east kerb.
    VN.sWest = a.intersectOffset(MD.axis, MD.kerb, 0, 120) ?? 0;
    const imc = IMC.axis;
    IMC.edges = [-IMC.half, IMC.half]
      .map((off): MouthEdge => {
        const tKerb = imc.intersectOffsetAt(off, a, VN.kerb) ?? imc.length;
        const tFront = imc.intersectOffsetAt(off, a, VN.frontage) ?? 0;
        return { off, tKerb, tFront, sKerb: a.project(...imc.point(tKerb, off)).s, sFront: a.project(...imc.point(tFront, off)).s };
      })
      .sort((p, q) => p.sKerb - q.sKerb);
  }

  /** Replaces the Marine Drive shoreline with the sea wall's outer face so land ends at the wall. */
  private buildLand(): void {
    const poly = this.geo.land[0];
    const n = poly.length / 2;
    const [i0, i1] = SHORE_RANGE;
    const wall: number[] = [];
    const a = MD.axis;
    for (let s = 0; s <= a.length; s += 6) {
      const [x, z] = a.point(s, MD.wallOuter);
      wall.push(x, z);
    }
    const out: number[] = [];
    for (let i = 0; i < i0; i++) out.push(poly[i * 2], poly[i * 2 + 1]);
    out.push(...wall);
    for (let i = i1 + 1; i < n; i++) out.push(poly[i * 2], poly[i * 2 + 1]);
    this.land = [out, ...this.geo.land.slice(1)];
  }

  private buildWalk(): void {
    // Out of the west exit, across IMC Road and down its west side.
    const pts: [number, number][] = [[-20, 5.5], [-24.4, 5.5], ...IMC.westWalk];
    // Along the middle of the north footpath of V.N. Road, west of the IMC Road mouth.
    const mid = (VN.kerb + VN.footpath) / 2 - 0.5;
    const [ex, ez] = IMC.westWalk[IMC.westWalk.length - 1];
    for (let s = VN.axis.project(ex, ez).s - 6; s > VN.sWest + 8; s -= 12) pts.push(VN.axis.point(s, mid));
    // Round the corner to the northern zebra, cross, and walk to the wall.
    const md = MD.axis;
    const sc = MD.sNorthCrossing;
    pts.push(md.point(sc + 1.5, MD.eastFoot - 2.5), md.point(sc, MD.kerb + 1.0), md.point(sc, 0), md.point(sc, -MD.kerb - 1.2), md.point(sc - 1.2, MD.promenade + 1.4));
    this.walk = new THREE.CatmullRomCurve3(
      pts.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
      0.4,
    );
  }

  private buildZones(): void {
    const vn = VN.axis;
    const md = MD.axis;
    this.zones = [
      { id: 'station', en: 'Churchgate', deva: 'चर्चगेट', test: (x, z) => x > -25 && x < 25 && z < 11 && z > -300 },
      { id: 'imc', en: 'IMC Road', deva: 'आय.एम.सी. मार्ग', test: (x, z) => x < -24 && x > -40 && z > 8 && z < 88 },
      {
        id: 'vn',
        en: 'Veer Nariman Road',
        deva: 'वीर नरिमन मार्ग',
        test: (x, z) => {
          const p = vn.project(x, z);
          return p.s > VN.sWest && p.s < VN.sEast + 40 && Math.abs(p.o) < 32;
        },
      },
      {
        id: 'nariman',
        en: 'Nariman Point',
        deva: 'नरिमन पॉइंट',
        test: (x, z) => {
          const p = md.project(x, z);
          return p.s > NP.sJunction - 20 && p.o < 140 && p.o > -80;
        },
      },
      {
        id: 'promenade',
        en: "Marine Drive · Queen's Necklace",
        deva: 'मरीन ड्राइव्ह',
        test: (x, z) => {
          const p = md.project(x, z);
          return p.o < -MD.kerb && p.o > MD.tetrapodToe;
        },
      },
      {
        id: 'md',
        en: 'Marine Drive',
        deva: 'नेताजी सुभाषचंद्र बोस मार्ग',
        test: (x, z) => {
          const p = md.project(x, z);
          return p.o >= -MD.kerb && p.o < MD.eastFoot + 8;
        },
      },
    ];
  }

  zoneAt(x: number, z: number, y: number): Zone | null {
    for (const zn of this.zones) if (zn.test(x, z, y)) return zn;
    return null;
  }
}
