import { Vector3, type Matrix4 } from 'three';
import { createBasis } from '../core/floatingOrigin';
import { forwardFrom, headingPitchOf, quaternionFrom } from './orientation';
import {
  clipPlanes,
  LOOK_DEG_PER_PX,
  MAX_PITCH_DEG,
  type CameraContext,
  type CameraController,
} from './types';

/** Mindestabstand zum Boden in m. */
export const FLY_MIN_CLEARANCE_M = 2;
/** Shift multipliziert das Tempo. */
export const FLY_BOOST = 5;

/** Tempo in m/s: proportional zur Höhe über Grund, damit es nah und fern gleich „schnell“ wirkt. */
export function flySpeed(heightAboveGroundM: number, boost: boolean): number {
  const base = Math.min(500_000, Math.max(10, heightAboveGroundM * 0.8));
  return boost ? base * FLY_BOOST : base;
}

const _basis = createBasis();
const _fwd = new Vector3();
const _right = new Vector3();
const _move = new Vector3();

/** Freie Flugkamera: WASD vor/zurück/seitlich, Q/E ab/auf, Shift Boost, Maus blickt. */
export class FlyCamera implements CameraController {
  readonly position = new Vector3();
  heading = 0;
  pitch = 0;
  private heightAboveGround = 100;

  constructor(private readonly ctx: CameraContext) {}

  enter(): void {
    const { camera, origin } = this.ctx;
    this.position.copy(camera.position);
    origin.basisAt(this.position, _basis);
    camera.getWorldDirection(_fwd);
    const hp = headingPitchOf(_basis, _fwd);
    this.heading = hp.heading;
    this.pitch = Math.max(-MAX_PITCH_DEG, Math.min(MAX_PITCH_DEG, hp.pitch));
  }

  update(dt: number): void {
    const { camera, origin, ground, input } = this.ctx;
    const look = input.consumeLook();
    this.heading = (this.heading + look.dx * LOOK_DEG_PER_PX + 360) % 360;
    this.pitch = Math.max(
      -MAX_PITCH_DEG,
      Math.min(MAX_PITCH_DEG, this.pitch - look.dy * LOOK_DEG_PER_PX),
    );
    // Pfeiltasten drehen ebenfalls (ohne Maus spielbar)
    this.heading = (this.heading + input.axis('ArrowRight', 'ArrowLeft') * 90 * dt + 360) % 360;
    this.pitch = Math.max(
      -MAX_PITCH_DEG,
      Math.min(MAX_PITCH_DEG, this.pitch + input.axis('ArrowUp', 'ArrowDown') * 60 * dt),
    );

    origin.basisAt(this.position, _basis);
    forwardFrom(_basis, this.heading, this.pitch, _fwd);
    _right.crossVectors(_fwd, _basis.up).normalize();
    _move
      .set(0, 0, 0)
      .addScaledVector(_fwd, input.axis('KeyW', 'KeyS'))
      .addScaledVector(_right, input.axis('KeyD', 'KeyA'))
      .addScaledVector(_basis.up, input.axis('KeyE', 'KeyQ'));
    if (_move.lengthSq() > 0) {
      const speed = flySpeed(
        this.heightAboveGround,
        input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
      );
      this.position.addScaledVector(_move.normalize(), speed * dt);
    }

    // Nie unter den Boden (inkl. Gebäude bei Google/Cesium)
    const hag = ground.heightAbove(this.position, 50);
    if (hag !== null) {
      if (hag < FLY_MIN_CLEARANCE_M)
        this.position.addScaledVector(_basis.up, FLY_MIN_CLEARANCE_M - hag);
      this.heightAboveGround = Math.max(hag, FLY_MIN_CLEARANCE_M);
    }

    camera.position.copy(this.position);
    quaternionFrom(_basis, this.heading, this.pitch, camera.quaternion);
    const { near, far } = clipPlanes(
      this.heightAboveGround,
      origin.worldToGeo(this.position).height,
    );
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  applyOriginShift(d: Matrix4): void {
    this.position.applyMatrix4(d);
  }

  exit(): void {
    this.ctx.input.release();
  }
}
