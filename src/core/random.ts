/**
 * Seedbarer PRNG (sfc32, Seed über splitmix32 gestreut). Deterministisch über
 * Plattformen hinweg, Grundlage für Replays und geteilte Szenen.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(readonly seed: number) {
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    // Aufwärmen
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Gleichverteilt in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Gleichverteilt in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Ganzzahl in [min, max] (inklusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: leere Liste');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Unabhängiger Kind-Generator, z. B. pro Werkzeug-Aktion. */
  fork(): Rng {
    return new Rng(this.nextUint32());
  }
}
