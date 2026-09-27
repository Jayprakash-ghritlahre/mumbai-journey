import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../../core/Random';
import { addShaderPatch } from '../../gfx/AmbientVolume';
import { boxGeo, rodGeo, tint } from '../../gfx/GeoBuilder';
import { makeCanvas, type TextureFactory } from '../../gfx/TextureFactory';
import { DEVA, LATIN, fillFitted } from '../../gfx/Signage';
import type { StationMaterials } from '../../world/churchgate/StationMaterials';
import { IN, buildCar, interiorWalls } from './EmuBuilder';
import { CAR, buildHeroLivery, buildInteriorTex } from './Livery';
import { patchDoors } from './TrainSystem';

/**
 * The car the player rides in: the regular exterior at high resolution plus a detailed
 * second-class interior reconstructed from the reference photos (assets/trains/internal):
 * navy benches on stainless frames in facing bays, a chequer-plate floor, tube-bar partitions,
 * poles, ceiling grab rails with hanging handles, caged fans, tube lights, luggage racks,
 * red LED next-station displays, ads and notices. Car-local frame as EmuBuilder: x across,
 * y up from rail top (floor at CAR.floorY), z along.
 */

const L = CAR.length / 2;
const F = CAR.floorY;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type RGB = [number, number, number];

const C = {
  steel: [1, 1, 1] as RGB,
  steelDark: [0.72, 0.73, 0.75] as RGB,
  navy: [0.045, 0.075, 0.17] as RGB,
  navyStripe: [0.3, 0.44, 0.66] as RGB,
  panel: [0.55, 0.56, 0.58] as RGB,
  red: [0.72, 0.08, 0.06] as RGB,
  black: [0.05, 0.05, 0.05] as RGB,
  white: [1, 1, 1] as RGB,
};

/** Door vestibule half-length along the car (door opening plus standing room). */
const VEST = 1.0;
/** Aisle half-width; benches run from here to the wall. */
const AISLE = 0.44;
const RAIL_Y = F + 1.95;
const CEIL_WALL = F + 2.05;
const CEIL_CROWN = F + 2.3;

/** Seating sections between the vestibules and bays within them (bench backs at each end). */
function bays(): { z0: number; z1: number }[] {
  const secs: [number, number][] = [
    [-L + 0.15, CAR.doors[0] - VEST],
    [CAR.doors[0] + VEST, CAR.doors[1] - VEST],
    [CAR.doors[1] + VEST, CAR.doors[2] - VEST],
    [CAR.doors[2] + VEST, L - 0.15],
  ];
  const out: { z0: number; z1: number }[] = [];
  for (const [a, b] of secs) {
    const n = Math.max(1, Math.floor((b - a) / 1.6));
    for (let i = 0; i < n; i++) out.push({ z0: a + ((b - a) * i) / n, z1: a + ((b - a) * (i + 1)) / n });
  }
  return out;
}

