import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

/** Grenzen laut Spec 8: 0 bis 3 g. */
export const GRAVITY_MIN_G = 0;
export const GRAVITY_MAX_G = 3;

/** Oberflächenschwere von Himmelskörpern als Vielfaches der Erdschwere (NASA Fact Sheets). */
export const GRAVITY_BODIES = {
  earth: 1,
  moon: 0.165,
  mars: 0.379,
  jupiter: 2.528,
} as const;
export type GravityBody = keyof typeof GRAVITY_BODIES | 'custom';

/** Himmelskörper zu einer Schwere, sonst „eigene“. */
export function gravityBody(g: number): GravityBody {
  for (const [body, value] of Object.entries(GRAVITY_BODIES)) {
    if (Math.abs(value - g) < 1e-3) return body as GravityBody;
  }
  return 'custom';
}

/**
 * `gravity` (Spec 8): Schwerkraft der Blase als Vielfaches von g, wirkt sofort und global auf alle
 * Körper der Blase (auch nach dem Abwählen, bis sie wieder geändert wird). Vorwahlen für Erde,
 * Mond, Mars und Jupiter setzen den Regler; ein verschobener Regler zeigt „eigene“.
 */
export function createGravityTool(): Tool {
  const tt = t.tools.gravity;
  let lastBody: GravityBody = 'earth';
  const clamp = (g: number): number => Math.min(GRAVITY_MAX_G, Math.max(GRAVITY_MIN_G, g));
  return {
    id: 'gravity',
    name: tt.name,
    tier: 1,
    icon: 'gravity',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'body',
        label: tt.body,
        type: 'select',
        options: (['earth', 'moon', 'mars', 'jupiter', 'custom'] as const).map((b) => ({
          value: b,
          label: tt.bodies[b],
        })),
        default: 'earth',
      },
      {
        key: 'g',
        label: tt.g,
        type: 'number',
        min: GRAVITY_MIN_G,
        max: GRAVITY_MAX_G,
        step: 0.01,
        unit: 'g',
        default: 1,
      },
    ],
    onActivate(env) {
      // Regler zeigt die aktuelle Schwere (eine neue Physikwelt startet mit 1 g)
      const g = env.physics?.gravityScale ?? 1;
      lastBody = gravityBody(g);
      env.setParams({ g, body: lastBody });
    },
    onParams(params, env) {
      const body = String(params.body) as GravityBody;
      let g = clamp(num(params.g, 1));
      if (body !== lastBody && body !== 'custom' && body in GRAVITY_BODIES) {
        // Vorwahl gewählt: Regler folgt
        g = GRAVITY_BODIES[body];
        env.setParams({ g });
        lastBody = body;
      } else {
        // Regler bewegt: Vorwahl folgt
        lastBody = gravityBody(g);
        if (lastBody !== body) env.setParams({ body: lastBody });
      }
      env.physics?.setGravityScale(g);
    },
  };
}
