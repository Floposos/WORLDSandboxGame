/**
 * Länder aus Natural Earth 1:10 Mio. (gemeinfrei, ADR-026): Flächen für „In welchem Land liegt
 * der Punkt?“, Landgrenzen zum Zeichnen. Daten aus `public/data/countries.json`
 * (`scripts/build-countries.mjs`), auf ≈ 500 m vereinfacht.
 */

/** Datei, wie sie das Build-Skript schreibt. */
export interface CountriesFile {
  version: string;
  source: string;
  /** Ganzzahlige Koordinaten pro Grad. */
  scale: number;
  countries: {
    id: string;
    iso2: string | null;
    de: string;
    en: string;
    color: number;
    pop: number;
    label: [number, number];
    bbox: [number, number, number, number];
    /** Delta-kodierte Ringe [lon0, lat0, dlon, dlat, …]. */
    rings: number[][];
  }[];
  /** Delta-kodierte Landgrenzen. */
  borders: number[][];
}

export interface Country {
  /** Laufende Nummer ab 1 (0 = kein Land), auch Index in der Länder-ID-Textur. */
  index: number;
  /** ADM0_A3 von Natural Earth, z. B. `DEU`. */
  id: string;
  iso2: string | null;
  name: { de: string; en: string };
  /** Natural-Earth-Farbklasse 1…9: Nachbarn haben verschiedene Klassen. */
  colorClass: number;
  population: number;
  /** Punkt für die Beschriftung (lon, lat). */
  label: { lon: number; lat: number };
  /** [West, Süd, Ost, Nord] in Grad. */
  bbox: [number, number, number, number];
  /** Ringe als [lon, lat, lon, lat, …] in Grad (geschlossen: letzter = erster Punkt). */
  rings: Float64Array[];
  /** Grobe Fläche in km² (sphärisch, aus den Ringen). */
  areaKm2: number;
}

/** Delta-kodierte Ganzzahlen → Grad. */
export function decodeLine(enc: readonly number[], scale: number): Float64Array {
  const out = new Float64Array(enc.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < enc.length; i += 2) {
    x += enc[i]!;
    y += enc[i + 1]!;
    out[i] = x / scale;
    out[i + 1] = y / scale;
  }
  return out;
}

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

/**
 * Fläche eines Landes aus seinen Ringen: Ein Ring, der in einer ungeraden Zahl anderer Ringe
 * liegt, ist ein Loch (Enklave wie Lesotho in Südafrika) und wird abgezogen.
 */
export function areaWithHolesKm2(rings: readonly Float64Array[]): number {
  const boxes = rings.map((r) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]!);
      x1 = Math.max(x1, r[i]!);
      y0 = Math.min(y0, r[i + 1]!);
      y1 = Math.max(y1, r[i + 1]!);
    }
    return [x0, y0, x1, y1] as const;
  });
  let area = 0;
  rings.forEach((r, i) => {
    const lon = r[0]!;
    const lat = r[1]!;
    let depth = 0;
    rings.forEach((o, j) => {
      const b = boxes[j]!;
      if (j === i || lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return;
      if (inRing(o, lon, lat)) depth++;
    });
    area += (depth % 2 ? -1 : 1) * ringAreaKm2(r);
  });
  return area;
}

/** Fläche eines Rings auf der Kugel (km², ohne Vorzeichen). */
export function ringAreaKm2(ring: Float64Array): number {
  let sum = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lon1 = ring[2 * i]! * RAD;
    const lat1 = ring[2 * i + 1]! * RAD;
    const lon2 = ring[2 * j]! * RAD;
    const lat2 = ring[2 * j + 1]! * RAD;
    sum += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((sum * R_KM * R_KM) / 2);
}

/** Gerade-ungerade-Test eines Punkts gegen einen Ring (lon/lat als Ebene). */
export function inRing(ring: Float64Array, lon: number, lat: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i]!;
    const yi = ring[2 * i + 1]!;
    const xj = ring[2 * j]!;
    const yj = ring[2 * j + 1]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Rasterzelle des Suchgitters in Grad. */
const CELL_DEG = 2;
const GRID_W = 360 / CELL_DEG;
const GRID_H = 180 / CELL_DEG;

export class CountryIndex {
  readonly countries: Country[];
  /** Landgrenzen als [lon, lat, …] in Grad. */
  readonly borders: Float64Array[];
  readonly byId = new Map<string, Country>();
  readonly source: string;
  /** Je Gitterzelle die Länder, deren Ring-Rechtecke sie berühren. */
  private readonly grid: Country[][] = Array.from({ length: GRID_W * GRID_H }, () => []);

