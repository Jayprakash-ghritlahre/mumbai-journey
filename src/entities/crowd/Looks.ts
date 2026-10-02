import type { RNG } from '../../core/Random';
import { EXTRA, POSE } from './CrowdMaterial';

/**
 * What a person looks like: build, face, skin, hair and clothes (drawn by CrowdMaterial on the
 * meshes of HumanGeometry). Colours are sRGB hex.
 *
 * Mumbai's crowd, after the reference photos (assets/: girl*, people*, peoples*, the Marine Drive
 * and station photos): men in shirts and trousers or T-shirts and jeans; women in sarees and salwar
 * kurtas, kurtis over jeans or palazzos, and in jeans and tops, shirts, dresses, skirts, co-ords and
 * wide trousers, with sneakers, sandals or flats, sling bags, totes and backpacks. Ordinary people
 * more than glamorous ones: students, office-goers, families, tourists, joggers, grandparents.
 */
export interface Look {
  /** 0 man, 1 woman in a salwar kurta, 2 saree, 3 young man, 4 contemporary woman (HumanGeometry). */
  variant: 0 | 1 | 2 | 3 | 4;
  top: number;
  bottom: number;
  accent: number;
  skin: number;
  hair: number;
  /** Open jacket / overshirt / dupatta. */
  layer: number;
  shoe: number;
  bag: number;
  /** Backpack, bag type (BAG), long sleeves (men), top pattern (PATTERN). */
  flags: [number, number, number, number];
  /** Cap (1 white, 2 dark, 3 accent colour), backpack colour idx, bottom pattern, width (negative: moustache). */
  misc: [number, number, number, number];
  /** Shoe type (SHOE), hair style (HAIR), bottom (BOTTOM), sleeves (0 none, 1 short, 2 long). */
  style: [number, number, number, number];
  /** Chest, hips, belly, face code (width × 100 + length × 10 + jaw). */
  shape: [number, number, number, number];
  /** Hair length, skirt length, layer (1 open jacket, 2 dupatta), extras (EXTRA bits). */
  wear: [number, number, number, number];
  scale: number;
  /** Stride (short steps in a saree or a long skirt). */
  stride: number;
}

/** Below the waist: trousers or jeans, skirt, dress, kurti (over leggings or jeans), wide trousers, kurti over palazzos. */
export const BOTTOM = { trousers: 0, skirt: 1, dress: 2, kurti: 3, wide: 4, kurtiWide: 5 } as const;
export const HAIR = { open: 0, ponytail: 1, bun: 2, braid: 3 } as const;
export const SHOE = { flats: 0, sneakers: 1, sandals: 2 } as const;
export const BAG = { none: 0, shoulder: 1, sling: 2, tote: 3 } as const;
export const PATTERN = { none: 0, diagonal: 1, check: 2, border: 3, floral: 4, stripes: 5, dots: 6, denim: 7, pinstripe: 8 } as const;
export { POSE };

type W<T> = readonly (readonly [T, number])[];

// ---- Palettes (sRGB) --------------------------------------------------------------------------

/** From fair to deep brown, weighted to the wheatish and brown tones of most Mumbaikars. */
const SKIN: W<number> = [
  [0xe8c3a2, 1.4],
  [0xdfb28c, 2.4],
  [0xd6a47e, 3],
  [0xcc9870, 4],
  [0xc08b63, 4],
  [0xb27d56, 4],
  [0xa36f4a, 3.5],
  [0x956441, 3],
  [0x85583a, 2.2],
  [0x744b31, 1.6],
  [0x633f29, 1],
  [0x543522, 0.6],
];
const HAIR_YOUNG: W<number> = [
  [0x0e0c0b, 5],
  [0x1a1512, 5],
  [0x2a1c14, 3],
  [0x3b2518, 1.6],
  [0x5a3a24, 0.8],
  [0x4a1c16, 0.5],
];
const HAIR_OLD: W<number> = [
  [0x1a1512, 3],
  [0x6a2a16, 2.5],
  [0x4a4642, 2],
  [0x7c7872, 2],
  [0xb8b4ac, 1],
];

const SHIRTS = [0xf4f4f0, 0xe9eef7, 0xbcd2ec, 0x9fc0e6, 0xd9c7e6, 0xf0cfd6, 0xd8d8d2, 0xe8e0c8, 0x7aa0c8, 0x2d3e63, 0x1c1c1e, 0x6a7b5a, 0xc9a86a, 0xb33a3a, 0x3f7fb5, 0xf2d15c, 0x5c8f6b, 0x8e3b5f, 0x2f6f73, 0xd9773a, 0x4b4f8a, 0x9c2a2a];
const TROUSERS = [0x1d1d20, 0x2a2b2e, 0x232a3e, 0x3b3f47, 0x8d7b5e, 0xb5a27f, 0x34496e, 0x2e4d7a, 0x4a4a4a, 0x5a4a3a];
const TEES = [0x111111, 0xf5f5f5, 0xc62828, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xff7043, 0x26c6da, 0x3949ab, 0x6d4c41, 0x9e9e9e, 0x5d6d3a, 0x546e7a, 0xe0e0d8, 0x0d47a1, 0xad1457, 0xffb300];
const DENIM = [0x8fa8c8, 0x7593bd, 0x5b7aae, 0x3f5a8a, 0x2c3e66, 0x222326, 0x6c6f76];
const MEN_DENIM = [0x1f3a5f, 0x2c4f7c, 0x3d5f8f, 0x16223a, 0x5b7fae, 0x7896bf, 0x222222, 0xcbbf9f, 0x4e5b31, 0x3a3a3a];

