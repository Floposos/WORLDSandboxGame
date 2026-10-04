import { Vector3, type Matrix4 } from 'three';
import { createBasis } from '../core/floatingOrigin';
import type { GeoPoint } from '../core/types';
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
/** Höher fliegt die Flugkamera nicht; darüber ist der Globusmodus da (Befund M2-Test). */
export const FLY_MAX_HEIGHT_M = 100_000;
/** Höchsttempo in m/s (mit Shift), damit die Höhe nicht exponentiell davonläuft. */
export const FLY_MAX_SPEED = 20_000;

/** Tempo in m/s: proportional zur Höhe über Grund, damit es nah und fern gleich „schnell“ wirkt. */
export function flySpeed(heightAboveGroundM: number, boost: boolean): number {
  const base = Math.max(10, Math.min(FLY_MAX_HEIGHT_M, heightAboveGroundM) * 0.8);
  return Math.min(FLY_MAX_SPEED, boost ? base * FLY_BOOST : base);
}

/**
 * Boden für die Flugkamera: Unter dem Meeresspiegel (Terrarium enthält Bathymetrie) gilt der
 * Meeresspiegel, damit man nicht durch den Ozean auf den Meeresgrund sinkt.
 * SIMPLIFIED: auch Senken an Land (Totes Meer) zählen als Meeresspiegel; Wasser kommt mit 6.3.
 */
export function flyFloor(groundHeightM: number): number {
  return Math.max(0, groundHeightM);
}

const _basis = createBasis();
const _fwd = new Vector3();
const _right = new Vector3();
const _move = new Vector3();
const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };

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

    // Nie unter den Boden (inkl. Gebäude bei Google/Cesium) und nicht über die Höchstgrenze
    const hit = ground.below(this.position, 50);
    if (hit) {
      origin.worldToGeo(this.position, _geo);
      const floor = flyFloor(hit.height);
      const hag = _geo.height - floor;
      if (hag < FLY_MIN_CLEARANCE_M)
        this.position.addScaledVector(_basis.up, FLY_MIN_CLEARANCE_M - hag);
      else if (hag > FLY_MAX_HEIGHT_M)
        this.position.addScaledVector(_basis.up, FLY_MAX_HEIGHT_M - hag);
      this.heightAboveGround = Math.min(FLY_MAX_HEIGHT_M, Math.max(hag, FLY_MIN_CLEARANCE_M));
    }

    camera.position.copy(this.position);
    quaternionFrom(_basis, this.heading, this.pitch, camera.quaternion);
    const { near, far } = clipPlanes(
      this.heightAboveGround,
      origin.worldToGeo(this.position, _geo).height,
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
