import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CountryIndex, rasterizeCountries, type CountriesFile } from '../../src/game/countries';

const file = JSON.parse(
  readFileSync(new URL('../../public/data/countries.json', import.meta.url), 'utf8'),
) as CountriesFile;
const index = new CountryIndex(file);

describe('Länder (Natural Earth)', () => {
  it('kennt die Länder an bekannten Orten', () => {
    expect(index.countryAt(52.52, 13.405)?.id).toBe('DEU');
    expect(index.countryAt(48.857, 2.352)?.id).toBe('FRA');
    expect(index.countryAt(40.71, -74.0)?.id).toBe('USA');
    expect(index.countryAt(-33.87, 151.21)?.id).toBe('AUS');
    expect(index.countryAt(55.75, 37.62)?.id).toBe('RUS');
    expect(index.countryAt(54.0, -30.0)).toBeNull();
  });

  it('trennt Nachbarn kilometergenau an der Grenze', () => {
    // Kehl (DE) und Straßburg (FR) liegen ≈ 4 km auseinander, dazwischen der Rhein
    expect(index.countryAt(48.5735, 7.815)?.id).toBe('DEU');
    expect(index.countryAt(48.5734, 7.752)?.id).toBe('FRA');
    // Basel (CH) und Weil am Rhein (DE)
    expect(index.countryAt(47.556, 7.59)?.id).toBe('CHE');
    expect(index.countryAt(47.594, 7.62)?.id).toBe('DEU');
  });

  it('hat deutsche Namen und Flächen in der richtigen Größenordnung', () => {
    const de = index.byId.get('DEU')!;
    expect(de.name.de).toBe('Deutschland');
    expect(de.areaKm2).toBeGreaterThan(330_000);
    expect(de.areaKm2).toBeLessThan(380_000);
    expect(index.borders.length).toBeGreaterThan(100);
  });

  it('rastert eine ID-Karte, die zu countryAt passt', () => {
    const w = 720;
    const h = 360;
    const ids = rasterizeCountries(index.countries, w, h);
    const idAt = (x: number, y: number): number => ids[y * w + x]!;
    const at = (lat: number, lon: number): number =>
      idAt(Math.floor(((lon + 180) / 360) * w), Math.floor(((lat + 90) / 180) * h));
    expect(index.byIndex(at(51, 10))?.id).toBe('DEU');
    expect(index.byIndex(at(-15, -55))?.id).toBe('BRA');
    expect(at(0, -140)).toBe(0);
    // Stichprobe: fast alle Pixelmitten stimmen mit dem Punkttest überein
    let same = 0;
    let n = 0;
    for (let y = 10; y < h; y += 7) {
      for (let x = 0; x < w; x += 7) {
        const lat = -90 + ((y + 0.5) * 180) / h;
        const lon = -180 + ((x + 0.5) * 360) / w;
        n++;
        if ((index.countryAt(lat, lon)?.index ?? 0) === idAt(x, y)) same++;
      }
    }
    expect(same / n).toBeGreaterThan(0.995);
  });
});
