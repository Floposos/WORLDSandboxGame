import { describe, expect, it } from 'vitest';
import {
  aabbArea,
  blastImpulse,
  craterOffset,
  craterSize,
  effectRadius,
  MAX_BLAST_DV,
  MAX_OVERPRESSURE_PA,
  MIN_EFFECT_PA,
  overpressureAt,
  peakOverpressure,
  scaledDistance,
  shakeAmount,
} from '../../src/physics/blast';

describe('Druckwelle (Spec 7.3)', () => {
  it('skalierte Distanz Z = R / W^(1/3)', () => {
    expect(scaledDistance(10, 1000)).toBeCloseTo(1, 10);
    expect(scaledDistance(-5, 8)).toBe(0);
  });

  it('Überdruck fällt streng monoton mit Z und ist gekappt', () => {
    let prev = Infinity;
    for (let z = 1; z < 200; z *= 1.1) {
      const p = peakOverpressure(z);
      expect(p).toBeLessThan(prev);
      expect(p).toBeGreaterThan(0);
      prev = p;
    }
    expect(peakOverpressure(0)).toBe(MAX_OVERPRESSURE_PA);
    expect(peakOverpressure(1e6)).toBeLessThan(1);
  });

  it('liegt nahe bekannter Werte der Kinney-Graham-Kurve', () => {
    // Z = 3: ≈ 0,8 bar, Z = 10: ≈ 0,1 bar
    expect(peakOverpressure(3) / 1000).toBeGreaterThan(60);
    expect(peakOverpressure(3) / 1000).toBeLessThan(100);
    expect(peakOverpressure(10) / 1000).toBeGreaterThan(7);
    expect(peakOverpressure(10) / 1000).toBeLessThan(13);
  });

  it('Wirkungsradius wächst mit W^(1/3)', () => {
    const r1 = effectRadius(1);
    const r8 = effectRadius(8);
    expect(r8 / r1).toBeCloseTo(2, 1);
    expect(overpressureAt(effectRadius(500), 500)).toBeCloseTo(MIN_EFFECT_PA, -2);
  });

  it('Impuls: weiter weg kleiner, mehr Fläche größer, Δv begrenzt', () => {
    expect(blastImpulse(20, 500, 1, 1000)).toBeGreaterThan(blastImpulse(40, 500, 1, 1000));
    expect(blastImpulse(40, 500, 2, 1000)).toBeGreaterThan(blastImpulse(40, 500, 1, 1000));
    expect(blastImpulse(0.1, 1000, 10, 100)).toBe(MAX_BLAST_DV * 100);
    expect(blastImpulse(5000, 500, 1, 100)).toBe(0);
    expect(aabbArea(1, 1, 1)).toBe(1);
  });

  it('Wackeln nimmt mit der Entfernung ab', () => {
    expect(shakeAmount(10, 500)).toBeGreaterThan(shakeAmount(500, 500));
    expect(shakeAmount(0, 500)).toBeLessThanOrEqual(1);
  });
});

describe('Krater (Spec 7.4)', () => {
  it('Größe wächst monoton mit der Ladung, 500 kg ergibt einen Bombentrichter', () => {
    let prev = 0;
    for (const w of [0.2, 2, 50, 500, 1000, 1e6]) {
      const c = craterSize(w);
      expect(c.radiusM).toBeGreaterThan(prev);
      prev = c.radiusM;
    }
    const bomb = craterSize(500);
    expect(bomb.radiusM).toBeGreaterThan(3.5);
    expect(bomb.radiusM).toBeLessThan(7);
    expect(bomb.depthM).toBeLessThan(bomb.radiusM);
  });

  it('Luftdetonation gräbt weniger, hoch genug gar nicht', () => {
    expect(craterSize(500, 3).depthM).toBeLessThan(craterSize(500).depthM);
    expect(craterSize(500, 100).depthM).toBe(0);
  });

  it('Profil: Schüssel, stetiger Wall, außen null', () => {
    const c = craterSize(500);
    expect(craterOffset(0, c)).toBeCloseTo(-c.depthM, 6);
    expect(craterOffset(c.radiusM - 1e-6, c)).toBeCloseTo(c.rimM, 4);
    expect(craterOffset(c.radiusM + 1e-6, c)).toBeCloseTo(c.rimM, 4);
    expect(craterOffset(2 * c.radiusM, c)).toBe(0);
    expect(craterOffset(5 * c.radiusM, c)).toBe(0);
  });
});
