/** Gleitender FPS-/Frame-Zeit-Messer über ein Zeitfenster. */
export class FpsMeter {
  private readonly samples: number[] = [];
  private sum = 0;

  constructor(private readonly windowSize = 60) {}

  /** Frame-Dauer in Sekunden eintragen. */
  push(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.samples.push(dt);
    this.sum += dt;
    if (this.samples.length > this.windowSize) this.sum -= this.samples.shift() ?? 0;
  }

  get fps(): number {
    return this.samples.length === 0 ? 0 : this.samples.length / this.sum;
  }

  get frameMs(): number {
    return this.samples.length === 0 ? 0 : (this.sum / this.samples.length) * 1000;
  }
}
