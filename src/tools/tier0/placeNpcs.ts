import { Vector3 } from 'three';
import { createNpc } from '../../physics/bodies';
import { sampleHeightfield } from '../../physics/terrain';
import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

/** `place-npcs` (Spec 8): 1–200 abstrakte Kapseln, verstreut um den Klickpunkt. */
export function createPlaceNpcsTool(): Tool {
  const tt = t.tools['place-npcs'];
  return {
    id: 'place-npcs',
    name: tt.name,
    tier: 0,
    icon: 'people',
    description: tt.description,
    needsPhysics: true,
    params: [
      { key: 'count', label: tt.count, type: 'number', min: 1, max: 200, step: 1, default: 20 },
    ],
    onPointerDown(hit, ctx, params) {
      const n = Math.round(num(params.count, 20));
      const spread = 2 + Math.sqrt(n) * 1.2;
      const hf = ctx.physics.terrainData;
      for (let i = 0; i < n; i++) {
        const a = ctx.rng.next() * Math.PI * 2;
        const r = Math.sqrt(ctx.rng.next()) * spread;
        const p = new Vector3(hit.local.x + Math.cos(a) * r, 0, hit.local.z + Math.sin(a) * r);
        // Auf Dächern bleiben sie auf der Klickhöhe, sonst auf dem Gelände
        p.y = hf ? Math.max(sampleHeightfield(hf, p.x, p.z), hit.local.y) : hit.local.y;
        createNpc(ctx.physics, p, i);
      }
    },
  };
}