/** Collects coloured geometry per material key. */
class Parts {
  private m = new Map<string, THREE.BufferGeometry[]>();
  add(key: string, g: THREE.BufferGeometry, color: RGB = [1, 1, 1]): void {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    tint(ng, ...color);
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) ng.deleteAttribute(k);
    let l = this.m.get(key);
    if (!l) this.m.set(key, (l = []));
    l.push(ng);
  }
  build(mats: Record<string, THREE.Material>, group: THREE.Group, shadows = false): void {
    for (const [k, list] of this.m) {
      const mesh = new THREE.Mesh(mergeGeometries(list)!, mats[k]);
      mesh.name = 'hero-' + k;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

/** Aluminium chequer plate (the diamond tread of the floor). */
function chequerTexture(tf: TextureFactory): THREE.Texture {
  return tf.memo('chequerPlate', () => {
    const S = 256;
    const [c, ctx] = makeCanvas(S, S);
    ctx.fillStyle = '#8d9194';
    ctx.fillRect(0, 0, S, S);
    tf.overlayNoise(ctx, S, S, 2, 2, 0.25, 'overlay', 7);
    const n = 8;
    const cell = S / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = i * cell + cell / 2;
        const y = j * cell + cell / 2;
        const a = (i + j) % 2 ? Math.PI / 4 : -Math.PI / 4;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.fillStyle = '#b4b8ba';
        ctx.fillRect(-cell * 0.34, -cell * 0.07, cell * 0.68, cell * 0.14);
        ctx.fillStyle = 'rgba(40,40,40,0.35)';
        ctx.fillRect(-cell * 0.34, cell * 0.05, cell * 0.68, cell * 0.04);
        ctx.restore();
      }
    // Scuffs and grime along the walking lines.
    const rng = new RNG(88);
    for (let i = 0; i < 14; i++) tf.stain(ctx, S, S, rng.range(0, S), rng.range(0, S), rng.range(12, 40), 'rgba(60,55,45,1)', 0.12, rng, 3);
    const t = tf.tex(c);
    t.repeat.set(1 / 0.6, 1 / 0.6);
    return t;
  });
}

/** Ads, notices and the route strip for the car's interior (fictional advertisers). */
function signAtlas(tf: TextureFactory): { tex: THREE.Texture; rect: (i: number) => [number, number, number, number] } {
  const cols = 4;
  const rows = 4;
  const W = 1024;
  const H = 512;
  const tex = tf.memo('heroSigns', () => {
    const [c, ctx] = makeCanvas(W, H);
    const cw = W / cols;
    const ch = H / rows;
    const cards: ((x: number, y: number, w: number, h: number) => void)[] = [
      (x, y, w, h) => {
        ctx.fillStyle = '#fff8e1';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#b71c1c';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fillFitted(ctx, 'पायदानावर उभे राहू नका', x + w / 2, y + h * 0.36, '700', DEVA, h * 0.26, w * 0.92);
        ctx.fillStyle = '#222';
        fillFitted(ctx, 'DO NOT STAND ON THE FOOTBOARD', x + w / 2, y + h * 0.72, '700', LATIN, h * 0.16, w * 0.92);
      },
      (x, y, w, h) => {
        ctx.fillStyle = '#0d47a1';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#ffeb3b';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        fillFitted(ctx, 'SPOKEN ENGLISH', x + w * 0.06, y + h * 0.32, '800', LATIN, h * 0.26, w * 0.88);
        ctx.fillStyle = '#fff';
        fillFitted(ctx, '30 दिवसांत · 98XXX XXX12', x + w * 0.06, y + h * 0.7, '700', DEVA, h * 0.2, w * 0.88);
      },
      (x, y, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#2e7d32';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        fillFitted(ctx, 'डॉ. जोशी क्लिनिक', x + w * 0.06, y + h * 0.35, '700', DEVA, h * 0.26, w * 0.88);
        ctx.fillStyle = '#333';
        fillFitted(ctx, 'Skin · Hair · Allergy — Dadar (W)', x + w * 0.06, y + h * 0.72, '600', LATIN, h * 0.15, w * 0.88);
      },
      (x, y, w, h) => {
        const g = ctx.createLinearGradient(x, y, x + w, y);
        g.addColorStop(0, '#ffd100');
        g.addColorStop(1, '#ff9f00');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#1a1a1a';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        fillFitted(ctx, 'JHAKAAS 5G', x + w * 0.06, y + h * 0.35, '900', LATIN, h * 0.3, w * 0.88);
        fillFitted(ctx, '₹299 · UNLIMITED', x + w * 0.06, y + h * 0.72, '700', LATIN, h * 0.18, w * 0.88);
      },
      (x, y, w, h) => {
        ctx.fillStyle = '#6a1b9a';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fillFitted(ctx, 'महिलांसाठी राखीव', x + w / 2, y + h * 0.35, '700', DEVA, h * 0.24, w * 0.9);
        fillFitted(ctx, 'SEATS FOR SENIOR CITIZENS', x + w / 2, y + h * 0.72, '700', LATIN, h * 0.15, w * 0.9);
      },
      (x, y, w, h) => {
        ctx.fillStyle = '#e65100';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#fff8e1';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        fillFitted(ctx, 'BINDAAS CHAI', x + w * 0.06, y + h * 0.35, '900', LATIN, h * 0.28, w * 0.88);
        fillFitted(ctx, 'एक कटिंग · ₹10', x + w * 0.06, y + h * 0.72, '700', DEVA, h * 0.2, w * 0.88);
      },
      (x, y, w, h) => {
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#c62828';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fillFitted(ctx, 'धूम्रपान निषिद्ध', x + w / 2, y + h * 0.35, '700', DEVA, h * 0.24, w * 0.9);
        fillFitted(ctx, 'NO SMOKING · FINE ₹200', x + w / 2, y + h * 0.72, '700', LATIN, h * 0.16, w * 0.9);
      },
      (x, y, w, h) => {
        ctx.fillStyle = '#004d40';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#a7ffeb';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        fillFitted(ctx, 'GANESH TUITIONS', x + w * 0.06, y + h * 0.35, '800', LATIN, h * 0.24, w * 0.88);
        ctx.fillStyle = '#fff';
        fillFitted(ctx, 'SSC · HSC · CET — Borivali (E)', x + w * 0.06, y + h * 0.72, '600', LATIN, h * 0.15, w * 0.88);
      },
    ];
    for (let i = 0; i < cards.length; i++) {
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      cards[i](x + 2, y + 2, cw - 4, ch - 4);
    }
    // Route strips (the bottom half: two rows): Churchgate … Virar with the stations as dots.
    const stations = ['CCG', 'MRL', 'CYR', 'GTR', 'BCT', 'MX', 'PL', 'PBHD', 'DDR', 'MRU', 'MM', 'BA', 'KHAR', 'STC', 'VLP', 'ADH', 'JOS', 'RMAR', 'GMN', 'MDD', 'KILE', 'BVI', 'DIC', 'MIRA', 'BYR', 'NIG', 'BSR', 'VR'];
    for (const r of [2, 3]) {
      const y = r * ch;
      ctx.fillStyle = '#f5f5f0';
      ctx.fillRect(2, y + 2, W - 4, ch - 4);
      ctx.fillStyle = '#6b3a92';
      ctx.fillRect(20, y + ch * 0.5 - 4, W - 40, 8);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      stations.forEach((st, i) => {
        const sx = 20 + ((W - 40) * i) / (stations.length - 1);
        ctx.fillStyle = st === 'MIRA' || st === 'CCG' ? '#c62828' : '#6b3a92';
        ctx.beginPath();
        ctx.arc(sx, y + ch * 0.5, st === 'MIRA' || st === 'CCG' ? 9 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = `700 13px ${LATIN}`;
        ctx.fillText(st, sx, y + ch * (r === 2 ? 0.22 : 0.8));
      });
    }
    return tf.tex(c, { wrap: false });
  });
  const rect = (i: number): [number, number, number, number] => {
    if (i >= 8) return [0, 1 - (i === 8 ? 0.75 : 1), 1, 1 - (i === 8 ? 0.5 : 0.75)];
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    return [cx / cols, 1 - (cy + 1) / rows, (cx + 1) / cols, 1 - cy / rows];
  };
  return { tex, rect };
}

/** A card facing +x (normal) mapped to an atlas rect, width w along z and height h. */
function card(w: number, h: number, r: [number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateY(Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + (r[2] - r[0]) * uv.getX(i), r[1] + (r[3] - r[1]) * uv.getY(i));
  return g;
}

/** The inside of a car is shaded by its body: little sky light, and the tube lights. */
export function cabinLit(m: THREE.Material, u: { uCabinSky: { value: number }; uCabinLamp: { value: THREE.Color } }): THREE.Material {
  addShaderPatch(m, 'cabin', (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCabinSky;\nuniform vec3 uCabinLamp;')
      .replace(
        '#include <aomap_fragment>',
        `reflectedLight.indirectDiffuse *= uCabinSky;
        reflectedLight.indirectSpecular *= uCabinSky * 0.7;
        reflectedLight.indirectDiffuse += uCabinLamp * diffuseColor.rgb;
        #include <aomap_fragment>`,
      );
  });
  return m;
}

export interface Seat {
  x: number;
  z: number;
  /** Facing along ±z. */
  face: 1 | -1;
}

export interface HeroCar {
  /** Car-local group; the ride sets its matrix. */
  group: THREE.Group;
  /** Cabin light uniforms (for figures inside the car). */
  cabin: { uCabinSky: { value: number }; uCabinLamp: { value: THREE.Color } };
  seats: Seat[];
  /** Standing spots in the aisle and vestibules (car-local x, z). */
  standing: { x: number; z: number }[];
  /** Doorway positions (z) — both sides. */
  doors: number[];
  setDoors(open: number): void;
  /** sway: lateral and longitudinal acceleration (m/s²) for the hanging handles. */
  update(dt: number, time: number, sway: { lat: number; lon: number }, lamps: number, ledText: string): void;
}

export function buildHeroCar(tf: TextureFactory, mats: StationMaterials): HeroCar {
  const group = new THREE.Group();
  group.name = 'hero-car';
  group.matrixAutoUpdate = false;
  const cabin = { uCabinSky: { value: 0.42 }, uCabinLamp: { value: new THREE.Color(0.9, 0.95, 1.0) } };
  const lit = (name: string, p: THREE.MeshStandardMaterialParameters, cab = true): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial(p);
    mats.add(name, m);
    if (cab) cabinLit(m, cabin);
    return m;
  };
  const signs = signAtlas(tf);
  const M: Record<string, THREE.Material> = {
    body: lit('heroBody', { map: buildHeroLivery(tf, 0), roughness: 0.5, metalness: 0.08 }, false),
    roof: lit('heroRoof', { color: 0x75746f, roughness: 0.85 }, false),
    metal: lit('heroMetal', { color: 0x3a3a3a, vertexColors: true, roughness: 0.6, metalness: 0.45 }, false),
    barsOut: lit('heroBarsOut', { color: 0xb9bcbe, vertexColors: true, roughness: 0.4, metalness: 0.85 }, false),
    steel: lit('heroSteel', { color: 0xa9adb0, vertexColors: true, roughness: 0.32, metalness: 0.7, envMapIntensity: 0.6 }),
    seat: lit('heroSeat', { vertexColors: true, roughness: 0.5, metalness: 0.05 }),
    floor: lit('heroFloor', { map: chequerTexture(tf), roughness: 0.42, metalness: 0.55 }),
    wall: lit('heroWall', { map: buildInteriorTex(tf), color: 0xf4f5f2, vertexColors: true, roughness: 0.6 }),
    ceiling: lit('heroCeiling', { color: 0xf1f1ec, roughness: 0.75 }),
    paint: lit('heroPaint', { vertexColors: true, roughness: 0.55 }),
    signs: lit('heroSigns', { map: signs.tex, roughness: 0.6 }),
    tube: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.8, 2.9) }),
  };

  // ---- Exterior: the regular car at high resolution, without the simple interior ----------------
  const ext = buildCar('trailer', 3, { interior: false });
  const add = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(ext.body, M.body);
  add(ext.roof, M.roof);
  add(ext.metal, M.metal, false);
  add(ext.steel, M.barsOut, false);
  const doorMat = lit('heroDoors', { vertexColors: true, roughness: 0.5, metalness: 0.35 });
  patchDoors(doorMat);
  const doors = new THREE.InstancedMesh(ext.doors, doorMat, 1);
  doors.setMatrixAt(0, new THREE.Matrix4());
  const doorOpen = new THREE.InstancedBufferAttribute(new Float32Array([1]), 1);
  ext.doors.setAttribute('aDoorOpen', doorOpen);
  doors.castShadow = true;
  group.add(doors);

  // ---- Interior --------------------------------------------------------------------------------
  const P = new Parts();
  const z0 = -L + 0.12;
  const z1 = L - 0.12;
  // Floor (chequer plate, metre UVs) and the doorway thresholds.
  {
    const g = new THREE.PlaneGeometry(2 * IN, z1 - z0).rotateX(-Math.PI / 2).translate(0, F + 0.002, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
    P.add('floor', g);
    for (const d of CAR.doors)
      for (const s of [-1, 1]) {
        const t = new THREE.PlaneGeometry(CAR.halfW - IN + 0.01, CAR.doorW).rotateX(-Math.PI / 2).translate(s * (IN + (CAR.halfW - IN) / 2), F + 0.003, d);
        P.add('floor', t);
      }
  }
  // Walls with the window and door openings, up to where the ceiling springs.
  P.add('wall', interiorWalls(z0, z1, CEIL_WALL), [1, 1, 1]);
  // Arched ceiling.
  {
    const prof: [number, number][] = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = -IN + 2 * IN * t;
      const y = CEIL_WALL + (CEIL_CROWN - CEIL_WALL) * Math.sin(Math.PI * t);
      prof.push([x, y]);
    }
    const pos: number[] = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = prof[i];
      const [bx, by] = prof[i + 1];
      pos.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z0, bx, by, z1, ax, ay, z1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    P.add('ceiling', g);
    // Cornice strip between wall and ceiling (where the ad cards sit).
    for (const s of [-1, 1]) P.add('paint', boxGeo(0.02, 0.2, z1 - z0).translate(s * (IN - 0.01), CEIL_WALL - 0.1, 0), [0.86, 0.87, 0.85]);
  }
  // End walls with a closed end door.
  for (const z of [z0, z1]) {
    const f = z < 0 ? 1 : -1;
    const g = new THREE.PlaneGeometry(2 * IN, CEIL_CROWN - F);
    if (f < 0) g.rotateY(Math.PI);
    P.add('wall', g.translate(0, (F + CEIL_CROWN) / 2, z));
    P.add('paint', boxGeo(0.72, 1.9, 0.03).translate(0, F + 0.95, z + f * 0.02), [0.5, 0.52, 0.55]);
    P.add('paint', boxGeo(0.4, 0.5, 0.035).translate(0, F + 1.45, z + f * 0.02), [0.12, 0.13, 0.14]);
    // Fire extinguisher by the end wall.
    P.add('paint', new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10).translate(-IN + 0.14, F + 0.5, z + f * 0.14), C.red);
  }

  // Benches in facing bays, back-to-back between bays; stainless frames, navy cushions.
  const seats: Seat[] = [];
  const backs = new Set<number>();
  const vestibuleBacks = new Set<number>();
  const B = bays();
  for (const b of B) {
    for (const [zb, f] of [
      [b.z0, 1],
      [b.z1, -1],
    ] as [number, 1 | -1][]) {
      const key = Math.round(zb * 100);
      backs.add(key);
      if (CAR.doors.some((d) => Math.abs(Math.abs(zb - d) - VEST) < 0.05)) vestibuleBacks.add(key);
      for (const s of [-1, 1]) {
        const xc = s * (AISLE + IN) / 2;
        const w = IN - AISLE - 0.04;
        // Seat cushion with a pale stripe, front lip, skirt.
        P.add('seat', boxGeo(w, 0.09, 0.44).translate(xc, F + 0.45, zb + f * 0.3), C.navy);
        P.add('seat', boxGeo(w, 0.012, 0.04).translate(xc, F + 0.5, zb + f * 0.42), C.navyStripe);
        P.add('steel', boxGeo(w + 0.02, 0.05, 0.035).translate(xc, F + 0.4, zb + f * 0.52));
        P.add('steel', boxGeo(w, 0.36, 0.02).translate(xc, F + 0.2, zb + f * 0.46), C.steelDark);
        // Backrest, leaning back, with its stripe.
        const back = boxGeo(w, 0.5, 0.07);
        back.rotateX(-f * 0.14);
        P.add('seat', back.translate(xc, F + 0.8, zb + f * 0.1), C.navy);
        const stripe = boxGeo(w, 0.035, 0.075);
        stripe.rotateX(-f * 0.14);
        P.add('seat', stripe.translate(xc, F + 0.78, zb + f * 0.1), C.navyStripe);
        for (let i = 0; i < 3; i++) seats.push({ x: s * (AISLE + 0.24 + i * 0.42), z: zb + f * 0.32, face: f });
      }
    }
  }
  // Back panels, grab bars on top and the aisle posts (shared by back-to-back benches).
  for (const key of backs) {
    const zb = key / 100;
    for (const s of [-1, 1]) {
      const xc = (s * (AISLE + IN)) / 2;
      P.add('steel', boxGeo(IN - AISLE, 0.95, 0.025).translate(xc, F + 0.72, zb));
      P.add('steel', rodGeo(V(s * (AISLE + 0.02), F + 1.25, zb), V(s * (IN - 0.02), F + 1.25, zb), 0.018, 8));
      P.add('steel', rodGeo(V(s * AISLE, F, zb), V(s * AISLE, RAIL_Y, zb), 0.02, 10));
      if (vestibuleBacks.has(key)) {
        // Tube-bar screen towards the vestibule, curving down to the wall at the top.
        for (let x = AISLE + 0.1; x < IN - 0.05; x += 0.11) {
          const top = F + 1.92 - 0.25 * Math.pow((x - AISLE) / (IN - AISLE), 2);
          P.add('steel', rodGeo(V(s * x, F + 1.25, zb), V(s * x, top, zb), 0.009, 6));
        }
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const x = AISLE + ((IN - AISLE) * i) / 8;
          pts.push(V(s * x, F + 1.92 - 0.25 * Math.pow(i / 8, 2), zb));
        }
        for (let i = 0; i < pts.length - 1; i++) P.add('steel', rodGeo(pts[i], pts[i + 1], 0.016, 8));
      }
    }
  }
  // Door poles and the vestibule's cross rail.
  for (const d of CAR.doors)
    for (const s of [-1, 1]) {
      P.add('steel', rodGeo(V(s * (CAR.halfW - 0.3), F, d), V(s * (CAR.halfW - 0.3), CEIL_WALL, d), 0.022, 10));
      P.add('steel', rodGeo(V(s * (CAR.halfW - 0.3), RAIL_Y, d), V(s * AISLE, RAIL_Y, d), 0.016, 8));
    }
  // Ceiling grab rails over the aisle edges, with drop brackets.
  for (const s of [-1, 1]) {
    P.add('steel', rodGeo(V(s * AISLE, RAIL_Y, z0 + 0.3), V(s * AISLE, RAIL_Y, z1 - 0.3), 0.017, 8));
    for (let z = z0 + 0.6; z < z1 - 0.3; z += 2.3) P.add('steel', rodGeo(V(s * AISLE, RAIL_Y, z), V(s * AISLE * 0.9, CEIL_CROWN - 0.04, z), 0.012, 6));
  }
  // Luggage racks above the windows between the vestibules.
  for (const b of B)
    for (const s of [-1, 1]) {
      for (const dx of [0.08, 0.18, 0.28]) P.add('steel', rodGeo(V(s * (IN - dx), F + 1.86, b.z0 + 0.1), V(s * (IN - dx), F + 1.86, b.z1 - 0.1), 0.011, 6));
      for (const z of [b.z0 + 0.15, b.z1 - 0.15]) P.add('steel', rodGeo(V(s * (IN - 0.01), F + 1.95, z), V(s * (IN - 0.3), F + 1.86, z), 0.012, 6));
    }
  // Emergency alarm chains (red handles) by the doors.
  for (const d of CAR.doors) P.add('paint', boxGeo(0.06, 0.12, 0.04).translate(-IN + 0.03, F + 1.72, d + CAR.doorW / 2 + 0.2), C.red);

  // Tube lights in covered strips along both sides of the ceiling.
  const tubes: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1])
    for (let z = z0 + 0.4; z < z1 - 1.2; z += 1.35) {
      const yy = CEIL_WALL + (CEIL_CROWN - CEIL_WALL) * Math.sin(Math.PI * ((s * 1.05 + IN) / (2 * IN))) - 0.03;
      P.add('paint', boxGeo(0.14, 0.03, 1.22).translate(s * 1.05, yy, z + 0.61), [0.9, 0.9, 0.88]);
      tubes.push(new THREE.CylinderGeometry(0.02, 0.02, 1.16, 8).rotateX(Math.PI / 2).translate(s * 1.05, yy - 0.03, z + 0.61).toNonIndexed());
    }
  const tubeMesh = new THREE.Mesh(mergeGeometries(tubes)!, M.tube);
  tubeMesh.name = 'hero-tubes';
  group.add(tubeMesh);

  // Ad cards along the cornices, notices by the doors, route strips over the doorways.
  const rng = new RNG(4141);
  for (const s of [-1, 1]) {
    for (let z = z0 + 0.8; z < z1 - 0.6; z += rng.range(0.95, 1.4)) {
      if (CAR.doors.some((d) => Math.abs(z - d) < 0.8)) continue;
      const g = card(0.62, 0.16, signs.rect(rng.int(0, 7)));
      if (s > 0) g.rotateY(Math.PI);
      P.add('signs', g.translate(s * (IN - 0.025), CEIL_WALL - 0.1, z));
    }
    for (const d of CAR.doors) {
      const r = card(1.2, 0.14, signs.rect(8 + (s > 0 ? 1 : 0)));
      if (s > 0) r.rotateY(Math.PI);
      P.add('signs', r.translate(s * (IN - 0.02), CAR.doorY1 + 0.1, d));
      const n = card(0.34, 0.2, signs.rect(0));
      if (s > 0) n.rotateY(Math.PI);
      P.add('signs', n.translate(s * (IN - 0.02), F + 1.5, d - CAR.doorW / 2 - 0.3));
    }
  }

  // Red LED passenger-information displays over the middle of each vestibule.
  const [ledCanvas, ledCtx] = makeCanvas(1024, 64);
  const ledTex = new THREE.CanvasTexture(ledCanvas);
  ledTex.colorSpace = THREE.SRGBColorSpace;
  ledTex.wrapS = THREE.RepeatWrapping;
  ledTex.repeat.set(0.3, 1);
  const ledMat = new THREE.MeshBasicMaterial({ map: ledTex, color: new THREE.Color(1.8, 1.8, 1.8) });
  const leds: THREE.BufferGeometry[] = [];
  for (const d of [CAR.doors[0], CAR.doors[2]]) {
    P.add('paint', boxGeo(1.0, 0.16, 0.1).translate(0, CEIL_CROWN - 0.16, d), C.black);
    for (const f of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.92, 0.1);
      if (f < 0) g.rotateY(Math.PI);
      leds.push(g.translate(0, CEIL_CROWN - 0.16, d + f * 0.052));
    }
  }
  const ledMesh = new THREE.Mesh(mergeGeometries(leds)!, ledMat);
  group.add(ledMesh);
  let ledLast = '';
  const drawLed = (text: string) => {
    ledCtx.fillStyle = '#080404';
    ledCtx.fillRect(0, 0, 1024, 64);
    ledCtx.fillStyle = '#ff2a12';
    ledCtx.textBaseline = 'middle';
    ledCtx.textAlign = 'left';
    ledCtx.font = `700 36px ${LATIN}, ${DEVA}`;
    ledCtx.fillText(text, 8, 34);
    // Dot-matrix look: dark grid over the text.
    ledCtx.fillStyle = 'rgba(0,0,0,0.45)';
    for (let x = 0; x < 1024; x += 4) ledCtx.fillRect(x, 0, 1, 64);
    for (let y = 0; y < 64; y += 4) ledCtx.fillRect(0, y, 1024, 1);
    ledTex.needsUpdate = true;
  };

  // Caged ceiling fans in pairs over each bay; the blades turn.
  const fanSpots: THREE.Vector3[] = [];
  for (const b of B) {
    const zc = (b.z0 + b.z1) / 2;
    for (const s of [-1, 1]) fanSpots.push(V(s * 0.62, CEIL_CROWN - 0.24, zc));
  }
  for (const p of fanSpots) {
    P.add('paint', new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6).translate(p.x, p.y + 0.14, p.z), [0.4, 0.4, 0.42]);
    P.add('paint', new THREE.CylinderGeometry(0.07, 0.08, 0.07, 12).translate(p.x, p.y + 0.05, p.z), [0.35, 0.36, 0.38]);
    const ring = new THREE.TorusGeometry(0.24, 0.008, 5, 28).rotateX(Math.PI / 2);
    P.add('steel', ring.clone().translate(p.x, p.y - 0.03, p.z), C.steelDark);
    P.add('steel', ring.clone().translate(p.x, p.y + 0.03, p.z), C.steelDark);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      P.add('steel', rodGeo(V(p.x, p.y - 0.035, p.z), V(p.x + Math.cos(a) * 0.24, p.y - 0.03, p.z + Math.sin(a) * 0.24), 0.004, 3), C.steelDark);
      P.add('steel', rodGeo(V(p.x + Math.cos(a) * 0.24, p.y - 0.03, p.z + Math.sin(a) * 0.24), V(p.x + Math.cos(a) * 0.24, p.y + 0.03, p.z + Math.sin(a) * 0.24), 0.004, 3), C.steelDark);
    }
  }
  const bladeGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const b = boxGeo(0.2, 0.006, 0.07);
      b.translate(0.12, 0, 0);
      b.rotateX(0.12);
      b.rotateY((k / 3) * Math.PI * 2);
      parts.push(b.toNonIndexed());
    }
    return mergeGeometries(parts)!;
  })();
  const blades = new THREE.InstancedMesh(bladeGeo, lit('heroBlades', { color: 0x5b5d60, roughness: 0.5, metalness: 0.4 }), fanSpots.length);
  group.add(blades);

  // Hanging triangular handles along the ceiling rails (animated sway).
  const loopGeo = (() => {
    const g: THREE.BufferGeometry[] = [];
    const top = V(0, 0, 0);
    const a = V(0, -0.2, 0);
    g.push(rodGeo(top, a, 0.008, 5));
    const l = V(-0.08, -0.36, 0);
    const r = V(0.08, -0.36, 0);
    for (const [p, q] of [
      [a, l],
      [a, r],
      [l, r],
    ] as [THREE.Vector3, THREE.Vector3][])
      g.push(rodGeo(p, q, 0.011, 6));
    const m = mergeGeometries(g.map((x) => x.toNonIndexed()))!;
    return tint(m, 0.9, 0.91, 0.93);
  })();
  const loopSpots: THREE.Vector3[] = [];
  for (const s of [-1, 1])
    for (let z = z0 + 0.5; z < z1 - 0.4; z += 0.3) {
      if (CAR.doors.some((d) => Math.abs(z - d) < 0.35)) continue;
      loopSpots.push(V(s * AISLE, RAIL_Y, z));
    }
  const loops = new THREE.InstancedMesh(loopGeo, M.steel, loopSpots.length);
  loops.frustumCulled = false;
  group.add(loops);
  const loopPhase = loopSpots.map(() => rng.range(0, Math.PI * 2));

  P.build(M, group, false);

  // Standing spots: along the aisle and in the vestibules.
  const standing: { x: number; z: number }[] = [];
  for (let z = z0 + 0.6; z < z1 - 0.6; z += 0.75) standing.push({ x: rng.range(-0.2, 0.2), z });
  for (const d of CAR.doors) for (const dz of [-0.6, 0, 0.6]) for (const s of [-1, 1]) standing.push({ x: s * rng.range(0.6, 1.2), z: d + dz });

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  let swingLat = 0;
  let swingLon = 0;
  return {
    group,
    cabin,
    seats,
    standing,
    doors: CAR.doors.slice(),
    setDoors(open: number) {
      doorOpen.setX(0, open);
      doorOpen.needsUpdate = true;
    },
    update(dt, time, sway, lamps, ledText) {
      // Tube lights: always on in service; they carry more of the light after dark.
      cabin.uCabinLamp.value.setRGB(0.55, 0.6, 0.63).multiplyScalar(0.55 + 0.9 * lamps);
      cabin.uCabinSky.value = 0.42;
      // Fans.
      fanSpots.forEach((p, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), time * 17 + i);
        m4.compose(new THREE.Vector3(p.x, p.y - 0.005, p.z), q, one);
        blades.setMatrixAt(i, m4);
      });
      blades.instanceMatrix.needsUpdate = true;
      // Handles swing against the car's acceleration, with a little jiggle of their own.
      const k = 1 - Math.exp(-dt * 3);
      swingLat += (THREE.MathUtils.clamp(-sway.lat * 0.09, -0.35, 0.35) - swingLat) * k;
      swingLon += (THREE.MathUtils.clamp(sway.lon * 0.09, -0.35, 0.35) - swingLon) * k;
      loopSpots.forEach((p, i) => {
        const j = Math.sin(time * 2.1 + loopPhase[i]) * 0.04;
        e.set(swingLon + j * 0.5, 0, swingLat + j);
        q.setFromEuler(e);
        m4.compose(p, q, one);
        loops.setMatrixAt(i, m4);
      });
      loops.instanceMatrix.needsUpdate = true;
      if (ledText !== ledLast) {
        ledLast = ledText;
        drawLed(ledText);
      }
      ledTex.offset.x = (time * 0.05) % 1;
    },
  };
}
