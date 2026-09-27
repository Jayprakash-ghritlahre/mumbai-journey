import * as THREE from 'three';
import { ease, easeInOut, handheld, WalkPath, type Shot } from '../../camera/Cinematic';
import { CAR } from '../../entities/train/Livery';
import { ARRIVAL_SECONDS } from '../../entities/train/TrainSystem';
import { fmtTime } from '../../entities/train/Timetable';
import { HERO_CAR, motion, type Ride } from './Ride';
import type { Railway } from './Railway';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const F = CAR.floorY;
const carBack = (i: number) => CAR.length / 2 + 0.62 + i * CAR.pitch;

export interface RideFilmDeps {
  ride: Ride;
  railway: Railway;
  /** The film's clock (hours): the ride keeps it on the ride's own clock. */
  clock: { start: number; warp: number; base?: number };
  /** Film seconds at which the ride begins (0 when it opens the film). */
  startT?: number;
}

/**
 * "Mira Road → Churchgate by local" — the film's opening: the station, the train coming in,
 * boarding, the ride in stretches joined by dissolves with the stops at Borivali and Dadar, and
 * the arrival under Churchgate's shed. Each shot shows a window of the ride's schedule (leg, leg time); the film's clock follows
 * the ride's clock, so dissolves skip real time.
 */
