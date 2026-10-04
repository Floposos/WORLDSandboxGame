import { Vector3 } from 'three';
import { STANDARD_GRAVITY } from '../core/constants';
import { createBasis } from '../core/floatingOrigin';
import type { GeoPoint } from '../core/types';
import { headingPitchOf, quaternionFrom } from './orientation';
import {
  clipPlanes,
  LOOK_DEG_PER_PX,
  MAX_PITCH_DEG,
  type CameraContext,
  type CameraController,
} from './types';

export const EYE_HEIGHT_M = 1.8;
export const WALK_SPEED = 1.4;
export const RUN_SPEED = 6;
export const JUMP_SPEED = 4.5;
/** Höher als das blockiert (Mauer, Gebäude), niedriger wird hochgestiegen. */
export const STEP_HEIGHT_M = 0.6;
/** Blickneigung beim Betreten des Bodenmodus. */
export const ENTRY_PITCH_DEG = -10;
/** Von hier oben wird nach dem Boden gesucht (findet Dächer und Hindernisse). */
const PROBE_FROM_ABOVE_M = 50;

export interface WalkState {
  /** Füße: Höhe über dem Ellipsoid in m */
  feet: number;
  vUp: number;
  onGround: boolean;
}

/**
 * Ein Schritt der vertikalen Bewegung (rein, testbar). `groundAhead` ist die Bodenhöhe am
 * Zielpunkt der horizontalen Bewegung; `blocked` sagt, ob der Schritt verworfen wurde.
 * SIMPLIFIED: kein echter Character-Controller, keine Kollision mit Wänden über die
 * Bodenhöhe hinaus. Ab M3 übernimmt Rapier (ADR-017).
 */
export function walkStep(
  s: WalkState,
  groundHere: number,
  groundAhead: number | null,
  jump: boolean,
  dt: number,
): { state: WalkState; blocked: boolean } {
  let blocked = false;
  let ground = groundHere;
  if (groundAhead !== null) {
    if (groundAhead - s.feet > STEP_HEIGHT_M) blocked = true;
    else ground = groundAhead;
  }
  let { feet, vUp, onGround } = s;
  if (onGround && jump) {
    vUp = JUMP_SPEED;
    onGround = false;
  }
  if (onGround) {
    // Hangabwärts am Boden bleiben, kleine Kanten hinunter ebenfalls
    if (ground >= feet - STEP_HEIGHT_M) {
      feet = ground;
      vUp = 0;
    } else {
      onGround = false;
    }
  }
  if (!onGround) {
    vUp -= STANDARD_GRAVITY * dt;
    feet += vUp * dt;
    if (feet <= ground) {
      feet = ground;
      vUp = 0;
      onGround = true;
    }
  }
  return { state: { feet, vUp, onGround }, blocked };
}

const _basis = createBasis();
const _fwd = new Vector3();
const _dir = new Vector3();
const _pos = new Vector3();
const _cand = new Vector3();
const _right = new Vector3();
const _g: GeoPoint = { lat: 0, lon: 0, height: 0 };

/** Ego-Kamera am Boden: Gehen (WASD), Rennen (Shift), Springen (Leertaste), Maus blickt. */
export class GroundCamera implements CameraController {
  /** Position der Füße (Breite/Länge) – geodätisch, damit Ursprungsverschiebungen egal sind. */
  readonly geo: GeoPoint = { lat: 0, lon: 0, height: 0 };
  heading = 0;
  pitch = 0;
  private walk: WalkState = { feet: 0, vUp: 0, onGround: true };

  constructor(private readonly ctx: CameraContext) {}

  /** Setzt die Füße auf den Boden bei `target` (Welt) bzw. unter die Kamera. */
  enter(target?: Vector3): void {
    const { camera, origin, ground } = this.ctx;
    camera.getWorldDirection(_fwd);
    origin.basisAt(camera.position, _basis);
    this.heading = headingPitchOf(_basis, _fwd).heading;
    // Leicht nach unten, damit Zielkreis und Boden im Bild sind
    this.pitch = ENTRY_PITCH_DEG;
    const at = target ?? camera.position;
    origin.worldToGeo(at, this.geo);
    _pos.copy(origin.geoToWorld({ ...this.geo, height: this.geo.height }));
    const hit = ground.below(_pos, 10_000);
    const h = hit?.height ?? 0;
    this.geo.height = h;
    this.walk = { feet: h, vUp: 0, onGround: true };
    this.place();
  }

