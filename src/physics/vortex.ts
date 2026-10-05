/**
 * Tornado-Kraftfeld (Spec 8): Rankine-Wirbel mit tangentialer, radial einwärts gerichteter und
 * aufwärts gerichteter Komponente. Alles im Blasen-Frame (x = Ost, y = oben, z = −Nord).
 */
import type { Vector3 } from 'three';

/** Höchste Windgeschwindigkeit je Stufe der Enhanced-Fujita-Skala (m/s, Mitte der Spanne). */
export const EF_SPEEDS = [33, 43, 54, 68, 83, 100] as const;

/** Luftdichte (kg/m³). */
const AIR_DENSITY = 1.2;
/** Spielerischer Verstärkungsfaktor auf den Luftwiderstand: Objekte heben sichtbar ab. */
export const VORTEX_GAIN = 3;
/** Höchste Beschleunigung durch den Wind (m/s²). */
export const VORTEX_MAX_ACCEL = 45;
/** Bis zu dieser Höhe über Grund saugt der Wirbel nach oben, darüber schleudert er hinaus (m). */
export const VORTEX_LIFT_TOP_M = 220;

/** Tangentialgeschwindigkeit im Abstand r (Rankine): innen linear, außen ∝ 1/r. */
export function rankineSpeed(r: number, coreR: number, vmax: number): number {
  if (r <= 0) return 0;
  return r <= coreR ? (vmax * r) / coreR : (vmax * coreR) / r;
}

/**
 * Luftgeschwindigkeit des Wirbels an einem Punkt relativ zur Wirbelachse (dx, dz) in der Höhe
 * `h` über Grund. Drehsinn gegen den Uhrzeiger (von oben, Nordhalbkugel).
 */
export function vortexWind(
  dx: number,
  h: number,
  dz: number,
  coreR: number,
  vmax: number,
  out: Vector3,
): Vector3 {
  const r = Math.hypot(dx, dz);
  if (r < 1e-3) return out.set(0, vmax * 0.5, 0);
  const vt = rankineSpeed(r, coreR, vmax);
  const ux = dx / r;
  const uz = dz / r;
  // Einströmen am Boden, oben schwächer
  const low = Math.max(0, 1 - Math.max(0, h) / VORTEX_LIFT_TOP_M);
  const vr = -0.55 * vt * (0.3 + 0.7 * low);
  // Aufwind im Kern, oberhalb der Saughöhe nach außen
  const core = Math.exp(-((r / (1.4 * coreR)) ** 2));
  const vy = h < VORTEX_LIFT_TOP_M ? vmax * 0.7 * core : -2;
  const outward = h < VORTEX_LIFT_TOP_M ? 0 : vt * 0.8;
  // Tangente gegen den Uhrzeiger: (Ost, Nord) = (−n, e) → im Frame (x, z) = (dz, −dx)/r
  return out.set(uz * vt + ux * (vr + outward), vy, -ux * vt + uz * (vr + outward));
}

/**
 * Beschleunigung eines Körpers durch den Wind (m/s²) aus dem Luftwiderstand
 * a = ½ ρ c_w A |Δv| Δv / m · Verstärkung, begrenzt auf {@link VORTEX_MAX_ACCEL}.
 */
export function windAccel(
  air: Vector3,
  vel: { x: number; y: number; z: number },
  areaM2: number,
  massKg: number,
  out: Vector3,
): Vector3 {
  const dx = air.x - vel.x;
  const dy = air.y - vel.y;
  const dz = air.z - vel.z;
  const dv = Math.hypot(dx, dy, dz);
  if (dv < 1e-3 || massKg <= 0) return out.set(0, 0, 0);
  let a = (0.5 * AIR_DENSITY * 1.1 * areaM2 * dv * dv * VORTEX_GAIN) / massKg;
  a = Math.min(a, VORTEX_MAX_ACCEL);
  return out.set((dx / dv) * a, (dy / dv) * a, (dz / dv) * a);
}

/**
 * Windgeschwindigkeit, ab der ein Bruchstück losreißt: Dach ab 40 m/s (EF1 deckt Dächer ab),
 * Erdgeschoss erst ab 95 m/s (nur der Kern eines EF5 trägt ganze Häuser ab).
 */
export function breakSpeed(rel: number): number {
  return 95 - 55 * Math.min(1, Math.max(0, rel));
}
