import { MAX_SUBSTEPS, PHYSICS_DT } from './constants';

export interface StepResult {
  /** Anzahl der fälligen festen Physik-Schritte in diesem Frame. */
  steps: number;
  /** Interpolationsfaktor 0..1 zwischen vorletztem und letztem Physikzustand. */
  alpha: number;
  /** Skalierte Frame-Zeit für VFX (Sekunden). */
  scaledDt: number;
}

/**
 * Reiner Akkumulator für einen festen Physik-Schritt (Gaffer-on-Games-Muster).
 * Ohne DOM-Abhängigkeit, damit er unit-testbar ist.
 */
export class FixedStepAccumulator {
  private acc = 0;

  constructor(
    readonly stepDt = PHYSICS_DT,
    readonly maxSubsteps = MAX_SUBSTEPS,
  ) {}

  advance(frameDt: number, timeScale: number): StepResult {
    // Negative oder riesige Frame-Zeiten (Tab im Hintergrund) abfangen.
    const dt = Math.max(0, Math.min(frameDt, 0.25)) * Math.max(0, timeScale);
    this.acc += dt;
    let steps = Math.floor(this.acc / this.stepDt);
    if (steps > this.maxSubsteps) {
      // Spirale des Todes vermeiden: überschüssige Zeit verwerfen.
      steps = this.maxSubsteps;
      this.acc = 0;
    } else {
      this.acc -= steps * this.stepDt;
    }
    return { steps, alpha: this.acc / this.stepDt, scaledDt: dt };
  }

  reset(): void {
    this.acc = 0;
  }
}

export interface LoopCallbacks {
  /** Fester Schritt (Physik). dt ist immer {@link PHYSICS_DT}. */
  fixedUpdate(dt: number): void;
  /** Variabler Schritt (Render). dt ist echte Zeit, scaledDt berücksichtigt die Zeitskala. */
  update(dt: number, scaledDt: number, alpha: number): void;
}

/** Game-Loop auf Basis von requestAnimationFrame. */
export class GameLoop {
  timeScale = 1;
  private readonly accumulator = new FixedStepAccumulator();
  private last = 0;
  private handle = 0;
  private running = false;

  constructor(private readonly callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const dt = (now - this.last) / 1000;
    this.last = now;
    const { steps, alpha, scaledDt } = this.accumulator.advance(dt, this.timeScale);
    for (let i = 0; i < steps; i++) this.callbacks.fixedUpdate(this.accumulator.stepDt);
    this.callbacks.update(dt, scaledDt, alpha);
    this.handle = requestAnimationFrame(this.tick);
  };
}
