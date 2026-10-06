import { haversineDistance, initialBearing } from '../core/geo';

/**
 * Militäreinheiten der Spielschicht (S2): Infanterie, Panzer, Luftwaffe. Reine Spiellogik ohne
 * Darstellung: Platzieren, Zuweisen, Marschbefehle, Bewegung entlang von Großkreisen.
 */

export type UnitType = 'infantry' | 'tank' | 'air';
export const UNIT_TYPES: readonly UnitType[] = ['infantry', 'tank', 'air'];

/** Marschgeschwindigkeit in km je Spielstunde. */
export const UNIT_SPEED_KMH: Record<UnitType, number> = { infantry: 5, tank: 40, air: 700 };
/** Stärke einer neuen Einheit (Soldaten bzw. Fahrzeuge/Flugzeuge, für die Anzeige). */
export const UNIT_STRENGTH: Record<UnitType, number> = { infantry: 1000, tank: 50, air: 20 };
/**
 * Spielzeit: eine Spielstunde je Echtsekunde (bei Zeitfaktor 1). So rollt ein Panzerverband in
 * 20 s durch Deutschland, Flugzeuge queren Europa in wenigen Sekunden.
 * SIMPLIFIED: kein Gelände, keine Straßen, kein Nachschub; Bodentruppen fahren Großkreise.
 */
export const GAME_HOURS_PER_SECOND = 1;

export interface Unit {
  id: number;
  type: UnitType;
  /** Land (ADM0_A3) oder null (keinem Land zugewiesen). */
  owner: string | null;
  lat: number;
  lon: number;
  /** Marschziel oder null. */
  target: { lat: number; lon: number } | null;
  strength: number;
  /** Blickrichtung in Grad (für die Darstellung). */
  heading: number;
}

export type PlaceResult = { ok: true; unit: Unit } | { ok: false; reason: 'sea' };
export type MoveResult = { moved: number; refusedSea: number };

/** Ist der Punkt Land? (Land = in einem Land oder Antarktis; Meer = kein Land.) */
export type IsLand = (lat: number, lon: number) => boolean;

const EARTH_R_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Punkt nach Strecke (km) und Kurs (Grad) auf der Kugel. */
export function destination(
  lat: number,
  lon: number,
  bearingDeg: number,
  km: number,
): { lat: number; lon: number } {
  const d = km / EARTH_R_KM;
  const b = bearingDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    l1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: ((((l2 / RAD + 180) % 360) + 360) % 360) - 180 };
}

/**
 * Zielpunkte für einen Verband: um das Ziel in einem Raster verteilt (Abstand in km), damit die
 * Einheiten nicht aufeinander stehen. Reihenfolge = Reihenfolge der Einheiten.
 */
export function formation(
  target: { lat: number; lon: number },
  count: number,
  spacingKm: number,
): { lat: number; lon: number }[] {
  const cols = Math.ceil(Math.sqrt(count));
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const dx = (c - (cols - 1) / 2) * spacingKm;
    const rows = Math.ceil(count / cols);
    const dy = ((rows - 1) / 2 - r) * spacingKm;
    if (dx === 0 && dy === 0) {
      out.push({ ...target });
      continue;
    }
    const dist = Math.hypot(dx, dy);
    const bearing = (Math.atan2(dx, dy) / RAD + 360) % 360;
    out.push(destination(target.lat, target.lon, bearing, dist));
  }
  return out;
}

export class UnitStore {
  private readonly map = new Map<number, Unit>();
  private nextId = 1;
  /** Wird nach jeder Änderung aufgerufen (UI, Speicher). */
  onChange: (() => void) | null = null;

  constructor(private readonly isLand: IsLand) {}

  get units(): Unit[] {
    return [...this.map.values()];
  }

  get(id: number): Unit | undefined {
    return this.map.get(id);
  }

  get size(): number {
    return this.map.size;
  }

  /** Einheit platzieren; Bodentruppen nur an Land. */
  place(type: UnitType, lat: number, lon: number, owner: string | null): PlaceResult {
    if (type !== 'air' && !this.isLand(lat, lon)) return { ok: false, reason: 'sea' };
    const unit: Unit = {
      id: this.nextId++,
      type,
      owner,
      lat,
      lon,
      target: null,
      strength: UNIT_STRENGTH[type],
      heading: 0,
    };
    this.map.set(unit.id, unit);
    this.onChange?.();
    return { ok: true, unit };
  }

