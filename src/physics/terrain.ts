import { ecefToGeodetic, geodeticToEcef, type LocalFrame } from '../core/geo';
import type { GeoPoint, Vec3 } from '../core/types';

/** Auflösung des Heightfields (Zellen pro Seite, Spec 7.1: z. B. 128 × 128). */
export const HEIGHTFIELD_CELLS = 128;

export interface HeightfieldData {
  /** Zellen pro Seite; Rapier erwartet (n+1)² Höhen. */
  n: number;
  /** Kantenlänge in m (Quadrat um die Mitte cx/cz). */
  size: number;
  /** Mitte im Blasen-Frame (0/0 für das Gelände der ganzen Blase, sonst Detail-Felder). */
  cx: number;
  cz: number;
  /** Höhen spaltenweise: Index = Zeile (z) + Spalte (x) · (n+1). */
  heights: Float32Array;
}

const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };
const _ecef: Vec3 = { x: 0, y: 0, z: 0 };
const _local: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Heightfield-Collider-Daten für die Blase (Spec 7.1): quadratisches Raster mit Kantenlänge
 * 2 × Radius im Frame der Blase (x = Ost, y = Oben, z = −Nord). Die Erdkrümmung steckt in den
 * Höhen (am Rand von 1,5 km ≈ 18 cm). `heightAt` liefert die Geländehöhe (Ellipsoid) oder null.
 * Fehlende Werte werden mit dem Mittel der bekannten aufgefüllt.
 */
export function buildHeightfield(
  frame: LocalFrame,
  radiusM: number,
  heightAt: (lat: number, lon: number) => number | null,
  n = HEIGHTFIELD_CELLS,
  cx = 0,
  cz = 0,
): HeightfieldData {
  const size = radiusM * 2;
  const heights = new Float32Array((n + 1) * (n + 1));
  const known: boolean[] = [];
  let sum = 0;
  let count = 0;
  for (let j = 0; j <= n; j++) {
    const x = cx - radiusM + (size * j) / n;
    for (let i = 0; i <= n; i++) {
      const z = cz - radiusM + (size * i) / n;
      _local.x = x;
      _local.y = 0;
      _local.z = z;
      ecefToGeodetic(frame.localToEcef(_local, _ecef), _geo);
      const h = heightAt(_geo.lat, _geo.lon);
      const idx = i + j * (n + 1);
      if (h === null) {
        known[idx] = false;
        continue;
      }
      _geo.height = h;
      heights[idx] = frame.ecefToLocal(geodeticToEcef(_geo, _ecef), _local).y;
      known[idx] = true;
      sum += heights[idx];
      count++;
    }
  }
  if (count < heights.length) {
    const fill = count > 0 ? sum / count : 0;
    for (let k = 0; k < heights.length; k++) if (!known[k]) heights[k] = fill;
  }
  return { n, size, heights, cx, cz };
}

/** Liegt (x, z) im Feld? */
export function insideHeightfield(hf: HeightfieldData, x: number, z: number): boolean {
  const h = hf.size / 2;
  return Math.abs(x - hf.cx) <= h && Math.abs(z - hf.cz) <= h;
}

/** Rasterweite der Detail-Felder unter Kratern (m). */
export const DETAIL_CELL_M = 0.5;
/** Höchstens so viele Zellen pro Seite eines Detail-Felds. */
export const DETAIL_MAX_CELLS = 192;

/**
 * Detail-Feld für einen Krater (Spec 7.4) und das grobe Feld darunter absenken: Die groben
 * Eckpunkte im Radius `r` + eine Zelle liegen danach unter dem Detail-Feld, das bis `r` + 2,5
 * Zellen reicht und damit jedes abgesenkte Dreieck überdeckt. Liefert das Detail-Feld.
 */
export function addDetail(
  coarse: HeightfieldData,
  frame: LocalFrame,
  heightAt: (lat: number, lon: number) => number | null,
  cx: number,
  cz: number,
  r: number,
): HeightfieldData {
  const cell = coarse.size / coarse.n;
  const half = r + 2.5 * cell;
  const n = Math.min(DETAIL_MAX_CELLS, Math.max(8, Math.ceil((2 * half) / DETAIL_CELL_M)));
  const fine = buildHeightfield(frame, half, heightAt, n, cx, cz);
  let min = Infinity;
  for (const h of fine.heights) min = Math.min(min, h);
  const reach = r + cell;
  const { n: cn, size, heights } = coarse;
  for (let j = 0; j <= cn; j++) {
    const x = coarse.cx - size / 2 + (size * j) / cn;
    for (let i = 0; i <= cn; i++) {
      const z = coarse.cz - size / 2 + (size * i) / cn;
      if (Math.hypot(x - cx, z - cz) > reach) continue;
      const k = i + j * (cn + 1);
      heights[k] = Math.min(heights[k]!, min - 1);
    }
  }
  return fine;
}

/** Höhe des Heightfields an (x, z) im Blasen-Frame (bilinear), für Tests und Spawns. */
export function sampleHeightfield(hf: HeightfieldData, x: number, z: number): number {
  const { n, size, heights } = hf;
  const fx = Math.min(n, Math.max(0, ((x - hf.cx + size / 2) / size) * n));
  const fz = Math.min(n, Math.max(0, ((z - hf.cz + size / 2) / size) * n));
  const j = Math.min(n - 1, Math.floor(fx));
  const i = Math.min(n - 1, Math.floor(fz));
  const tx = fx - j;
  const tz = fz - i;
  const h = (ii: number, jj: number): number => heights[ii + jj * (n + 1)]!;
  const a = h(i, j) + (h(i, j + 1) - h(i, j)) * tx;
  const b = h(i + 1, j) + (h(i + 1, j + 1) - h(i + 1, j)) * tx;
  return a + (b - a) * tz;
}
