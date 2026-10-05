import { t } from '../../ui/i18n';
import { FLOOD_MAX_M } from '../../world/water/water';
import { num, type Tool } from '../Tool';

/**
 * `flood` (Spec 8): hebt den Wasserspiegel in der Blase auf 0 bis 50 m über dem tiefsten Punkt.
 * Ein Klick setzt die Blase und startet die Flut; danach wirkt der Regler sofort.
 */
export function createFloodTool(): Tool {
  const tt = t.tools.flood;
  let hinted = false;
  const fmt = (v: number): string => v.toLocaleString(t.locale, { maximumFractionDigits: 0 });
  return {
    id: 'flood',
    name: tt.name,
    tier: 1,
    icon: 'water',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'level',
        label: tt.level,
        type: 'number',
        min: 0,
        max: FLOOD_MAX_M,
        step: 1,
        unit: 'm',
        default: 8,
      },
    ],
    onPointerDown(_hit, ctx, params) {
      const level = num(params.level, 8);
      ctx.water.setTarget(level);
      ctx.toast('info', tt.rising.replace('{m}', fmt(level)));
    },
    onParams(params, env) {
      const level = num(params.level, 8);
      if (env.physics?.frame) {
        env.water.setTarget(level);
      } else if (!hinted) {
        hinted = true;
        env.toast('info', tt.clickFirst);
      }
    },
  };
}
