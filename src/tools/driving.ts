import { Vector3 } from 'three';
import type { CameraRig } from '../camera/cameraRig';
import { isTyping } from '../camera/input';
import type { PhysicsWorld } from '../physics/world';
import type { Car } from '../physics/vehicle';

/** F steigt in Autos bis zu dieser Entfernung (m) von der Kamera ein. */
export const ENTER_RANGE_M = 30;

const _cam = new Vector3();
const _car = new Vector3();

/**
 * Fahrmodus (Spec M3 „Ein Auto ist fahrbar“): W/S Gas/Rückwärts, A/D lenken, Leertaste
 * bremst, F steigt ein/aus. Die Kamera folgt dem Auto (Verfolgerkamera, Modus 4).
 */
export class Driving {
  private car: Car | null = null;
  private readonly cars = new Set<Car>();
  private readonly keys = new Set<string>();
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;
  /** Wird gerufen, wenn F kein Auto in Reichweite findet. */
  onNoCar: () => void = () => undefined;
  onChange: (driving: boolean) => void = () => undefined;

  constructor(
    private readonly rig: CameraRig,
    private readonly getPhysics: () => PhysicsWorld | null,
  ) {
    this.onKeyDown = (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyF' && !e.repeat) {
        if (this.car) this.exit();
        else this.enterNearest();
        return;
      }
      if (!this.car) return;
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'Space',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(e.code)
      ) {
        e.preventDefault();
        this.keys.add(e.code);
      }
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  get active(): boolean {
    return this.car !== null;
  }

  get current(): Car | null {
    return this.car;
  }

  add(car: Car): void {
    this.cars.add(car);
    const remove = car.body.onRemove;
    car.body.onRemove = () => {
      remove?.();
      this.cars.delete(car);
      if (this.car === car) this.exit();
    };
  }

  enter(car: Car): void {
    this.car = car;
    this.keys.clear();
    this.rig.follow.setTarget(car.root, { distance: 9, height: 3.5, useObjectForward: true });
    this.rig.setMode('follow');
    this.onChange(true);
  }

  exit(): void {
    if (!this.car) return;
    this.car.input = { throttle: 0, steer: 0, brake: true };
    this.car = null;
    this.keys.clear();
    if (this.rig.mode === 'follow') this.rig.follow.setTarget(null);
    this.onChange(false);
  }

  private enterNearest(): void {
    const physics = this.getPhysics();
    if (!physics) return this.onNoCar();
    _cam.copy(this.rig.cameraPosition);
    let best: Car | null = null;
    let bestD = ENTER_RANGE_M;
    for (const car of this.cars) {
      const d = physics.bubbleToWorld(car.body.pos, _car).distanceTo(_cam);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    if (best) this.enter(best);
    else this.onNoCar();
  }

  /** Pro Frame: Eingabe ans Auto, Ende des Fahrmodus erkennen. */
  update(): void {
    const car = this.car;
    if (!car) return;
    if (this.rig.mode !== 'follow') {
      this.exit();
      return;
    }
    const k = (a: string, b: string): number => (this.keys.has(a) || this.keys.has(b) ? 1 : 0);
    car.input = {
      throttle: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      steer: k('KeyA', 'ArrowLeft') - k('KeyD', 'ArrowRight'),
      brake: this.keys.has('Space'),
    };
  }

  /** Räder aller Autos nachführen (Darstellung). */
  render(): void {
    for (const car of this.cars) car.updateWheels();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