export function rideShots(d: RideFilmDeps): Shot[] {
  const { ride, railway: r } = d;
  const legs = ride.legs;
  const legIndex = (k: string) => legs.findIndex((l) => l.key === k);
  const A = legIndex('A');
  const E = legIndex('E');
  const dm = r.dMiraRoad;
  const heroD = dm - carBack(HERO_CAR);
  /** World point on the line (d, offset, height). */
  const W = (dd: number, o: number, y: number) => {
    const [x, z] = r.path.point(dd, o);
    return V(x, y, z);
  };
  /** Leg time at which the ridden car's centre reaches path distance dd. */
  const whenAt = (leg: number, dd: number) => {
    let lo = 0;
    let hi = legs[leg].duration;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (motion(legs[leg], m).d - carBack(HERO_CAR) < dd) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const u = (x: number) => r.dOfU(x);
  /** Keeps the film's clock on the ride's clock for the shot. */
  const at = (leg: number, t: number, T: number) => {
    ride.set(leg, t);
    d.clock.warp = (ride.clock(leg, t) - (T - (d.startT ?? 0))) / 3600;
  };
  /** A camera inside the car (ride frame), with handheld sway. */
  const inCar = (eye: THREE.Vector3, target: THREE.Vector3, amount = 0.5, roll = 0) => {
    ride.camRequest = (cam, rd) => {
      rd.placeCamera(cam, eye, target, roll);
      handheld(cam, rd.seconds, amount);
    };
  };
  const world = (eye: () => THREE.Vector3, target: () => THREE.Vector3, amount = 0.4) => {
    ride.camRequest = (cam, rd) => {
      cam.position.copy(eye());
      cam.lookAt(target());
      handheld(cam, rd.seconds, amount);
    };
  };
  const dep = 70; // departure from Mira Road (leg A time)
  const tBridgeA = whenAt(A, u(39050));
  const tMalad = whenAt(legIndex('B'), u(29270) + 60);
  const tMahim = whenAt(legIndex('C'), u(14020) - 10);
  const tParel = whenAt(legIndex('D'), u(7330) + 80);
  const tCharni = whenAt(E, u(1980) + 60);
  const tHand = legs[E].handoverAt ?? 0;
  const tStop = tHand + ARRIVAL_SECONDS;
  const B = legIndex('B');
  const C = legIndex('C');
  const D = legIndex('D');
  const BO = legIndex('BO');
  const DA = legIndex('DA');
  const stopOf = (leg: number) => legs[leg].stop!;
  /**
   * A stop at a halt in three shots: leaning out of the doorway as the station comes up, in the
   * vestibule as the train stops and the doors open on the rush, and away past the platform end.
   */
  const haltShots = (leg: number, title: [string, string, string], sub: [string, string], late = false): Shot[] => {
    const st = stopOf(leg);
    const dep = st.at + st.dwell;
    return [
      {
        name: `${legs[leg].key}-in`,
        duration: 15,
        fov: 55,
        fadeIn: 1.2,
        title,
        titleAt: 1,
        titleFor: 4.5,
        update: (t, c) => {
          // In the open doorway on the platform side, looking ahead as the station comes up (at
          // Dadar, under Tilak Bridge and onto the packed platform).
          at(leg, (late ? 10 : 8) + t * 14.5, c.T);
          inCar(V(CAR.halfW + 0.05, F + 1.56, 0.3), V(CAR.halfW + 1.3 + t * 0.6, F + 0.9 + t * (late ? 0.4 : 1.6), 30 - t * (late ? 10 : 0)), 0.35);
        },
      },
      {
        name: `${legs[leg].key}-stop`,
        duration: 25,
        fov: 60,
        sub,
        subAt: 2,
        subFor: 5,
        update: (t, c) => {
          // From just before the stop: the doors open, people off, people on, the doors close.
          at(leg, st.at - 7 + t * 25, c.T);
          // Standing in the corner of the vestibule, across from the platform-side door.
          const e = easeInOut(Math.min(1, t * 1.4));
          inCar(V(-1.0, F + 1.64, -1.0 + e * 0.15), V(CAR.halfW + 3, F + 1.0, 0.6 + e * 0.5), 0.3);
        },
      },
      {
        name: `${legs[leg].key}-out`,
        duration: 11,
        fov: 55,
        update: (t, c) => {
          // Someone pushes the door open as it rolls; the platform end slides past.
          at(leg, dep + 2 + t * 11, c.T);
          const e = ease(t);
          inCar(V(CAR.halfW - 0.25 + e * 0.3, F + 1.58, 0.3), V(CAR.halfW + 1.4, F + 1.25 - e * 0.2, 25 - e * 8), 0.4);
        },
        fadeOut: 1.2,
      },
    ];
  };

  // The walk from PF 4 into the car's middle doorway (the train stands still here).
  const doorD = heroD - CAR.doors[1];
  const board = new WalkPath([W(doorD + 7, 4.2, 0.92 + 1.62), W(doorD + 3, 3.1, 0.92 + 1.62), W(doorD + 0.4, 2.2, 0.92 + 1.62), W(doorD, 1.2, F + 1.6), W(doorD - 0.4, 0.3, F + 1.64)]);

  const shots: Shot[] = [
    {
      name: 'mira-front',
      duration: 9,
      fov: 50,
      fadeIn: 2.5,
      title: ['Mira Road', 'मीरा रोड', `Western Railway · ${fmtTime(ride.hourAt(A, 0))}`],
      titleAt: 1.5,
      titleFor: 6,
      enter: () => ride.start(),
      update: (t, c) => {
        at(A, t * 9, c.T);
        const e = ease(t);
        world(
          // From the approach road's median (clear of the traffic either side).
          () => V(9097 - e * 3, 1.95 + e * 0.5, -37674.5 - e * 0.5),
          () => V(9050, 6.8 - e * 1.2, -37694 + e * 2),
          0.3,
        );
      },
    },
    {
      name: 'mira-platform',
      duration: 27,
      fov: 44,
      sub: ['Platform 4 · the Churchgate fast is coming in', 'फलाट क्रमांक ४ वर चर्चगेट जलद लोकल येत आहे'],
      subAt: 3,
      subFor: 6,
      update: (t, c) => {
        // Leaning out at the platform edge to look up the line for the train, like everyone does.
        const tt = 11 + t * 27;
        at(A, tt, c.T);
        const lead = ride.state.d;
        const e = ease(Math.min(1, t * 1.4));
        world(
          () => W(dm + 9 - e * 4, 2.25, 0.92 + 1.58),
          () => {
            // Watch it come in, then turn to the doors as it stops.
            const k = THREE.MathUtils.smoothstep(lead, dm - 120, dm - 8);
            return W(Math.min(lead - 40, dm - 60) * (1 - k) + (heroD + 4) * k, 0.4 + k * 1.2, 2.1);
          },
          0.6,
        );
      },
    },
    {
      name: 'mira-board',
      duration: 14,
      fov: 56,
      update: (t, c) => {
        at(A, 38 + 3 + t * 14, c.T);
        const s = t < 0.25 ? 0 : easeInOut((t - 0.25) / 0.75);
        ride.camRequest = (cam, rd) => {
          board.apply(cam, s * board.length, c.T, { lookAhead: 2.5, bob: s > 0 && s < 1 ? 1 : 0.3 });
          // Turn along the car once inside.
          cam.rotateY(-THREE.MathUtils.smoothstep(s, 0.75, 1) * 1.1);
          handheld(cam, rd.seconds, 0.3);
        };
      },
    },
    {
      name: 'in-car',
      duration: 17,
      fov: 58,
      update: (t, c) => {
        // The doors slide shut; looking down the car past the fans and handles.
        at(A, 55 + t * 17, c.T);
        const e = easeInOut(t);
        inCar(V(0.9 - e * 0.6, F + 1.63, -0.9), V(0.2 - e * 0.3, F + 1.45, -9), 0.5);
      },
    },
    {
      name: 'departure',
      duration: 20,
      fov: 55,
      sub: ['Churchgate fast · next stop Dahisar', 'चर्चगेट जलद · पुढील स्टेशन दहिसर'],
      subAt: 2,
      subFor: 5,
      update: (t, c) => {
        at(A, dep - 2 + t * 20, c.T);
        // By the doorway as the platform slides away, then someone slides the door open.
        const e = ease(t);
        inCar(V(CAR.halfW - 0.55, F + 1.6, 1.1), V(CAR.halfW + 2.5, F + 1.2 - e * 0.2, 10 + e * 6), 0.45);
      },
      fadeOut: 1.2,
    },
    {
      name: 'salt-pans',
      duration: 15,
      fov: 52,
      fadeIn: 1.2,
      title: ['Salt pans', 'मिठागरे', 'Mira Road → Dahisar'],
      titleAt: 1,
      titleFor: 4.5,
      update: (t, c) => {
        at(A, tBridgeA - 8 + t * 15, c.T);
        // Standing in the open doorway, holding the pole, looking ahead along the train.
        inCar(V(CAR.halfW + 0.1, F + 1.56, 0.3), V(CAR.halfW + 1.6 + t * 0.6, F + 1.05, 30), 0.35);
      },
      fadeOut: 1.2,
    },
    ...haltShots(BO, ['Borivali', 'बोरीवली', 'Platform 5 · the Churchgate fast stops'], ['Borivali · platform 5 · half a minute to get off and on', 'बोरीवली · फलाट क्रमांक ५']),
    {
      name: 'malad-window',
      duration: 14,
      fov: 50,
      fadeIn: 1.2,
      title: ['Malad', 'मालाड', 'The suburbs'],
      titleAt: 1,
      titleFor: 4.5,
      update: (t, c) => {
        at(B, 8 + t * 14, c.T);
        // A window seat: the slow local on the next line, trackside homes, the passing down train.
        inCar(V(-1.45, F + 1.12, 3.4), V(-7, F + 0.95, 8 + t * 2), 0.3);
      },
    },
    {
      name: 'malad-door',
      duration: 13,
      fov: 55,
      update: (t, c) => {
        at(B, tMalad - 9 + t * 13, c.T);
        inCar(V(-CAR.halfW - 0.1, F + 1.56, -0.3), V(-CAR.halfW - 1.4, F + 1.05, 30), 0.35);
      },
      fadeOut: 1.2,
    },
    {
      name: 'mahim',
      duration: 15,
      fov: 52,
      fadeIn: 1.2,
      title: ['Mahim Creek', 'माहीम खाडी', 'Bandra → Mahim'],
      titleAt: 1,
      titleFor: 4.5,
      update: (t, c) => {
        at(C, tMahim - 8 + t * 15, c.T);
        inCar(V(CAR.halfW + 0.1, F + 1.56, 0.3), V(CAR.halfW + 3 + t, F + 0.7, 26), 0.35);
      },
      fadeOut: 1.2,
    },
    ...haltShots(DA, ['Dadar', 'दादर', 'Platform 4 · change here for the Central line'], ['Dadar · everyone for the Central line gets off here', 'दादर · मध्य रेल्वेसाठी येथे उतरा'], true),
    {
      name: 'lower-parel',
      duration: 14,
      fov: 55,
      fadeIn: 1.2,
      title: ['Lower Parel', 'लोअर परळ', 'Mill chimneys and glass towers'],
      titleAt: 1,
      titleFor: 4.5,
      update: (t, c) => {
        at(D, tParel - 10 + t * 14, c.T);
        inCar(V(0.35, F + 1.64, -3.5), V(4.5, F + 1.3, 5), 0.4);
      },
      fadeOut: 1.2,
    },
    {
      name: 'charni-road',
      duration: 14,
      fov: 52,
      fadeIn: 1.2,
      title: ['Charni Road', 'चर्नी रोड', 'The last stretch'],
      titleAt: 1,
      titleFor: 4,
      update: (t, c) => {
        at(E, tCharni - 10 + t * 14, c.T);
        inCar(V(-CAR.halfW - 0.1, F + 1.56, -0.3), V(-CAR.halfW - 1.5, F + 1.1, 30), 0.35);
      },
    },
    {
      name: 'arrival',
      duration: 30,
      fov: 50,
      sub: ['Churchgate · this train terminates here', 'चर्चगेट · ही गाडी येथे संपते'],
      subAt: 18,
      subFor: 6,
      update: (t, c) => {
        // Rolling in under the shed, leaning out of the doorway; the train stops at the buffers.
        at(E, tStop - 24 + t * 30, c.T);
        const e = ease(t);
        inCar(V(-CAR.halfW - 0.05 + e * 0.1, F + 1.58, -0.2), V(-CAR.halfW - 1.2 + e * 0.8, F + 1.1 - e * 0.2, 30 - e * 12), 0.4);
        // From here on the film's clock carries the ride's offset.
        d.clock.base = d.clock.warp;
      },
    },
  ];
  return shots;
}
