import { describe, expect, it } from 'vitest';
import {
  julianDay,
  solarPosition,
  subsolarPoint,
  sunDirectionEcef,
} from '../../src/world/atmosphere/sun';

describe('sun', () => {
  it('computes the Julian day of J2000', () => {
    expect(julianDay(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(2451545.0, 6);
  });

  it('has solstice and equinox declinations', () => {
    expect(solarPosition(new Date('2026-06-21T12:00:00Z'), 0, 0).declinationDeg).toBeCloseTo(
      23.44,
      1,
    );
    expect(solarPosition(new Date('2026-12-21T12:00:00Z'), 0, 0).declinationDeg).toBeCloseTo(
      -23.44,
      1,
    );
    const eq = solarPosition(new Date('2026-03-20T15:00:00Z'), 0, 0).declinationDeg;
    expect(Math.abs(eq)).toBeLessThan(0.5);
  });

  it('puts the sun overhead at (0,0) at equinox solar noon', () => {
    const d = new Date('2026-03-20T12:07:00Z');
    const p = solarPosition(d, 0, 0);
    expect(Math.abs(p.hourAngleDeg)).toBeLessThan(1);
    expect(p.elevationDeg).toBeGreaterThan(85);
    const s = subsolarPoint(d);
    expect(Math.abs(s.lat)).toBeLessThan(0.5);
    expect(Math.abs(s.lon)).toBeLessThan(1);
  });

  it('matches Berlin near solar noon on the June solstice', () => {
    const p = solarPosition(new Date('2026-06-21T11:10:00Z'), 52.52, 13.405);
    expect(Math.abs(p.elevationDeg - 61)).toBeLessThan(1.5);
    expect(Math.abs(p.azimuthDeg - 180)).toBeLessThan(10);
  });

  it('has polar day and night at the June solstice', () => {
    const d = new Date('2026-06-21T00:00:00Z');
    expect(solarPosition(d, 89.9, 0).elevationDeg).toBeGreaterThan(0);
    expect(solarPosition(d, -89.9, 0).elevationDeg).toBeLessThan(0);
  });

  it('gives a unit sun vector pointing at the subsolar point', () => {
    const d = new Date('2026-09-10T07:33:00Z');
    const v = sunDirectionEcef(d);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
    const s = subsolarPoint(d);
    expect(Math.asin(v.z) * (180 / Math.PI)).toBeCloseTo(s.lat, 6);
    expect(Math.atan2(v.y, v.x) * (180 / Math.PI)).toBeCloseTo(s.lon, 6);
    expect(s.lon).toBeGreaterThanOrEqual(-180);
    expect(s.lon).toBeLessThan(180);
  });

  it('keeps azimuth and elevation in range over a sweep', () => {
    for (let i = 0; i < 400; i++) {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 7_919_003_000);
      const lat = ((i * 37) % 181) - 90;
      const lon = ((i * 73) % 360) - 180;
      const p = solarPosition(d, lat, lon);
      expect(p.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(p.azimuthDeg).toBeLessThan(360);
      expect(p.elevationDeg).toBeGreaterThanOrEqual(-90);
      expect(p.elevationDeg).toBeLessThanOrEqual(90);
    }
  });
});
