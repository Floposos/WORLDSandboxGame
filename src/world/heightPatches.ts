import { craterOffset, type CraterSize } from '../physics/blast';
import { WGS84 } from '../core/constants';

/** Höchstens so viele Krater gleichzeitig (Spec 7.4: „maximal N Patches pro Blase“). */
export const MAX_CRATERS = 24;

export interface CraterPatch extends CraterSize {
  id: number;
  lat: number;
  lon: number;
}

/** Vulkankegel: Basisradius, Höhe und Radius des Gipfelkraters (m). */
export interface ConeSize {
  radiusM: number;
  heightM: number;
  craterM: number;
}

export interface ConePatch extends ConeSize {
  id: number;
  lat: number;
  lon: number;
}

/**
 * Höhe eines Vulkankegels im Abstand r (m): konkave Flanken H · (1 − r/R)^1,4, oben ein
 * Gipfelkrater mit Tiefe 0,35 · R_c. Außerhalb von R exakt 0.
 */
export function coneOffset(r: number, c: ConeSize): number {
  const { radiusM: R, heightM: H, craterM: Rc } = c;
  if (R <= 0 || H <= 0 || r >= R) return 0;
  if (r >= Rc) return H * (1 - r / R) ** 1.4;
  const rim = H * (1 - Rc / R) ** 1.4;
  return rim - 0.35 * Rc * (1 - (r / Math.max(1e-6, Rc)) ** 2);
}

const DEG = Math.PI / 180;

/**
 * Höhen-Patches (Spec 7.4): Krater als Versatz zur Geländehöhe, additiv überlagert. Wird vom
 * {@link HeightSampler}, der Bodenabfrage und dem Heightfield-Collider berücksichtigt.
 * Abstände werden lokal eben gerechnet (Krater sind höchstens einige hundert Meter groß).
 */
export class HeightPatches {
  private readonly list: CraterPatch[] = [];
  private readonly coneList: ConePatch[] = [];
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
    if (this.list.length + this.coneList.length > MAX_CRATERS) {
      if (this.list.length > 1 || this.coneList.length === 0) this.list.shift();
      else this.coneList.shift();
    }
    this.changed();
    return patch;
  }

  get cones(): readonly ConePatch[] {
    return this.coneList;
  }

  /** Vulkankegel hinzufügen (zählt zur Höchstzahl der Patches). */
  addCone(lat: number, lon: number, size: ConeSize): ConePatch {
    const patch: ConePatch = { id: this.nextId++, lat, lon, ...size };
    this.coneList.push(patch);
    if (this.list.length + this.coneList.length > MAX_CRATERS) this.coneList.shift();
    this.changed();
    return patch;
  }

  /** Kegel wächst: neue Maße. Liefert false, wenn es ihn nicht mehr gibt. */
  updateCone(id: number, size: ConeSize): boolean {
    const c = this.coneList.find((x) => x.id === id);
    if (!c) return false;
    Object.assign(c, size);
    this.changed();
    return true;
  }

  clear(): void {
    if (this.list.length === 0 && this.coneList.length === 0) return;
    this.list.length = 0;
    this.coneList.length = 0;
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
    for (const c of this.coneList) {
      const dz = (lat - c.lat) * DEG * WGS84.a;
      const dx = (lon - c.lon) * DEG * WGS84.a * Math.cos(c.lat * DEG);
      const r2 = dx * dx + dz * dz;
      if (r2 >= c.radiusM * c.radiusM) continue;
      sum += coneOffset(Math.sqrt(r2), c);
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
