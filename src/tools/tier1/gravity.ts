import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

/** Grenzen laut Spec 8: 0 bis 3 g. */
export const GRAVITY_MIN_G = 0;
export const GRAVITY_MAX_G = 3;

/**
 * `gravity` (Spec 8): Schwerkraft der Blase als Vielfaches von g, wirkt sofort und global auf alle
 * Körper der Blase (auch nach dem Abwählen, bis sie wieder geändert wird).
 */
export function createGravityTool(): Tool {
  const tt = t.tools.gravity;
  return {
    id: 'gravity',
    name: tt.name,
    tier: 1,
    icon: 'gravity',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'g',
        label: tt.g,
        type: 'number',
        min: GRAVITY_MIN_G,
        max: GRAVITY_MAX_G,
        step: 0.05,
        unit: 'g',
        default: 1,
      },
    ],
    onActivate(env) {
      // Regler zeigt die aktuelle Schwere (eine neue Physikwelt startet mit 1 g)
      env.setParams({ g: env.physics?.gravityScale ?? 1 });
    },
    onParams(params, env) {
      env.physics?.setGravityScale(
        Math.min(GRAVITY_MAX_G, Math.max(GRAVITY_MIN_G, num(params.g, 1))),
      );
    },
  };
}