const TOPS = [0xf4f2ee, 0xece4d4, 0x161616, 0xa9c8e8, 0x8ec5e8, 0xc8b6e2, 0xf2c4cf, 0xe0457e, 0xf0806a, 0xf5c09a, 0xe0a92c, 0xf2e27a, 0xb5e3cc, 0xa8b89a, 0x6b7045, 0x2a8c8c, 0x1f7a52, 0x1f2d55, 0x2c56b8, 0x7a1f2e, 0xc8283a, 0xb4512a, 0xd8c3a0, 0x9d9d9d, 0xb9a4d9, 0xf07a28, 0x4a4a52];
const W_SHIRTS = [0xf6f5f1, 0xdde8f5, 0xa9c4e2, 0xf3d7dd, 0x5b7aa6, 0xe9e3d3, 0x1c1c1e, 0xc9d8c2, 0xf1e2b8, 0xe8d0e8];
const W_TROUSERS = [0x1c1c1e, 0xcdb99a, 0xece2cf, 0x252f4f, 0x5d6340, 0x7a7a7a, 0xf0efea, 0x6a4a35, 0xb5a27a];
const WIDE = [0x1c1c1e, 0x252f4f, 0xf0efea, 0xcdb99a, 0x5a5e3a, 0xe0a92c, 0x7a1f2e, 0x3a3a3c, 0x2b3a7a];
const SKIRTS = [0x1c1c1e, 0x5b7aae, 0xcdb99a, 0x5d6340, 0x252f4f, 0x7a1f2e, 0xf0efea, 0xe8b4c4, 0xc8283a, 0x6a4a35];
const DRESSES = [0x1f2d55, 0x161616, 0xc8283a, 0x1f7a52, 0xe0a92c, 0xf4f2ee, 0xb9a4d9, 0x8ec5e8, 0xf0806a, 0x7a1f2e, 0xe8d8b8, 0x2a8c8c, 0xf2c4cf];
const COORDS = [0xc8b6e2, 0xb5e3cc, 0xd8c3a0, 0xb4512a, 0x8ec5e8, 0xf2c4cf, 0xece4d4, 0x1f2d55, 0x6b7045, 0xe0a92c];
const KURTIS = [0x2b3a7a, 0x7a1f2e, 0xe0a92c, 0x2a8c8c, 0x161616, 0xf4f2ee, 0xe0457e, 0x1f7a52, 0xc8283a, 0xf07a28, 0x7d4a9e, 0x6d8c3a, 0xf2c4cf, 0x1565c0];
const KURTAS = [0xc2185b, 0xd84315, 0xf9a825, 0x00897b, 0x6a1b9a, 0x1565c0, 0xad1457, 0x2e7d32, 0xef6c00, 0xf5f5f5, 0x8d6e63, 0x5d4037, 0xe57373, 0x4dd0e1, 0xfff176, 0x7986cb];
const SAREES = [0xd32f2f, 0xf57c00, 0x2e7d32, 0x1565c0, 0xc2185b, 0x6a1b9a, 0x00838f, 0xfbc02d, 0x8e24aa, 0xbf360c, 0xe8d8b8, 0x1f2d55, 0x9ccc65, 0xf48fb1];
const LEGGINGS = [0xf5f5f0, 0x1b1b1b, 0xd7ccc8, 0xf0e2c8, 0x37474f, 0x252f4f];
const LAYERS = [0x4b6a99, 0x6a86b0, 0x1c1c1e, 0xcdb99a, 0xf4f2ee, 0x5d6340, 0xe8c8d0, 0xd8cfe8, 0xece2cf, 0x7a4a33];
const PRINT = [0xc8283a, 0xe0457e, 0xf2e27a, 0xf4f2ee, 0x2c56b8, 0x1f7a52, 0xf07a28, 0x7a1f2e, 0x161616, 0x8ec5e8];
const JEWEL = [0xd4af37, 0xd4af37, 0xc0c0c0, 0xb08d57];
const SNEAKERS: W<number> = [
  [0xf0f0ec, 6],
  [0xe8e4dc, 2],
  [0x1a1a1a, 2],
  [0xa0a0a0, 1],
  [0xe8c9d0, 1],
  [0xd8c8a8, 1],
];
const FLATS = [0x9a6a42, 0x5a3b26, 0x1a1a1a, 0xc8a45a, 0xd8b89a, 0xa33a2a, 0xe8e0d0, 0x7a4a33];
const BAGS = [0x151515, 0x151515, 0x9a6238, 0x5a3a24, 0xcdb393, 0xeeeeea, 0x6a1a2a, 0x5d6340, 0xe8a0b4, 0x252f4f, 0xc8a45a];
const MEN_SHOES = [0x0a0908, 0xd8d8d4, 0x3a2412, 0x6a4a2c];

// ---- Helpers ----------------------------------------------------------------------------------

/** A colour a little lighter or darker (no two shirts from one palette entry exactly alike). */
function vary(rng: RNG, hex: number, amount = 0.07): number {
  const l = 1 + rng.range(-amount, amount);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * l * (1 + rng.range(-amount, amount) * 0.25))));
  return (ch((hex >> 16) & 255) << 16) | (ch((hex >> 8) & 255) << 8) | ch(hex & 255);
}

