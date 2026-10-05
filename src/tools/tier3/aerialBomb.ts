import { Vector3 } from 'three';
import { STANDARD_GRAVITY } from '../../core/constants';
import { t } from '../../ui/i18n';
import { yawTowards } from '../shared';
import { num, type Tool } from '../Tool';
import { bombScale, createBombVisual, fallTime } from './projectiles';

/** Nach dem Einschlag bleibt die Kamera so lange auf der Einschlagstelle (s). */
const IMPACT_HOLD_S = 4;
/** Liegt der Treffer so weit über dem Gelände, gilt er als Dach (m). */
const ROOF_MIN_M = 1.5;

/**
 * `aerial-bomb` (Spec 8): Die Bombe fällt aus der Abwurfhöhe senkrecht auf den Klickpunkt,
 * Fallzeit t = √(2h/g); die Verfolgerkamera hängt sich daran. 50 bis 1 000 kg TNT.
 */
export function createAerialBombTool(): Tool {
  const tt = t.tools['aerial-bomb'];
  return {
    id: 'aerial-bomb',
    name: tt.name,
    tier: 3,
    icon: 'bomb',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'charge',
        label: tt.charge,
        type: 'number',
        min: 50,
        max: 1_000,
        step: 50,
        unit: 'kg',
        default: 500,
      },
      {
        key: 'height',
        label: tt.height,
        type: 'number',
        min: 100,
        max: 3_000,
        step: 100,
        unit: 'm',
        default: 600,
      },
      { key: 'follow', label: tt.follow, type: 'boolean', default: true },
    ],
    onPointerDown(hit, ctx, params) {
      const physics = ctx.physics;
      const tnt = num(params.charge, 500);
      const height = num(params.height, 600);
      // SIMPLIFIED: Luftwiderstand vernachlässigt; die Bombe durchschlägt Dächer und zündet
      // am Boden (Verzögerungszünder), daher Ziel = Gelände unter dem Treffpunkt
      const target = hit.local.clone();
      const groundY = physics.groundY(target.x, target.z);
      if (hit.buildingId !== null || target.y - groundY > ROOF_MIN_M) target.y = groundY;
      const startY = target.y + height;
      const total = fallTime(height, STANDARD_GRAVITY);

      const carrier = createBombVisual(bombScale(tnt));
      const cam = physics.worldToBubble(ctx.view.position);
      carrier.rotation.y = yawTowards(cam, target);
      carrier.position.set(target.x, startY, target.z);
      physics.group.add(carrier);
      carrier.updateMatrixWorld(true);
      const follow = params.follow !== false;
      if (follow) {
        ctx.camera.follow.setTarget(carrier, { distance: 45, height: 12, useObjectForward: true });
        ctx.camera.setMode('follow');
      }

      let time = 0;
      let exploded = false;
      const frame = physics.frame;
      ctx.addTask((dt) => {
        // Neue Blase: Bombe verwerfen
        if (physics.frame !== frame) {
          carrier.removeFromParent();
          return true;
        }
        time += dt;
        if (!exploded) {
          const fall = Math.min(total, time);
          carrier.position.y = startY - 0.5 * STANDARD_GRAVITY * fall * fall;
          if (time < total) return false;
          exploded = true;
          time = 0;
          carrier.position.copy(target);
          carrier.children[0]!.visible = false;
          ctx.explosions.detonate(new Vector3().copy(target), tnt, {
            burstHeightM: 0,
            source: 'aerial-bomb',
          });
          if (follow) {
            // Weiter weg, damit Feuerball und Rauchsäule ins Bild passen
            ctx.camera.follow.setTarget(carrier, {
              distance: 90 + 6 * Math.cbrt(tnt),
              height: 35 + 3 * Math.cbrt(tnt),
              useObjectForward: true,
            });
          }
          return false;
        }
        if (time < IMPACT_HOLD_S) return false;
        // Ziel verschwindet: die Verfolgerkamera kehrt zur vorherigen Ansicht zurück
        carrier.removeFromParent();
        return true;
      });
    },
  };
}
