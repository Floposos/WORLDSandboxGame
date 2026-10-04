import { WGS84 } from './constants';
import type { GeoPoint, Vec3 } from './types';

/**
 * Koordinatenumrechnungen WGS84 ↔ ECEF ↔ ENU (reine Funktionen, Float64).
 * Winkel in Grad an der Schnittstelle, Höhen in Metern über dem Ellipsoid.
 */

const DEG = Math.PI / 180;
const { a, f } = WGS84;
const e2 = f * (2 - f);
const b = a * (1 - f);
const ep2 = (a * a - b * b) / (b * b); // zweite Exzentrizität²

export const toRad = (deg: number): number => deg * DEG;
export const toDeg = (rad: number): number => rad / DEG;

/** Normalisiert einen Längengrad auf [-180, 180). */
export function wrapLon(lon: number): number {
  const w = (((lon + 180) % 360) + 360) % 360;
  return w - 180;
}

/** Geodätisch → ECEF (Formeln laut Spezifikation 4.2). */
export function geodeticToEcef(p: GeoPoint, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const phi = p.lat * DEG;
  const lam = p.lon * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const n = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  out.x = (n + p.height) * cosPhi * Math.cos(lam);
  out.y = (n + p.height) * cosPhi * Math.sin(lam);
  out.z = (n * (1 - e2) + p.height) * sinPhi;
  return out;
}

/**
 * ECEF → geodätisch nach Bowring mit anschließender Newton-Verfeinerung.
 * Genauigkeit deutlich unter 1 mm von −11 km bis in den Orbit.
 */
export function ecefToGeodetic(v: Vec3, out: GeoPoint = { lat: 0, lon: 0, height: 0 }): GeoPoint {
  const { x, y, z } = v;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);

  if (p < 1e-9) {
    // Auf der Polachse
    out.lat = z >= 0 ? 90 : -90;
    out.lon = 0;
    out.height = Math.abs(z) - b;
    return out;
  }

  // Bowring-Startwert
  const theta = Math.atan2(z * a, p * b);
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  let phi = Math.atan2(z + ep2 * b * st * st * st, p - e2 * a * ct * ct * ct);

  // Zwei Iterationen der klassischen Fixpunkt-Formel genügen für < 1 µm.
  let h = 0;
  for (let i = 0; i < 2; i++) {
    const sinPhi = Math.sin(phi);
    const n = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
    h = p / Math.cos(phi) - n;
    phi = Math.atan2(z, p * (1 - (e2 * n) / (n + h)));
  }
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const n = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  // numerisch stabile Höhe für alle Breiten
  h = p * cosPhi + z * sinPhi - (a * a) / n;

  out.lat = phi / DEG;
  out.lon = lon / DEG;
  out.height = h;
  return out;
}

/**
 * Rotationsmatrix ECEF → ENU am Ursprung (Zeilen = E, N, U als ECEF-Einheitsvektoren),
 * zeilenweise als 9 Zahlen.
 */
export function enuBasis(origin: GeoPoint): {
  east: Vec3;
  north: Vec3;
  up: Vec3;
} {
  const phi = origin.lat * DEG;
  const lam = origin.lon * DEG;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const sl = Math.sin(lam);
  const cl = Math.cos(lam);
  return {
    east: { x: -sl, y: cl, z: 0 },
    north: { x: -sp * cl, y: -sp * sl, z: cp },
    up: { x: cp * cl, y: cp * sl, z: sp },
  };
}

/**
 * Lokaler Frame um einen Ursprung. ENU-Werte (e, n, u); für three.js gilt die
 * Achsenzuordnung x = Ost, y = Oben, z = −Nord (siehe ARCHITECTURE.md).
 */
export class LocalFrame {
  readonly originEcef: Vec3;
  private readonly basis: ReturnType<typeof enuBasis>;

  constructor(readonly origin: GeoPoint) {
    this.originEcef = geodeticToEcef(origin);
    this.basis = enuBasis(origin);
  }

