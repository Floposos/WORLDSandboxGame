/**
 * Globale Konstanten. Alle Distanzen, Radien und Geschwindigkeiten im Spiel
 * müssen über {@link WORLD_SCALE} skaliert werden (Ziel 1:1, Untergrenze 1:2).
 */

/** Maßstab der Spielwelt relativ zur echten Erde. 1 = 1:1, 0.5 = 1:2. */
export const WORLD_SCALE = 1;

/** Skaliert eine reale Länge in Metern in Spielmeter. */
export function scaled(meters: number): number {
  return meters * WORLD_SCALE;
}

/** WGS84-Ellipsoid (EPSG:4326). */
export const WGS84 = {
  /** große Halbachse a in m */
  a: 6_378_137,
  /** Abplattung f */
  f: 1 / 298.257223563,
  /** kleine Halbachse b = a·(1−f) in m */
  get b(): number {
    return this.a * (1 - this.f);
  },
  /** erste numerische Exzentrizität im Quadrat e² = f·(2−f) */
  get e2(): number {
    return this.f * (2 - this.f);
  },
} as const;

/** Physik läuft mit festem Schritt. */
export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
/** Maximal so viele Physik-Substeps pro Frame, danach wird Zeit verworfen. */
export const MAX_SUBSTEPS = 5;

/** Floating Origin: Ab dieser Kameraentfernung vom Ursprung wird neu zentriert. */
export const ORIGIN_SHIFT_THRESHOLD_M = scaled(5_000);

/** Erdbeschleunigung in m/s². */
export const STANDARD_GRAVITY = 9.80665;
/** Schallgeschwindigkeit in Luft (20 °C) in m/s. */
export const SPEED_OF_SOUND = 343;
/** Energie von 1 kg TNT in Joule (1 t TNT = 4,184·10⁹ J). */
export const TNT_J_PER_KG = 4.184e6;

/** Erlaubte Zeitskalen (0 = Pause). Wirken auf Physik und VFX, nicht auf die UI. */
export const TIME_SCALES = [0, 0.1, 0.25, 0.5, 1, 2] as const;
export type TimeScale = (typeof TIME_SCALES)[number];