  /** Höhe der Augen über dem Boden (für HUD und Tests). */
  get eyeHeightAboveFeet(): number {
    return EYE_HEIGHT_M;
  }

  get feetHeight(): number {
    return this.walk.feet;
  }

  update(dt: number): void {
    const { origin, ground, input } = this.ctx;
    const look = input.consumeLook();
    this.heading =
      (this.heading +
        look.dx * LOOK_DEG_PER_PX +
        input.axis('ArrowRight', 'ArrowLeft') * 90 * dt +
        360) %
      360;
    this.pitch = Math.max(
      -MAX_PITCH_DEG,
      Math.min(
        MAX_PITCH_DEG,
        this.pitch - look.dy * LOOK_DEG_PER_PX + input.axis('ArrowUp', 'ArrowDown') * 60 * dt,
      ),
    );

    _g.lat = this.geo.lat;
    _g.lon = this.geo.lon;
    _g.height = this.walk.feet;
    origin.geoToWorld(_g, _pos);
    origin.basisAt(_pos, _basis);
    const h = (this.heading * Math.PI) / 180;
    _fwd.copy(_basis.north).multiplyScalar(Math.cos(h)).addScaledVector(_basis.east, Math.sin(h));
    // Rechts = Ost·cos(h) − Nord·sin(h)
    _right
      .copy(_basis.east)
      .multiplyScalar(Math.cos(h))
      .addScaledVector(_basis.north, -Math.sin(h));
    _dir
      .set(0, 0, 0)
      .addScaledVector(_fwd, input.axis('KeyW', 'KeyS'))
      .addScaledVector(_right, input.axis('KeyD', 'KeyA'));

    // Boden direkt unter den Füßen: nur knapp darüber suchen, damit Dächer/Brücken über uns
    // nicht als Boden gelten.
    const groundHere = ground.below(_pos, STEP_HEIGHT_M + 0.1)?.height ?? this.walk.feet;
    let groundAhead: number | null = null;
    const moving = _dir.lengthSq() > 0;
    if (moving) {
      const run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      _cand.copy(_pos).addScaledVector(_dir.normalize(), (run ? RUN_SPEED : WALK_SPEED) * dt);
      // Von hoch oben: Was höher als eine Stufe ist, blockiert (Mauern, Gebäude).
      // SIMPLIFIED: blockiert auch unter Bäumen/Brücken (nur Google/Cesium-Meshes).
      groundAhead = ground.below(_cand, PROBE_FROM_ABOVE_M)?.height ?? null;
    }
    const jump = input.consumeKey('Space');
    const { state, blocked } = walkStep(this.walk, groundHere, groundAhead, jump, dt);
    this.walk = state;
    if (moving && !blocked) {
      const g = origin.worldToGeo(_cand, _g);
      this.geo.lat = g.lat;
      this.geo.lon = g.lon;
    }
    this.geo.height = this.walk.feet;
    this.place();
  }

  private place(): void {
    const { camera, origin } = this.ctx;
    _g.lat = this.geo.lat;
    _g.lon = this.geo.lon;
    _g.height = this.walk.feet + EYE_HEIGHT_M;
    origin.geoToWorld(_g, camera.position);
    origin.basisAt(camera.position, _basis);
    quaternionFrom(_basis, this.heading, this.pitch, camera.quaternion);
    const { near, far } = clipPlanes(EYE_HEIGHT_M, this.walk.feet + EYE_HEIGHT_M);
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  applyOriginShift(): void {
    // Zustand ist geodätisch, nichts umzurechnen.
  }

  exit(): void {
    this.ctx.input.release();
  }
}
