import * as THREE from 'three';
import { GeoBuilder, boxGeo, floorGeo, planarUV, rodGeo, wallGeo } from '../../gfx/GeoBuilder';
import type { StationMaterials } from './StationMaterials';
import type { CollisionWorld } from '../../core/Collision';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import { BuildingBatch } from '../city/BuildingGen';
import { FACADE } from '../../gfx/FacadeTextures';
import { DEVA, LATIN, SignAtlas, drawDirectionSign, drawStationBoard, fitFont, signQuad, ADS, drawAd, type AtlasRect } from '../../gfx/Signage';
import type { Ctx } from '../../gfx/TextureFactory';
import { BUILDING, CONCOURSE, SHED, Y } from './Layout';
import { RNG } from '../../core/Random';

const B = BUILDING;

function drawBlueBoard(c: Ctx, w: number, h: number): void {
  c.fillStyle = '#2046a8';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#f2f2f2';
  c.lineWidth = h * 0.03;
  c.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08);
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `700 ${h * 0.22}px ${DEVA}`;
  c.fillText('चर्चगेट', w / 2, h * 0.24);
  c.fillText('चर्चगेट', w / 2, h * 0.5);
  c.font = `700 ${h * 0.2}px ${LATIN}`;
  c.fillText('CHURCHGATE', w / 2, h * 0.77);
}

function drawIrLogo(c: Ctx, w: number, h: number): void {
  // Indian Railways-style emblem (simplified: red disc with white ring and a stylised wheel).
  c.clearRect(0, 0, w, h);
  const r = w / 2;
  c.fillStyle = '#b3261e';
  c.beginPath();
  c.arc(r, r, r * 0.96, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#f5f0e6';
  c.lineWidth = r * 0.07;
  c.beginPath();
  c.arc(r, r, r * 0.8, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(r, r, r * 0.34, 0, Math.PI * 2);
  c.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.beginPath();
    c.moveTo(r + Math.cos(a) * r * 0.36, r + Math.sin(a) * r * 0.36);
    c.lineTo(r + Math.cos(a) * r * 0.62, r + Math.sin(a) * r * 0.62);
    c.stroke();
  }
  c.fillStyle = '#f5f0e6';
  c.font = `700 ${r * 0.15}px ${LATIN}`;
  c.textAlign = 'center';
  c.fillText('INDIAN RAILWAYS', r, r * 1.66);
  c.font = `700 ${r * 0.15}px ${DEVA}`;
  c.fillText('भारतीय रेल', r, r * 0.42);
}

function drawRedLetters(c: Ctx, w: number, h: number, text: string): void {
  c.fillStyle = '#efe9dc';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#c0231c';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `700 ${h * 0.7}px ${LATIN}`;
  c.fillText(text, w / 2, h * 0.55);
}

function drawShopSign(c: Ctx, w: number, h: number, bg: string, en: string, deva: string, fg = '#fff'): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, bg);
  g.addColorStop(1, '#000');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.globalAlpha = 0.25;
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.globalAlpha = 1;
  c.fillStyle = fg;
  c.textBaseline = 'middle';
  // Devanagari on the right, the English name fitted into what is left (they never overlap).
  c.textAlign = 'right';
  const dPx = fitFont(c, deva, '700', DEVA, h * 0.4, w * 0.36);
  c.font = `700 ${dPx}px ${DEVA}`;
  const dW = c.measureText(deva).width;
  c.fillText(deva, w - h * 0.3, h * 0.52);
  c.textAlign = 'left';
  const ePx = fitFont(c, en, '700', LATIN, h * 0.46, w - dW - h * 1.0);
  c.font = `700 ${ePx}px ${LATIN}`;
  c.fillText(en, h * 0.3, h * 0.5);
}

export interface StationBuildingResult {
  group: THREE.Group;
}

