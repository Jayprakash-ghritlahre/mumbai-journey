import * as THREE from 'three';
import { ease, easeInOut, handheld, pose, WalkPath, type Shot } from '../../camera/Cinematic';
import type { Crowd } from '../../entities/crowd/Crowd';
import type { Route } from './Route';
import { MD, NP, VN } from './RouteLayout';

const EYE = 1.62;

export interface RouteJourneyDeps {
  route: Route;
  crowd: Crowd;
  /** The film's clock (start hour, time-lapse offset in hours; base: offset already built up). */
  clock?: { start: number; warp: number; base?: number };
}

/**
 * Documentary walk from Churchgate's west exit to the Marine Drive sea wall
 * (see CHURCHGATE_TO_MARINE_DRIVE.md §2 for the stages), at a brisk pace, almost a jog, with cuts
 * that skip stretches of IMC and V.N. Road (about two minutes from the exit to the wall).
 */
export function routeShots(d: RouteJourneyDeps): Shot[] {
  const r = d.route;
  const vn = VN.axis;
  const md = MD.axis;
  const g = (x: number, z: number) => r.walk.sample(x, z);
  const E = (x: number, z: number, eye = EYE) => new THREE.Vector3(x, g(x, z) + eye, z);
  const V = (p: [number, number], eye = EYE) => E(p[0], p[1], eye);
  const sV = (x: number, z: number) => vn.project(x, z).s;
  const oN = 17.9;
  const sN = MD.sNorthCrossing;
  const setPlayer = (p: THREE.Vector3 | null) => d.crowd.setPlayer(p);

  // Paths. Out of the west exit the walk crosses IMC Road with everyone else and goes down its west
  // footpath (IMC.westWalk), then follows the same line round the corner onto V.N. Road's north
  // footpath, in a wide arc rather than across the junction.
  const vnStart = V(vn.point(sV(-72, 101), oN + 0.4));
  // Off the foot of the steps still heading south (as the exit shot ends), then across on the
  // diagonal, ahead of the cars parked from z ≈ 22.
  const imcRoad = new WalkPath([E(-27.2, 8.5, EYE), E(-27.8, 11.2), E(-30.6, 14.2), E(-34.2, 17.5), E(-37.4, 20.6), E(-38.6, 24.5), E(-38.7, 30), E(-37.6, 38)]);
  // Round the corner through the IMC mouth (clear of the end of the first compound wall at o ≈ 20.75),
  // then along the middle of the footpath, between the wall and the kerbside trees.
  const cornerVN = (s: number, o: number) => V(vn.point(s, o));
  const corner = new WalkPath([E(-36.0, 66), E(-36.2, 74), E(-38.6, 84), cornerVN(369.8, 27.6), cornerVN(368.4, 22.4), cornerVN(366.3, 19.5), cornerVN(362.5, 18.6), cornerVN(sV(-66, 103), 18.4), vnStart]);
  const vnWalk = new WalkPath([vnStart, V(vn.point(sV(-84, 97), oN + 0.4)), V(vn.point(sV(-96, 93), oN + 0.9)), V(vn.point(sV(-104, 90), oN + 0.6))]);
  const trackA = sV(-122, 84);
  const trackB = sV(-150, 75);
  const vnSun = new WalkPath([V(vn.point(sV(-196, 60), oN)), V(vn.point(sV(-208, 56), oN - 0.4)), V(vn.point(sV(-220, 52), oN - 0.6)), V(vn.point(sV(-232, 49), oN - 0.2))]);
  const openA = sV(-296, 30);
  const openB = sV(-336, 17);
  const kerbWait = md.point(sN + 0.4, MD.kerb + 1.0);
  const crossPath = new WalkPath([V(md.point(sN + 0.4, MD.kerb + 1.0)), V(md.point(sN + 0.2, MD.kerb - 3)), V(md.point(sN, 0)), V(md.point(sN - 0.3, -MD.kerb + 2)), V(md.point(sN - 0.6, -MD.kerb - 1.2))]);
  const toWall = new WalkPath([V(md.point(sN - 0.6, -MD.kerb - 1.2)), V(md.point(sN - 2.0, -20.5)), V(md.point(sN - 3.2, MD.promenade + 0.7))]);
  const wallSpot = md.point(sN - 3.2, MD.promenade + 0.7);
  const seaDir = (s: number, a: number) => {
    // Unit vector out to sea at arc length s, rotated by angle a (radians, + = to the right/north).
    const t = md.at(s);
    const nx = -t.tz;
    const nz = t.tx;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    return new THREE.Vector3(nx * c + t.tx * -sn, 0, nz * c + t.tz * -sn);
  };

  // Nariman Point paths (promenade, seaward of the trees).
  const pp = (sa: number, o: number) => V(md.point(sa, o));
  const stroll = new WalkPath([pp(sN - 3.2, MD.promenade + 0.7), pp(sN + 8, -21.5), pp(sN + 50, -21), pp(sN + 100, -20.5), pp(sN + 150, -20.5)]);
  // Seaward of the almond trunks (o ≈ −17 … −19.4 here), clear of the trees and the wall's step.
  const almonds = new WalkPath([pp(NP.sJunction + 40, -21.6), pp(NP.sJunction + 80, -22.2), pp(NP.sJunction + 120, -22.5), pp(NP.sJunction + 160, -22.2)]);
  const toTip = new WalkPath([pp(NP.sEnd - 95, -20.5), pp(NP.sEnd - 60, -21), pp(NP.sEnd - 30, -21.5), pp(NP.sEnd - 7, -22.5)]);
  /** Setting off from the foot of the steps, then a steady jog (the fraction of the path at t). */
  const pace = (t: number, a = 0.15) => (t < a ? (t * t) / (2 * a) : t - a / 2) / (1 - a / 2);
  /** Time-lapse into the night, only when the film starts in the evening. */
  const warp = (t: number, a: number, b: number) => {
    const clock = d.clock;
    const base = clock?.base ?? 0;
    if (!clock || clock.start + base < 16 || clock.start + base > 19.5) return;
    clock.warp = base + THREE.MathUtils.lerp(a, b, t);
  };

  const shots: Shot[] = [
    {
      name: 'imc-road',
      duration: 11,
      fov: 55,
      update: (t, c) => {
        // The gaze reaches further ahead as the walk gets going (no jump from the exit shot's).
        imcRoad.apply(c.camera, pace(t) * imcRoad.length, c.T, { lookAhead: 2 + 7 * THREE.MathUtils.smoothstep(t, 0, 0.5) });
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'vn-corner',
      duration: 14,
      fov: 55,
      update: (t, c) => {
        // A long look-ahead: the gaze comes round the corner gradually, as a walker's does.
        corner.apply(c.camera, t * corner.length, c.T, { lookAhead: 11 });
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'vn-walk',
      duration: 9,
      fov: 55,
      title: ['Veer Nariman Road', 'वीर नरिमन मार्ग', 'Churchgate → Marine Drive · 400 m'],
      titleAt: 2,
      titleFor: 7,
      update: (t, c) => {
        // A glance to the right at the bus stop and the shopfronts halfway along.
        const glance = Math.sin(Math.min(1, Math.max(0, (t - 0.35) / 0.4)) * Math.PI);
        vnWalk.apply(c.camera, t * vnWalk.length, c.T, { lookAhead: 7, yawOffset: -0.6 * glance });
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'vn-restaurants',
      duration: 9,
      fov: 42,
      enter: () => setPlayer(null),
      update: (t, c) => {
        // Lateral tracking shot along the restaurant row, from the kerb side.
        const e = ease(t);
        const s = trackA + (trackB - trackA) * e;
        const cam = V(vn.point(s, VN.kerb + 0.9), 1.55);
        const look = V(vn.point(s - 5, VN.footpath + 4), 2.6);
        pose(c.camera, cam, look);
        handheld(c.camera, c.T, 0.35);
      },
    },
    {
      name: 'vn-banyans',
      duration: 11,
      fov: 55,
      update: (t, c) => {
        vnSun.apply(c.camera, t * vnSun.length, c.T, { lookAhead: 8, lookOffset: new THREE.Vector3(0, 0.6 * Math.sin(t * Math.PI), 0) });
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'opening',
      duration: 12,
      fov: 50,
      sub: ['The buildings end — the sky opens over the sea', 'समोर समुद्र'],
      subAt: 5,
      subFor: 6,
      update: (t, c) => {
        const s = openA + (openB - openA) * t;
        const cam = V(vn.point(s, oN - 0.4));
        const look = V(vn.point(s - 40, oN - 3), 2.2);
        pose(c.camera, cam, look);
        handheld(c.camera, c.T, 0.45);
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'junction',
      duration: 11,
      fov: 50,
      title: ['Marine Drive', 'मरीन ड्राइव्ह', "Netaji Subhash Chandra Bose Road · the Queen's Necklace"],
      titleAt: 2.5,
      titleFor: 8,
      enter: () => d.crowd.clearZone(kerbWait[0], kerbWait[1], 1.2),
      update: (t, c) => {
        // At the kerb: look left along Marine Drive to Nariman Point, then right along the curve.
        const cam = V(kerbWait);
        const e = ease(t);
        const a = THREE.MathUtils.lerp(-1.15, 1.05, e);
        const target = cam.clone().add(seaDir(sN, a).multiplyScalar(60));
        target.y = cam.y + 2 + 6 * Math.abs(Math.sin(a)) * 0.3;
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.3);
        setPlayer(cam);
      },
    },
    {
      name: 'signal',
      duration: 10,
      fov: 48,
      // Only after a seek (or a long stall) is the clock off; then it is realigned here.
      enter: () => {
        if (Math.abs(r.signals.secondsToPedGreen() - 8.5) > 1.5) r.signals.pedGreenIn(8.5);
      },
      update: (t, c) => {
        // Waiting with everyone else for the green man; traffic streams past.
        const cam = V(kerbWait);
        const target = cam.clone().add(seaDir(sN, 0.12).multiplyScalar(40));
        target.y = cam.y - 0.4 + t * 0.4;
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.35);
        setPlayer(cam);
      },
    },
    {
      name: 'crossing',
      duration: 13,
      fov: 55,
      enter: () => {
        // Keep the far kerb and the path to the wall clear of people standing still.
        for (let u = 0.6; u <= 1; u += 0.1) {
          const p = crossPath.curve.getPointAt(u);
          d.crowd.clearZone(p.x, p.z, 1.3);
        }
        for (let u = 0; u <= 1; u += 0.25) {
          const p = toWall.curve.getPointAt(u);
          d.crowd.clearZone(p.x, p.z, 1.5);
        }
      },
      update: (t, c) => {
        crossPath.apply(c.camera, ease(t) * crossPath.length, c.T, { lookAhead: 8 });
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'promenade',
      duration: 7,
      fov: 55,
      enter: () => d.crowd.clearZone(wallSpot[0], wallSpot[1], 2.2),
      update: (t, c) => {
        toWall.apply(c.camera, ease(t) * toWall.length, c.T, { lookAhead: 5, lookOffset: new THREE.Vector3(0, -0.9 * t, 0) });
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'sea',
      duration: 18,
      fov: 50,
      title: ['Arabian Sea', 'अरबी समुद्र', 'Back Bay · sunset'],
      titleAt: 3,
      titleFor: 8,
      update: (t, c) => {
        const cam = V(wallSpot, EYE + 0.05);
        const e = easeInOut(t);
        const a = THREE.MathUtils.lerp(-0.35, 0.55, e);
        const target = cam.clone().add(seaDir(sN - 3, a).multiplyScalar(80));
        target.y = cam.y - 2.5 + e * 1.5;
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.25);
        setPlayer(cam);
      },
    },
    // ---- On to Nariman Point (milestone 3) ------------------------------------------------------
    {
      name: 'np-stroll',
      duration: 20,
      fov: 55,
      sub: ['The promenade runs on to Nariman Point', 'पुढे नरिमन पॉइंट'],
      subAt: 4,
      subFor: 7,
      enter: () => setPlayer(null),
      update: (t, c) => {
        // Along the wall, glancing out to sea half-way.
        const glance = Math.sin(Math.min(1, Math.max(0, (t - 0.3) / 0.45)) * Math.PI);
        stroll.apply(c.camera, easeInOut(t) * stroll.length, c.T, { lookAhead: 9, yawOffset: -0.7 * glance });
        warp(t, 0, 0.12);
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'np-airindia',
      duration: 16,
      fov: 50,
      title: ['Nariman Point', 'नरिमन पॉइंट', 'Air-India Building · Trident · NCPA'],
      titleAt: 3,
      titleFor: 8,
      update: (t, c) => {
        // At the Air India junction, tilting up the slab.
        const e = easeInOut(t);
        const [x, z] = md.point(NP.sJunction - 26 + 6 * e, -20.5);
        const cam = E(x, z);
        const target = new THREE.Vector3(-652, THREE.MathUtils.lerp(22, 88, e), 525);
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.3);
        warp(t, 0.12, 0.26);
        setPlayer(cam);
      },
    },
    {
      name: 'np-almonds',
      duration: 16,
      fov: 55,
      update: (t, c) => {
        // Under the almond trees, the towers on the left, the sea on the right.
        almonds.apply(c.camera, t * almonds.length, c.T, { lookAhead: 10, yawOffset: 0.35 - 0.5 * t });
        warp(t, 0.26, 0.4);
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'np-tip',
      duration: 18,
      fov: 52,
      sub: ['The sun goes down over the Arabian Sea', 'सूर्यास्त'],
      subAt: 8,
      subFor: 6,
      update: (t, c) => {
        // The last stretch to the tip, turning to the setting sun.
        const turn = THREE.MathUtils.smoothstep(t, 0.55, 1);
        toTip.apply(c.camera, easeInOut(t) * toTip.length, c.T, { lookAhead: 8, yawOffset: -1.25 * turn, lookOffset: new THREE.Vector3(0, 0.5 * turn, 0) });
        warp(t, 0.4, 0.56);
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'np-necklace',
      duration: 28,
      fov: 48,
      fadeOut: 4,
      title: ["Queen's Necklace", 'राणीचा हार', 'Marine Drive from Nariman Point'],
      titleAt: 12,
      titleFor: 9,
      update: (t, c) => {
        // Looking back north along the curve while the lights come on; a slow rise off the wall.
        const e = easeInOut(t);
        const v = r.np.tipView;
        const cam = new THREE.Vector3(v.x, g(v.x, v.z) + EYE + 4.5 * e, v.z);
        const [fx, fz] = md.point(NP.sEnd - 1600, -60);
        const target = new THREE.Vector3(fx, 14 + 6 * e, fz);
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.12);
        warp(t, 0.56, 1.45);
        setPlayer(cam);
      },
    },
  ];
  // The green man comes 8.5 s into the 'signal' shot. The junction's clock is set once, as the walk
  // leaves the station and the junction is out of sight, so the lights never jump while on screen.
  const iSignal = shots.findIndex((sh) => sh.name === 'signal');
  const lead = shots.slice(0, iSignal).reduce((t, sh) => t + sh.duration, 0);
  const first = shots[0];
  const enter0 = first.enter;
  first.enter = () => {
    enter0?.();
    if (d.clock) d.clock.warp = d.clock.base ?? 0;
    r.signals.pedGreenIn(lead + 8.5);
  };
  return shots;
}
