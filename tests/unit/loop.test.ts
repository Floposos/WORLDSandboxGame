import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator } from '../../src/core/loop';
import { MAX_SUBSTEPS, PHYSICS_DT } from '../../src/core/constants';

describe('FixedStepAccumulator', () => {
  it('macht bei 60 FPS einen Schritt pro Frame', () => {
    const acc = new FixedStepAccumulator();
    let total = 0;
    for (let i = 0; i < 60; i++) total += acc.advance(PHYSICS_DT, 1).steps;
    expect(total).toBeGreaterThanOrEqual(59);
    expect(total).toBeLessThanOrEqual(60);
  });

  it('macht bei 30 FPS zwei Schritte pro Frame', () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(2 * PHYSICS_DT + 1e-9, 1).steps).toBe(2);
  });

  it('begrenzt die Substeps', () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(0.2, 1).steps).toBe(MAX_SUBSTEPS);
  });

  it('Pause (Zeitskala 0) macht keine Schritte', () => {
    const acc = new FixedStepAccumulator();
    const r = acc.advance(0.1, 0);
    expect(r.steps).toBe(0);
    expect(r.scaledDt).toBe(0);
  });

  it('Zeitlupe 0,25 macht ein Viertel der Schritte', () => {
    const acc = new FixedStepAccumulator();
    let total = 0;
    for (let i = 0; i < 240; i++) total += acc.advance(PHYSICS_DT, 0.25).steps;
    expect(total).toBeGreaterThanOrEqual(59);
    expect(total).toBeLessThanOrEqual(60);
  });

  it('alpha bleibt in [0, 1)', () => {
    const acc = new FixedStepAccumulator();
    for (let i = 0; i < 100; i++) {
      const { alpha } = acc.advance(0.007 + (i % 7) * 0.003, 1);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('ignoriert negative Frame-Zeiten', () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(-1, 1).steps).toBe(0);
  });
});
