/**
 * Druckwelle (Spec 7.3) als reine Funktionen: skalierte Distanz, Spitzenüberdruck nach
 * Kinney-Graham, Impuls auf Körper und Kraterabmessungen (Spec 7.4).
 */

/** Normaldruck auf Meereshöhe in Pa. */
export const AMBIENT_PRESSURE_PA = 101_325;
/** Kappung des Überdrucks in Pa (spielerisch, verhindert Unendlichkeiten nahe Null). */
export const MAX_OVERPRESSURE_PA = 2_000_000;
/** Unterhalb dieses Überdrucks bewegt die Welle nichts mehr (Pa). */
export const MIN_EFFECT_PA = 3_000;

/** Skalierte Distanz Z = R / W^(1/3) in m/kg^(1/3). */
export function scaledDistance(distanceM: number, tntKg: number): number {
  return Math.max(0, distanceM) / Math.cbrt(Math.max(1e-6, tntKg));
}

/**
 * Spitzenüberdruck in Pa nach Kinney & Graham (1985) für eine Detonation an der Oberfläche:
 * ΔP/P0 = 808·(1 + (Z/4,5)²) / √((1 + (Z/0,048)²)·(1 + (Z/0,32)²)·(1 + (Z/1,35)²)).
 * Streng monoton fallend in Z, gekappt auf {@link MAX_OVERPRESSURE_PA}.
 */
export function peakOverpressure(z: number): number {
  const zz = Math.max(0, z);
  const num = 808 * (1 + (zz / 4.5) ** 2);
  const den = Math.sqrt((1 + (zz / 0.048) ** 2) * (1 + (zz / 0.32) ** 2) * (1 + (zz / 1.35) ** 2));
  return Math.min(MAX_OVERPRESSURE_PA, (num / den) * AMBIENT_PRESSURE_PA);
}

/** Überdruck in Pa in `distanceM` Entfernung einer Ladung von `tntKg` kg TNT. */
export function overpressureAt(distanceM: number, tntKg: number): number {
  return peakOverpressure(scaledDistance(distanceM, tntKg));
}

/**
 * Wirkungsradius in m: Entfernung, ab der der Überdruck unter `thresholdPa` fällt.
 * Bisektion auf der monotonen Kurve.
 */
export function effectRadius(tntKg: number, thresholdPa = MIN_EFFECT_PA): number {
  let lo = 0;
  let hi = 200 * Math.cbrt(Math.max(1e-6, tntKg));
  if (overpressureAt(hi, tntKg) > thresholdPa) return hi;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (overpressureAt(mid, tntKg) > thresholdPa) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Dauer der Überdruckphase in s (SIMPLIFIED: ≈ 2 ms · W^(1/3), grobe Näherung an die
 * Kingery-Bulmash-Kurven im mittleren Abstand).
 */
export function positivePhaseS(tntKg: number): number {
  return 0.002 * Math.cbrt(Math.max(1e-6, tntKg));
}

/** Spielverstärkung des physikalischen Impulses (Spec 7.3: „auf Spielwerte gemappt“). */
export const BLAST_GAIN = 10;
/** Höchstens diese Geschwindigkeitsänderung in m/s pro Körper (gegen Durchtunneln). */
export const MAX_BLAST_DV = 60;

/**
 * Impuls (N·s) auf einen Körper: ΔP · Angriffsfläche · Phasendauer · Spielverstärkung,
 * begrenzt auf eine Geschwindigkeitsänderung von {@link MAX_BLAST_DV}.
 */
export function blastImpulse(
  distanceM: number,
  tntKg: number,
  areaM2: number,
  massKg: number,
): number {
  const dp = overpressureAt(distanceM, tntKg);
  if (dp < MIN_EFFECT_PA) return 0;
  const j = dp * Math.max(0, areaM2) * positivePhaseS(tntKg) * BLAST_GAIN;
  return Math.min(j, MAX_BLAST_DV * massKg);
}

/** Angriffsfläche aus der AABB (Spec 7.3): mittlere Seitenfläche einer Box. */
export function aabbArea(sx: number, sy: number, sz: number): number {
  return (sx * sy + sy * sz + sx * sz) / 3;
}

/** Bildschirmwackeln 0…1 aus Entfernung und Ladung (abklingend mit der skalierten Distanz). */
export function shakeAmount(distanceM: number, tntKg: number): number {
  const z = scaledDistance(distanceM, tntKg);
  return Math.min(1, 6 / (1 + z * z * 0.05)) / 6;
}

// ------------------------------------------------------------------------------------- Krater

export interface CraterSize {
  /** Radius der Schüssel bis zum Kamm des Auswurfwalls (m). */
  radiusM: number;
  /** Tiefe unter dem ursprünglichen Gelände (m). */
  depthM: number;
  /** Höhe des Auswurfwalls (m). */
  rimM: number;
}

/**
 * Kraterabmessungen aus der Ladung (Spec 7.4): R = 0,6 · W^(1/3) m, Tiefe = 0,4 · R,
 * Wall = 0,12 · R. Für eine 500-kg-Bombe ≈ 4,8 m Radius, 1,9 m tief (Bombentrichter real
 * etwa 8 bis 12 m Durchmesser). Detonationen in der Luft (`burstHeightM`) graben weniger:
 * linear abnehmend bis null bei einer Höhe von 2 · R.
 */
export function craterSize(tntKg: number, burstHeightM = 0): CraterSize {
  const r0 = 0.6 * Math.cbrt(Math.max(0, tntKg));
  const k = Math.max(0, 1 - Math.max(0, burstHeightM) / (2 * Math.max(1e-6, r0)));
  const radiusM = r0 * Math.sqrt(k);
  return { radiusM, depthM: 0.4 * radiusM * k, rimM: 0.12 * radiusM * k };
}

/**
 * Höhenversatz des Kraters (m) im Abstand r von der Mitte: Parabel-Schüssel bis R, dann ein
 * Auswurfwall, der bis 2 · R ausläuft. Bei r = R stetig, außerhalb von 2 · R exakt 0.
 */
export function craterOffset(r: number, c: CraterSize): number {
  const { radiusM: R, depthM: D, rimM: H } = c;
  if (R <= 0) return 0;
  const x = r / R;
  if (x >= 2) return 0;
  if (x <= 1) {
    // Schüssel: −D in der Mitte, bei x = 1 auf Wallhöhe
    return -D + (D + H) * x * x;
  }
  // Wall fällt von H bei x = 1 glatt (Kosinus) auf 0 bei x = 2
  return H * 0.5 * (1 + Math.cos(Math.PI * (x - 1)));
}
