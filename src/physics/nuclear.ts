/**
 * Mega-Bombe (Spec 8, Stufe 5): Wirkungsradien und Größe der Pilzwolke aus der Sprengkraft.
 * Abstrakt und spielerisch, ohne Strahlung und ohne Opferzahlen (Spec 7.5).
 *
 * - Feuerball: R ≈ 66 m · W^0,4 (W in kt), Skalierung nach Glasstone & Dolan (1977) für den
 *   größten Feuerballradius einer Luftdetonation. SIMPLIFIED: ein fester Faktor.
 * - Schwere Zerstörung: Überdruck ≥ 20 psi (≈ 138 kPa), leichte Zerstörung: ≥ 1 psi (≈ 6,9 kPa),
 *   beide aus der Kinney-Graham-Kurve der Explosionen (Bodendetonation, siehe `blast.ts`).
 * - Pilzwolke: Gipfelhöhe ≈ 3,4 km · W^0,25 (Anpassung an veröffentlichte Werte: 15 kt ≈ 7 km,
 *   1 Mt ≈ 19 km, 50 Mt ≈ 50 km), Hutradius ≈ 0,45 · Gipfelhöhe. SIMPLIFIED, rein visuell.
 */
import { radiusForOverpressure } from './impact';

/** Grenzen laut Spec 8: 1 kt bis 50 Mt. */
export const MEGA_MIN_KT = 1;
export const MEGA_MAX_KT = 50_000;

/** 20 psi und 1 psi in Pa. */
export const HEAVY_DAMAGE_PA = 137_900;
export const LIGHT_DAMAGE_PA = 6_895;

export interface YieldRadii {
  /** Feuerball (m). */
  fireballM: number;
  /** Schwere Zerstörung, Überdruck ≥ 20 psi (m). */
  heavyM: number;
  /** Leichte Zerstörung, Überdruck ≥ 1 psi (m). */
  lightM: number;
}

/** kt TNT → kg TNT. */
export const ktToKg = (kt: number): number => kt * 1e6;

/** Wirkungsradien für eine Sprengkraft in kt. */
export function yieldRadii(kt: number): YieldRadii {
  const w = Math.max(1e-3, kt);
  const tnt = ktToKg(w);
  return {
    fireballM: 66 * w ** 0.4,
    heavyM: radiusForOverpressure(tnt, HEAVY_DAMAGE_PA),
    lightM: radiusForOverpressure(tnt, LIGHT_DAMAGE_PA),
  };
}

export interface MushroomSize {
  /** Gipfelhöhe über Grund (m). */
  heightM: number;
  /** Radius des Hutes (m). */
  capRadiusM: number;
  /** Radius des Stiels (m). */
  stemRadiusM: number;
}

/** Größe der Pilzwolke (stilisiert). */
export function mushroomSize(kt: number): MushroomSize {
  const h = 3_400 * Math.max(1e-3, kt) ** 0.25;
  return { heightM: h, capRadiusM: 0.45 * h, stemRadiusM: 0.09 * h };
}

/** Luftdetonation knapp über dem Feuerball: Er berührt den Boden nicht (kein Krater). */
export function airburstHeightM(kt: number): number {
  return 1.2 * yieldRadii(kt).fireballM;
}
