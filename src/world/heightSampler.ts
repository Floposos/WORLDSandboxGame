/**
 * Höhen-Sampler auf Basis der AWS Terrain Tiles (Terrarium-Kodierung, WebMercator-XYZ).
 * Synchrones sample() liest aus einem LRU-Cache und fordert fehlende Kacheln im Hintergrund an.
 */
import { HttpError } from '../core/net';
import { toRad } from '../core/geo';
import { TERRARIUM_URL } from './providers/OpenDataProvider';

/** 256*256 Höhen in m, zeilenweise, Zeile 0 = Nordrand. */
export type HeightTileLoader = (
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
) => Promise<Float32Array>;

export interface HeightSamplerOptions {
  /** Zoomstufe der Höhenkacheln (Standard 14). */
  zoom?: number;
  /** Maximale Zahl gecachter Kacheln (LRU, Standard 64). */
  maxTiles?: number;
  /** Kachel-Lader (Standard: terrariumLoader). */
  loader?: HeightTileLoader;
}

const TILE = 256;
const MAX_LAT = 85.05112878;
/** Nach einem Fehlschlag wird eine Kachel mindestens so lange nicht erneut angefragt. */
const FAIL_BACKOFF_MS = 5000;
const METERS_PER_DEG_LAT = 111_320;

/** RGBA (Terrarium) → Höhen in m: (R*256 + G + B/256) − 32768. */
export function decodeTerrarium(
  rgba: Uint8ClampedArray | Uint8Array,
  out?: Float32Array,
): Float32Array {
  const count = Math.floor(rgba.length / 4);
  const heights = out ?? new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    heights[i] = (rgba[o] ?? 0) * 256 + (rgba[o + 1] ?? 0) + (rgba[o + 2] ?? 0) / 256 - 32768;
  }
  return heights;
}