  constructor(file: CountriesFile) {
    this.source = file.source;
    this.countries = file.countries.map((c, i) => {
      const rings = c.rings.map((r) => {
        const open = decodeLine(r, file.scale);
        // Ringe schließen, damit Umrisse lückenlos gezeichnet werden
        const n = open.length;
        if (n >= 4 && (open[0] !== open[n - 2] || open[1] !== open[n - 1])) {
          const closed = new Float64Array(n + 2);
          closed.set(open);
          closed[n] = open[0]!;
          closed[n + 1] = open[1]!;
          return closed;
        }
        return open;
      });
      const areaKm2 = areaWithHolesKm2(rings);
      return {
        index: i + 1,
        id: c.id,
        iso2: c.iso2,
        name: { de: c.de, en: c.en },
        colorClass: c.color,
        population: c.pop,
        label: { lon: c.label[0], lat: c.label[1] },
        bbox: c.bbox,
        rings,
        areaKm2,
      };
    });
    this.borders = file.borders.map((b) => decodeLine(b, file.scale));
    for (const c of this.countries) {
      this.byId.set(c.id, c);
      const seen = new Set<number>();
      for (const r of c.rings) {
        let w = 180;
        let s = 90;
        let e = -180;
        let n = -90;
        for (let i = 0; i < r.length; i += 2) {
          w = Math.min(w, r[i]!);
          e = Math.max(e, r[i]!);
          s = Math.min(s, r[i + 1]!);
          n = Math.max(n, r[i + 1]!);
        }
        for (let gy = cellY(s); gy <= cellY(n); gy++) {
          for (let gx = cellX(w); gx <= cellX(e); gx++) {
            const k = gy * GRID_W + gx;
            if (seen.has(k)) continue;
            seen.add(k);
            this.grid[k]!.push(c);
          }
        }
      }
    }
  }

  /** Land am Punkt oder null (Meer, Antarktis-Lücken). */
  countryAt(lat: number, lon: number): Country | null {
    const cell = this.grid[cellY(lat) * GRID_W + cellX(lon)];
    if (!cell) return null;
    for (const c of cell) {
      const [w, s, e, n] = c.bbox;
      if (lon < w || lon > e || lat < s || lat > n) continue;
      let inside = false;
      for (const r of c.rings) if (inRing(r, lon, lat)) inside = !inside;
      if (inside) return c;
    }
    return null;
  }

  byIndex(index: number): Country | null {
    return this.countries[index - 1] ?? null;
  }
}

const cellX = (lon: number): number =>
  Math.min(GRID_W - 1, Math.max(0, Math.floor((lon + 180) / CELL_DEG)));
const cellY = (lat: number): number =>
  Math.min(GRID_H - 1, Math.max(0, Math.floor((lat + 90) / CELL_DEG)));

/**
 * Länder-ID-Karte in Plattkarten-Projektion (Pixelmitte), ein Byte je Pixel (Index, 0 = kein
 * Land), Zeile 0 = Süden. Scanline-Füllung mit gerade-ungerade-Regel je Land; so bleibt jede
 * Kante scharf (kein Antialiasing, das Indizes mischen würde).
 */
export function rasterizeCountries(
  countries: readonly Country[],
  width: number,
  height: number,
): Uint8Array {
  if (countries.length > 255) throw new Error('Mehr als 255 Länder passen nicht in ein Byte');
  const out = new Uint8Array(width * height);
  // Kanten je Zeile einsortieren
  const rows: number[][] = Array.from({ length: height }, () => []);
  const dy = 180 / height;
  for (const c of countries) {
    for (const r of c.rings) {
      const n = r.length / 2;
      for (let i = 0; i < n - 1; i++) {
        const x0 = r[2 * i]!;
        const y0 = r[2 * i + 1]!;
        const x1 = r[2 * i + 2]!;
        const y1 = r[2 * i + 3]!;
        if (y0 === y1) continue;
        const lo = Math.min(y0, y1);
        const hi = Math.max(y0, y1);
        // Zeilen, deren Mitte im halboffenen Intervall [lo, hi) liegt
        const first = Math.max(0, Math.ceil((lo + 90) / dy - 0.5));
        const last = Math.min(height - 1, Math.ceil((hi + 90) / dy - 0.5) - 1);
        for (let row = first; row <= last; row++) {
          const lat = -90 + (row + 0.5) * dy;
          const x = x0 + ((lat - y0) * (x1 - x0)) / (y1 - y0);
          rows[row]!.push(x, c.index);
        }
      }
    }
  }
  const parity = new Uint8Array(256);
  const dx = 360 / width;
  for (let row = 0; row < height; row++) {
    const list = rows[row]!;
    const m = list.length / 2;
    if (!m) continue;
    const order = Array.from({ length: m }, (_, i) => i).sort(
      (a, b) => list[2 * a]! - list[2 * b]!,
    );
    const active: number[] = [];
    for (let k = 0; k < m; k++) {
      const i = order[k]!;
      const id = list[2 * i + 1]!;
      parity[id] = parity[id] ? 0 : 1;
      if (parity[id]) active.push(id);
      else active.splice(active.lastIndexOf(id), 1);
      const top = active[active.length - 1];
      if (!top || k + 1 >= m) continue;
      const xa = list[2 * i]!;
      const xb = list[2 * order[k + 1]!]!;
      const p0 = Math.max(0, Math.ceil((xa + 180) / dx - 0.5));
      const p1 = Math.min(width - 1, Math.ceil((xb + 180) / dx - 0.5) - 1);
      if (p1 >= p0) out.fill(top, row * width + p0, row * width + p1 + 1);
    }
    for (const id of active) parity[id] = 0;
  }
  return out;
}

/** Lädt die Länderdaten (einmal, gemeinsam für alle Nutzer). */
let pending: Promise<CountryIndex> | null = null;
export function loadCountries(fetchImpl: typeof fetch = fetch): Promise<CountryIndex> {
  pending ??= fetchImpl(`${import.meta.env.BASE_URL}data/countries.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`countries.json: HTTP ${res.status}`);
      return res.json() as Promise<CountriesFile>;
    })
    .then((file) => new CountryIndex(file))
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}
