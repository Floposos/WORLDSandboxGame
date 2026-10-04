import { describe, expect, it } from 'vitest';
import {
  easeInOut,
  flightDuration,
  flightPose,
  planFlight,
  viewDistanceFor,
  type CameraPose,
} from '../../src/camera/flyTo';

const space: CameraPose = { lat: 30, lon: 10, height: 16_000_000, heading: 0, pitch: -90 };
const zugspitze: CameraPose = { lat: 47.4211, lon: 10.9853, height: 7_000, heading: 0, pitch: -35 };
const garmisch: CameraPose = { lat: 47.492, lon: 11.095, height: 3_000, heading: 90, pitch: -30 };

describe('flyTo', () => {
  it('Easing beginnt bei 0, endet bei 1 und ist monoton', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeInOut(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('Dauer wächst mit der Distanz und bleibt in [1,5; 8] s', () => {
    expect(flightDuration(0)).toBe(1.5);
    expect(flightDuration(10_000)).toBeLessThan(flightDuration(1_000_000));
    expect(flightDuration(20_000_000)).toBeLessThanOrEqual(8);
  });

  it('Start- und Endpose werden exakt getroffen', () => {
    const plan = planFlight(garmisch, zugspitze);
    const start = flightPose(plan, 0);
    const end = flightPose(plan, 1);
    expect(start.lat).toBeCloseTo(garmisch.lat, 9);
    expect(start.height).toBeCloseTo(garmisch.height, 6);
    expect(end.lat).toBeCloseTo(zugspitze.lat, 9);
    expect(end.lon).toBeCloseTo(zugspitze.lon, 9);
    expect(end.height).toBeCloseTo(zugspitze.height, 6);
    expect(end.pitch).toBeCloseTo(zugspitze.pitch, 6);
    expect(end.heading).toBeCloseTo(zugspitze.heading, 6);
  });

  it('Langer Flug steigt in der Mitte über beide Endhöhen', () => {
    const tokyo: CameraPose = { lat: 35.68, lon: 139.76, height: 5_000, heading: 0, pitch: -30 };
    const plan = planFlight(zugspitze, tokyo);
    expect(plan.arcM).toBeGreaterThan(0);
    expect(flightPose(plan, 0.5).height).toBeGreaterThan(1_000_000);
  });

  it('Aus dem All nach unten: keine Zusatzhöhe, Höhe fällt monoton', () => {
    const plan = planFlight(space, zugspitze);
    expect(plan.arcM).toBe(0);
    let prev = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const h = flightPose(plan, t).height;
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
  });

  it('Betrachtungshöhe aus der Ausdehnung', () => {
    expect(viewDistanceFor()).toBe(4_000);
    const city = viewDistanceFor([13.08, 52.33, 13.76, 52.68]);
    expect(city).toBeGreaterThan(40_000);
    expect(viewDistanceFor([10, 47, 10.0001, 47.0001])).toBe(1_500);
  });
});
