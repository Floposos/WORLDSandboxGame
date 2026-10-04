import { Vector3 } from 'three';
import { createBox } from '../../physics/bodies';
import { t } from '../../ui/i18n';
import { asMaterial, materialParam, stackOffsets } from '../shared';
import { num, type Tool } from '../Tool';

/** Fallhöhe über dem Ziel, damit Stapel sichtbar herunterfallen (Abnahme M3: Kisten aufs Dach). */
export const DROP_HEIGHT_M = 3;

/** `place-box` (Spec 8): Kiste 0,5–5 m, Material → Dichte; Anzahl > 1 ergibt einen Stapel. */
export function createPlaceBoxTool(): Tool {
  const tt = t.tools['place-box'];
  return {
    id: 'place-box',
    name: tt.name,
    tier: 0,
    icon: 'box',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'size',
        label: tt.size,
        type: 'number',
        min: 0.5,
        max: 5,
        step: 0.5,
        unit: 'm',
        default: 1,
      },
      materialParam(tt.material, 'wood'),
      { key: 'count', label: tt.count, type: 'number', min: 1, max: 200, step: 1, default: 1 },
    ],
    onPointerDown(hit, ctx, params) {
      const size = num(params.size, 1);
      const count = Math.round(num(params.count, 1));
      const material = asMaterial(params.material);
      const base = hit.local.clone().add(new Vector3(0, count > 1 ? DROP_HEIGHT_M : 0.02, 0));
      for (const o of stackOffsets(count, size)) {
        createBox(ctx.physics, base.clone().add(o), size, material);
      }
    },
  };
}
