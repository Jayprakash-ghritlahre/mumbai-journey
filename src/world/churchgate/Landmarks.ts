import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, boxGeo } from '../../gfx/GeoBuilder';
import { BuildingBatch } from '../city/BuildingGen';
import { FACADE } from '../../gfx/FacadeTextures';
import { LATIN, type SignAtlas, signQuad } from '../../gfx/Signage';
import type { StationMaterials } from './StationMaterials';
import type { CollisionWorld } from '../../core/Collision';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import type { GeoBuilding } from '../city/City';

/** OSM way ids of buildings that are modelled by hand here (the city generator skips them). */
export const LANDMARK_IDS = { eros: 1065856910, wrhq: 107602112 };

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);

function centroid(fp: number[]): THREE.Vector2 {
  let x = 0;
  let z = 0;
  const n = fp.length / 2;
  for (let i = 0; i < n; i++) {
    x += fp[i * 2];
    z += fp[i * 2 + 1];
  }
  return V2(x / n, z / n);
}

/** Vertical neon-style "EROS" sign painted into the sign atlas. */
function erosSign(atlas: SignAtlas) {
  return atlas.add(128, 512, (c, w, h) => {
    c.fillStyle = '#efe6cf';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#b9a67c';
    c.lineWidth = 6;
    c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#b01e23';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 ${h * 0.2}px ${LATIN}`;
    'EROS'.split('').forEach((ch, i) => c.fillText(ch, w / 2, h * (0.14 + i * 0.24)));
  });
}

/**
 * Eros Cinema (1938): Art Deco block across the junction from the station, with a
 * stepped tower over the curved corner and a vertical EROS sign.
 */
export function buildEros(b: GeoBuilding, mats: StationMaterials, atlas: SignAtlas, facade: THREE.Material, col: CollisionWorld, av: AmbientVolume): THREE.Group {
  const group = new THREE.Group();
  group.name = 'eros';
  const batch = new BuildingBatch();
  const ground = 5.2;
  const floorH = 3.5;
  const height = ground + 4 * floorH;
  batch.add({ fp: b.fp, height, floorH, groundH: ground, style: FACADE.decoCinema, groundStyle: FACADE.sandstone, tint: [1, 0.98, 0.95], seed: 38, chajjas: false, parapet: 1.3, detail: 1 });

  // The curved corner faces the junction (north-east). Build the tower on it.
  const fp = b.fp;
  const n = fp.length / 2;
  const c = centroid(fp);
  // Corner point: the footprint vertex closest to the junction.
  const junction = V2(30, 150);
  let best = 0;
  for (let i = 1; i < n; i++) if (V2(fp[i * 2], fp[i * 2 + 1]).distanceTo(junction) < V2(fp[best * 2], fp[best * 2 + 1]).distanceTo(junction)) best = i;
  const corner = V2(fp[best * 2], fp[best * 2 + 1]);
  const out = corner.clone().sub(c).normalize();
  const towerC = corner.clone().addScaledVector(out, -6.5);
  const ang = Math.atan2(out.x, out.y);
  const gb = new GeoBuilder();
  const tierW = [15, 11, 7];
  const tierH = [height + 4.5, height + 9, height + 12.5];
  let y0 = 0;
  tierW.forEach((w, i) => {
    const h = tierH[i] - y0;
    const g = boxGeo(w, h, 9 - i * 1.5);
    g.rotateY(ang);
    g.translate(towerC.x, y0 + h / 2, towerC.y);
    gb.add('erosCream', g);
    // Horizontal cornice at each setback.
    const k = boxGeo(w + 0.6, 0.35, 9.6 - i * 1.5);
    k.rotateY(ang);
    k.translate(towerC.x, tierH[i], towerC.y);
    gb.add('erosTrim', k);
    y0 = i === 0 ? height : tierH[i - 1];
  });
  // Vertical fins across the tower face (the classic deco "speed lines").
  for (let k = -3; k <= 3; k++) {
    const g = boxGeo(0.35, tierH[0] - ground - 1, 0.7);
    g.translate(k * 1.9, ground + (tierH[0] - ground - 1) / 2, 4.6);
    g.rotateY(ang);
    g.translate(towerC.x, 0, towerC.y);
    gb.add('erosTrim', g);
  }
  // Red sandstone plinth wrapping the corner and a deep entrance canopy.
  const plinth = boxGeo(17, ground, 10);
  plinth.rotateY(ang);
  plinth.translate(towerC.x, ground / 2, towerC.y);
  gb.add('erosRed', plinth);
  const canopy = boxGeo(15, 0.5, 3.4);
  canopy.translate(0, ground - 0.4, 6.2);
  canopy.rotateY(ang);
  canopy.translate(towerC.x, 0, towerC.y);
  gb.add('erosTrim', canopy);
  // Vertical EROS sign standing proud of the tower face.
  const sign = erosSign(atlas);
  const sq = signQuad(sign, 2.6, 10.4);
  sq.translate(0, height + 6.8, 6.3);
  sq.rotateY(ang);
  sq.translate(towerC.x, 0, towerC.y);
  gb.add('signs', sq);
  const back = boxGeo(2.9, 10.8, 1.2);
  back.translate(0, height + 6.8, 5.65);
  back.rotateY(ang);
  back.translate(towerC.x, 0, towerC.y);
  gb.add('erosTrim', back);

  mats.add('erosCream', new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.85 }), 0.3);
  mats.add('erosTrim', new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 }), 0.3);
  mats.add('erosRed', new THREE.MeshStandardMaterial({ color: 0x8e4636, roughness: 0.9 }), 0.35);
  group.add(batch.buildWalls(facade));
  group.add(batch.details.build(mats.m));
  group.add(gb.build(mats.m));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    col.addWall(fp[i * 2], fp[i * 2 + 1], fp[j * 2], fp[j * 2 + 1], 0.4, -2, height);
  }
  // Warm light spilling from the foyer at night.
  av.light(corner.x - out.x * 2, corner.y - out.y * 2, 12, 0.35);
  return group;
}

