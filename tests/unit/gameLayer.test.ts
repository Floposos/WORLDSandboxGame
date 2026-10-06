import { Group, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { geodeticToEcef } from '../../src/core/geo';
import { pickEllipsoid } from '../../src/game/gameLayer';
import { borderFade, buildChunks, chunkAboveHorizon, fillFade } from '../../src/game/politicalMap';

describe('Spielschicht: Auswahl und Karte', () => {
  it('trifft das Ellipsoid senkrecht unter der Kamera', () => {
    const globe = new Group();
    globe.updateMatrixWorld();
    const above = geodeticToEcef({ lat: 52.52, lon: 13.4, height: 3_000_000 });
    const below = geodeticToEcef({ lat: 52.52, lon: 13.4, height: 0 });
    const origin = new Vector3(above.x, above.y, above.z);
    const dir = new Vector3(below.x, below.y, below.z).sub(origin).normalize();
    const geo = pickEllipsoid(new Ray(origin, dir), globe, { lat: 0, lon: 0, height: 0 });
    expect(geo?.lat).toBeCloseTo(52.52, 4);
    expect(geo?.lon).toBeCloseTo(13.4, 4);
    expect(Math.abs(geo!.height)).toBeLessThan(0.5);
    // Am Globus vorbei
    const miss = new Ray(origin, new Vector3(0, 0, 1).cross(dir).normalize());
    expect(pickEllipsoid(miss, globe, { lat: 0, lon: 0, height: 0 })).toBeNull();
  });

  it('unterteilt lange Grenzstücke und speichert sie relativ zur Stückmitte', () => {
    const line = new Float64Array([-120, 49, -95, 49]);
    const chunks = buildChunks([line]);
    expect(chunks).toHaveLength(1);
    const { positions, center } = chunks[0]!;
    // 25° in 0,25°-Schritten = 100 Segmente zu je zwei Punkten
    expect(positions.length).toBe(100 * 6);
    expect(center.length()).toBeGreaterThan(6.3e6);
    expect(Math.max(...positions.map(Math.abs))).toBeLessThan(2e6);
  });

  it('blendet Flächen aus der Nähe aus und hält Grenzen sichtbar', () => {
    expect(fillFade(20_000)).toBe(0);
    expect(fillFade(1_000_000)).toBe(1);
    expect(borderFade(0)).toBeCloseTo(0.35);
    expect(borderFade(100_000)).toBe(1);
  });

  it('zeichnet nur Grenzstücke über dem Horizont', () => {
    const [near] = buildChunks([new Float64Array([10, 47, 11, 47.5])]);
    const [far] = buildChunks([new Float64Array([-100, 40, -99, 40.5])]);
    const cam = (lat: number, lon: number, h: number): Vector3 => {
      const p = geodeticToEcef({ lat, lon, height: h });
      return new Vector3(p.x, p.y, p.z);
    };
    expect(chunkAboveHorizon(near!, cam(47.3, 10.5, 5_000))).toBe(true);
    expect(chunkAboveHorizon(far!, cam(47.3, 10.5, 5_000))).toBe(false);
    expect(chunkAboveHorizon(far!, cam(47.3, 10.5, 40_000_000))).toBe(true);
  });
});
