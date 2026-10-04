import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HeightSampler,
  decodeTerrarium,
  lonLatToGlobalPixel,
  type HeightTileLoader,
} from '../../src/world/heightSampler';

const Z = 2;
const N = 256 * 2 ** Z;

/** Höhe als bekannte Funktion der globalen Pixelkoordinaten. */
const f = (px: number, py: number): number => px * 0.5 + py * 0.25;

function makeLoader(): { loader: HeightTileLoader; calls: [number, number, number][] } {
  const calls: [number, number, number][] = [];
  const loader: HeightTileLoader = (z, x, y) => {
    calls.push([z, x, y]);
    const h = new Float32Array(256 * 256);
    for (let r = 0; r < 256; r++) {
      for (let c = 0; c < 256; c++) h[r * 256 + c] = f(x * 256 + c, y * 256 + r);
    }
    return Promise.resolve(h);
  };
  return { loader, calls };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Mittelpunkt (Grad) eines Pixels in globalen Koordinaten, inverse WebMercator. */
function pixelToLonLat(px: number, py: number): { lat: number; lon: number } {
  const lon = (px / N) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / N))) * 180) / Math.PI;
  return { lat, lon };
}

/** Punkt in der Mitte der Kachel (tx, ty). */
const tileCentre = (tx: number, ty: number): { lat: number; lon: number } =>
  pixelToLonLat(tx * 256 + 128, ty * 256 + 128);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decodeTerrarium', () => {
  it('dekodiert 128,0,0 zu 0 m', () => {
    expect(decodeTerrarium(new Uint8Array([128, 0, 0, 255]))[0]).toBe(0);
  });

  it('dekodiert bekannte Werte', () => {
    const out = decodeTerrarium(new Uint8ClampedArray([129, 2, 128, 255, 0, 0, 0, 255]));
    expect(out[0]).toBeCloseTo(258.5, 5);
    expect(out[1]).toBe(-32768);
  });

  it('schreibt in den übergebenen Puffer', () => {
    const buf = new Float32Array(1);
    expect(decodeTerrarium(new Uint8Array([128, 1, 0, 255]), buf)).toBe(buf);
    expect(buf[0]).toBe(1);
  });
});

describe('lonLatToGlobalPixel', () => {
  it('liefert bei Zoom 0 für (0,0) die Mitte', () => {
    const { px, py } = lonLatToGlobalPixel(0, 0, 0);
    expect(px).toBeCloseTo(128, 9);
    expect(py).toBeCloseTo(128, 9);
  });

  it('liefert Eckwerte', () => {
    const nw = lonLatToGlobalPixel(85.05112878, -180, 3);
    expect(nw.px).toBeCloseTo(0, 6);
    expect(nw.py).toBeCloseTo(0, 3);
    const se = lonLatToGlobalPixel(-85.05112878, 180, 3);
    expect(se.px).toBeCloseTo(2048, 6);
    expect(se.py).toBeCloseTo(2048, 3);
  });

  it('klemmt die Breite', () => {
    expect(lonLatToGlobalPixel(90, 0, 1).py).toBeCloseTo(0, 3);
  });
});

