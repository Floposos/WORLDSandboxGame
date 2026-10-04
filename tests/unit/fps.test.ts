import { describe, expect, it } from 'vitest';
import { FpsMeter } from '../../src/core/fps';

describe('FpsMeter', () => {
  it('misst konstante 60 FPS', () => {
    const m = new FpsMeter(30);
    for (let i = 0; i < 100; i++) m.push(1 / 60);
    expect(m.fps).toBeCloseTo(60, 5);
    expect(m.frameMs).toBeCloseTo(16.667, 2);
  });

  it('ignoriert ungültige Werte und startet bei 0', () => {
    const m = new FpsMeter();
    expect(m.fps).toBe(0);
    m.push(0);
    m.push(Number.NaN);
    m.push(-1);
    expect(m.fps).toBe(0);
  });
});
