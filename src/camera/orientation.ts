import { Matrix4, Quaternion, Vector3 } from 'three';
import type { EnuBasis } from '../core/floatingOrigin';

const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _m = new Matrix4();
const _h = new Vector3();

/** Blickrichtung (Einheitsvektor) aus Kurs (0 = Nord, im Uhrzeigersinn) und Neigung in Grad. */
export function forwardFrom(
  basis: EnuBasis,
  headingDeg: number,
  pitchDeg: number,
  out = new Vector3(),
): Vector3 {
  const h = (headingDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  return out
    .copy(basis.north)
    .multiplyScalar(Math.cos(h) * Math.cos(p))
    .addScaledVector(basis.east, Math.sin(h) * Math.cos(p))
    .addScaledVector(basis.up, Math.sin(p))
    .normalize();
}

/** Kamera-Orientierung (three.js blickt entlang −Z) ohne Rollen. */
export function quaternionFrom(
  basis: EnuBasis,
  headingDeg: number,
  pitchDeg: number,
  out = new Quaternion(),
): Quaternion {
  forwardFrom(basis, headingDeg, pitchDeg, _fwd);
  // Rechts = Blick × Oben; bei senkrechtem Blick über den Kurs bestimmen.
  _right.crossVectors(_fwd, basis.up);
  if (_right.lengthSq() < 1e-10) {
    const h = (headingDeg * Math.PI) / 180;
    _right.copy(basis.east).multiplyScalar(Math.cos(h)).addScaledVector(basis.north, -Math.sin(h));
  }
  _right.normalize();
  _up.crossVectors(_right, _fwd).normalize();
  _m.makeBasis(_right, _up, _fwd.negate());
  return out.setFromRotationMatrix(_m);
}

/** Kurs und Neigung (Grad) einer Blickrichtung relativ zur lokalen ENU-Basis. */
export function headingPitchOf(
  basis: EnuBasis,
  forward: Vector3,
): { heading: number; pitch: number } {
  const f = _fwd.copy(forward).normalize();
  const sinP = Math.max(-1, Math.min(1, f.dot(basis.up)));
  const pitch = (Math.asin(sinP) * 180) / Math.PI;
  _h.copy(f).addScaledVector(basis.up, -sinP);
  const heading =
    _h.lengthSq() < 1e-12
      ? 0
      : ((Math.atan2(_h.dot(basis.east), _h.dot(basis.north)) * 180) / Math.PI + 360) % 360;
  return { heading, pitch };
}
