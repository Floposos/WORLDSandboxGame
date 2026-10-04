import { fetchJson, isAbortError, RateLimiter, type FetchLike } from '../../core/net';
import type { Bounds } from './geohash';
import { buildingColours, buildingHeights, type Tags } from './heights';

/**
 * Overpass-Endpunkte (Spec 5.4): Hauptinstanz zuerst, danach Mirrors. Fällt einer aus, wird der
 * nächste versucht.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

/** Ein Polygon: Außenring und Löcher, jeweils als flache Liste [lon, lat, lon, lat, …], offen. */
export interface Polygon {
  outer: number[];
  holes: number[][];
}

/** Ein Gebäude bzw. Gebäudeteil, fertig für die Extrusion. */
export interface Footprint {
  /** OSM-ID; Relationen negativ, damit Ways und Relationen nicht kollidieren. */
  id: number;
  polygons: Polygon[];
  height: number;
  minHeight: number;
  wallColour: number;
  roofColour: number;
  /** `building:part` (ersetzt den Umriss, in dem er liegt). */
  part: boolean;
  /** Schwerpunkt (Grad), für die Zuordnung zu Cache-Zellen. */
  lat: number;
  lon: number;
  /** Grundfläche in m². */
  areaM2: number;
}

/**
 * Overpass-Abfrage für ein Rechteck. Abweichung von Spec 5.4 (`around`): Rechteck der
 * Cache-Zellen, damit jede Zelle unabhängig gecacht werden kann (ADR-019). `out geom` statt
 * `out geom tags`, weil `tags` bei Relationen die Mitglieder samt Geometrie weglässt.
 */
export function buildQuery(b: Bounds, timeoutS = 25): string {
  const bbox = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(6)).join(',');
  return (
    `[out:json][timeout:${timeoutS}];(` +
    `way["building"](${bbox});relation["building"](${bbox});` +
    `way["building:part"](${bbox});relation["building:part"](${bbox});` +
    `);out geom;`
  );
}

interface OsmLatLon {
  lat: number;
  lon: number;
}

interface OsmMember {
  type: string;
  role: string;
  geometry?: (OsmLatLon | null)[];
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: (OsmLatLon | null)[];
  members?: OsmMember[];
}

export interface OverpassResponse {
  elements: OsmElement[];
}

const M_PER_DEG = 111_320;

/** Fläche (m², vorzeichenbehaftet: positiv = gegen den Uhrzeigersinn) eines offenen Rings. */
export function ringArea(ring: readonly number[], refLat: number): number {
  const kx = M_PER_DEG * Math.cos((refLat * Math.PI) / 180);
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2]! * kx * ring[j * 2 + 1]! * M_PER_DEG;
    a -= ring[j * 2]! * kx * ring[i * 2 + 1]! * M_PER_DEG;
  }
  return a / 2;
}

/** Punkt-in-Polygon (Strahlverfahren) für einen offenen Ring [lon, lat, …]. */
export function pointInRing(lon: number, lat: number, ring: readonly number[]): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!;
    const yi = ring[i * 2 + 1]!;
    const xj = ring[j * 2]!;
    const yj = ring[j * 2 + 1]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Wandelt eine Overpass-Geometrie in einen offenen Ring; null, wenn unvollständig/zu klein. */
function toRing(geom: readonly (OsmLatLon | null)[] | undefined): number[] | null {
  if (!geom || geom.length < 4) return null;
  const ring: number[] = [];
  for (const p of geom) {
    if (!p) return null; // Knoten außerhalb der Abfrage
    ring.push(p.lon, p.lat);
  }
  const n = ring.length;
  if (ring[0] !== ring[n - 2] || ring[1] !== ring[n - 1]) return null; // nicht geschlossen
  ring.length = n - 2;
  return ring.length >= 6 ? ring : null;
}

