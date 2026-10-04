import { Car } from '../../physics/vehicle';
import { t } from '../../ui/i18n';
import { yawTowards } from '../shared';
import type { Tool } from '../Tool';

/** `place-car` (Spec 8): Chassis + 4 Räder (Raycast-Fahrzeug von Rapier), fahrbar. */
export function createPlaceCarTool(): Tool {
  const tt = t.tools['place-car'];
  let colors = 0;
  return {
    id: 'place-car',
    name: tt.name,
    tier: 0,
    icon: 'car',
    description: tt.description,
    needsPhysics: true,
    params: [{ key: 'drive', label: tt.drive, type: 'boolean', default: true }],
    onPointerDown(hit, ctx, params) {
      const cam = ctx.physics.worldToBubble(ctx.view.position);
      // Auto steht quer zur Blickrichtung? Nein: mit dem Heck zur Kamera, damit „W“ wegfährt.
      const yaw = yawTowards(cam, hit.local) + Math.PI;
      const car = new Car(ctx.physics, hit.local, yaw, colors++);
      ctx.driving.add(car);
      if (params.drive === true) {
        ctx.driving.enter(car);
        ctx.toast('info', t.tools.driveHint);
      }
    },
  };
}