const pickVary = (rng: RNG, list: readonly number[], amount?: number) => vary(rng, rng.pick(list), amount);

function skinTone(rng: RNG): number {
  return vary(rng, rng.weighted(SKIN), 0.04);
}

function faceCode(rng: RNG): number {
  const c = () => Math.max(0, Math.min(8, Math.round(4 + rng.gauss() * 1.9)));
  return c() * 100 + c() * 10 + c();
}

type Age = 'child' | 'teen' | 'young' | 'adult' | 'middle' | 'senior';

/** Height, build and face for a person of this sex and age. */
function body(rng: RNG, female: boolean, age: Age): { scale: number; shape: [number, number, number, number]; width: number } {
  const g = () => Math.max(-2, Math.min(2, rng.gauss()));
  const scale = age === 'child' ? rng.range(0.55, 0.74) : female ? 0.915 + g() * 0.034 + (age === 'teen' ? -0.01 : 0) : 1.0 + g() * 0.034;
  // Build: slim … heavy, fuller with age.
  const older = age === 'middle' ? 0.4 : age === 'senior' ? 0.45 : age === 'adult' ? 0.2 : 0;
  const build = age === 'child' ? rng.range(-0.3, 0.2) : Math.max(-0.8, Math.min(1.6, g() * (female && older ? 0.55 : 0.45) + older));
  const chest = female ? 1 + build * 0.1 + g() * 0.05 : 1 + build * 0.07 + g() * 0.03;
  const hips = female ? 1 + build * 0.1 + g() * 0.05 : 1 + build * 0.04;
  const belly = 1 + Math.max(-0.08, build * (female ? 0.14 : 0.2) + (age === 'middle' || age === 'senior' ? rng.range(0, 0.12) : 0));
  const width = (female ? 0.96 : 1.0) + build * 0.05 + g() * 0.02;
  return { scale, shape: [chest, hips, belly, faceCode(rng)], width };
}

function hairFor(rng: RNG, age: Age): number {
  if (age === 'senior') return vary(rng, rng.weighted(HAIR_OLD), 0.05);
  if (age === 'middle' && rng.chance(0.45)) return vary(rng, rng.weighted(HAIR_OLD), 0.05);
  return vary(rng, rng.weighted(HAIR_YOUNG), 0.05);
}

// ---- Men --------------------------------------------------------------------------------------

function manLook(rng: RNG, age: Age): Look {
  const b = body(rng, false, age);
  const pattern = rng.weighted([
    [0, 55],
    [1, 20],
    [2, 25],
  ] as const);
  const old = age === 'senior' || (age === 'middle' && rng.chance(0.4));
  return {
    variant: 0,
    top: pickVary(rng, SHIRTS),
    bottom: rng.chance(0.3) ? pickVary(rng, MEN_DENIM) : pickVary(rng, TROUSERS),
    accent: pickVary(rng, SHIRTS),
    skin: skinTone(rng),
    hair: old ? vary(rng, rng.pick([0x4a4642, 0x7c7872, 0xb8b4ac, 0x2a2622]), 0.05) : vary(rng, rng.pick([0x0e0c0b, 0x1a1512, 0x241a14]), 0.05),
    layer: 0,
    shoe: rng.weighted([
      [MEN_SHOES[0], 60],
      [MEN_SHOES[2], 25],
      [MEN_SHOES[3], 15],
    ] as const),
    bag: vary(rng, rng.pick([0x1f140a, 0x050505, 0x4a0d14])),
    flags: [rng.chance(0.42) ? 1 : 0, rng.chance(0.18) ? 1 : 0, rng.chance(0.45) ? 1 : 0, pattern],
    misc: [old && rng.chance(0.3) ? 1 : rng.chance(0.04) ? 2 : 0, rng.int(0, 3), 0, b.width * (rng.chance(old ? 0.7 : 0.45) ? -1 : 1)],
    style: [0, 0, 0, 0],
    shape: b.shape,
    wear: [1, 1, 0, rng.chance(old ? 0.45 : 0.15) ? EXTRA.glasses : 0],
    scale: b.scale,
    stride: 1,
  };
}

/** T-shirt or casual shirt, jeans or chinos, sneakers; a backpack or sling bag, now and then a cap. */
export function youngMan(rng: RNG, skin = skinTone(rng), age: Age = 'young'): Look {
  const b = body(rng, false, age);
  const tee = rng.pick(TEES);
  const shirt = rng.chance(0.3);
  return {
    variant: 3,
    top: vary(rng, tee),
    bottom: pickVary(rng, MEN_DENIM),
    accent: vary(rng, rng.chance(0.6) ? tee : rng.pick(TEES)),
    skin,
    hair: rng.chance(0.12) ? vary(rng, rng.pick([0x2a1c14, 0x3b2518])) : vary(rng, rng.pick([0x0e0c0b, 0x1a1512])),
    layer: 0,
    shoe: rng.weighted([
      [0xe8e8e4, 55],
      [0x111111, 30],
      [0x3a2412, 15],
    ] as const),
    bag: vary(rng, rng.pick([0x151515, 0x2a2e3a, 0x5a3a24])),
    flags: [rng.chance(0.4) ? 1 : 0, rng.chance(0.25) ? 1 : 0, 0, shirt ? rng.weighted([[1, 40], [2, 40], [8, 20]] as const) : rng.chance(0.12) ? 1 : 0],
    misc: [rng.chance(0.1) ? (rng.chance(0.5) ? 1 : 2) : 0, rng.int(0, 3), rng.chance(0.6) ? PATTERN.denim : 0, b.width * (rng.chance(0.25) ? -1 : 1)],
    style: [0, 0, 0, shirt ? rng.weighted([[2, 60], [1, 40]] as const) : rng.chance(0.12) ? 2 : 1],
    shape: b.shape,
    wear: [1, 1, 0, (rng.chance(0.15) ? EXTRA.glasses : 0) | (age === 'child' ? EXTRA.child : 0)],
    scale: b.scale,
    stride: 1,
  };
}

