import { Vector3 } from 'three';
import { createBall } from '../../physics/bodies';
import { t } from '../../ui/i18n';
import { asMaterial, materialParam } from '../shared';
import { num, type Tool } from '../Tool';

/** `place-ball` (Spec 8): Kugel mit Radius und Material. */
export function createPlaceBallTool(): Tool {
  const tt = t.tools['place-ball'];
  return {
    id: 'place-ball',
    name: tt.name,
    tier: 0,
    icon: 'ball',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'radius',
        label: tt.radius,
        type: 'number',
        min: 0.2,
        max: 3,
        step: 0.1,
        unit: 'm',
        default: 0.5,
      },
      materialParam(tt.material, 'rubber', ['rubber', 'wood', 'concrete', 'metal']),
    ],
    onPointerDown(hit, ctx, params) {
      const r = num(params.radius, 0.5);
      createBall(
        ctx.physics,
        hit.local.clone().add(new Vector3(0, r + 0.02, 0)),
        r,
        asMaterial(params.material),
      );
    },
  };
}
