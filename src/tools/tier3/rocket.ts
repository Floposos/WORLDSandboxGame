import { Vector3 } from 'three';
import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';
import { createRocketVisual } from './projectiles';

/** Start vor der Kamera (m). */
const LAUNCH_OFFSET_M = 3;
/** Längster Flugweg; weiter entfernte Kameras starten die Rakete näher am Ziel (m). */
const MAX_RANGE_M = 600;
/** Rauchpuffs je Sekunde im Schweif. */
const TRAIL_RATE = 60;

/**
 * `rocket` (Spec 8): Rakete fliegt von der Kamera geradlinig zum Ziel und explodiert dort.
 * SIMPLIFIED: Flugbahn ohne Schwerkraft und ohne Kollision unterwegs (das Ziel stand beim
 * Abschuss fest).
 */
export function createRocketTool(): Tool {
  const tt = t.tools.rocket;
  return {
    id: 'rocket',
    name: tt.name,
    tier: 3,
    icon: 'rocket',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'charge',
        label: tt.charge,
        type: 'number',
        min: 1,
        max: 25,
        step: 1,
        unit: 'kg',
        default: 4,
      },
      {
        key: 'speed',
        label: tt.speed,
        type: 'number',
        min: 50,
        max: 300,
        step: 10,
        unit: 'm/s',
        default: 140,
      },
    ],
    onPointerDown(hit, ctx, params) {
      const physics = ctx.physics;
      const tnt = num(params.charge, 4);
      const speed = num(params.speed, 140);
      const dir = physics.dirToBubble(hit.ray.direction, new Vector3()).normalize();
      // Knapp vor der Oberfläche zünden
      const target = hit.local.clone().addScaledVector(hit.localNormal, 0.3);
      const cam = physics.worldToBubble(hit.ray.origin);
      let start = cam.addScaledVector(dir, LAUNCH_OFFSET_M);
      if (start.distanceTo(target) > MAX_RANGE_M) {
        start = target.clone().addScaledVector(dir, -MAX_RANGE_M);
      }
      const path = target.clone().sub(start);
      const length = path.length();
      path.normalize();

      const rocket = createRocketVisual();
      rocket.position.copy(start);
      rocket.lookAt(start.clone().sub(path)); // lookAt richtet +z aus; Spitze liegt auf −z
      physics.group.add(rocket);
      const glowPos = new Vector3();
      let travelled = 0;
      let trail = 0;
      const frame = physics.frame;
      ctx.addTask((dt) => {
        if (physics.frame !== frame) {
          rocket.removeFromParent();
          return true;
        }
        travelled = Math.min(length, travelled + speed * dt);
        rocket.position.copy(start).addScaledVector(path, travelled);
        trail += TRAIL_RATE * dt;
        while (trail >= 1) {
          trail -= 1;
          glowPos.copy(rocket.position).addScaledVector(path, -0.6);
          ctx.effects.trail(glowPos);
        }
        if (travelled < length) return false;
        rocket.removeFromParent();
        const burst = Math.max(0, target.y - physics.groundY(target.x, target.z) - 0.3);
        ctx.explosions.detonate(target, tnt, { burstHeightM: burst, source: 'rocket' });
        return true;
      });
    },
  };
}