/** Onion dome with a ribbed profile, finial and drum (for the WR headquarters). */
function domeGeometry(r: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // Bulbous onion: widest at ~35% height, pointed tip.
    const y = t * r * 1.7;
    const w = r * (t < 0.35 ? 1 + Math.sin((t / 0.35) * Math.PI * 0.5) * 0.12 : 1.12 * Math.cos(((t - 0.35) / 0.65) * Math.PI * 0.5) ** 1.3);
    pts.push(V2(Math.max(0.02, w), y));
  }
  const g = new THREE.LatheGeometry(pts, 24);
  const drum = new THREE.CylinderGeometry(r * 1.02, r * 1.02, r * 0.9, 16).translate(0, -r * 0.45, 0);
  const finial = new THREE.CylinderGeometry(0.06, 0.25, r * 0.7, 8).translate(0, r * 1.7 + r * 0.3, 0);
  return mergeGeometries([g.toNonIndexed(), drum.toNonIndexed(), finial.toNonIndexed()].map((x) => {
    x.deleteAttribute('uv');
    return x;
  }))!;
}

/** Central dome and corner cupolas for the Western Railway headquarters (1899). */
export function buildWrhqDome(b: GeoBuilding, height: number, mats: StationMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wrhq-dome';
  mats.add('domeStone', new THREE.MeshStandardMaterial({ color: 0x7c776e, roughness: 0.75 }), 0.3);
  mats.add('domeTrim', new THREE.MeshStandardMaterial({ color: 0xcfc3a8, roughness: 0.8 }), 0.3);
  const fp = b.fp;
  const n = fp.length / 2;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, fp[i * 2]);
    maxX = Math.max(maxX, fp[i * 2]);
    minZ = Math.min(minZ, fp[i * 2 + 1]);
    maxZ = Math.max(maxZ, fp[i * 2 + 1]);
  }
  const gb = new GeoBuilder();
  const c = centroid(fp);
  // Main dome over the middle of the west (M.K. Road) front, on an octagonal drum.
  const cx = minX + 7;
  const cz = c.y;
  gb.add('domeTrim', new THREE.CylinderGeometry(5.2, 5.6, 7, 8).translate(cx, height + 3.5, cz));
  gb.add('domeTrim', new THREE.CylinderGeometry(6.0, 6.0, 0.5, 8).translate(cx, height + 7.2, cz));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    gb.add('domeStone', boxGeo(1.4, 3.2, 0.2).rotateY(-a).translate(cx + Math.cos(a) * 5.35, height + 3.8, cz + Math.sin(a) * 5.35));
  }
  gb.add('domeStone', domeGeometry(4.6).translate(cx, height + 7.4 + 4.6 * 0.9, cz));
  // Chhatris (small domes on columns) on the four outermost corners of the real footprint.
  const quad = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].map(([sx, sz]) => {
    let bi = 0;
    let bd = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = (fp[i * 2] - c.x) * sx + (fp[i * 2 + 1] - c.y) * sz;
      if (d > bd) {
        bd = d;
        bi = i;
      }
    }
    const p = V2(fp[bi * 2], fp[bi * 2 + 1]);
    return p.addScaledVector(c.clone().sub(p).normalize(), 2.2);
  });
  void minZ;
  void maxZ;
  void maxX;
  for (const { x, y: z } of quad) {
    for (const [dx, dz] of [
      [-0.9, -0.9],
      [0.9, -0.9],
      [-0.9, 0.9],
      [0.9, 0.9],
    ])
      gb.add('domeTrim', boxGeo(0.3, 2.4, 0.3).translate(x + dx, height + 1.2, z + dz));
    gb.add('domeTrim', boxGeo(2.4, 0.3, 2.4).translate(x, height + 2.5, z));
    gb.add('domeStone', domeGeometry(1.1).translate(x, height + 2.7 + 1.0, z));
  }
  group.add(gb.build(mats.m));
  return group;
}
