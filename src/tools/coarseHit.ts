import { Vector3, type Ray } from 'three';
import type { GeoPoint } from '../core/types';

/** So weit (m) darf ein Kacheltreffer unter dem Höhenmodell liegen, bevor er als grob gilt. */
export const COARSE_TILE_TOLERANCE_M = 40;

const _march = new Vector3();

/**
 * Noch grobe Kacheln (beim Laden, unter Last) liegen als Sehne bis zu Kilometer unter dem
 * Gelände; ein Treffer darauf setzte die Blase weit hinter das Ziel und unter die Erde. Liegt
 * der Treffer deutlich unter dem Höhenmodell, wird der Strahl stattdessen mit dem Höhenmodell
 * geschnitten (in 64 Schritten abtasten, dann halbieren). Fehlen Höhendaten, bleibt der Treffer.
 */
export function refineCoarseHit(
  ray: Ray,
  hit: { point: Vector3; distance: number } | null,
  toGeo: (p: Vector3) => GeoPoint,
  terrainAt: (lat: number, lon: number) => number | null,
): { point: Vector3; distance: number } | null {
  if (!hit) return hit;
  const g = toGeo(hit.point);
  const terrain = terrainAt(g.lat, g.lon);
  if (terrain === null || g.height > terrain - COARSE_TILE_TOLERANCE_M) return hit;
  const below = (t: number): boolean | null => {
    const p = toGeo(ray.at(t, _march));
    const h = terrainAt(p.lat, p.lon);
    return h === null ? null : p.height <= h;
  };
  const steps = 64;
  let prev = 0;
  for (let i = 1; i <= steps; i++) {
    const t = (hit.distance * i) / steps;
    const b = below(t);
    if (b === null) return hit;
    if (!b) {
      prev = t;
      continue;
    }
    let lo = prev;
    let hi = t;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      if (below(mid)) hi = mid;
      else lo = mid;
    }
    return { point: ray.at(hi, new Vector3()), distance: hi };
  }
  return hit;
}