/** Mumbai Police: khaki shirt and trousers, a cap, a moustache more often than not. */
export function policeLook(rng: RNG, cap: 1 | 2): Look {
  const b = body(rng, false, 'adult');
  return {
    ...manLook(rng, 'adult'),
    top: 0xb09a72,
    bottom: 0xa48e66,
    accent: 0xb09a72,
    layer: 0,
    shoe: MEN_SHOES[0],
    flags: [0, 0, 0, 0],
    misc: [cap, 0, 0, Math.max(1.02, b.width) * (rng.chance(0.7) ? -1 : 1)],
    wear: [1, 1, 0, 0],
    scale: Math.max(0.98, b.scale),
  };
}

// ---- Women ------------------------------------------------------------------------------------

type Kind = 'college' | 'office' | 'stylish' | 'indo' | 'tourist' | 'seniorWestern' | 'jogger' | 'salwar' | 'saree';

/** Hair: a style and a length (1 ≈ to the shoulder blades; a bob ≈ 0.3; to the waist ≈ 1.5). */
function hairStyle(rng: RNG, w: W<number>, lengths: [number, number]): [number, number] {
  return [rng.weighted(w), rng.range(lengths[0], lengths[1])];
}

function extras(rng: RNG, p: { earrings?: number; bindi?: number; glasses?: number; sunglasses?: number; lipstick?: number }): number {
  let e = 0;
  if (rng.chance(p.earrings ?? 0)) e |= EXTRA.earrings;
  if (rng.chance(p.bindi ?? 0)) e |= EXTRA.bindi;
  if (rng.chance(p.sunglasses ?? 0)) e |= EXTRA.sunglasses;
  else if (rng.chance(p.glasses ?? 0)) e |= EXTRA.glasses;
  if (rng.chance(p.lipstick ?? 0)) e |= EXTRA.lipstick;
  return e;
}

