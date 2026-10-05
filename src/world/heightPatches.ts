import { craterOffset, type CraterSize } from '../physics/blast';
import { WGS84 } from '../core/constants';

/** Höchstens so viele Krater gleichzeitig (Spec 7.4: „maximal N Patches pro Blase“). */
export const MAX_CRATERS = 24;

export interface CraterPatch extends CraterSize {
  id: number;
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;

/**
 * Höhen-Patches (Spec 7.4): Krater als Versatz zur Geländehöhe, additiv überlagert. Wird vom
 * {@link HeightSampler}, der Bodenabfrage und dem Heightfield-Collider berücksichtigt.
 * Abstände werden lokal eben gerechnet (Krater sind höchstens einige hundert Meter groß).
 */
export class HeightPatches {
  private readonly list: CraterPatch[] = [];
  private nextId = 1;
  private readonly listeners = new Set<() => void>();
  /** Erhöht sich bei jeder Änderung (für Caches). */
  version = 0;

  get craters(): readonly CraterPatch[] {
    return this.list;
  }

  /** Krater hinzufügen; bei Überlauf fällt der älteste weg. */
  add(lat: number, lon: number, size: CraterSize): CraterPatch | null {
    if (size.radiusM <= 0.05) return null;
    const patch: CraterPatch = { id: this.nextId++, lat, lon, ...size };
    this.list.push(patch);
    if (this.list.length > MAX_CRATERS) this.list.shift();
    this.changed();
    return patch;
  }

  clear(): void {
    if (this.list.length === 0) return;
    this.list.length = 0;
    this.changed();
  }

  /** Summe aller Krater-Versätze an lat/lon in m (0 außerhalb). */
  offsetAt(lat: number, lon: number): number {
    let sum = 0;
    for (const c of this.list) {
      const dz = (lat - c.lat) * DEG * WGS84.a;
      const dx = (lon - c.lon) * DEG * WGS84.a * Math.cos(c.lat * DEG);
      const r2 = dx * dx + dz * dz;
      const reach = 2 * c.radiusM;
      if (r2 >= reach * reach) continue;
      sum += craterOffset(Math.sqrt(r2), c);
    }
    return sum;
  }

  /** Ändert sich etwas, wird `fn` aufgerufen; Rückgabe meldet ab. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