describe('HeightSampler', () => {
  it('liefert erst null, nach dem Laden den Wert', async () => {
    const { loader } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader });
    const p = tileCentre(1, 1);
    expect(s.sample(p.lat, p.lon)).toBeNull();
    await tick();
    const { px, py } = lonLatToGlobalPixel(p.lat, p.lon, Z);
    expect(s.sample(p.lat, p.lon)).toBeCloseTo(f(px - 0.5, py - 0.5), 4);
    expect(s.cachedTiles).toBe(1);
  });

  it('interpoliert bilinear über Kachelgrenzen', async () => {
    const { loader, calls } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader });
    // lon -90, lat 0 → px = 256, py = 512: genau auf Ecke von vier Kacheln
    const { px, py } = lonLatToGlobalPixel(0, -90, Z);
    expect(px).toBeCloseTo(256, 6);
    expect(py).toBeCloseTo(512, 6);
    expect(s.sample(0, -90)).toBeNull();
    await tick();
    expect(calls).toHaveLength(4);
    expect(s.sample(0, -90)).toBeCloseTo(f(px - 0.5, py - 0.5), 4);
  });

  it('bricht am Antimeridian um', async () => {
    const { loader } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader });
    const lon = 179.9999;
    const lat = 0;
    expect(await s.sampleAsync(lat, lon)).not.toBeNull();
    const { px, py } = lonLatToGlobalPixel(lat, lon, Z);
    const x0 = Math.floor(px - 0.5);
    const fx = px - 0.5 - x0;
    expect(x0).toBe(N - 1);
    const y0 = Math.floor(py - 0.5);
    const fy = py - 0.5 - y0;
    const row = (x: number): number => f(x, y0) * (1 - fy) + f(x, y0 + 1) * fy;
    const expected = row(N - 1) * (1 - fx) + row(0) * fx;
    expect(s.sample(lat, lon)).toBeCloseTo(expected, 3);
  });

  it('klemmt an den Polen', async () => {
    const { loader } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader });
    const h = await s.sampleAsync(89, 0);
    expect(Number.isFinite(h)).toBe(true);
  });

  it('dedupliziert gleichzeitige Anfragen', async () => {
    const { loader, calls } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader });
    const p = tileCentre(0, 0);
    s.sample(p.lat, p.lon);
    s.sample(p.lat, p.lon);
    const a = s.sampleAsync(p.lat, p.lon);
    const b = s.sampleAsync(p.lat, p.lon);
    await Promise.all([a, b]);
    expect(calls).toHaveLength(1);
  });

  it('verdrängt per LRU und frischt bei sample() auf', async () => {
    const { loader, calls } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader, maxTiles: 2 });
    const a = tileCentre(0, 0);
    const b = tileCentre(1, 0);
    const c = tileCentre(2, 0);
    await s.sampleAsync(a.lat, a.lon);
    await s.sampleAsync(b.lat, b.lon);
    expect(s.sample(a.lat, a.lon)).not.toBeNull(); // A auffrischen
    await s.sampleAsync(c.lat, c.lon);
    expect(s.cachedTiles).toBe(2);
    expect(s.sample(a.lat, a.lon)).not.toBeNull();
    expect(s.sample(c.lat, c.lon)).not.toBeNull();
    const before = calls.length;
    expect(s.sample(b.lat, b.lon)).toBeNull(); // B wurde verdrängt
    await tick();
    expect(calls.length).toBe(before + 1);
  });

  it('fragt fehlgeschlagene Kacheln 5 s lang nicht erneut an', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const loader = vi.fn<HeightTileLoader>(() => Promise.reject(new Error('boom')));
    const s = new HeightSampler({ zoom: Z, loader });
    const p = tileCentre(0, 0);
    expect(s.sample(p.lat, p.lon)).toBeNull();
    await tick();
    expect(loader).toHaveBeenCalledTimes(1);
    s.sample(p.lat, p.lon);
    await tick();
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(s.sampleAsync(p.lat, p.lon)).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(1);
    now += 5001;
    s.sample(p.lat, p.lon);
    await tick();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('prefetch lädt die erwarteten Kacheln', async () => {
    const { loader, calls } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader });
    // kleiner Radius in Kachelmitte → 1 Kachel
    const p = tileCentre(1, 1);
    await s.prefetch(p.lat, p.lon, 1000);
    expect(calls).toHaveLength(1);
    // Radius größer als die Welt → alle 16 Kacheln (x wird umgebrochen und gedeckelt)
    await s.prefetch(0, 0, 12_000_000);
    expect(s.cachedTiles).toBe(16);
    // Kreis über die Kachelecke (lon -90, lat 0) → 2x2 Kacheln
    const s2 = new HeightSampler({ zoom: Z, loader: makeLoader().loader });
    await s2.prefetch(0, -90, 1000);
    expect(s2.cachedTiles).toBe(4);
  });

  it('sampleAsync liefert den Wert und respektiert Abbruch', async () => {
    const { loader } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader });
    const p = tileCentre(3, 2);
    const h = await s.sampleAsync(p.lat, p.lon);
    const { px, py } = lonLatToGlobalPixel(p.lat, p.lon, Z);
    expect(h).toBeCloseTo(f(px - 0.5, py - 0.5), 4);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(s.sampleAsync(0, 0, ctrl.signal)).rejects.toThrow();
  });

  it('clear leert den Cache', async () => {
    const { loader } = makeLoader();
    const s = new HeightSampler({ zoom: Z, loader });
    await s.sampleAsync(0, 0);
    expect(s.cachedTiles).toBeGreaterThan(0);
    s.clear();
    expect(s.cachedTiles).toBe(0);
  });
});
