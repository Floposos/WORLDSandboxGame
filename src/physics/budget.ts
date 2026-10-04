/**
 * Body-Budget (Spec 7.1): reine Entscheidungslogik, unit-getestet. Die Physikwelt fragt hier,
 * welche Bodies verschwinden und welche einfrieren.
 */

/** Schlafende Bodies frieren nach so vielen Sekunden ein (werden statisch). */
export const FREEZE_AFTER_SLEEP_S = 10;
/** Ausblenden beim Despawn in Sekunden. */
export const DESPAWN_FADE_S = 0.4;

export interface BudgetEntry {
  id: number;
  /** Zeitpunkt der Erzeugung (Simulationssekunden). */
  spawnedAt: number;
  /** Volumen in m³ (klein = zuerst weg). */
  volume: number;
  /** Trümmer gehen vor platzierten Objekten (ab M4). */
  debris: boolean;
  /** Vom Spieler gesteuerte oder verbundene Objekte (Auto, Abrissbirne) bleiben. */
  pinned: boolean;
}

/**
 * Welche Bodies müssen weg, damit höchstens `max` übrig bleiben? Reihenfolge laut Spec:
 * Trümmer vor platzierten Objekten, dann die ältesten, bei Gleichstand die kleinsten.
 */
export function selectDespawn(entries: readonly BudgetEntry[], max: number): number[] {
  const excess = entries.length - Math.max(0, max);
  if (excess <= 0) return [];
  const candidates = entries
    .filter((e) => !e.pinned)
    .sort(
      (a, b) =>
        Number(b.debris) - Number(a.debris) ||
        a.spawnedAt - b.spawnedAt ||
        a.volume - b.volume ||
        a.id - b.id,
    );
  return candidates.slice(0, excess).map((e) => e.id);
}

/**
 * Schlafzeit fortschreiben: liefert die neue Schlafdauer und ob der Body jetzt einfrieren soll.
 */
export function advanceSleep(
  sleptS: number,
  sleeping: boolean,
  dt: number,
): { sleptS: number; freeze: boolean } {
  if (!sleeping) return { sleptS: 0, freeze: false };
  const next = sleptS + dt;
  return { sleptS: next, freeze: sleptS < FREEZE_AFTER_SLEEP_S && next >= FREEZE_AFTER_SLEEP_S };
}

/** Liegt ein Punkt (Blasen-Frame, Mitte = 0) außerhalb der Simulationsblase? */
export function outsideBubble(x: number, y: number, z: number, radiusM: number): boolean {
  // Etwas Spielraum, damit Objekte am Rand nicht flackernd verschwinden
  return x * x + z * z > (radiusM * 1.15) ** 2 || y < -radiusM || y > radiusM * 4;
}