/** A woman of the given kind and age. */
function womanLook(rng: RNG, kind: Kind, age: Age): Look {
  const b = body(rng, true, age);
  const skin = skinTone(rng);
  const hair = hairFor(rng, age);
  const base = (variant: 1 | 2 | 4): Look => ({
    variant,
    top: 0,
    bottom: 0,
    accent: pickVary(rng, JEWEL, 0.03),
    skin,
    hair,
    layer: 0,
    shoe: pickVary(rng, FLATS),
    bag: pickVary(rng, BAGS),
    flags: [0, BAG.none, 0, 0],
    misc: [0, rng.int(0, 3), 0, b.width],
    style: [SHOE.flats, HAIR.open, BOTTOM.trousers, 1],
    shape: b.shape,
    wear: [1, 1, 0, 0],
    scale: b.scale,
    stride: 1,
  });
  const young = age === 'teen' || age === 'young';
  const bagOf = (w: W<number>) => rng.weighted(w);
  const setHair = (w: W<number>, len: [number, number]) => {
    const [st, ln] = hairStyle(rng, w, len);
    l.style[1] = st;
    l.wear[0] = ln;
  };
  let l: Look;
  switch (kind) {
    case 'saree': {
      l = base(2);
      l.top = pickVary(rng, SAREES);
      l.accent = rng.chance(0.6) ? pickVary(rng, KURTAS) : l.top;
      l.bottom = 0x222222;
      l.flags = [0, bagOf([[BAG.none, 3], [BAG.shoulder, 5], [BAG.tote, 3]]), 0, rng.chance(0.75) ? PATTERN.border : PATTERN.none];
      l.style = [rng.chance(0.75) ? SHOE.sandals : SHOE.flats, 0, 0, 0];
      setHair(young ? [[HAIR.open, 3], [HAIR.braid, 3], [HAIR.bun, 3], [HAIR.ponytail, 1]] : [[HAIR.bun, 6], [HAIR.braid, 3], [HAIR.open, 1]], [0.8, 1.45]);
      l.wear[3] = extras(rng, { earrings: 0.8, bindi: 0.7, glasses: age === 'senior' ? 0.6 : 0.15, lipstick: young ? 0.3 : 0.1 });
      l.stride = 0.6;
      break;
    }
    case 'salwar': {
      l = base(1);
      l.top = pickVary(rng, KURTAS);
      l.bottom = pickVary(rng, LEGGINGS);
      l.layer = rng.chance(0.5) ? pickVary(rng, KURTAS) : vary(rng, l.top, 0.12);
      l.flags = [young && rng.chance(0.2) ? 1 : 0, bagOf([[BAG.none, 2], [BAG.shoulder, 5], [BAG.tote, 2], [BAG.sling, young ? 2 : 0.3]]), 0, rng.weighted([[PATTERN.none, 4], [PATTERN.border, 3], [PATTERN.floral, 2]])];
      l.style = [rng.weighted([[SHOE.sandals, 4], [SHOE.flats, 4], [SHOE.sneakers, young ? 1.5 : 0.3]]), 0, 0, 2];
      l.wear[2] = rng.chance(young ? 0.55 : 0.8) ? 2 : 0;
      setHair([[HAIR.braid, 3.5], [HAIR.bun, age === 'senior' || age === 'middle' ? 4 : 1.5], [HAIR.ponytail, 1.5], [HAIR.open, young ? 3 : 1]], [0.8, 1.4]);
      l.wear[3] = extras(rng, { earrings: 0.8, bindi: young ? 0.3 : 0.6, glasses: age === 'senior' ? 0.55 : 0.15, lipstick: young ? 0.25 : 0.1 });
      break;
    }
    default: {
      l = base(4);
      const e = { earrings: 0.6, glasses: 0.15, sunglasses: 0, lipstick: 0.2, bindi: 0 };
      const top = (pattern: W<number>, list = TOPS) => {
        l.top = pickVary(rng, list);
        l.flags[3] = rng.weighted(pattern);
        l.accent = l.flags[3] === PATTERN.floral || l.flags[3] === PATTERN.dots || l.flags[3] === PATTERN.stripes ? pickVary(rng, PRINT) : l.accent;
      };
      const jeans = () => {
        l.style[2] = BOTTOM.trousers;
        l.bottom = pickVary(rng, DENIM, 0.05);
        l.misc[2] = PATTERN.denim;
      };
      const shirtOn = () => {
        top([[PATTERN.none, 5], [PATTERN.pinstripe, 2], [PATTERN.check, 1], [PATTERN.floral, 2]], W_SHIRTS);
        l.wear[3] |= EXTRA.collar;
        l.style[3] = rng.chance(0.65) ? 2 : 1;
      };
      switch (kind) {
        case 'college': {
          if (rng.chance(0.25)) shirtOn();
          else {
            top([[PATTERN.none, 7], [PATTERN.stripes, 1.5], [PATTERN.pinstripe, 1.5], [PATTERN.floral, 0.6]]);
            l.style[3] = rng.weighted([[1, 6], [2, 2.5], [0, 1.5]]);
          }
          const b2 = rng.weighted([['jeans', 6], ['wide', 2.5], ['skirt', 1.2], ['kurti', 1.3]] as const);
          if (b2 === 'jeans') jeans();
          else if (b2 === 'wide') {
            l.style[2] = BOTTOM.wide;
            l.bottom = pickVary(rng, WIDE);
          } else if (b2 === 'skirt') {
            l.style[2] = BOTTOM.skirt;
            l.bottom = pickVary(rng, SKIRTS);
            l.wear[1] = rng.range(0.9, 1.7);
          } else {
            l.style[2] = BOTTOM.kurti;
            l.top = pickVary(rng, KURTIS);
            l.flags[3] = rng.weighted([[PATTERN.none, 3], [PATTERN.floral, 2], [PATTERN.border, 1]]);
            l.accent = pickVary(rng, PRINT);
            l.wear[1] = rng.range(0.55, 1.1);
            l.bottom = rng.chance(0.6) ? pickVary(rng, DENIM) : pickVary(rng, LEGGINGS);
          }
          if (rng.chance(0.18)) {
            l.wear[2] = 1;
            l.layer = pickVary(rng, LAYERS);
          }
          l.style[0] = rng.weighted([[SHOE.sneakers, 7], [SHOE.sandals, 2], [SHOE.flats, 1]]);
          l.flags[0] = rng.chance(0.3) ? 1 : 0;
          l.flags[1] = l.flags[0] ? BAG.none : bagOf([[BAG.sling, 4], [BAG.tote, 1.5], [BAG.shoulder, 1.5], [BAG.none, 1.5]]);
          setHair([[HAIR.open, 4.5], [HAIR.ponytail, 3.5], [HAIR.bun, 1], [HAIR.braid, 1]], [0.4, 1.4]);
          e.glasses = 0.2;
          e.earrings = 0.5;
          e.lipstick = 0.1;
          break;
        }
        case 'office': {
          if (rng.chance(0.45)) shirtOn();
          else {
            top([[PATTERN.none, 6], [PATTERN.floral, 1.5], [PATTERN.dots, 1]]);
            l.style[3] = rng.weighted([[1, 5], [2, 4], [0, 1]]);
          }
          const b2 = rng.weighted([['trousers', 4.5], ['wide', 2.5], ['skirt', 1], ['kurti', 2], ['jeans', 1]] as const);
          if (b2 === 'trousers') {
            l.bottom = pickVary(rng, W_TROUSERS);
          } else if (b2 === 'wide') {
            l.style[2] = BOTTOM.wide;
            l.bottom = pickVary(rng, W_TROUSERS);
          } else if (b2 === 'skirt') {
            l.style[2] = BOTTOM.skirt;
            l.bottom = pickVary(rng, [0x1c1c1e, 0x252f4f, 0xcdb99a, 0x7a7a7a]);
            l.wear[1] = rng.range(1.0, 1.55);
          } else if (b2 === 'kurti') {
            l.style[2] = BOTTOM.kurti;
            l.top = pickVary(rng, KURTIS);
            l.flags[3] = rng.weighted([[PATTERN.none, 3], [PATTERN.floral, 2], [PATTERN.border, 1]]);
            l.accent = pickVary(rng, PRINT);
            l.wear[1] = rng.range(0.9, 1.4);
            l.bottom = pickVary(rng, LEGGINGS);
            l.wear[3] &= ~EXTRA.collar;
          } else jeans();
          if (rng.chance(0.22)) {
            l.wear[2] = 1;
            l.layer = pickVary(rng, [0x1c1c1e, 0xcdb99a, 0x252f4f, 0xece2cf, 0x7a7a7a]);
          }
          l.style[0] = rng.weighted([[SHOE.flats, 5], [SHOE.sandals, 3], [SHOE.sneakers, 2]]);
          l.flags[1] = bagOf([[BAG.tote, 4.5], [BAG.shoulder, 4], [BAG.sling, 1.5]]);
          setHair([[HAIR.open, 4], [HAIR.ponytail, 2.5], [HAIR.bun, 2.5], [HAIR.braid, 1]], [0.3, 1.3]);
          e.glasses = 0.3;
          e.earrings = 0.75;
          e.lipstick = 0.4;
          e.bindi = 0.1;
          break;
        }
        case 'stylish': {
          const o = rng.weighted([['dress', 3.5], ['coord', 2], ['crop', 1.2], ['skirt', 1.5], ['wide', 1.5], ['shirt', 1]] as const);
          if (o === 'dress') {
            l.style[2] = BOTTOM.dress;
            l.top = pickVary(rng, DRESSES);
            l.flags[3] = rng.weighted([[PATTERN.none, 4], [PATTERN.floral, 3], [PATTERN.dots, 1]]);
            l.accent = pickVary(rng, PRINT);
            l.wear[1] = rng.weighted([[rng.range(0.85, 1.05), 2], [rng.range(1.3, 1.6), 3], [rng.range(1.7, 1.9), 1.5]]);
            l.style[3] = rng.weighted([[0, 3], [1, 4], [2, 1.5]]);
          } else if (o === 'coord') {
            // Co-ord set: top and skirt or trousers alike.
            const c = pickVary(rng, COORDS);
            l.top = c;
            l.bottom = vary(rng, c, 0.03);
            const pat = rng.weighted([[PATTERN.none, 3], [PATTERN.floral, 1.5], [PATTERN.pinstripe, 1]]);
            l.flags[3] = pat;
            l.misc[2] = pat;
            l.accent = pickVary(rng, PRINT);
            if (rng.chance(0.5)) {
              l.style[2] = BOTTOM.skirt;
              l.wear[1] = rng.range(0.95, 1.6);
            } else l.style[2] = BOTTOM.wide;
            l.style[3] = rng.weighted([[1, 3], [2, 2], [0, 1]]);
          } else if (o === 'crop') {
            top([[PATTERN.none, 5], [PATTERN.pinstripe, 1]]);
            l.wear[3] |= EXTRA.crop;
            l.style[3] = rng.weighted([[1, 3], [0, 2], [2, 1]]);
            if (rng.chance(0.7)) jeans();
            else {
              l.style[2] = BOTTOM.wide;
              l.bottom = pickVary(rng, WIDE);
            }
          } else if (o === 'skirt') {
            top([[PATTERN.none, 5], [PATTERN.stripes, 1]]);
            l.style[2] = BOTTOM.skirt;
            l.bottom = pickVary(rng, SKIRTS);
            l.misc[2] = rng.weighted([[PATTERN.none, 4], [PATTERN.floral, 1.5]]);
            l.wear[1] = rng.weighted([[rng.range(0.8, 1.0), 1.5], [rng.range(1.2, 1.9), 3]]);
            l.style[3] = rng.weighted([[1, 4], [0, 1.5], [2, 1]]);
          } else if (o === 'wide') {
            top([[PATTERN.none, 5], [PATTERN.floral, 1]]);
            l.style[2] = BOTTOM.wide;
            l.bottom = pickVary(rng, WIDE);
            l.style[3] = rng.weighted([[1, 3], [0, 1.5], [2, 1]]);
          } else {
            shirtOn();
            jeans();
          }
          if (rng.chance(0.15)) {
            l.wear[2] = 1;
            l.layer = pickVary(rng, LAYERS);
          }
          l.style[0] = rng.weighted([[SHOE.sandals, 4.5], [SHOE.sneakers, 4], [SHOE.flats, 1.5]]);
          l.flags[1] = bagOf([[BAG.sling, 5], [BAG.shoulder, 3.5], [BAG.none, 1.5]]);
          setHair([[HAIR.open, 6.5], [HAIR.ponytail, 2], [HAIR.bun, 1.5]], [0.3, 1.5]);
          e.sunglasses = 0.18;
          e.earrings = 0.85;
          e.lipstick = 0.55;
          e.glasses = 0.08;
          break;
        }
        case 'indo': {
          l.top = pickVary(rng, KURTIS);
          l.flags[3] = rng.weighted([[PATTERN.none, 3], [PATTERN.floral, 3], [PATTERN.border, 1.5]]);
          l.accent = pickVary(rng, PRINT);
          l.style[3] = rng.weighted([[2, 4], [1, 3], [0, 0.5]]);
          l.wear[1] = rng.range(0.6, 1.5);
          const b2 = rng.weighted([['jeans', 3.5], ['leggings', 3.5], ['palazzo', 3]] as const);
          if (b2 === 'palazzo') {
            // Kurti over palazzos.
            l.style[2] = BOTTOM.kurtiWide;
            l.bottom = pickVary(rng, WIDE);
            l.misc[2] = rng.chance(0.3) ? PATTERN.floral : PATTERN.none;
          } else {
            l.style[2] = BOTTOM.kurti;
            l.bottom = b2 === 'jeans' ? pickVary(rng, DENIM) : pickVary(rng, LEGGINGS);
            if (b2 === 'jeans') l.misc[2] = PATTERN.denim;
          }
          const lay = rng.weighted([['none', 4.5], ['denim', 2], ['dupatta', 3.5]] as const);
          if (lay === 'denim') {
            l.wear[2] = 1;
            l.layer = pickVary(rng, [0x4b6a99, 0x6a86b0, 0x3f5a8a]);
          } else if (lay === 'dupatta') {
            l.wear[2] = 2;
            l.layer = pickVary(rng, KURTIS);
          }
          l.style[0] = rng.weighted([[SHOE.flats, 5], [SHOE.sandals, 3.5], [SHOE.sneakers, 1.5]]);
          l.flags[1] = bagOf([[BAG.tote, 4], [BAG.shoulder, 4], [BAG.sling, 2]]);
          setHair([[HAIR.braid, 2.5], [HAIR.open, 3.5], [HAIR.bun, 2], [HAIR.ponytail, 2]], [0.6, 1.5]);
          e.bindi = 0.45;
          e.earrings = 0.9;
          e.lipstick = 0.3;
          e.glasses = 0.15;
          break;
        }
        case 'tourist': {
          if (rng.chance(0.55)) {
            shirtOn();
            l.flags[3] = rng.weighted([[PATTERN.floral, 3], [PATTERN.none, 2], [PATTERN.check, 1]]);
            l.accent = pickVary(rng, PRINT);
          } else top([[PATTERN.none, 4], [PATTERN.stripes, 1.5], [PATTERN.floral, 1.5]]);
          if (rng.chance(0.65)) jeans();
          else l.bottom = pickVary(rng, W_TROUSERS);
          l.style[0] = rng.weighted([[SHOE.sneakers, 7], [SHOE.sandals, 2], [SHOE.flats, 1]]);
          l.flags[1] = bagOf([[BAG.sling, 5], [BAG.shoulder, 3], [BAG.tote, 1]]);
          l.flags[0] = rng.chance(0.2) ? 1 : 0;
          if (rng.chance(0.4)) {
            l.misc[0] = 3;
            l.accent = pickVary(rng, [0xe8dcc8, 0xd8c3a0, 0xf2c4cf, 0xf4f2ee, 0x1f2d55]);
          }
          setHair([[HAIR.open, 5], [HAIR.ponytail, 3], [HAIR.bun, 1]], [0.3, 1.2]);
          e.sunglasses = 0.45;
          e.earrings = 0.6;
          e.lipstick = 0.25;
          break;
        }
        case 'seniorWestern': {
          top([[PATTERN.floral, 3], [PATTERN.none, 3], [PATTERN.dots, 1], [PATTERN.check, 1]], rng.chance(0.5) ? W_SHIRTS : TOPS);
          if (rng.chance(0.6)) l.wear[3] |= EXTRA.collar;
          l.accent = pickVary(rng, PRINT);
          l.style[3] = rng.weighted([[2, 3], [1, 2]]);
          l.bottom = pickVary(rng, [0xcdb99a, 0x1c1c1e, 0x252f4f, 0xece2cf, 0x8a7a6a]);
          l.style[2] = rng.chance(0.3) ? BOTTOM.wide : BOTTOM.trousers;
          l.style[0] = rng.weighted([[SHOE.sneakers, 4], [SHOE.flats, 4], [SHOE.sandals, 2]]);
          l.flags[1] = bagOf([[BAG.shoulder, 5], [BAG.tote, 2], [BAG.sling, 2]]);
          setHair([[HAIR.open, 7], [HAIR.bun, 3]], [0.22, 0.45]);
          e.glasses = 0.6;
          e.earrings = 0.7;
          e.lipstick = 0.2;
          e.bindi = 0.3;
          break;
        }
        case 'jogger': {
          l.top = pickVary(rng, [0x161616, 0xf4f2ee, 0xe0457e, 0x2c56b8, 0x9d9d9d, 0x2a8c8c, 0xf07a28, 0xb9a4d9]);
          l.bottom = pickVary(rng, [0x161616, 0x161616, 0x252f4f, 0x3a3a3c]);
          l.style = [SHOE.sneakers, 0, BOTTOM.trousers, rng.chance(0.6) ? 1 : 0];
          l.flags[1] = BAG.none;
          setHair([[HAIR.ponytail, 8], [HAIR.bun, 2]], [0.6, 1.1]);
          e.earrings = 0.2;
          e.lipstick = 0;
          e.glasses = 0;
          break;
        }
      }
      l.wear[3] |= extras(rng, e);
      if (l.style[2] === BOTTOM.skirt || l.style[2] === BOTTOM.dress) if (l.wear[1] > 1.3) l.stride = 0.72;
    }
  }
  if (l.style[0] === SHOE.sneakers) l.shoe = vary(rng, rng.weighted(SNEAKERS), 0.04);
  if (age === 'child') {
    l.wear[3] = (l.wear[3] & (EXTRA.collar | EXTRA.earrings)) | EXTRA.child;
    l.wear[2] = 0;
    l.flags[1] = BAG.none;
    l.style[0] = rng.chance(0.7) ? SHOE.sneakers : SHOE.sandals;
    if (l.style[0] === SHOE.sneakers) l.shoe = vary(rng, rng.weighted(SNEAKERS), 0.04);
    l.wear[0] = Math.min(l.wear[0], 1.0);
  }
  return l;
}

