import { Vector3, type Matrix4, type Object3D } from 'three';
import { createBasis } from '../core/floatingOrigin';
import { clipPlanes, type CameraContext, type CameraController } from './types';

/** So lange nach dem Verschwinden des Ziels wird noch gewartet, dann kehrt die Kamera zurück. */
export const FOLLOW_RETURN_DELAY_S = 1.5;
/** Abstand hinter und über dem Ziel in m. */
export const FOLLOW_DISTANCE_M = 40;
export const FOLLOW_HEIGHT_M = 15;

const _basis = createBasis();
const _target = new Vector3();
const _vel = new Vector3();
const _want = new Vector3();
const _fwd = new Vector3();

export interface FollowOptions {
  distance?: number;
  height?: number;
  /** Blickrichtung aus der Vorwärtsachse (−z) des Objekts statt aus der Bewegung (Autos). */
  useObjectForward?: boolean;
}

/**
 * Verfolgerkamera: hängt hinter einem Objekt (Projektil, Meteor) in Bewegungsrichtung und
 * blickt darauf. Verschwindet das Ziel, meldet `finished` nach {@link FOLLOW_RETURN_DELAY_S}.
 * Wird ab M4 automatisch an Projektile gehängt (Einstellung „automatisch folgen“).
 */
export class FollowCamera implements CameraController {
  private target: Object3D | null = null;
  private readonly lastPos = new Vector3();
  private readonly dir = new Vector3(0, 0, -1);
  private lostFor = 0;
  private distance = FOLLOW_DISTANCE_M;
  private height = FOLLOW_HEIGHT_M;
  private useObjectForward = false;
  /** true, sobald die Kamera zur vorherigen Ansicht zurückkehren soll. */
  finished = false;

  constructor(private readonly ctx: CameraContext) {}

  setTarget(obj: Object3D | null, opts: FollowOptions = {}): void {
    this.target = obj;
    this.distance = opts.distance ?? FOLLOW_DISTANCE_M;
    this.height = opts.height ?? FOLLOW_HEIGHT_M;
    this.useObjectForward = opts.useObjectForward ?? false;
    this.lostFor = 0;
    this.finished = obj === null;
    if (obj) obj.getWorldPosition(this.lastPos);
  }

  get hasTarget(): boolean {
    return this.target !== null;
  }

  enter(): void {
    this.finished = this.target === null;
  }

  update(dt: number): void {
    const { camera, origin } = this.ctx;
    const t = this.target;
    if (!t || !t.parent) {
      this.lostFor += dt;
      if (this.lostFor >= FOLLOW_RETURN_DELAY_S) this.finished = true;
      return;
    }
    t.getWorldPosition(_target);
    if (this.useObjectForward) {
      _fwd.set(0, 0, -1).transformDirection(t.matrixWorld);
      this.dir.lerp(_fwd, Math.min(1, dt * 3)).normalize();
    } else {
      _vel.subVectors(_target, this.lastPos);
      if (_vel.lengthSq() > 1e-6) this.dir.lerp(_vel.normalize(), Math.min(1, dt * 4)).normalize();
    }
    this.lastPos.copy(_target);

    origin.basisAt(_target, _basis);
    _want
      .copy(_target)
      .addScaledVector(this.dir, -this.distance)
      .addScaledVector(_basis.up, this.height);
    // Weich nachziehen
    camera.position.lerp(_want, Math.min(1, dt * 5));
    camera.up.copy(_basis.up);
    camera.lookAt(_target);
    const { near, far } = clipPlanes(this.height, origin.worldToGeo(camera.position).height);
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  applyOriginShift(d: Matrix4): void {
    this.lastPos.applyMatrix4(d);
    this.dir.transformDirection(d);
  }

  exit(): void {
    this.ctx.camera.up.set(0, 1, 0);
  }
}
