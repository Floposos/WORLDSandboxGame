import { describe, expect, it } from 'vitest';
import { haversineDistance } from '../../src/core/geo';
import { destination, formation, UNIT_SPEED_KMH, UnitStore } from '../../src/game/units';

// Land = östlich von 0° (Testwelt)
const isLand = (_lat: number, lon: number): boolean => lon > 0;
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number =>
  haversineDistance({ ...a, height: 0 }, { ...b, height: 0 }) / 1000;

describe('Einheiten', () => {
  it('setzt Bodentruppen nur an Land, Luftwaffe überall', () => {
    const s = new UnitStore(isLand);
    expect(s.place('tank', 50, 10, 'DEU').ok).toBe(true);
    expect(s.place('infantry', 50, -10, 'DEU')).toEqual({ ok: false, reason: 'sea' });
    expect(s.place('air', 50, -10, null).ok).toBe(true);
    expect(s.size).toBe(2);
  });

  it('weist Einheiten einem Land zu', () => {
    const s = new UnitStore(isLand);
    const a = s.place('tank', 50, 10, null);
    const b = s.place('air', 50, 11, null);
    if (!a.ok || !b.ok) throw new Error('platzieren');
    s.assign([a.unit.id, b.unit.id], 'FRA');
    expect(s.units.map((u) => u.owner)).toEqual(['FRA', 'FRA']);
  });

  it('marschiert mit der Geschwindigkeit des Typs und hält am Ziel', () => {
    const s = new UnitStore(isLand);
    const r = s.place('tank', 50, 10, 'DEU');
    if (!r.ok) throw new Error('platzieren');
    const target = destination(50, 10, 90, 100);
    expect(s.move([r.unit.id], target, 5)).toEqual({ moved: 1, refusedSea: 0 });
    s.step(1);
    expect(km(r.unit, { lat: 50, lon: 10 })).toBeCloseTo(UNIT_SPEED_KMH.tank, 0);
    s.step(10);
    expect(r.unit.target).toBeNull();
    expect(km(r.unit, target)).toBeLessThan(0.01);
    expect(s.step(1)).toBe(false);
  });

  it('verteilt einen Verband und verweigert Meeresziele für Bodentruppen', () => {
    const spots = formation({ lat: 50, lon: 10 }, 9, 10);
    expect(spots).toHaveLength(9);
    // Raster 3 × 3 mit 10 km Abstand: Mitte = Ziel, Ecken ≈ 14 km entfernt
    expect(km(spots[4]!, { lat: 50, lon: 10 })).toBeLessThan(0.01);
    expect(km(spots[0]!, { lat: 50, lon: 10 })).toBeCloseTo(14.1, 0);
    const s = new UnitStore(isLand);
    const t = s.place('tank', 50, 10, null);
    const p = s.place('air', 50, 10, null);
    if (!t.ok || !p.ok) throw new Error('platzieren');
    expect(s.move([t.unit.id, p.unit.id], { lat: 50, lon: -5 }, 5)).toEqual({
      moved: 1,
      refusedSea: 1,
    });
    expect(t.unit.target).toBeNull();
    expect(p.unit.target).not.toBeNull();
  });

  it('speichert und lädt den Zustand', () => {
    const s = new UnitStore(isLand);
    s.place('infantry', 48, 11, 'DEU');
    s.place('air', 40, -3, 'ESP');
    const copy = new UnitStore(isLand);
    copy.load(JSON.parse(JSON.stringify(s.toJSON())));
    expect(copy.units).toEqual(s.units);
    expect(copy.place('tank', 50, 10, null).ok && copy.size).toBe(3);
    expect(Math.max(...copy.units.map((u) => u.id))).toBe(3);
    copy.load({ units: [{ id: 'x' }, null] });
    expect(copy.size).toBe(0);
  });
});