export function buildStationBuilding(mats: StationMaterials, atlas: SignAtlas, col: CollisionWorld, av: AmbientVolume, facadeMat: THREE.Material): StationBuildingResult {
  const group = new THREE.Group();
  group.name = 'station-building';
  const gb = new GeoBuilder();
  const rng = new RNG(1899);
  const M = mats.m;
  const G = Y.platform; // ground floor level inside (same as concourse)
  const top = G + B.groundH + (B.levels - 1) * B.floorH;

  // ---- Upper floors: white office block with strip windows (facade generator) ----
  const fp = [B.west, B.north, B.east, B.north, B.east, B.south, B.westStepX, B.south, B.westStepX, B.westStepZ, B.west, B.westStepZ];
  // Ring must be CCW viewed from above (negative shoelace in x/z): reverse the listed (clockwise) order.
  const ring: number[] = [];
  for (let i = fp.length / 2 - 1; i >= 0; i--) ring.push(fp[i * 2], fp[i * 2 + 1]);
  const batch = new BuildingBatch();
  batch.add({ fp: ring, height: top - G, floorH: B.floorH, groundH: B.groundH, style: FACADE.station, groundStyle: FACADE.station, tint: [1, 1, 1], seed: 11, chajjas: false, parapet: 1.1, detail: 1, noGround: true, baseY: G });
  group.add(batch.buildWalls(facadeMat));
  group.add(batch.details.build(M));
  // A red band above the ground floor, as on the station's frontages.
  const bandY = G + B.groundH - 0.3;
  gb.box('redPaint', B.east - B.west + 0.3, 0.45, 0.3, (B.east + B.west) / 2, bandY, B.north - 0.1);
  gb.box('redPaint', 0.3, 0.45, B.westStepZ - B.north, B.west - 0.1, bandY, (B.north + B.westStepZ) / 2);
  gb.box('redPaint', 0.3, 0.45, B.south - B.north, B.east + 0.1, bandY, (B.north + B.south) / 2);

  // ---- Ground floor shell (concourse level G) ----
  const H0 = B.groundH;
  const px0 = B.passageX0;
  const px1 = B.passageX1;
  // North face towards the concourse: booking office (west), passage (centre), shops (east).
  const nz = B.north;
  gb.box('wall', px0 - B.west, H0 - 4.6, 0.4, (B.west + px0) / 2, G + (H0 + 4.6) / 2, nz);
  gb.box('wall', B.east - px1, H0 - 4.6, 0.4, (B.east + px1) / 2, G + (H0 + 4.6) / 2, nz);
  gb.box('wall', px1 - px0, H0 - 4.6, 0.4, (px0 + px1) / 2, G + (H0 + 4.6) / 2, nz);
  // Booking office: a counter wall with ticket windows.
  gb.box('dado', px0 - B.west - 1, 1.1, 0.42, (B.west + px0) / 2, G + 0.55, nz);
  gb.box('wallGrey', px0 - B.west - 1, 3.5, 0.3, (B.west + px0) / 2, G + 1.1 + 1.75, nz + 0.05);
  const booking = atlas.add(640, 200, (c, w, h) => drawDirectionSign(c, w, h, { mr: 'तिकीट घर', hi: 'टिकट घर', en: 'BOOKING OFFICE' }, 'none', '#1d4f9c', 31));
  for (let x = B.west + 2; x < px0 - 1.5; x += 2.6) {
    gb.box('glassDark', 1.3, 0.9, 0.05, x, G + 1.55, nz - 0.2);
    for (let k = 0; k < 6; k++) gb.box('stainless', 0.02, 0.9, 0.03, x - 0.55 + k * 0.22, G + 1.55, nz - 0.23);
    gb.box('stainless', 1.4, 0.05, 0.35, x, G + 1.08, nz - 0.3);
    gb.box('lampTube', 1.1, 0.03, 0.05, x, G + 2.1, nz - 0.22);
  }
  const bq = signQuad(booking, 4.2, 1.3);
  bq.rotateY(Math.PI);
  bq.translate((B.west + px0) / 2, G + 3.4, nz - 0.22);
  gb.add('signs', bq);
  // Shops on the east side of the north face.
  const shopSigns: AtlasRect[] = [
    atlas.add(512, 110, (c, w, h) => drawShopSign(c, w, h, '#c62828', 'MUMBAI JUICE CENTRE', 'ज्यूस सेंटर')),
    atlas.add(512, 110, (c, w, h) => drawShopSign(c, w, h, '#1b5e20', 'SHREE BOOK STALL', 'पुस्तक भांडार')),
    atlas.add(512, 110, (c, w, h) => drawShopSign(c, w, h, '#f9a825', 'VADA PAV · CHAI', 'वडा पाव · चहा', '#1a1a1a')),
    atlas.add(512, 110, (c, w, h) => drawShopSign(c, w, h, '#0d47a1', 'CITY CHEMIST', 'औषधालय')),
    atlas.add(512, 110, (c, w, h) => drawShopSign(c, w, h, '#6a1b9a', 'MOBILE RECHARGE', 'मोबाईल रिचार्ज')),
    atlas.add(512, 110, (c, w, h) => drawShopSign(c, w, h, '#e65100', 'SAI SNACKS CORNER', 'साई स्नॅक्स')),
  ];
  const shopFront = (x: number, z: number, rot: number, w: number, sign: AtlasRect) => {
    const m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, G, z);
    const q = signQuad(sign, w, w * (110 / 512));
    q.translate(0, 3.1, 0.23);
    gb.add('signs', q.applyMatrix4(m));
    gb.add('darkMetal', boxGeo(w, 0.12, 0.8).translate(0, 2.7, 0.4).applyMatrix4(m));
    // Counter with goods and a lit interior.
    gb.add('wood', boxGeo(w - 0.4, 1.0, 0.5).translate(0, 0.5, 0.05).applyMatrix4(m));
    for (let k = 0; k < 6; k++) {
      const gx = -w / 2 + 0.5 + k * ((w - 1) / 5);
      gb.add(rng.pick(['redPaint', 'greenBin', 'plasticWhite', 'steelYellow']), boxGeo(0.18, 0.28, 0.14).translate(gx, 1.15, 0.05).applyMatrix4(m));
    }
    gb.add('lampTube', boxGeo(w - 0.6, 0.03, 0.04).translate(0, 2.55, -0.5).applyMatrix4(m));
    gb.add('wallGrey', boxGeo(w, 2.6, 0.1).translate(0, 1.3, -1.6).applyMatrix4(m));
  };
  shopFront((px1 + B.east) / 2, nz - 0.2, Math.PI, B.east - px1 - 0.6, shopSigns[0]);
  // Station name board and advertising lightboxes on the concourse face.
  const board = atlas.add(640, 320, (c, w, h) => drawStationBoard(c, w, h, 'चर्चगेट', 'चर्चगेट', 'CHURCHGATE', 21));
  const sb = signQuad(board, 3.2, 1.6);
  sb.rotateY(Math.PI);
  sb.translate((px0 + px1) / 2, G + 6.6, nz - 0.25);
  gb.add('signs', sb);
  const adTall = atlas.add(256, 400, (c, w, h) => drawAd(c, w, h, ADS[2], 41));
  const adTall2 = atlas.add(256, 400, (c, w, h) => drawAd(c, w, h, ADS[8], 42));
  for (const [x, r] of [
    [px0 - 1.2, adTall],
    [px1 + 1.2, adTall2],
  ] as [number, AtlasRect][]) {
    const q = signQuad(r, 1.2, 1.9);
    q.rotateY(Math.PI);
    q.translate(x, G + 2.2, nz - 0.3);
    gb.add('signs', q);
    gb.add('stainless', boxGeo(1.3, 2.0, 0.12).translate(x, G + 2.2, nz - 0.22));
  }

  // ---- The passage through the building to Veer Nariman Road ----
  const passageAds = [3, 5, 9].map((k) => atlas.add(512, 240, (c, w, h) => drawAd(c, w, h, ADS[k], 60 + k)));
  const pz0 = nz;
  const pz1 = B.south;
  const plen = pz1 - pz0;
  const pcx = (px0 + px1) / 2;
  gb.add('stone', planarUV(floorGeo(px1 - px0, plen).translate(pcx, G + 0.01, (pz0 + pz1) / 2), 'xz'));
  gb.add('wallGrey', floorGeo(px1 - px0, plen).rotateX(Math.PI).translate(pcx, G + 4.4, (pz0 + pz1) / 2));
  col.addFloor(px0, pz0 - 0.5, px1, pz1 - 2.5, G + 0.01);
  for (const s of [-1, 1]) {
    const x = s < 0 ? px0 : px1;
    // Shop fronts every 6 m along both sides, walls between.
    for (let z = pz0 + 3; z < pz1 - 6; z += 6) {
      const idx = Math.floor((z - pz0) / 6) + (s > 0 ? 3 : 0);
      if (idx % 3 === 1) {
        shopFront(x - s * 0.05, z + 3, s < 0 ? Math.PI / 2 : -Math.PI / 2, 5.2, shopSigns[idx % shopSigns.length]);
      } else {
        const wg = wallGeo(6, 4.4);
        wg.rotateY(s < 0 ? Math.PI / 2 : -Math.PI / 2);
        wg.translate(x, G + 2.2, z + 3);
        gb.add('wall', wg);
        const dg = wallGeo(6, 1.2);
        dg.rotateY(s < 0 ? Math.PI / 2 : -Math.PI / 2);
        dg.translate(x - s * 0.01, G + 0.6, z + 3);
        gb.add('dado', dg);
        if (idx % 3 === 2) {
          const ad = signQuad(passageAds[idx % passageAds.length], 2.4, 1.13);
          ad.rotateY(s < 0 ? Math.PI / 2 : -Math.PI / 2);
          ad.translate(x - s * 0.03, G + 2.2, z + 3);
          gb.add('signs', ad);
        }
      }
      col.addWall(x, z, x, z + 6, 0.3, G - 1, G + 4);
    }
    for (let z = pz0 + 2; z < pz1; z += 4) {
      gb.box('lampTube', 1.2, 0.04, 0.08, pcx + s * 2, G + 4.3, z);
      av.light(pcx, z, 6, 0.15);
    }
  }
  av.paint(px0 - 0.5, pz0, px1 + 0.5, pz1, (_x, _z, sky, ceil) => [Math.min(sky, 0.12), Math.max(ceil, G + 4.4)]);
  // Building interior is solid everywhere except the passage.
  col.addBox(B.west, B.north + 0.2, px0, B.westStepZ, -2, 40);
  col.addBox(B.westStepX, B.westStepZ, px0, B.south, -2, 40);
  col.addBox(px1, B.north + 0.2, B.east, B.south, -2, 40);

  // ---- South entrance on Veer Nariman Road: blue canopy, signs, steps ----
  const sz = B.south;
  gb.box('bluePaint', px1 - px0 + 4, 1.1, 2.6, pcx, G + 4.9, sz + 1.3);
  gb.box('blackPaint', px1 - px0 + 4, 0.08, 2.6, pcx, G + 4.32, sz + 1.3);
  for (let k = 0; k < 5; k++) gb.box('lampWarm', 0.2, 0.03, 0.2, px0 + 0.6 + k * 2, G + 4.3, sz + 1.3);
  const blue = atlas.add(512, 256, (c, w, h) => drawBlueBoard(c, w, h));
  const bb = signQuad(blue, 3.4, 1.7);
  bb.translate(pcx, G + 6.4, sz + 0.25);
  gb.add('signs', bb);
  const entry = atlas.add(256, 160, (c, w, h) => {
    c.fillStyle = '#c62828';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${h * 0.3}px ${DEVA}`;
    c.fillText('आत प्रवेश', w / 2, h * 0.36);
    c.font = `700 ${h * 0.26}px ${LATIN}`;
    c.fillText('ENTRANCE', w / 2, h * 0.72);
  });
  const eq = signQuad(entry, 1.0, 0.62);
  eq.translate(px0 - 0.9, G + 3.3, sz + 0.25);
  gb.add('signs', eq);
  // Steps down to the pavement.
  for (let k = 0; k < 5; k++) {
    const y = G - (k + 1) * ((G - Y.sidewalk) / 5);
    const g = boxGeo(px1 - px0, y + 0.02, 0.34);
    g.translate(pcx, (y + 0.02) / 2, sz + 0.17 + k * 0.34);
    gb.add('stone', planarUV(g, 'xz'));
  }
  col.addFloor(px0, sz - 2.5, px1, sz + 1.8, G, Y.sidewalk, 'z');
  // Walls either side of the entrance.
  gb.box('facade', px0 - B.westStepX, G + B.groundH, 0.4, (B.westStepX + px0) / 2, (G + B.groundH) / 2, sz);
  gb.box('facade', B.east - px1, G + B.groundH, 0.4, (B.east + px1) / 2, (G + B.groundH) / 2, sz);

  // ---- West frontage (IMC Road side) and the concourse west exit canopy ----
  const wx = B.west;
  for (let z = B.north + 1; z < B.westStepZ - 1; z += 5.2) {
    const g = wallGeo(5.2, B.groundH + G);
    g.rotateY(-Math.PI / 2);
    g.translate(wx - 0.02, (B.groundH + G) / 2, z + 2.6);
    gb.add('facade', g);
    gb.box('shutter', 0.06, 2.6, 3.6, wx - 0.05, 1.3, z + 2.6);
  }
  const sx = B.westStepX;
  for (let z = B.westStepZ; z < B.south - 1; z += 5.2) {
    const g = wallGeo(5.2, B.groundH + G);
    g.rotateY(-Math.PI / 2);
    g.translate(sx - 0.02, (B.groundH + G) / 2, z + 2.6);
    gb.add('facade', g);
  }
  // East frontage.
  for (let z = B.north; z < B.south - 1; z += 5.2) {
    const g = wallGeo(5.2, B.groundH + G);
    g.rotateY(Math.PI / 2);
    g.translate(B.east + 0.02, (B.groundH + G) / 2, z + 2.6);
    gb.add('facade', g);
  }
  // West exit (on the shed wall): blue canopy, "CHURCHGATE" in red letters and the railway emblem.
  const ex = -24.9;
  gb.box('bluePaint', 3.2, 1.2, 9.4, ex - 1.5, 4.9, CONCOURSE.passageZ);
  gb.box('blackPaint', 3.2, 0.06, 9.4, ex - 1.5, 4.28, CONCOURSE.passageZ);
  for (let k = 0; k < 4; k++) gb.box('lampWarm', 0.2, 0.03, 0.2, ex - 1.5, 4.26, CONCOURSE.passageZ - 3 + k * 2);
  const redName = atlas.add(512, 96, (c, w, h) => drawRedLetters(c, w, h, 'CHURCHGATE'));
  const rn = signQuad(redName, 5.2, 0.97);
  rn.rotateY(-Math.PI / 2);
  rn.translate(ex - 0.23, 6.3, CONCOURSE.passageZ);
  gb.add('signs', rn);
  const logo = atlas.add(256, 256, (c, w, h) => drawIrLogo(c, w, h));
  const lq = signQuad(logo, 1.5, 1.5);
  lq.rotateY(-Math.PI / 2);
  lq.translate(ex - 0.24, 7.9 - 0.2, CONCOURSE.passageZ);
  gb.add('signs', lq);
  // East exit canopy.
  gb.box('bluePaint', 3.2, 1.2, 9.4, -ex + 1.5, 4.9, CONCOURSE.passageZ);
  gb.box('blackPaint', 3.2, 0.06, 9.4, -ex + 1.5, 4.28, CONCOURSE.passageZ);
  const rn2 = signQuad(redName, 5.2, 0.97);
  rn2.rotateY(Math.PI / 2);
  rn2.translate(-ex + 0.23, 6.3, CONCOURSE.passageZ);
  gb.add('signs', rn2);
  // Bollards in front of the exits.
  for (const s of [-1, 1])
    for (let k = -2; k <= 2; k++) gb.add('stainless', rodGeo(new THREE.Vector3(s * 28.4, Y.sidewalk, CONCOURSE.passageZ + k * 1.8), new THREE.Vector3(s * 28.4, Y.sidewalk + 0.85, CONCOURSE.passageZ + k * 1.8), 0.06, 8));

  // East passage (open-air) along the building towards the junction.
  gb.add('stone', planarUV(floorGeo(24.4 - B.east, SHED.south + 30 - B.north).translate((24.4 + B.east) / 2, G + 0.005, (B.north + SHED.south + 30) / 2), 'xz'));
  col.addFloor(B.east, B.north, 24.4, SHED.south + 30, G + 0.005);

  const built = gb.build(M, { noShadowKeys: ['signs', 'lampTube', 'lampWarm'] });
  group.add(built);
  return { group };
}