function clampLat(lat: number): number {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

/** Globale Pixel-X-Koordinate (Kachelgröße 256); nicht umgebrochen. */
function globalPx(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** zoom;
}

/** Globale Pixel-Y-Koordinate (Kachelgröße 256), Breite wird auf WebMercator-Grenzen geklemmt. */
function globalPy(lat: number, zoom: number): number {
  const phi = toRad(clampLat(lat));
  const merc = Math.log(Math.tan(phi) + 1 / Math.cos(phi));
  return ((1 - merc / Math.PI) / 2) * TILE * 2 ** zoom;
}

/** WebMercator-Hilfsfunktion: Grad → globale Pixelkoordinaten (Kachelgröße 256). */
export function lonLatToGlobalPixel(
  lat: number,
  lon: number,
  zoom: number,
): { px: number; py: number } {
  return { px: globalPx(lon, zoom), py: globalPy(lat, zoom) };
}

interface Failure {
  at: number;
  error: unknown;
}

interface InFlight {
  promise: Promise<Float32Array>;
  ctrl: AbortController;
}

export class HeightSampler {
  readonly zoom: number;
  private readonly maxTiles: number;
  private readonly loader: HeightTileLoader;
  private readonly tilesPerSide: number;
  private readonly pixelsPerSide: number;
  /** Cache: Schlüssel → Höhen; Map-Einfügereihenfolge = LRU-Reihenfolge (ältester zuerst). */
  private readonly cache = new Map<number, Float32Array>();
  private readonly inflight = new Map<number, InFlight>();
  private readonly failures = new Map<number, Failure>();
  /** Scratch: wird von pixel() gesetzt, wenn eine benötigte Kachel fehlt (vermeidet Allokationen). */
  private missing = false;

  constructor(options: HeightSamplerOptions = {}) {
    this.zoom = options.zoom ?? 14;
    this.maxTiles = Math.max(1, options.maxTiles ?? 64);
    this.loader = options.loader ?? terrariumLoader;
    this.tilesPerSide = 2 ** this.zoom;
    this.pixelsPerSide = this.tilesPerSide * TILE;
  }

  get cachedTiles(): number {
    return this.cache.size;
  }

  clear(): void {
    for (const f of this.inflight.values()) f.ctrl.abort();
    this.inflight.clear();
    this.cache.clear();
    this.failures.clear();
  }

  /** Synchron: bilineare Höhe in m oder null, falls eine benötigte Kachel noch fehlt. */
  sample(lat: number, lon: number): number | null {
    const px = globalPx(lon, this.zoom) - 0.5;
    const py = globalPy(lat, this.zoom) - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    this.missing = false;
    const h00 = this.pixel(x0, y0);
    const h10 = this.pixel(x0 + 1, y0);
    const h01 = this.pixel(x0, y0 + 1);
    const h11 = this.pixel(x0 + 1, y0 + 1);
    if (this.missing) return null;
    const top = h00 + (h10 - h00) * fx;
    const bottom = h01 + (h11 - h01) * fx;
    return top + (bottom - top) * fy;
  }

  /** Asynchron: wartet auf die benötigten Kacheln und liefert dann die Höhe. */
  async sampleAsync(lat: number, lon: number, signal?: AbortSignal): Promise<number> {
    // Mehrere Versuche, falls bei sehr kleinem maxTiles eine Kachel zwischendurch verdrängt wurde.
    for (let attempt = 0; attempt < 3; attempt++) {
      throwIfAborted(signal);
      const h = this.sample(lat, lon);
      if (h !== null) return h;
      const px = globalPx(lon, this.zoom) - 0.5;
      const py = globalPy(lat, this.zoom) - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      await this.loadRange(x0, y0, x0 + 1, y0 + 1, signal);
    }
    const h = this.sample(lat, lon);
    if (h === null) throw new Error('Höhenkachel konnte nicht im Cache gehalten werden');
    return h;
  }

  /** Lädt alle Kacheln, die einen Kreis mit Radius radiusM um lat/lon überdecken. */
  async prefetch(lat: number, lon: number, radiusM: number, signal?: AbortSignal): Promise<void> {
    const dLat = radiusM / METERS_PER_DEG_LAT;
    const cosLat = Math.max(0.01, Math.cos(toRad(clampLat(lat))));
    const dLon = radiusM / (METERS_PER_DEG_LAT * cosLat);
    // Nordrand hat kleineres py
    const xMin = Math.floor(globalPx(lon - dLon, this.zoom));
    const xMax = Math.floor(globalPx(lon + dLon, this.zoom));
    const yMin = Math.floor(globalPy(lat + dLat, this.zoom));
    const yMax = Math.floor(globalPy(lat - dLat, this.zoom));
    await this.loadRange(xMin, yMin, xMax, yMax, signal);
  }

  /** Lädt alle Kacheln, die die globalen Pixelbereiche [x0,x1] × [y0,y1] berühren. */
  private async loadRange(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const n = this.tilesPerSide;
    const txMin = Math.floor(x0 / TILE);
    const txMax = Math.min(Math.floor(x1 / TILE), txMin + n - 1);
    const tyMin = Math.max(0, Math.floor(y0 / TILE));
    const tyMax = Math.min(n - 1, Math.floor(y1 / TILE));
    const jobs: Promise<Float32Array>[] = [];
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        jobs.push(this.ensure(((tx % n) + n) % n, ty, true));
      }
    }
    await withSignal(Promise.all(jobs), signal);
  }

  /** Höhe des Pixels (globale Koordinaten; x umbrechen, y klemmen); NaN + missing, falls Kachel fehlt. */
  private pixel(xi: number, yi: number): number {
    const w = this.pixelsPerSide;
    const x = ((xi % w) + w) % w;
    const y = yi < 0 ? 0 : yi >= w ? w - 1 : yi;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const key = ty * this.tilesPerSide + tx;
    const tile = this.cache.get(key);
    if (tile === undefined) {
      this.missing = true;
      this.request(key, tx, ty);
      return NaN;
    }
    // LRU auffrischen: ans Ende der Einfügereihenfolge verschieben
    this.cache.delete(key);
    this.cache.set(key, tile);
    return tile[(y - ty * TILE) * TILE + (x - tx * TILE)] ?? NaN;
  }

  /** Hintergrundanforderung aus sample(): dedupliziert, mit Fehler-Backoff, ohne unbehandelte Rejections. */
  private request(key: number, tx: number, ty: number): void {
    if (this.inflight.has(key)) return;
    const failure = this.failures.get(key);
    if (failure && Date.now() - failure.at < FAIL_BACKOFF_MS) return;
    this.ensure(tx, ty, false).catch(() => undefined);
  }

  /**
   * Liefert die Kachel (Cache, laufende Anfrage oder neue Anfrage). Mit respectBackoff
   * werden Anfragen im Fehler-Backoff direkt mit dem alten Fehler abgelehnt.
   */
  private ensure(tx: number, ty: number, rejectInBackoff: boolean): Promise<Float32Array> {
    const key = ty * this.tilesPerSide + tx;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running) return running.promise;
    const failure = this.failures.get(key);
    if (failure && Date.now() - failure.at < FAIL_BACKOFF_MS) {
      if (rejectInBackoff) return Promise.reject(asError(failure.error));
    }
    const ctrl = new AbortController();
    const entry: InFlight = {
      ctrl,
      promise: Promise.resolve().then(() => this.loader(this.zoom, tx, ty, ctrl.signal)),
    };
    this.inflight.set(key, entry);
    entry.promise = entry.promise.then(
      (heights) => {
        if (this.inflight.get(key) === entry) {
          this.inflight.delete(key);
          this.failures.delete(key);
          this.store(key, heights);
        }
        return heights;
      },
      (error: unknown) => {
        if (this.inflight.get(key) === entry) {
          this.inflight.delete(key);
          this.failures.set(key, { at: Date.now(), error });
        }
        throw error;
      },
    );
    return entry.promise;
  }

  private store(key: number, heights: Float32Array): void {
    this.cache.delete(key);
    this.cache.set(key, heights);
    while (this.cache.size > this.maxTiles) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Wartet auf das Promise, bricht aber für diesen Aufrufer bei Abbruch ab (geteilte Ladevorgänge laufen weiter). */
function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(asError(e));
      },
    );
  });
}

/** Standard-Lader (nur Browser): PNG laden → ImageBitmap → OffscreenCanvas → Terrarium dekodieren. */
export const terrariumLoader: HeightTileLoader = async (z, x, y, signal) => {
  const url = TERRARIUM_URL.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new HttpError(res.status, url);
  const bitmap = await createImageBitmap(await res.blob());
  try {
    const canvas = new OffscreenCanvas(TILE, TILE);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D-Kontext nicht verfügbar');
    ctx.drawImage(bitmap, 0, 0, TILE, TILE);
    return decodeTerrarium(ctx.getImageData(0, 0, TILE, TILE).data);
  } finally {
    bitmap.close();
  }
};