// ---- Who is out -------------------------------------------------------------------------------

/** A young woman: student, office-goer, out for the evening, in Indian or Indo-western wear. */
export function youngWoman(rng: RNG): Look {
  const age: Age = rng.chance(0.25) ? 'teen' : 'young';
  const kind = rng.weighted([
    ['college', age === 'teen' ? 5 : 3],
    ['stylish', 2.5],
    ['office', age === 'teen' ? 0 : 1.8],
    ['indo', 1.8],
    ['salwar', 0.8],
    ['saree', 0.3],
  ] as const);
  return womanLook(rng, kind, age);
}

/** A woman past her twenties: sarees and salwar kurtas, Indo-western, office wear, tourists. */
export function woman(rng: RNG): Look {
  const age: Age = rng.weighted([
    ['adult', 5],
    ['middle', 3.5],
    ['senior', 1.8],
  ] as const);
  const kind = rng.weighted([
    ['saree', age === 'adult' ? 2 : 4],
    ['salwar', 3],
    ['indo', age === 'senior' ? 0.5 : 2],
    ['office', age === 'senior' ? 0 : 1.6],
    ['tourist', 1.2],
    ['seniorWestern', age === 'adult' ? 0.3 : 1.4],
  ] as const);
  return womanLook(rng, kind, age);
}