/** Fügt Mitglieder-Ways zu geschlossenen Ringen zusammen (Multipolygon). */
export function assembleRings(ways: readonly (readonly (OsmLatLon | null)[])[]): number[][] {
  const open: OsmLatLon[][] = [];
  for (const w of ways) {
    if (w.length < 2 || w.some((p) => !p)) continue;
    open.push([...(w as OsmLatLon[])]);
  }
  const same = (a: OsmLatLon, b: OsmLatLon): boolean => a.lat === b.lat && a.lon === b.lon;
  const rings: number[][] = [];
  while (open.length > 0) {
    let cur = open.pop()!;
    let grown = true;
    while (!same(cur[0]!, cur[cur.length - 1]!) && grown) {
      grown = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i]!;
        const end = cur[cur.length - 1]!;
        if (same(end, w[0]!)) cur = cur.concat(w.slice(1));
        else if (same(end, w[w.length - 1]!)) cur = cur.concat([...w].reverse().slice(1));
        else continue;
        open.splice(i, 1);
        grown = true;
        break;
      }
    }
    const ring = toRing(cur);
    if (ring) rings.push(ring);
  }
  return rings;
}

function centroidOf(ring: readonly number[]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    lon += ring[i * 2]!;
    lat += ring[i * 2 + 1]!;
  }
  return { lat: lat / n, lon: lon / n };
}

/** Ab diesem Anteil, den Gebäudeteile abdecken, wird der Umriss nicht gezeichnet. */
export const PART_COVERAGE_TO_HIDE_OUTLINE = 0.5;
/** Kleinere Flächen (m²) sind Datenfehler oder Kleinstobjekte. */
const MIN_AREA_M2 = 2;

/** Teile, die nur Innenräume oder Türen beschreiben, werden nicht extrudiert. */
const NON_VOLUME_PARTS = new Set(['door', 'entrance', 'window', 'room', 'corridor', 'balcony']);

function isBuilding(tags: Tags | undefined): boolean {
  if (!tags) return false;
  if (tags.indoor !== undefined || tags.location === 'underground') return false;
  if (NON_VOLUME_PARTS.has(tags['building:part'] ?? '')) return false;
  const b = tags.building;
  const p = tags['building:part'];
  return (b !== undefined && b !== 'no') || (p !== undefined && p !== 'no');
}

/**
 * Parser für Overpass-JSON (`out geom`): Ways und Multipolygon-Relationen mit `building` oder
 * `building:part`. Umrisse, die zu mindestens {@link PART_COVERAGE_TO_HIDE_OUTLINE} von Teilen
 * abgedeckt sind, entfallen (die Teile tragen dann die Form, Spec 5.4).
 */
export function parseOverpass(json: OverpassResponse): Footprint[] {
  const all: Footprint[] = [];
  const seen = new Set<number>();
  for (const el of json.elements ?? []) {
    if (!isBuilding(el.tags)) continue;
    const tags = el.tags!;
    let polygons: Polygon[] = [];
    if (el.type === 'way') {
      const ring = toRing(el.geometry);
      if (ring) polygons = [{ outer: ring, holes: [] }];
    } else if (el.type === 'relation' && el.members) {
      const outers = assembleRings(
        el.members
          .filter((m) => m.type === 'way' && m.role !== 'inner')
          .map((m) => m.geometry ?? []),
      );
      const inners = assembleRings(
        el.members
          .filter((m) => m.type === 'way' && m.role === 'inner')
          .map((m) => m.geometry ?? []),
      );
      polygons = outers.map((outer) => ({ outer, holes: [] }));
      for (const hole of inners) {
        const owner = polygons.find((p) => pointInRing(hole[0]!, hole[1]!, p.outer));
        owner?.holes.push(hole);
      }
    }
    if (polygons.length === 0) continue;
    const id = el.type === 'relation' ? -el.id : el.id;
    if (seen.has(id)) continue;
    seen.add(id);

    const c = centroidOf(polygons[0]!.outer);
    let area = 0;
    for (const p of polygons) {
      // Außenring gegen den Uhrzeigersinn, Löcher im Uhrzeigersinn (für Normalen der Wände)
      if (ringArea(p.outer, c.lat) < 0) reverseRing(p.outer);
      for (const h of p.holes) if (ringArea(h, c.lat) > 0) reverseRing(h);
      area += ringArea(p.outer, c.lat) + p.holes.reduce((s, h) => s + ringArea(h, c.lat), 0);
    }
    if (area < MIN_AREA_M2) continue;
    const { height, minHeight } = buildingHeights(tags);
    const colours = buildingColours(tags, el.id);
    all.push({
      id,
      polygons,
      height,
      minHeight,
      wallColour: colours.wall,
      roofColour: colours.roof,
      part: tags['building:part'] !== undefined && tags['building:part'] !== 'no',
      lat: c.lat,
      lon: c.lon,
      areaM2: area,
    });
  }
  return hideOutlinesWithParts(all);
}

