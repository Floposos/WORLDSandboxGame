import { describe, expect, it } from 'vitest';
import {
  ecefToGeodetic,
  geodeticToEcef,
  haversineDistance,
  initialBearing,
  interpolateGreatCircle,
  LocalFrame,
  wrapLon,
} from '../../src/core/geo';
import { WGS84 } from '../../src/core/constants';
import type { GeoPoint } from '../../src/core/types';

const MM = 1e-3;

/** Abstand zweier geodätischer Punkte in Metern über ECEF (fair an Polen und Datumsgrenze). */
function ecefDistance(p: GeoPoint, q: GeoPoint): number {
  const a = geodeticToEcef(p);
  const b = geodeticToEcef(q);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const cases: [string, GeoPoint][] = [
  ['Äquator / Nullmeridian', { lat: 0, lon: 0, height: 0 }],
  ['Äquator 90° Ost, 1 km', { lat: 0, lon: 90, height: 1000 }],
  ['Nordpol', { lat: 90, lon: 0, height: 0 }],
  ['Südpol, 2835 m (Amundsen-Scott)', { lat: -90, lon: 0, height: 2835 }],
  ['fast Nordpol', { lat: 89.999999, lon: 45, height: 10 }],
  ['Datumsgrenze Ost', { lat: -16.5, lon: 179.999999, height: 5 }],
  ['Datumsgrenze West', { lat: -16.5, lon: -179.999999, height: 5 }],
  ['Mount Everest', { lat: 27.988119, lon: 86.925026, height: 8848.86 }],
  ['Marianengraben (Challengertief)', { lat: 11.3733, lon: 142.5917, height: -10_935 }],
  ['Zugspitze', { lat: 47.421111, lon: 10.985278, height: 2962 }],
  ['ISS-Höhe', { lat: 51.6, lon: -120, height: 420_000 }],
  ['geostationär', { lat: 0, lon: 13, height: 35_786_000 }],
];

describe('geodätisch ↔ ECEF', () => {
  it('Äquator/Nullmeridian liegt bei (a, 0, 0)', () => {
    const v = geodeticToEcef({ lat: 0, lon: 0, height: 0 });
    expect(v.x).toBeCloseTo(WGS84.a, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('Nordpol liegt bei (0, 0, b)', () => {
    const v = geodeticToEcef({ lat: 90, lon: 0, height: 0 });
    expect(Math.hypot(v.x, v.y)).toBeLessThan(1e-6);
    expect(v.z).toBeCloseTo(WGS84.b, 6);
  });

  it.each(cases)('Roundtrip %s unter 1 mm', (_name, p) => {
    const back = ecefToGeodetic(geodeticToEcef(p));
    expect(Math.abs(back.height - p.height)).toBeLessThan(MM);
    expect(ecefDistance(back, p)).toBeLessThan(MM);
  });

  it('Roundtrip über ein dichtes Raster unter 1 mm', () => {
    let worst = 0;
    for (let lat = -90; lat <= 90; lat += 7.5) {
      for (let lon = -180; lon < 180; lon += 15) {
        for (const height of [-11_000, 0, 9_000, 1e6]) {
          const p = { lat, lon, height };
          const back = ecefToGeodetic(geodeticToEcef(p));
          worst = Math.max(worst, ecefDistance(back, p), Math.abs(back.height - height));
        }
      }
    }
    expect(worst).toBeLessThan(MM);
  });

  it('Pol direkt auf der Achse', () => {
    const g = ecefToGeodetic({ x: 0, y: 0, z: -WGS84.b - 100 });
    expect(g.lat).toBe(-90);
    expect(g.height).toBeCloseTo(100, 6);
  });
});

describe('LocalFrame (ENU)', () => {
  const origin: GeoPoint = { lat: 53.55, lon: 9.99, height: 10 };
  const frame = new LocalFrame(origin);

  it('Ursprung ist (0, 0, 0)', () => {
    const v = frame.ecefToEnu(geodeticToEcef(origin));
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1e-6);
  });

  it('100 m höher ist +Up bzw. +y lokal', () => {
    const above = geodeticToEcef({ ...origin, height: origin.height + 100 });
    const enu = frame.ecefToEnu(above);
    expect(enu.z).toBeCloseTo(100, 6);
    const local = frame.ecefToLocal(above);
    expect(local.y).toBeCloseTo(100, 6);
    expect(Math.abs(local.x) + Math.abs(local.z)).toBeLessThan(1e-6);
  });

  it('nördlicher Punkt hat +North und −z lokal, östlicher +East und +x', () => {
    const north = frame.ecefToLocal(geodeticToEcef({ ...origin, lat: origin.lat + 0.001 }));
    expect(north.z).toBeLessThan(-100);
    expect(Math.abs(north.x)).toBeLessThan(1e-3);
    const east = frame.ecefToLocal(geodeticToEcef({ ...origin, lon: origin.lon + 0.001 }));
    expect(east.x).toBeGreaterThan(60);
  });

  it('ENU ↔ ECEF und lokal ↔ ECEF sind invers', () => {
    const p = { x: 1234.5, y: -987.25, z: 42.125 };
    const ecef = frame.localToEcef(p);
    const back = frame.ecefToLocal(ecef);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
    expect(back.z).toBeCloseTo(p.z, 6);
    const enu = frame.ecefToEnu(frame.enuToEcef(p));
    expect(enu.x).toBeCloseTo(p.x, 6);
  });
});

describe('Distanz, Kurs, Großkreis', () => {
  const berlin = { lat: 52.52, lon: 13.405, height: 0 };
  const hamburg = { lat: 53.5511, lon: 9.9937, height: 0 };

  it('Berlin–Hamburg ≈ 255 km', () => {
    expect(haversineDistance(berlin, hamburg) / 1000).toBeCloseTo(255.3, 0);
  });

  it('Kurs nach Norden ist 0°, nach Osten 90°', () => {
    expect(
      initialBearing({ lat: 0, lon: 0, height: 0 }, { lat: 1, lon: 0, height: 0 }),
    ).toBeCloseTo(0, 6);
    expect(
      initialBearing({ lat: 0, lon: 0, height: 0 }, { lat: 0, lon: 1, height: 0 }),
    ).toBeCloseTo(90, 6);
  });

  it('Großkreis-Interpolation trifft Endpunkte und Mitte über die Datumsgrenze', () => {
    const p1 = { lat: 0, lon: 170, height: 0 };
    const p2 = { lat: 0, lon: -170, height: 100 };
    const mid = interpolateGreatCircle(p1, p2, 0.5);
    expect(Math.abs(wrapLon(mid.lon))).toBeCloseTo(180, 6);
    expect(mid.height).toBe(50);
    const end = interpolateGreatCircle(p1, p2, 1);
    expect(end.lon).toBeCloseTo(-170, 6);
  });

  it('wrapLon', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(-180);
  });
});
