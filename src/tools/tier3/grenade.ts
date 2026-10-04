import { Vector3 } from 'three';
import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';
import { createGrenade } from './projectiles';

/** Start so weit vor der Kamera, damit die Granate nicht im Bild „klebt“. */
const LAUNCH_OFFSET_M = 1.5;
/** Ist die Kamera weiter weg, wird die Granate aus dieser Entfernung zum Ziel geworfen. */
const MAX_THROW_DISTANCE_M = 40;

/** `grenade` (Spec 8): Handgranate werfen; nach dem Zünder explodiert sie (0,2–2 kg TNT). */
export function createGrenadeTool(): Tool {
  const tt = t.tools.grenade;
  return {
    id: 'grenade',
    name: tt.name,
    tier: 3,
    icon: 'grenade',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'charge',
        label: tt.charge,
        type: 'number',
        min: 0.2,
        max: 2,
        step: 0.1,
        unit: 'kg',
        default: 0.5,
      },
      {
        key: 'fuse',
        label: tt.fuse,
        type: 'number',
        min: 1,
        max: 6,
        step: 0.5,
        unit: 's',
        default: 3,
      },
      {
        key: 'speed',
        label: tt.speed,
        type: 'number',
        min: 5,
        max: 35,
        step: 1,
        unit: 'm/s',
        default: 16,
      },
    ],
    onPointerDown(hit, ctx, params) {
      const physics = ctx.physics;
      const charge = num(params.charge, 0.5);
      const fuse = num(params.fuse, 3);
      const speed = num(params.speed, 16);
      const cam = physics.worldToBubble(hit.ray.origin);
      const dir = physics.dirToBubble(hit.ray.direction, new Vector3()).normalize();
      let start: Vector3;
      if (cam.distanceTo(hit.local) > MAX_THROW_DISTANCE_M) {
        // SIMPLIFIED: aus großer Entfernung „wirft“ ein unsichtbarer Werfer nahe am Ziel
        start = hit.local.clone().addScaledVector(dir, -MAX_THROW_DISTANCE_M * 0.5);
        start.y += 2;
      } else {
        start = cam.addScaledVector(dir, LAUNCH_OFFSET_M);
      }
      // Leicht nach oben werfen, damit die Granate im Bogen ankommt
      const v = dir.multiplyScalar(speed);
      v.y += Math.min(4, speed * 0.2);
      const body = createGrenade(physics, start, v);
      let age = 0;
      ctx.addTask((dt) => {
        if (!body.rb) return true;
        age += dt;
        if (age < fuse) return false;
        const pos = body.pos.clone();
        physics.removeBody(body);
        const burst = Math.max(0, pos.y - physics.groundY(pos.x, pos.z) - 0.1);
        ctx.explosions.detonate(pos, charge, { burstHeightM: burst, source: 'grenade' });
        return true;
      });
    },
  };
}