function reverseRing(ring: number[]): void {
  const n = ring.length / 2;
  for (let i = 0; i < n / 2; i++) {
    const j = n - 1 - i;
    const lon = ring[i * 2]!;
    const lat = ring[i * 2 + 1]!;
    ring[i * 2] = ring[j * 2]!;
    ring[i * 2 + 1] = ring[j * 2 + 1]!;
    ring[j * 2] = lon;
    ring[j * 2 + 1] = lat;
  }
}

interface Box {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function boxOf(f: Footprint): Box {
  const b: Box = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const p of f.polygons) {
    for (let i = 0; i < p.outer.length; i += 2) {
      b.minLon = Math.min(b.minLon, p.outer[i]!);
      b.maxLon = Math.max(b.maxLon, p.outer[i]!);
      b.minLat = Math.min(b.minLat, p.outer[i + 1]!);
      b.maxLat = Math.max(b.maxLat, p.outer[i + 1]!);
    }
  }
  return b;
}

/** Entfernt Umrisse, deren Fläche überwiegend von Gebäudeteilen abgedeckt ist. */
export function hideOutlinesWithParts(list: Footprint[]): Footprint[] {
  const parts = list.filter((f) => f.part);
  if (parts.length === 0) return list;
  const partBoxes = parts.map((p) => ({ p, lon: p.lon, lat: p.lat }));
  return list.filter((f) => {
    if (f.part) return true;
    const b = boxOf(f);
    let covered = 0;
    for (const { p, lon, lat } of partBoxes) {
      if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
      if (f.polygons.some((poly) => pointInRing(lon, lat, poly.outer))) covered += p.areaM2;
    }
    return covered < PART_COVERAGE_TO_HIDE_OUTLINE * f.areaM2;
  });
}

export interface OverpassClientOptions {
  endpoints?: readonly string[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Overpass-Client: höchstens eine Anfrage pro Sekunde (Nutzungsregeln), Timeout und Retry pro
 * Endpunkt, danach der nächste Mirror.
 */
export class OverpassClient {
  private readonly limiter = new RateLimiter(1_000);
  private readonly endpoints: readonly string[];
  private preferred = 0;

  constructor(private readonly opts: OverpassClientOptions = {}) {
    this.endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  }

  async fetchBuildings(bounds: Bounds, signal?: AbortSignal): Promise<Footprint[]> {
    const query = buildQuery(bounds);
    let lastError: unknown = new Error('kein Overpass-Endpunkt konfiguriert');
    for (let k = 0; k < this.endpoints.length; k++) {
      const idx = (this.preferred + k) % this.endpoints.length;
      const url = `${this.endpoints[idx]}?data=${encodeURIComponent(query)}`;
      try {
        const json = await this.limiter.schedule(() =>
          fetchJson<OverpassResponse>(url, {
            timeoutMs: this.opts.timeoutMs ?? 30_000,
            attempts: 2,
            baseDelayMs: 1_000,
            ...(signal ? { signal } : {}),
            ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
          }),
        );
        this.preferred = idx;
        return parseOverpass(json);
      } catch (e) {
        if (isAbortError(e)) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }
}
