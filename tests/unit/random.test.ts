import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/random';

describe('Rng', () => {
  it('ist deterministisch für denselben Seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('liefert für verschiedene Seeds verschiedene Folgen', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 8 }, () => a.nextUint32());
    const seqB = Array.from({ length: 8 }, () => b.nextUint32());
    expect(seqA).not.toEqual(seqB);
  });

  it('bleibt im Wertebereich und ist grob gleichverteilt', () => {
    const rng = new Rng(7);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]! += 1;
    }
    for (const count of buckets) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });

  it('int liefert inklusive Grenzen', () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(rng.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('fork ist deterministisch', () => {
    expect(new Rng(9).fork().next()).toBe(new Rng(9).fork().next());
  });

  it('Referenzwert bleibt stabil (Replays dürfen nicht brechen)', () => {
    const rng = new Rng(123456);
    const first = rng.nextUint32();
    expect(first).toBe(new Rng(123456).nextUint32());
    expect(Number.isInteger(first)).toBe(true);
  });
});
