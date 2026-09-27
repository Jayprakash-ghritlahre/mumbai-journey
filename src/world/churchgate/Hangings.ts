import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, boxGeo, rodGeo } from '../../gfx/GeoBuilder';
import { RNG } from '../../core/Random';
import type { StationMaterials } from './StationMaterials';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import { ADS, SignAtlas, drawAd, drawClockFace, drawDirectionSign, drawPlatformNumber, drawStationBoard, signQuad, type AtlasRect } from '../../gfx/Signage';
import { LedAtlas } from '../../gfx/LedBoard';
import { PLATFORMS, SHED, TRACKS, CONCOURSE } from './Layout';
import { trussBottomAt } from './Shed';

export interface Hangings {
  group: THREE.Group;
  /** Rotating fan blades (instanced); call update(dt). */
  update(dt: number, hours: number): void;
  /** Indicator slot for each platform number (big boards), and repeaters. */
  boards: { slot: number; pf: number }[];
  repeaters: { slot: number; pf: number }[];
  /** Positions of PA speakers (for spatial announcement audio). */
  speakers: THREE.Vector3[];
  clocks: THREE.Vector3[];
}

const trussLine = (i: number) => SHED.south - i * SHED.bay;

export function buildHangings(mats: StationMaterials, atlas: SignAtlas, led: LedAtlas, av: AmbientVolume, rng: RNG): Hangings {
  const group = new THREE.Group();
  group.name = 'hangings';
  const gb = new GeoBuilder();
  const M = mats.m;

  // ---- Atlas content -------------------------------------------------------
  // Tallest items first so the shelf packer wastes little space.
  const board = atlas.add(640, 320, (c, w, h) => drawStationBoard(c, w, h, 'चर्चगेट', 'चर्चगेट', 'CHURCHGATE', 3));
  const boardB = atlas.add(640, 320, (c, w, h) => drawStationBoard(c, w, h, 'चर्चगेट', 'चर्चगेट', 'CHURCHGATE', 9));
  const clockFace = atlas.add(256, 256, (c, w, h) => drawClockFace(c, w, h));
  const adRects = ADS.map((ad, i) => atlas.add(512, 240, (c, w, h) => drawAd(c, w, h, ad, i + 1)));
  const wayOutL = atlas.add(640, 200, (c, w, h) => drawDirectionSign(c, w, h, { mr: 'बाहेर जाण्याचा मार्ग', hi: 'बाहर जाने का रास्ता', en: 'WAY OUT' }, 'left', '#1d4f9c', 11));
  const wayOutR = atlas.add(640, 200, (c, w, h) => drawDirectionSign(c, w, h, { mr: 'बाहेर जाण्याचा मार्ग', hi: 'बाहर जाने का रास्ता', en: 'WAY OUT' }, 'right', '#1d4f9c', 12));
  const subwaySign = atlas.add(640, 200, (c, w, h) => drawDirectionSign(c, w, h, { mr: 'भुयारी मार्ग · तिकीट घर', hi: 'सबवे · टिकट घर', en: 'SUBWAY · BOOKING OFFICE' }, 'up', '#1d4f9c', 13));
  const pfNum: Record<number, AtlasRect> = {};
  for (const t of TRACKS) pfNum[t.pf] = atlas.add(192, 192, (c, w, h) => drawPlatformNumber(c, w, h, t.pf));
  const ladies = atlas.add(384, 160, (c, w, h) => drawDirectionSign(c, w, h, { mr: 'महिला', en: 'LADIES' }, 'none', '#8e2a6a', 14));
  const first = atlas.add(384, 160, (c, w, h) => drawDirectionSign(c, w, h, { mr: 'प्रथम श्रेणी', en: 'FIRST CLASS' }, 'none', '#8a6d12', 15));

  /** Adds a (double-sided) flat sign centred at (x,y,z), facing ±Z (rotY=0) or ±X (rotY=π/2), with hanger rods. */
  const hang = (front: AtlasRect, back: AtlasRect | null, w: number, h: number, x: number, y: number, z: number, rotY: number, frame = true, rods = true) => {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    const f = signQuad(front, w, h);
    f.translate(0, 0, 0.031);
    gb.add('signs', f.applyMatrix4(m));
    if (back) {
      const b = signQuad(back, w, h);
      b.rotateY(Math.PI);
      b.translate(0, 0, -0.031);
      gb.add('signs', b.applyMatrix4(m));
    }
    if (frame) gb.add('darkMetal', boxGeo(w + 0.08, h + 0.08, 0.06).applyMatrix4(m));
    if (rods) {
      const top = trussBottomAt(x) - 0.1;
      const ax = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      for (const s of [-1, 1]) {
        const p = new THREE.Vector3(x, y + h / 2, z).addScaledVector(ax, s * w * 0.4);
        gb.add('rod', rodGeo(p, new THREE.Vector3(p.x, top, p.z), 0.01, 4));
      }
      if (Math.abs(rotY) > 0.1) gb.add('darkMetal', boxGeo(0.08, 0.08, w + 0.4).translate(x, top, z));
    }
  };

  // Platform number boxes above each track end, facing the concourse (and the other way).
  for (const t of TRACKS) hang(pfNum[t.pf], pfNum[t.pf], 1.0, 1.0, t.x, 6.9, trussLine(2) + 0.0, 0);

  // Indicator boards: over each platform face near the heads.
  const boards: { slot: number; pf: number }[] = [];
  const bigBoard = (slot: number, pf: number, x: number, z: number) => {
    const uv = LedAtlas.uv(slot);
    const rect: AtlasRect = { uv, w: 768, h: 416 };
    const W = 2.3;
    const H = 1.25;
    const q1 = signQuad(rect, W, H).translate(0, 0, 0.09);
    const q2 = signQuad(rect, W, H).rotateY(Math.PI).translate(0, 0, -0.09);
    const m = new THREE.Matrix4().makeTranslation(x, 5.6, z);
    ledGeos.push(q1.applyMatrix4(m), q2.applyMatrix4(m));
    gb.add('blackPaint', boxGeo(W + 0.16, H + 0.22, 0.16).applyMatrix4(m));
    const top = trussBottomAt(x) - 0.1;
    for (const s of [-0.8, 0.8]) gb.add('rod', rodGeo(new THREE.Vector3(x + s, 5.6 + H / 2, z), new THREE.Vector3(x + s, top, z), 0.016, 5));
    boards.push({ slot, pf });
  };
  const ledGeos: THREE.BufferGeometry[] = [];
  const zB = trussLine(3);
  bigBoard(0, 1, -22.0, zB);
  bigBoard(1, 1, -13.9, zB);
  bigBoard(2, 2, -10.1, zB);
  bigBoard(3, 2, -1.9, zB);
  bigBoard(4, 3, 1.9, zB);
  bigBoard(5, 3, 10.1, zB);
  bigBoard(6, 4, 13.9, zB);
  bigBoard(7, 4, 22.0, zB);
  const repeaters: { slot: number; pf: number }[] = [];
  const rep = (slot: number, pf: number, x: number, z: number) => {
    const rect: AtlasRect = { uv: LedAtlas.uv(slot), w: 768, h: 116 };
    const W = 2.2;
    const H = 0.33;
    const m = new THREE.Matrix4().makeTranslation(x, 4.9, z);
    ledGeos.push(signQuad(rect, W, H).translate(0, 0, 0.06).applyMatrix4(m), signQuad(rect, W, H).rotateY(Math.PI).translate(0, 0, -0.06).applyMatrix4(m));
    gb.add('blackPaint', boxGeo(W + 0.1, H + 0.1, 0.1).applyMatrix4(m));
    const top = trussBottomAt(x) - 0.1;
    for (const s of [-0.9, 0.9]) gb.add('rod', rodGeo(new THREE.Vector3(x + s, 4.9, z), new THREE.Vector3(x + s, top, z), 0.01, 4));
    repeaters.push({ slot, pf });
  };
  rep(8, 1, -13.9, trussLine(14));
  rep(9, 2, -10.1, trussLine(14));
  rep(10, 3, 10.1, trussLine(14));
  rep(11, 4, 13.9, trussLine(14));
  rep(12, 2, -1.9, trussLine(26));
  rep(13, 3, 1.9, trussLine(26));
  const ledMesh = new THREE.Mesh(mergeGeometries(ledGeos)!, led.material);
  ledMesh.castShadow = false;
  ledMesh.name = 'led-boards';
  group.add(ledMesh);

  // Station name boards facing the tracks, along every island and side platform.
  for (const p of PLATFORMS) {
    const cx = (p.x0 + p.x1) / 2;
    const both = p.west && p.east;
    for (let i = 4; i < SHED.bays; i += 7) {
      const z = trussLine(i);
      if (both) hang(board, boardB, 2.3, 1.15, cx, 4.2, z, Math.PI / 2);
      else hang(board, null, 2.3, 1.15, p.west ? p.x1 - 0.5 : p.x0 + 0.5, 4.2, z, p.west ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  // Coach position boards (ladies / first class) along the islands.
  for (const p of PLATFORMS) {
    if (!(p.west && p.east)) continue;
    const cx = (p.x0 + p.x1) / 2;
    for (const [i, r] of [
      [9, ladies],
      [16, first],
      [21, ladies],
      [30, first],
    ] as [number, AtlasRect][])
      hang(r, r, 1.1, 0.46, cx, 3.35, trussLine(i), Math.PI / 2);
  }
  // Hanging advertisement banners across the islands.
  let adIdx = 0;
  for (const p of PLATFORMS) {
    if (!(p.west && p.east)) continue;
    const cx = (p.x0 + p.x1) / 2;
    for (let i = 6; i < SHED.bays - 2; i += 6) {
      const a = adRects[adIdx++ % adRects.length];
      const b = adRects[(adIdx * 3 + 1) % adRects.length];
      hang(a, b, 2.6, 1.22, cx, 5.9, trussLine(i), 0);
    }
  }
  // Way-out and subway signs over the concourse.
  hang(wayOutL, wayOutR, 2.6, 0.81, -14, 4.1, CONCOURSE.passageZ, 0);
  hang(wayOutR, wayOutL, 2.6, 0.81, 14, 4.1, CONCOURSE.passageZ, 0);
  hang(subwaySign, subwaySign, 2.6, 0.81, 3, 4.1, 9.2, 0);

  // Clocks: double-faced round clocks over the platform heads.
  const clockPositions = [new THREE.Vector3(-12, 5.0, trussLine(3)), new THREE.Vector3(12, 5.0, trussLine(3)), new THREE.Vector3(0, 5.2, trussLine(9)), new THREE.Vector3(0, 5.0, 3)];
  // Clocks at the platform heads share the board positions; nudge them outwards.
  clockPositions[0].z = trussLine(4);
  clockPositions[1].z = trussLine(4);
  const clocks: THREE.Vector3[] = [];
  for (const c of clockPositions) {
    for (const s of [1, -1]) {
      const f = signDisc(clockFace, 0.31);
      if (s < 0) f.rotateY(Math.PI);
      f.translate(c.x, c.y, c.z + s * 0.07);
      gb.add('signs', f);
    }
    const rim = new THREE.CylinderGeometry(0.34, 0.34, 0.13, 24);
    rim.rotateX(Math.PI / 2);
    rim.translate(c.x, c.y, c.z);
    gb.add('blackPaint', rim);
    gb.add('rod', rodGeo(new THREE.Vector3(c.x, c.y + 0.34, c.z), new THREE.Vector3(c.x, trussBottomAt(c.x) - 0.1, c.z), 0.012, 4));
    clocks.push(c);
  }

  // ---- Lighting fixtures, fans, speakers, cameras, cables ---------------------
  const lampShade: THREE.Matrix4[] = [];
  const tubes: THREE.Matrix4[] = [];
  const fans: THREE.Vector3[] = [];
  const speakers: THREE.Vector3[] = [];
  for (const p of PLATFORMS) {
    const cx = (p.x0 + p.x1) / 2;
    const both = p.west && p.east;
    for (let i = 0; i <= SHED.bays; i++) {
      const z = trussLine(i);
      if (z < p.north + 20) continue;
      if (i % 2 === 0) {
        const xs = both ? [cx + (i % 4 === 0 ? -2.4 : 2.4)] : [cx];
        for (const x of xs) {
          const y = 6.3;
          lampShade.push(new THREE.Matrix4().makeTranslation(x, y, z));
          gb.add('rod', rodGeo(new THREE.Vector3(x, y + 0.1, z), new THREE.Vector3(x, trussBottomAt(x) - 0.05, z), 0.008, 3));
          av.light(x, z, 10, 0.1);
        }
      } else if (i > 1) {
        // Fluorescent batten on the truss line between lamps.
        const x = both ? cx + (i % 4 === 1 ? 2.2 : -2.2) : cx;
        tubes.push(new THREE.Matrix4().makeTranslation(x, 5.2, z));
        av.light(x, z, 8, 0.08);
      }
      if (both && i % 2 === 1) {
        for (const x of [cx - 2.0, cx + 2.0]) fans.push(new THREE.Vector3(x, 4.7, z));
      }
      if (both && i % 3 === 0) speakers.push(new THREE.Vector3(cx, 7.2, z));
    }
  }
  // Concourse lighting.
  for (let x = -20; x <= 20; x += 5)
    for (const z of [2.5, 8]) {
      tubes.push(new THREE.Matrix4().makeTranslation(x, 5.4, z));
      av.light(x, z, 7, 0.1);
    }

  // Pendant lamp: enamel dome + bulb.
  const shadeGeo = new THREE.CylinderGeometry(0.1, 0.3, 0.22, 16, 1, true);
  const shades = new THREE.InstancedMesh(shadeGeo, M.whiteEnamel, lampShade.length);
  const bulbGeo = new THREE.SphereGeometry(0.075, 10, 8);
  bulbGeo.translate(0, -0.08, 0);
  const bulbs = new THREE.InstancedMesh(bulbGeo, M.lampWarm, lampShade.length);
  lampShade.forEach((m, i) => {
    shades.setMatrixAt(i, m);
    bulbs.setMatrixAt(i, m);
  });
  shades.castShadow = false;
  group.add(shades, bulbs);

  // Fluorescent fittings: batten + two tubes, hung on short chains.
  const battenGeo = boxGeo(1.3, 0.06, 0.16);
  const tubeGeo = mergeGeometries([new THREE.CylinderGeometry(0.018, 0.018, 1.22, 6).rotateZ(Math.PI / 2).translate(0, -0.05, -0.04), new THREE.CylinderGeometry(0.018, 0.018, 1.22, 6).rotateZ(Math.PI / 2).translate(0, -0.05, 0.04)])!;
  const battens = new THREE.InstancedMesh(battenGeo, M.whiteEnamel, tubes.length);
  const tubeMesh = new THREE.InstancedMesh(tubeGeo, M.lampTube, tubes.length);
  tubes.forEach((m, i) => {
    battens.setMatrixAt(i, m);
    tubeMesh.setMatrixAt(i, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    for (const s of [-0.5, 0.5]) gb.add('rod', rodGeo(new THREE.Vector3(p.x + s, p.y, p.z), new THREE.Vector3(p.x + s, trussBottomAt(p.x + s) - 0.05, p.z), 0.006, 3));
  });
  battens.castShadow = false;
  group.add(battens, tubeMesh);

  // Ceiling fans on long downrods: housing is static, blades rotate.
  const fanHousing = mergeGeometries([new THREE.CylinderGeometry(0.13, 0.11, 0.16, 12), new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8).translate(0, -0.12, 0)])!;
  const housings = new THREE.InstancedMesh(fanHousing, M.whiteEnamel, fans.length);
  const bladeParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const b = boxGeo(0.62, 0.012, 0.11);
    b.translate(0.42, -0.02, 0);
    b.rotateX(0.12);
    b.rotateY((k / 3) * Math.PI * 2);
    bladeParts.push(b);
  }
  const bladeGeo = mergeGeometries(bladeParts)!;
  const blades = new THREE.InstancedMesh(bladeGeo, M.whiteEnamel, fans.length);
  const fanPhase = fans.map(() => rng.range(0, Math.PI * 2));
  const fanSpeed = fans.map(() => rng.range(7, 11) * (rng.chance(0.12) ? 0 : 1));
  fans.forEach((p, i) => {
    housings.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
    gb.add('rod', rodGeo(new THREE.Vector3(p.x, p.y + 0.08, p.z), new THREE.Vector3(p.x, trussBottomAt(p.x) - 0.05, p.z), 0.018, 5));
  });
  housings.castShadow = false;
  blades.castShadow = false;
  group.add(housings, blades);

  // PA speakers (black horn boxes) and CCTV cameras.
  for (const s of speakers) {
    gb.add('blackPaint', boxGeo(0.34, 0.5, 0.26).translate(s.x, s.y, s.z + 0.2));
    gb.add('blackPaint', boxGeo(0.34, 0.5, 0.26).translate(s.x, s.y, s.z - 0.2));
    gb.add('rod', rodGeo(new THREE.Vector3(s.x, s.y + 0.25, s.z), new THREE.Vector3(s.x, trussBottomAt(s.x) - 0.05, s.z), 0.012, 4));
  }
  for (let i = 1; i < SHED.bays; i += 5)
    for (const x of [-12, 0, 12]) {
      const z = trussLine(i);
      const y = trussBottomAt(x) - 0.6;
      gb.add('plasticWhite', boxGeo(0.14, 0.12, 0.3).translate(x + 0.2, y, z + 0.1));
      gb.add('rod', rodGeo(new THREE.Vector3(x + 0.2, y + 0.06, z), new THREE.Vector3(x + 0.2, trussBottomAt(x) - 0.05, z), 0.012, 4));
    }
  // Sagging power cables between trusses along each island.
  for (const p of PLATFORMS) {
    const cx = (p.x0 + p.x1) / 2;
    for (const off of [-1.3, 1.1]) {
      const x = cx + off;
      const y0 = trussBottomAt(x) - 0.3;
      for (let i = 0; i < SHED.bays; i++) {
        const za = trussLine(i);
        const zb = trussLine(i + 1);
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 3; k++) {
          const t = k / 3;
          pts.push(new THREE.Vector3(x, y0 - Math.sin(t * Math.PI) * 0.35, za + (zb - za) * t));
        }
        for (let k = 0; k < 3; k++) gb.add('cable', rodGeo(pts[k], pts[k + 1], 0.012, 3));
      }
    }
  }

  const built = gb.build(M, { castShadow: false });
  group.add(built);

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const upAxis = new THREE.Vector3(0, 1, 0);
  const update = (dt: number) => {
    for (let i = 0; i < fans.length; i++) {
      fanPhase[i] += fanSpeed[i] * dt;
      tmpQ.setFromAxisAngle(upAxis, fanPhase[i]);
      tmpM.compose(fans[i], tmpQ, one);
      blades.setMatrixAt(i, tmpM);
    }
    blades.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { group, update, boards, repeaters, speakers, clocks };
}

export function signMaterials(mats: StationMaterials, atlas: SignAtlas): void {
  // Signs are slightly self-lit (lightboxes / reflective paint read brighter than their surroundings).
  const m = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55, metalness: 0.05, emissiveMap: atlas.texture, emissive: new THREE.Color(0.22, 0.22, 0.22) });
  mats.add('signs', m);
}

/** Circular sign (clock face) mapped to an atlas rect. */
export function signDisc(rect: AtlasRect, radius: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 32);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = rect.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}