  remove(ids: Iterable<number>): void {
    let changed = false;
    for (const id of ids) changed = this.map.delete(id) || changed;
    if (changed) this.onChange?.();
  }

  clear(): void {
    if (this.map.size === 0) return;
    this.map.clear();
    this.onChange?.();
  }

  assign(ids: Iterable<number>, owner: string | null): void {
    for (const id of ids) {
      const u = this.map.get(id);
      if (u) u.owner = owner;
    }
    this.onChange?.();
  }

  /**
   * Marschbefehl an einen Verband. Bodentruppen verweigern Ziele auf dem Meer (ihr Platz im
   * Raster wird dann übersprungen); Luftwaffe fliegt überall hin.
   */
  move(
    ids: readonly number[],
    target: { lat: number; lon: number },
    spacingKm: number,
  ): MoveResult {
    const units = ids.map((id) => this.map.get(id)).filter((u): u is Unit => !!u);
    const spots = formation(target, units.length, spacingKm);
    let moved = 0;
    let refusedSea = 0;
    units.forEach((u, i) => {
      const spot = spots[i]!;
      if (u.type !== 'air' && !this.isLand(spot.lat, spot.lon)) {
        // Rasterplatz im Meer: notfalls genau auf das Ziel, sonst verweigern
        if (this.isLand(target.lat, target.lon)) {
          u.target = { ...target };
          moved++;
        } else refusedSea++;
        return;
      }
      u.target = spot;
      moved++;
    });
    if (moved) this.onChange?.();
    return { moved, refusedSea };
  }

  /** Bewegung um `dtHours` Spielstunden. Gibt zurück, ob sich etwas bewegt hat. */
  step(dtHours: number): boolean {
    let any = false;
    for (const u of this.map.values()) {
      if (!u.target) continue;
      any = true;
      const remain = haversineDistance(
        { lat: u.lat, lon: u.lon, height: 0 },
        { lat: u.target.lat, lon: u.target.lon, height: 0 },
      );
      const stepKm = UNIT_SPEED_KMH[u.type] * dtHours;
      if (remain / 1000 <= stepKm) {
        u.lat = u.target.lat;
        u.lon = u.target.lon;
        u.target = null;
        continue;
      }
      const bearing = initialBearing(
        { lat: u.lat, lon: u.lon, height: 0 },
        { lat: u.target.lat, lon: u.target.lon, height: 0 },
      );
      u.heading = bearing;
      const next = destination(u.lat, u.lon, bearing, stepKm);
      u.lat = next.lat;
      u.lon = next.lon;
    }
    return any;
  }

  /** Zustand zum Speichern. */
  toJSON(): { units: Unit[]; nextId: number } {
    return { units: this.units, nextId: this.nextId };
  }

  /** Zustand laden (ungültige Einträge werden übergangen). */
  load(data: unknown): void {
    this.map.clear();
    const d = data as { units?: unknown; nextId?: unknown } | null;
    const list = Array.isArray(d?.units) ? (d.units as Partial<Unit>[]) : [];
    for (const u of list) {
      if (
        !u ||
        typeof u.id !== 'number' ||
        !UNIT_TYPES.includes(u.type as UnitType) ||
        typeof u.lat !== 'number' ||
        typeof u.lon !== 'number'
      ) {
        continue;
      }
      this.map.set(u.id, {
        id: u.id,
        type: u.type as UnitType,
        owner: typeof u.owner === 'string' ? u.owner : null,
        lat: u.lat,
        lon: u.lon,
        target:
          u.target && typeof u.target.lat === 'number' && typeof u.target.lon === 'number'
            ? { lat: u.target.lat, lon: u.target.lon }
            : null,
        strength: typeof u.strength === 'number' ? u.strength : UNIT_STRENGTH[u.type as UnitType],
        heading: typeof u.heading === 'number' ? u.heading : 0,
      });
    }
    const maxId = Math.max(0, ...this.map.keys());
    this.nextId = Math.max(maxId + 1, typeof d?.nextId === 'number' ? d.nextId : 1);
    this.onChange?.();
  }
}
