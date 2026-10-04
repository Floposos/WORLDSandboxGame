/**
 * Local sun position, no network. Follows the NOAA Solar Calculator spreadsheet formulas
 * (NOAA Solar Calculator, gml.noaa.gov/grad/solcalc). Pure math, no three.js.
 */

export interface SolarPosition {
  /** Degrees clockwise from north, 0..360. */
  azimuthDeg: number;
  /** Geometric elevation above the horizon (no refraction), -90..90. */
  elevationDeg: number;
  declinationDeg: number;
  equationOfTimeMin: number;
  /** Local hour angle, degrees, 0 at solar noon, positive in the afternoon. */
  hourAngleDeg: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const clamp1 = (v: number): number => Math.min(1, Math.max(-1, v));

/** Julian day (UT) of a JS Date. */
export function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

interface SunCore {
  declinationDeg: number;
  equationOfTimeMin: number;
  /** Minutes since 00:00 UTC of the date's UTC day. */
  utcMinutes: number;
}

function sunCore(date: Date): SunCore {
  const t = (julianDay(date) - 2_451_545) / 36_525;
  const l0 = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360);
  const m = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * RAD;
  const c =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mr) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));
  const y = Math.tan((obliq * RAD) / 2) ** 2;
  const l0r = l0 * RAD;
  const eot =
    4 *
    DEG *
    (y * Math.sin(2 * l0r) -
      2 * e * Math.sin(mr) +
      4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
      0.5 * y * y * Math.sin(4 * l0r) -
      1.25 * e * e * Math.sin(2 * mr));
  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60_000;
  return { declinationDeg: declination * DEG, equationOfTimeMin: eot, utcMinutes };
}

/** Hour angle in degrees, range [-180, 180), for a longitude (east positive). */
function hourAngle(core: SunCore, lonDeg: number): number {
  const trueSolarTime = mod(core.utcMinutes + core.equationOfTimeMin + 4 * lonDeg, 1440);
  return trueSolarTime / 4 - 180;
}

export function solarPosition(date: Date, latDeg: number, lonDeg: number): SolarPosition {
  const core = sunCore(date);
  const ha = hourAngle(core, lonDeg);
  const lat = latDeg * RAD;
  const dec = core.declinationDeg * RAD;
  const cosZenith = clamp1(
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha * RAD),
  );
  const zenith = Math.acos(cosZenith);
  const sinZenith = Math.sin(zenith);
  let azimuthDeg = 180;
  const denom = Math.cos(lat) * sinZenith;
  if (Math.abs(denom) > 1e-9) {
    const a = Math.acos(clamp1((Math.sin(lat) * cosZenith - Math.sin(dec)) / denom)) * DEG;
    azimuthDeg = ha > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  }
  return {
    azimuthDeg,
    elevationDeg: 90 - zenith * DEG,
    declinationDeg: core.declinationDeg,
    equationOfTimeMin: core.equationOfTimeMin,
    hourAngleDeg: ha,
  };
}

/** Where the sun is at zenith. lon is normalised to [-180, 180). */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const core = sunCore(date);
  const lon = mod(-hourAngle(core, 0) + 180, 360) - 180;
  return { lat: core.declinationDeg, lon };
}

/** Unit vector from Earth's centre to the sun in ECEF (X: lat0/lon0, Y: 90E, Z: north). */
export function sunDirectionEcef(date: Date): { x: number; y: number; z: number } {
  const { lat, lon } = subsolarPoint(date);
  const la = lat * RAD;
  const lo = lon * RAD;
  return {
    x: Math.cos(la) * Math.cos(lo),
    y: Math.cos(la) * Math.sin(lo),
    z: Math.sin(la),
  };
}
