import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

/** `eraser` (Spec 8): entfernt das getroffene Objekt bzw. alle Objekte im Radius. */
export function createEraserTool(): Tool {
  const tt = t.tools.eraser;
  return {
    id: 'eraser',
    name: tt.name,
    tier: 0,
    icon: 'eraser',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'radius',
        label: tt.radius,
        type: 'number',
        min: 0,
        max: 20,
        step: 1,
        unit: 'm',
        default: 0,
      },
    ],
    onPointerDown(hit, ctx, params) {
      const r = num(params.radius, 0);
      if (hit.body) ctx.physics.removeBody(hit.body, true);
      if (r > 0)
        for (const b of ctx.physics.bodiesNear(hit.local, r)) ctx.physics.removeBody(b, true);
    },
  };
}
