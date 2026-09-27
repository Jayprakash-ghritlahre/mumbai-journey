import * as THREE from 'three';

/** Churchgate, Mumbai. */
export const SITE = { lat: 18.93418, lon: 72.82743, utcOffsetHours: 5.5 };

/** True bearing of the station's -Z axis (up the tracks). Must match tools/build-geo.mjs. */
export const STATION_BEARING = 351;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface SunPosition {
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Degrees above the horizon (with approximate refraction). */
  elevation: number;
}

/** NOAA solar position algorithm (accurate to ~0.01° for our purposes). */
export function solarPosition(utc: Date, lat = SITE.lat, lon = SITE.lon): SunPosition {
  const jd = utc.getTime() / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C =
    Math.sin(M * D2R) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * M * D2R) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(obliq * D2R) * Math.sin(appLong * D2R));
  const y = Math.tan((obliq / 2) * D2R) ** 2;
  const eqTime =
    4 *
    R2D *
    (y * Math.sin(2 * L0 * D2R) -
      2 * e * Math.sin(M * D2R) +
      4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R) -
      0.5 * y * y * Math.sin(4 * L0 * D2R) -
      1.25 * e * e * Math.sin(2 * M * D2R));
  const minutes = utc.getUTCHours() * 60 + utc.getUTCMinutes() + utc.getUTCSeconds() / 60;
  const tst = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const latR = lat * D2R;
  const cosZen = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha * D2R);
  const zen = Math.acos(THREE.MathUtils.clamp(cosZen, -1, 1));
  const azDen = Math.cos(latR) * Math.sin(zen);
  let az: number;
  if (Math.abs(azDen) < 1e-6) az = 180;
  else {
    const a = THREE.MathUtils.clamp((Math.sin(latR) * Math.cos(zen) - Math.sin(decl)) / azDen, -1, 1);
    az = ha > 0 ? (R2D * Math.acos(a) + 180) % 360 : (540 - R2D * Math.acos(a)) % 360;
  }
  let elev = 90 - zen * R2D;
  // Simple atmospheric refraction near the horizon.
  if (elev > -0.575 && elev < 85) {
    const te = Math.tan(elev * D2R);
    elev += (elev > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5 : 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)))) / 3600;
  }
  return { azimuth: az, elevation: elev };
}

/** Local wall-clock time in Mumbai (IST) → UTC Date. */
export function istToUtc(year: number, month: number, day: number, hour: number): Date {
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0) + (hour - SITE.utcOffsetHours) * 3600000;
  return new Date(ms);
}

/** Converts a true bearing/elevation to a unit vector in the game's local frame. */
export function directionFromBearing(bearingDeg: number, elevationDeg: number, target = new THREE.Vector3()): THREE.Vector3 {
  const b = (bearingDeg - STATION_BEARING) * D2R;
  const el = elevationDeg * D2R;
  return target.set(Math.sin(b) * Math.cos(el), Math.sin(el), -Math.cos(b) * Math.cos(el));
}
