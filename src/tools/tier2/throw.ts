import { Vector3 } from 'three';
import { createBall, createBox } from '../../physics/bodies';
import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

/** Start so weit vor der Kamera, damit das Objekt nicht im Bild „klebt“. */
const LAUNCH_OFFSET_M = 2;

/** `throw` (Spec 8): Objekt aus der Kamera mit Geschwindigkeit in Klickrichtung werfen. */
export function createThrowTool(): Tool {
  const tt = t.tools.throw;
  return {
    id: 'throw',
    name: tt.name,
    tier: 2,
    icon: 'throw',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'speed',
        label: tt.speed,
        type: 'number',
        min: 5,
        max: 80,
        step: 1,
        unit: 'm/s',
        default: 25,
      },
      {
        key: 'shape',
        label: tt.shape,
        type: 'select',
        options: [
          { value: 'box', label: t.tools.shapes.box },
          { value: 'ball', label: t.tools.shapes.ball },
        ],
        default: 'box',
      },
      {
        key: 'size',
        label: tt.size,
        type: 'number',
        min: 0.3,
        max: 3,
        step: 0.1,
        unit: 'm',
        default: 0.8,
      },
    ],
    onPointerDown(hit, ctx, params) {
      const physics = ctx.physics;
      const dir = physics.dirToBubble(hit.ray.direction, new Vector3()).normalize();
      const start = physics.worldToBubble(hit.ray.origin).addScaledVector(dir, LAUNCH_OFFSET_M);
      const size = num(params.size, 0.8);
      const velocity = dir.multiplyScalar(num(params.speed, 25));
      if (params.shape === 'ball') createBall(physics, start, size / 2, 'rubber', { velocity });
      else createBox(physics, start, size, 'wood', { velocity });
    },
  };
}
