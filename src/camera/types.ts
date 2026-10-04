import type { Matrix4, PerspectiveCamera } from 'three';
import type { FloatingOrigin } from '../core/floatingOrigin';
import type { GroundService } from '../world/ground';
import type { CameraInput } from './input';

export type CameraMode = 'globe' | 'fly' | 'ground' | 'follow';
export const CAMERA_MODES: readonly CameraMode[] = ['globe', 'fly', 'ground', 'follow'];

/** Was alle lokalen Kameras brauchen. */
export interface CameraContext {
  camera: PerspectiveCamera;
  origin: FloatingOrigin;
  ground: GroundService;
  input: CameraInput;
}

/** Eine Kamera, die die three.js-Kamera pro Frame setzt (Flug, Boden, Verfolgen). */
export interface CameraController {
  /** Übernimmt Position und Blick der aktuellen Kamera. */
  enter(): void;
  update(dt: number): void;
  /** Gespeicherte Weltkoordinaten nach einer Ursprungsverschiebung umrechnen. */
  applyOriginShift(d: Matrix4): void;
  exit(): void;
}

/** Mausempfindlichkeit in Grad pro Pixel. */
export const LOOK_DEG_PER_PX = 0.12;
/** Grenze der Neigung, damit die Kamera nicht überschlägt. */
export const MAX_PITCH_DEG = 89;

/** Near/Far außerhalb der Globus-Kamera: Near wächst mit der Höhe, Far = Horizont + Gebirge. */
export function clipPlanes(
  heightAboveGroundM: number,
  heightM: number,
): { near: number; far: number } {
  const near = Math.min(100, Math.max(0.1, heightAboveGroundM * 0.02));
  const R = 6_371_000;
  const horizon = (h: number): number => Math.sqrt(Math.max(0, 2 * R * h + h * h));
  // Berge bis 9 km hinter dem eigenen Horizont noch sichtbar
  const far = horizon(Math.max(heightM, 10)) + horizon(9_000);
  return { near, far };
}