  /** ECEF → ENU (e, n, u) in Metern. */
  ecefToEnu(v: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    const dx = v.x - this.originEcef.x;
    const dy = v.y - this.originEcef.y;
    const dz = v.z - this.originEcef.z;
    const { east, north, up } = this.basis;
    const e = east.x * dx + east.y * dy + east.z * dz;
    const n = north.x * dx + north.y * dy + north.z * dz;
    const u = up.x * dx + up.y * dy + up.z * dz;
    out.x = e;
    out.y = n;
    out.z = u;
    return out;
  }

  /** ENU (e, n, u) → ECEF. */
  enuToEcef(enu: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    const { east, north, up } = this.basis;
    const { x: e, y: n, z: u } = enu;
    out.x = this.originEcef.x + east.x * e + north.x * n + up.x * u;
    out.y = this.originEcef.y + east.y * e + north.y * n + up.y * u;
    out.z = this.originEcef.z + east.z * e + north.z * n + up.z * u;
    return out;
  }

  /** ECEF → lokale three.js-Koordinaten (x = Ost, y = Oben, z = −Nord). */
  ecefToLocal(v: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    this.ecefToEnu(v, out);
    const n = out.y;
    out.y = out.z;
    out.z = -n;
    return out;
  }

  /** Lokale three.js-Koordinaten → ECEF. */
  localToEcef(v: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    return this.enuToEcef({ x: v.x, y: -v.z, z: v.y }, out);
  }
}

/** Großkreisdistanz (Haversine auf der mittleren Erdkugel, R = 6 371 008,8 m). */
export function haversineDistance(p1: GeoPoint, p2: GeoPoint): number {
  const R = 6_371_008.8;
  const dLat = (p2.lat - p1.lat) * DEG;
  const dLon = (p2.lon - p1.lon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1.lat * DEG) * Math.cos(p2.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Anfangskurs von p1 nach p2 in Grad (0 = Nord, im Uhrzeigersinn, [0, 360)). */
export function initialBearing(p1: GeoPoint, p2: GeoPoint): number {
  const phi1 = p1.lat * DEG;
  const phi2 = p2.lat * DEG;
  const dLon = (p2.lon - p1.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Punkt auf dem Großkreis zwischen p1 und p2 (t ∈ [0, 1]), sphärische Interpolation.
 * Die Höhe wird linear interpoliert.
 */
export function interpolateGreatCircle(p1: GeoPoint, p2: GeoPoint, t: number): GeoPoint {
  const phi1 = p1.lat * DEG;
  const lam1 = p1.lon * DEG;
  const phi2 = p2.lat * DEG;
  const lam2 = p2.lon * DEG;
  const v1 = [Math.cos(phi1) * Math.cos(lam1), Math.cos(phi1) * Math.sin(lam1), Math.sin(phi1)];
  const v2 = [Math.cos(phi2) * Math.cos(lam2), Math.cos(phi2) * Math.sin(lam2), Math.sin(phi2)];
  const dot = Math.min(1, Math.max(-1, v1[0]! * v2[0]! + v1[1]! * v2[1]! + v1[2]! * v2[2]!));
  const omega = Math.acos(dot);
  let w1 = 1 - t;
  let w2 = t;
  if (omega > 1e-9) {
    const so = Math.sin(omega);
    w1 = Math.sin((1 - t) * omega) / so;
    w2 = Math.sin(t * omega) / so;
  }
  const x = w1 * v1[0]! + w2 * v2[0]!;
  const y = w1 * v1[1]! + w2 * v2[1]!;
  const z = w1 * v1[2]! + w2 * v2[2]!;
  return {
    lat: toDeg(Math.atan2(z, Math.hypot(x, y))),
    lon: toDeg(Math.atan2(y, x)),
    height: p1.height + (p2.height - p1.height) * t,
  };
}
