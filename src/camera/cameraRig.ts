import { Raycaster, Vector2, type Matrix4, type Object3D, type Vector3 } from 'three';
import type { GlobeCamera } from './globeCamera';
import { FlyCamera } from './flyCamera';
import { FollowCamera } from './followCamera';
import { GroundCamera } from './groundCamera';
import { isTyping } from './input';
import type { CameraContext, CameraController, CameraMode } from './types';

const KEY_TO_MODE: Record<string, CameraMode> = {
  Digit1: 'globe',
  Digit2: 'fly',
  Digit3: 'ground',
  Digit4: 'follow',
};

const _ray = new Raycaster();
const _center = new Vector2(0, 0);

/**
 * Verwaltet die Kameramodi: Globus (GlobeControls), Flug, Boden, Verfolgen.
 * Tasten 1–4 schalten um; die UI ruft {@link setMode}.
 */
export class CameraRig {
  readonly fly: FlyCamera;
  readonly ground: GroundCamera;
  readonly follow: FollowCamera;
  private modeValue: CameraMode = 'globe';
  private previous: Exclude<CameraMode, 'follow'> = 'globe';
  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(
    private readonly ctx: CameraContext,
    private readonly globe: GlobeCamera,
    /** Bodenpunkt in der Bildmitte (Raycast), für den Einstieg in den Bodenmodus. */
    private readonly pickCenter: (ray: Raycaster) => Vector3 | null,
    private readonly onModeChange: (mode: CameraMode) => void = () => undefined,
    /** Wird gerufen, wenn „Verfolgen“ gewählt wird, es aber nichts zu verfolgen gibt. */
    private readonly onFollowUnavailable: () => void = () => undefined,
  ) {
    this.fly = new FlyCamera(ctx);
    this.ground = new GroundCamera(ctx);
    this.follow = new FollowCamera(ctx);
    this.onKey = (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const mode = KEY_TO_MODE[e.code];
      if (mode) this.setMode(mode);
    };
    window.addEventListener('keydown', this.onKey);
  }

  get mode(): CameraMode {
    return this.modeValue;
  }

  private controller(mode: CameraMode): CameraController | null {
    if (mode === 'fly') return this.fly;
    if (mode === 'ground') return this.ground;
    if (mode === 'follow') return this.follow;
    return null;
  }

  /** Verfolgt ein Objekt (z. B. Projektil); Rückkehr zur vorherigen Ansicht automatisch. */
  followObject(obj: Object3D): void {
    this.follow.setTarget(obj);
    this.setMode('follow');
  }

  setMode(mode: CameraMode): void {
    if (mode === this.modeValue) return;
    if (mode === 'follow' && !this.follow.hasTarget) {
      this.onFollowUnavailable();
      return;
    }
    const from = this.modeValue;
    this.controller(from)?.exit();
    if (from === 'globe') {
      this.globe.cancelFlight();
      this.globe.controls.enabled = false;
    }
    if (mode !== 'follow') this.previous = mode;
    this.modeValue = mode;
    this.ctx.input.active = mode === 'fly' || mode === 'ground';
    if (mode === 'globe') {
      this.globe.controls.enabled = true;
      this.globe.controls.resetState();
    } else if (mode === 'ground') {
      _ray.setFromCamera(_center, this.ctx.camera);
      // Aus großer Höhe in der Bildmitte landen, aus der Nähe (< 300 m) direkt darunter
      const target = from === 'globe' || from === 'fly' ? this.pickCenter(_ray) : null;
      this.ground.enter(target ?? undefined);
    } else {
      this.controller(mode)?.enter();
    }
    this.onModeChange(mode);
  }

  /** Darf der Ursprung jetzt verschoben werden? (Globus nur ohne Geste/Trägheit.) */
  get canShiftOrigin(): boolean {
    return this.modeValue !== 'globe' || this.globe.idle;
  }

  applyOriginShift(d: Matrix4): void {
    this.globe.applyOriginShift(d);
    this.fly.applyOriginShift(d);
    this.follow.applyOriginShift(d);
  }

  update(dt: number): void {
    if (this.modeValue === 'globe') {
      this.globe.update(dt);
      return;
    }
    this.controller(this.modeValue)?.update(dt);
    if (this.modeValue === 'follow' && this.follow.finished) this.setMode(this.previous);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
  }
}
