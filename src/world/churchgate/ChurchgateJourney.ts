import * as THREE from 'three';
import { ease, easeInOut, handheld, pose, WalkPath, type Shot } from '../../camera/Cinematic';
import { TrainSystem } from '../../entities/train/TrainSystem';
import type { Crowd } from '../../entities/crowd/Crowd';
import { fmtTime, type Timetable } from '../../entities/train/Timetable';
import { CAR } from '../../entities/train/Livery';
import { Y } from './Layout';
import type { Route } from '../route/Route';
import { routeShots } from '../route/RouteJourney';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const EYE = Y.platform + 1.62;
/** The scripted train pulls up at the buffers this many seconds into the film. */
export const ARRIVE_T = 48;

export interface JourneyDeps {
  trains: TrainSystem;
  crowd: Crowd;
  timetable: Timetable;
  startHour: number;
  route: Route;
  /** The film's clock; the Nariman Point shots add a time-lapse into the night. */
  clock: { start: number; warp: number; base?: number };
  /** The film arrives by the ridden local: skip the arrival shots, it is already on PF 3. */
  byTrain?: boolean;
}

/**
 * "Arrival at Churchgate" — documentary sequence from the incoming local to the street.
 */
export function churchgateShots(d: JourneyDeps): Shot[] {
  const pf = 3;
  const tx = 6;
  const view = () => d.trains.views[pf - 1];
  const departAt = d.startHour + (ARRIVE_T + 480) / 3600;
  if (!d.byTrain) d.trains.script(pf, d.startHour + ARRIVE_T / 3600, departAt);
  const doorZ = TrainSystem.carZ(-2, 1) + CAR.doors[2];
  const dest = d.timetable.current(pf, d.startHour + 0.2)?.dest ?? 'BHAYANDAR';
  const setPlayer = (p: THREE.Vector3 | null) => d.crowd.setPlayer(p);
  // Keep the static camera positions clear of waiting commuters.
  d.crowd.clearZone(8.6, -232, 3.5);
  d.crowd.clearZone(3.0, -14, 3.0);
  d.crowd.clearZone(tx - 1.5, doorZ, 2.0);

  const walkOff = new WalkPath([V(tx - 0.6, CAR.floorY + 1.62, doorZ), V(tx - 1.9, CAR.floorY + 1.55, doorZ), V(3.2, EYE, doorZ + 0.3), V(2.4, EYE, doorZ + 2.5), V(1.9, EYE, doorZ + 5)]);
  const walkPf = new WalkPath([V(1.9, EYE, doorZ + 5), V(1.3, EYE, -14), V(0.6, EYE, -5), V(-0.2, EYE, 1.2), V(-2.5, EYE + 0.01, 4.4)]);
  const walkOut = new WalkPath([V(-7, EYE + 0.01, 5.3), V(-15, EYE + 0.01, 5.6), V(-22.5, EYE + 0.01, 5.5), V(-24.6, EYE, 5.5), V(-26.3, Y.sidewalk + 1.62 + 0.35, 5.8), V(-27.1, 1.62 + 0.05, 7.4), V(-27.2, 1.62, 8.5)]);

  const shots: Shot[] = [
    {
      name: 'approach',
      duration: 14,
      fov: 40,
      fadeIn: 2,
      title: ['Churchgate', 'चर्चगेट', `Western Railway · ${fmtTime(d.startHour)}`],
      titleAt: 1.5,
      titleFor: 6,
      update: (t, c) => {
        const v = view();
        const front = V(tx, 2.4, v.headZ + 2);
        const cam = V(8.55, 1.85, -232 + t * 1.5);
        // Watch it come up the platform, then turn to follow the cab past us.
        const look = front.z < cam.z - 12 ? V(tx, 2.3, Math.min(front.z, cam.z - 25)) : V(tx - 0.5, 2.3, cam.z + 30);
        const pastBlend = THREE.MathUtils.smoothstep(front.z, cam.z - 30, cam.z + 10);
        const target = V(tx, 2.3, cam.z - 60).lerp(look, 0.6 + 0.4 * pastBlend);
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.6);
      },
    },
    {
      name: 'platform',
      duration: 18,
      fov: 48,
      sub: [`Platform 3 · the ${dest.charAt(0) + dest.slice(1).toLowerCase()} local is coming in`, 'फलाट क्रमांक तीन वर गाडी येत आहे'],
      subAt: 3,
      subFor: 5,
      update: (t, c) => {
        const v = view();
        // Leaning out at the platform edge to look up the line for the train, like everyone does.
        setPlayer(V(3.7, 0, -14));
        const cam = V(3.85, 2.45, -15 + ease(t) * 2.5);
        const target = V(tx - 0.3, 2.2, Math.min(v.headZ - 14, -60));
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.8);
      },
    },
    {
      name: 'buffers',
      duration: 17,
      fov: 36,
      update: (t, c) => {
        const cam = V(7.4 - t * 0.8, 2.25, 6.2 - t * 1.4);
        const v = view();
        const target = V(tx, 2.35, Math.min(-2, v.headZ) - 3);
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.5);
      },
    },
    {
      name: 'alight',
      duration: 14,
      fov: 56,
      enter: () => setPlayer(V(tx - 1.9, 0, doorZ)),
      update: (t, c) => {
        // Hold inside the doorway, then step down onto the platform and turn south.
        const s = t < 0.2 ? 0 : easeInOut((t - 0.2) / 0.8);
        walkOff.apply(c.camera, s * walkOff.length, c.T, { lookAhead: 5, bob: s > 0 && s < 1 ? 1 : 0.2 });
        const yaw = THREE.MathUtils.lerp(0, 0.35, 1 - s);
        c.camera.rotateY(yaw);
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'walk',
      duration: 22,
      fov: 56,
      update: (t, c) => {
        const dist = t * walkPf.length;
        const glanceUp = Math.max(0, Math.sin(Math.min(1, Math.max(0, (t - 0.35) / 0.3)) * Math.PI));
        walkPf.apply(c.camera, dist, c.T, { lookAhead: 7, lookOffset: V(0, glanceUp * 3.2, 0) });
        setPlayer(c.camera.position);
      },
    },
    {
      name: 'concourse',
      duration: 12,
      fov: 44,
      title: ['Evening rush', 'संध्याकाळची गर्दी', 'Everyone is heading home'],
      titleAt: 1.2,
      titleFor: 5,
      enter: () => setPlayer(null),
      update: (t, c) => {
        const e = easeInOut(t);
        const cam = V(15 - e * 11, 6.4 - e * 0.9, 8.4 - e * 0.6);
        const target = V(-4 - e * 16, 2.4, -14 + e * 16);
        pose(c.camera, cam, target);
        handheld(c.camera, c.T, 0.3);
      },
    },
    {
      name: 'exit',
      duration: 19,
      fov: 56,
      update: (t, c) => {
        walkOut.apply(c.camera, easeInOut(t) * walkOut.length, c.T, { lookAhead: 6 });
        setPlayer(c.camera.position);
      },
    },
    ...routeShots({ route: d.route, crowd: d.crowd, clock: d.clock }),
  ];
  if (d.byTrain) return shots.filter((s) => !['approach', 'platform', 'buffers'].includes(s.name));
  return shots;
}
