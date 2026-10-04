import { Vector3 } from 'three';
import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

/** Halber Öffnungswinkel des Kegels. */
export const PUSH_HALF_ANGLE_DEG = 25;

/**
 * Stoßstärke für einen Körper (rein, testbar): Geschwindigkeitsänderung in m/s, 0 außerhalb des
 * Kegels oder der Reichweite, linear abfallend mit Entfernung und Winkel.
 */
export function pushFalloff(
  distance: number,
  angleDeg: number,
  range: number,
  strength: number,
): number {
  if (distance > range || angleDeg > PUSH_HALF_ANGLE_DEG) return 0;
  return strength * (1 - distance / range) * (1 - (angleDeg / PUSH_HALF_ANGLE_DEG) * 0.5);
}

const _d = new Vector3();

/** `force-push` (Spec 8): Kraftstoß als Kegel von der Kamera in Klickrichtung, ohne Explosion. */
export function createForcePushTool(): Tool {
  const tt = t.tools['force-push'];
  return {
    id: 'force-push',
    name: tt.name,
    tier: 2,
    icon: 'push',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'strength',
        label: tt.strength,
        type: 'number',
        min: 1,
        max: 50,
        step: 1,
        unit: 'm/s',
        default: 15,
      },
      {
        key: 'range',
        label: tt.range,
        type: 'number',
        min: 5,
        max: 150,
        step: 5,
        unit: 'm',
        default: 60,
      },
    ],
    onPointerDown(hit, ctx, params) {
      const physics = ctx.physics;
      const apex = physics.worldToBubble(hit.ray.origin);
      const axis = physics.dirToBubble(hit.ray.direction, new Vector3()).normalize();
      const range = num(params.range, 60);
      const strength = num(params.strength, 15);
      for (const b of physics.bodiesNear(apex, range)) {
        if (!b.rb) continue;
        _d.subVectors(b.pos, apex);
        const dist = _d.length();
        if (dist < 1e-3) continue;
        const angle = (Math.acos(Math.min(1, _d.dot(axis) / dist)) * 180) / Math.PI;
        const dv = pushFalloff(dist, angle, range, strength);
        if (dv <= 0) continue;
        if (b.frozen) physics.unfreeze(b);
        _d.normalize()
          .add(new Vector3(0, 0.25, 0))
          .normalize();
        const m = b.rb.mass();
        b.rb.applyImpulse({ x: _d.x * dv * m, y: _d.y * dv * m, z: _d.z * dv * m }, true);
      }
    },
  };
}