export function man(rng: RNG): Look {
  const age: Age = rng.weighted([
    ['adult', 5],
    ['middle', 3.5],
    ['senior', 1.5],
  ] as const);
  return manLook(rng, age);
}

/** Someone out for a run along the promenade. */
export function jogger(rng: RNG, female: boolean): Look {
  if (female) return womanLook(rng, 'jogger', rng.chance(0.7) ? 'young' : 'adult');
  const l = youngMan(rng);
  l.top = pickVary(rng, [0x161616, 0xf4f4f0, 0x1e88e5, 0x9e9e9e, 0xc62828, 0x0d47a1]);
  l.bottom = pickVary(rng, [0x161616, 0x252f4f, 0x3a3a3c]);
  l.misc = [0, 0, 0, Math.abs(l.misc[3])];
  l.flags = [0, 0, 0, 0];
  l.shoe = pickVary(rng, [0xf0f0ec, 0x1a1a1a, 0x2c56b8]);
  return l;
}

/** A child out with the family. */
export function child(rng: RNG): Look {
  if (rng.chance(0.5)) return youngMan(rng, skinTone(rng), 'child');
  return womanLook(rng, rng.weighted([['college', 3], ['stylish', 2], ['indo', 1]] as const), 'child');
}

/**
 * A random passer-by. `youth` is the share of young people (college students, couples): about a
 * third at the station, more on the evening promenade. Looks drawn from one random stream stay
 * distinct from the last few dozen drawn from it (LookDeck).
 */
