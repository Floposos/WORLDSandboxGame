/** Ortssuche: Photon zuerst, Nominatim als Fallback. Keine Query-Logs. */
import { fetchJson, isAbortError, RateLimiter } from '../core/net';
import type { FetchLike, SleepFn } from '../core/net';

export const SEARCH_DEBOUNCE_MS = 400;

export interface GeocodeResult {
  name: string;
  label: string;
  lat: number;
  lon: number;
  kind?: string;
  /** minLon, minLat, maxLon, maxLat */
  extent?: [number, number, number, number];
}

export interface GeoOptions {
  lang?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  sleep?: SleepFn;
  random?: () => number;
  /** Nur für Nominatim; Standard: modulweiter Limiter (1100 ms). */
  limiter?: RateLimiter;
}

const nominatimLimiter = new RateLimiter(1100);

function netOpts(opts: GeoOptions): Parameters<typeof fetchJson>[1] {
  return {
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(opts.random ? { random: opts.random } : {}),
  };
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number {
  return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')
    ? Number(v)
    : Number.NaN;
}

function quad(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  const n = v.map(num);
  return n.every(Number.isFinite) ? n : undefined;
}

function joinLabel(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.trim().toLowerCase();
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    out.push(p.trim());
  }
  return out.join(', ');
}

function parsePhotonFeature(f: unknown): GeocodeResult | null {
  if (!isRec(f) || !isRec(f.geometry) || !isRec(f.properties)) return null;
  const c = f.geometry.coordinates;
  if (!Array.isArray(c)) return null;
  const lon = num(c[0]);
  const lat = num(c[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const p = f.properties;
  const street = [str(p.street), str(p.housenumber)].filter((s) => s !== '').join(' ');
  const name = str(p.name) || street || str(p.city) || str(p.state) || str(p.country);
  const label = joinLabel([str(p.name), street, str(p.city), str(p.state), str(p.country)]);
  const res: GeocodeResult = { name, label: label || name, lat, lon };
  const kind = str(p.osm_value);
  if (kind) res.kind = kind;
  const e = quad(p.extent);
  if (e) {
    // Photon: [minLon, maxLat, maxLon, minLat]
    const [minLon, maxLat, maxLon, minLat] = e as [number, number, number, number];
    res.extent = [minLon, minLat, maxLon, maxLat];
  }
  return res;
}

function parseNominatimItem(it: unknown): GeocodeResult | null {
  if (!isRec(it)) return null;
  const lat = num(it.lat);
  const lon = num(it.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const display = str(it.display_name);
  const name = str(it.name) || display.split(',')[0]?.trim() || '';
  const res: GeocodeResult = { name, label: display || name, lat, lon };
  const kind = str(it.type);
  if (kind) res.kind = kind;
  const b = quad(it.boundingbox);
  if (b) {
    // Nominatim: [minLat, maxLat, minLon, maxLon]
    const [minLat, maxLat, minLon, maxLon] = b as [number, number, number, number];
    res.extent = [minLon, minLat, maxLon, maxLat];
  }
  return res;
}

function photonLang(opts: GeoOptions): string {
  return opts.lang === 'de' || opts.lang === 'en' ? `&lang=${opts.lang}` : '';
}

export async function searchPhoton(q: string, opts: GeoOptions = {}): Promise<GeocodeResult[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5${photonLang(opts)}`;
  const json = await fetchJson<unknown>(url, netOpts(opts));
  if (!isRec(json) || !Array.isArray(json.features)) return [];
  return json.features.map(parsePhotonFeature).filter((r): r is GeocodeResult => r !== null);
}

export async function searchNominatim(q: string, opts: GeoOptions = {}): Promise<GeocodeResult[]> {
  const lang = opts.lang ? `&accept-language=${encodeURIComponent(opts.lang)}` : '';
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}${lang}`;
  const limiter = opts.limiter ?? nominatimLimiter;
  const json = await limiter.schedule(() => fetchJson<unknown>(url, netOpts(opts)));
  if (!Array.isArray(json)) return [];
  return json.map(parseNominatimItem).filter((r): r is GeocodeResult => r !== null);
}

export async function reversePhoton(
  lat: number,
  lon: number,
  opts: GeoOptions = {},
): Promise<GeocodeResult | null> {
  const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}${photonLang(opts)}`;
  const json = await fetchJson<unknown>(url, netOpts(opts));
  if (!isRec(json) || !Array.isArray(json.features)) return null;
  for (const f of json.features) {
    const r = parsePhotonFeature(f);
    if (r) return r;
  }
  return null;
}

const CACHE_MAX = 50;

class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }
}

export class Geocoder {
  private readonly searchCache = new Lru<GeocodeResult[]>(CACHE_MAX);
  private readonly reverseCache = new Lru<GeocodeResult | null>(CACHE_MAX);

  constructor(private readonly base: GeoOptions = {}) {}

  async search(q: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
    const query = q.trim();
    if (query.length < 2) return [];
    const key = query.toLowerCase();
    const hit = this.searchCache.get(key);
    if (hit) return hit;
    const opts: GeoOptions = { ...this.base, ...(signal ? { signal } : {}) };
    let results: GeocodeResult[] = [];
    try {
      results = await searchPhoton(query, opts);
    } catch (e) {
      if (isAbortError(e)) throw e;
    }
    if (results.length === 0) results = await searchNominatim(query, opts);
    this.searchCache.set(key, results);
    return results;
  }

  async reverse(lat: number, lon: number, signal?: AbortSignal): Promise<GeocodeResult | null> {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const cached = this.reverseCache.get(key);
    if (cached !== undefined) return cached;
    const res = await reversePhoton(lat, lon, {
      ...this.base,
      ...(signal ? { signal } : {}),
    });
    this.reverseCache.set(key, res);
    return res;
  }
}
