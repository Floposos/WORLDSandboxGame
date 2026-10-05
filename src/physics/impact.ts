/**
 * Einschlag-Physik für den Meteor (Spec 8): Masse, kinetische Energie, TNT-Äquivalent und
 * Kratergröße. Die Kraterformel folgt Collins, Melosh & Marcus (2005), „Earth Impact Effects
 * Program“: transienter Krater
 *   D_tc = 1,161 · (ρ_i/ρ_t)^(1/3) · L^0,78 · v^0,44 · g^(−0,22) · sin^(1/3) θ,
 * einfacher Endkrater D = 1,25 · D_tc, Wallhöhe h = 0,07 · D_tc⁴ / D³.
 */
import { STANDARD_GRAVITY, TNT_J_PER_KG } from '../core/constants';
import { overpressureAt, type CraterSize } from './blast';

/** Dichte eines Steinmeteoriten (kg/m³). */
export const METEOR_DENSITY = 3_000;
/** Dichte des Zielgesteins bzw. Bodens (kg/m³). */
export const TARGET_DENSITY = 2_500;

/** Masse einer Kugel mit Durchmesser `d` (m). */
export function meteorMass(diameterM: number, density = METEOR_DENSITY): number {
  const r = diameterM / 2;
  return density * (4 / 3) * Math.PI * r ** 3;
}

/** E = ½ · m · v² (J), Geschwindigkeit in km/s. */
export function meteorEnergyJ(
  diameterM: number,
  speedKms: number,
  density = METEOR_DENSITY,
): number {
  const v = speedKms * 1_000;
  return 0.5 * meteorMass(diameterM, density) * v * v;
}

/** Joule → kg TNT (1 t TNT = 4,184 · 10⁹ J). */
export function tntKgFromJoule(joule: number): number {
  return joule / TNT_J_PER_KG;
}

/** Durchmesser des transienten Kraters (m) nach Collins et al. (2005), Gl. 21. */
export function transientCraterM(
  diameterM: number,
  speedKms: number,
  angleDeg: number,
  impactorDensity = METEOR_DENSITY,
  targetDensity = TARGET_DENSITY,
  gravity = STANDARD_GRAVITY,
): number {
  const v = speedKms * 1_000;
  const sin = Math.sin((Math.max(5, Math.min(90, angleDeg)) * Math.PI) / 180);
  return (
    1.161 *
    Math.cbrt(impactorDensity / targetDensity) *
    diameterM ** 0.78 *
    v ** 0.44 *
    gravity ** -0.22 *
    Math.cbrt(sin)
  );
}

/**
 * Endkrater als {@link CraterSize}: Radius bis zum Wall = D/2, Tiefe ≈ 0,2 · D (einfacher
 * Krater, Barringer: 1,2 km Ø, 170 m tief), Wallhöhe nach Collins. SIMPLIFIED: kein Abbremsen
 * oder Zerbrechen in der Atmosphäre (kleine Steinmeteore würden real in der Luft zerplatzen).
 */
export function impactCrater(diameterM: number, speedKms: number, angleDeg: number): CraterSize {
  const dtc = transientCraterM(diameterM, speedKms, angleDeg);
  const d = 1.25 * dtc;
  const rim = (0.07 * dtc ** 4) / d ** 3;
  return { radiusM: d / 2, depthM: 0.2 * d, rimM: rim };
}

/** Abstand (m), bis zu dem der Überdruck mindestens `pa` beträgt. */
export function radiusForOverpressure(tntKg: number, pa: number): number {
  let lo = 0.1;
  let hi = 1;
  while (hi < 1e6 && overpressureAt(hi, tntKg) > pa) hi *= 2;
  if (overpressureAt(lo, tntKg) < pa) return 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (overpressureAt(mid, tntKg) > pa) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Ab diesem Überdruck bleibt von einem Gebäude nichts Erkennbares (Pa). */
export const VAPORIZE_OVERPRESSURE_PA = 1_000_000;

/**
 * Gebäude in diesem Umkreis verschwinden ohne Bruchstücke: Kraterschüssel samt Auswurf
 * (1,3 · R) oder der Bereich mit über 1 MPa Überdruck, je nachdem, was größer ist.
 */
export function vaporizeRadius(crater: CraterSize, tntKg: number): number {
  return Math.max(1.3 * crater.radiusM, radiusForOverpressure(tntKg, VAPORIZE_OVERPRESSURE_PA));
}