export function makeLook(rng: RNG, youth = 0.3): Look {
  return deckOf(rng).take(() => {
    const female = rng.chance(0.44);
    if (rng.chance(youth)) return female ? youngWoman(rng) : youngMan(rng);
    return female ? woman(rng) : man(rng);
  });
}

/** A particular kind of person, kept distinct from the recent looks of the same stream. */
export function makeLookOf(rng: RNG, make: (rng: RNG) => Look): Look {
  return deckOf(rng).take(() => make(rng));
}

// ---- Keeping neighbours distinct --------------------------------------------------------------

const near = (a: number, b: number, tol = 28) => Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255)) < tol * 3;

/** How alike two looks read at a glance (0 … ~9). */
function likeness(a: Look, b: Look): number {
  if (a.variant !== b.variant) return 0;
  let s = 1;
  if (near(a.top, b.top)) s += 2;
  if (near(a.bottom, b.bottom)) s += 1.2;
  if (a.style[2] === b.style[2]) s += 0.8;
  if (a.style[1] === b.style[1]) s += 0.8;
  if (Math.abs(a.wear[0] - b.wear[0]) < 0.25) s += 0.5;
  if (near(a.skin, b.skin, 14)) s += 0.8;
  if (near(a.hair, b.hair, 14)) s += 0.4;
  if (a.flags[3] === b.flags[3]) s += 0.4;
  if (a.flags[1] === b.flags[1] && near(a.bag, b.bag)) s += 0.4;
  if (a.wear[2] === b.wear[2]) s += 0.3;
  if (Math.abs(a.scale - b.scale) < 0.02) s += 0.3;
  return s;
}

/** Recent looks from one stream; new ones too like any of them are drawn again. */
export class LookDeck {
  private readonly recent: Look[] = [];
  private next = 0;

  constructor(private readonly size = 48) {}

  take(make: () => Look): Look {
    let best: Look | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 6; i++) {
      const l = make();
      let score = 0;
      for (const r of this.recent) score = Math.max(score, likeness(l, r));
      if (score < bestScore) {
        best = l;
        bestScore = score;
      }
      if (score < 4.5) break;
    }
    if (this.recent.length < this.size) this.recent.push(best!);
    else this.recent[this.next] = best!;
    this.next = (this.next + 1) % this.size;
    return best!;
  }
}

const decks = new WeakMap<RNG, LookDeck>();
function deckOf(rng: RNG): LookDeck {
  let d = decks.get(rng);
  if (!d) decks.set(rng, (d = new LookDeck()));
  return d;
}
