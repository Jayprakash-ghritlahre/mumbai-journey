import { RNG } from '../../core/Random';
import type { Departure } from '../../gfx/LedBoard';

export interface Service {
  id: number;
  platform: number;
  /** Game-clock hours. */
  arrive: number;
  depart: number;
  code: string;
  dest: string;
  destDeva: string;
  mode: 'S' | 'F';
  cars: 12 | 15;
  note: string;
  /** Some Virar/Bhayandar services stop at Mira Road — used by announcements. */
  miraRoad: boolean;
}

interface Dest {
  code: string;
  name: string;
  deva: string;
  weight: number;
  fastOk: boolean;
  miraRoad: boolean;
}

// Western Railway suburban destinations from Churchgate (indicator codes as used on WR boards).
const DESTS: Dest[] = [
  { code: 'V', name: 'VIRAR', deva: 'विरार', weight: 24, fastOk: true, miraRoad: true },
  { code: 'BO', name: 'BORIVALI', deva: 'बोरिवली', weight: 26, fastOk: true, miraRoad: false },
  { code: 'A', name: 'ANDHERI', deva: 'अंधेरी', weight: 14, fastOk: false, miraRoad: false },
  { code: 'BY', name: 'BHAYANDAR', deva: 'भाईंदर', weight: 14, fastOk: true, miraRoad: true },
  { code: 'NSP', name: 'NALLASOPARA', deva: 'नालासोपारा', weight: 6, fastOk: true, miraRoad: true },
  { code: 'GO', name: 'GOREGAON', deva: 'गोरेगांव', weight: 7, fastOk: false, miraRoad: false },
  { code: 'BA', name: 'BANDRA', deva: 'वांद्रे', weight: 5, fastOk: false, miraRoad: false },
  { code: 'DRD', name: 'DAHANU ROAD', deva: 'डहाणू रोड', weight: 2, fastOk: true, miraRoad: true },
];

const SLOW_NOTE = 'SLOW-WILL HALT AT ALL STATIONS';
const FAST_NOTE = 'FAST-DADAR BANDRA ANDHERI';

export function fmtTime(h: number): string {
  const t = ((h % 24) + 24) % 24;
  const hh = Math.floor(t);
  const mm = Math.floor((t - hh) * 60 + 1e-6);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Generates a plausible evening departure pattern: one train every ~3 minutes across 4 platforms. */
export class Timetable {
  readonly services: Service[] = [];

  constructor(fromHour: number, toHour: number, seed = 4) {
    const rng = new RNG(seed);
    const freeAt = [0, fromHour - 0.2, fromHour - 0.15, fromHour - 0.1, fromHour - 0.05];
    let t = fromHour;
    let id = 1;
    // Minutes are whole numbers on real timetables.
    const roundMin = (h: number) => Math.round(h * 60) / 60;
    while (t < toHour) {
      t = roundMin(t + rng.range(2, 4.2) / 60);
      // Pick the platform that frees up earliest.
      let pf = 1;
      for (let p = 2; p <= 4; p++) if (freeAt[p] < freeAt[pf]) pf = p;
      const dwell = rng.range(6, 9) / 60;
      const arrive = Math.max(freeAt[pf] + 1.2 / 60, t - dwell);
      const depart = Math.max(t, arrive + 4.5 / 60);
      const d = rng.weighted(DESTS.map((x) => [x, x.weight] as const));
      const fast = d.fastOk && rng.chance(0.4);
      this.services.push({
        id: id++,
        platform: pf,
        arrive,
        depart: roundMin(depart),
        code: d.code,
        dest: d.name,
        destDeva: d.deva,
        mode: fast ? 'F' : 'S',
        cars: d.code === 'V' || d.code === 'DRD' ? (rng.chance(0.5) ? 15 : 12) : 12,
        note: fast ? FAST_NOTE : SLOW_NOTE,
        miraRoad: d.miraRoad,
      });
      freeAt[pf] = roundMin(depart) + 0.4 / 60;
    }
    this.services.sort((a, b) => a.depart - b.depart);
  }

  upcoming(platform: number, now: number): Service[] {
    return this.services.filter((s) => s.platform === platform && s.depart >= now - 0.2 / 60);
  }

  /** The service occupying (or about to occupy) a platform at time `now`. */
  current(platform: number, now: number): Service | null {
    return this.upcoming(platform, now)[0] ?? null;
  }

  allUpcoming(now: number, n = 6): Service[] {
    return this.services.filter((s) => s.depart >= now - 0.2 / 60).slice(0, n);
  }

  static toDeparture(s: Service, now: number): Departure {
    return {
      code: s.code,
      time: fmtTime(s.depart),
      mode: s.mode,
      mins: Math.max(0, Math.round((s.depart - now) * 60)),
      dest: s.dest,
      cars: s.cars,
      note: s.note,
    };
  }
}
