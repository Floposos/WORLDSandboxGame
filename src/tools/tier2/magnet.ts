import { Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import type { SimBody } from '../../physics/world';
import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

/** Magnet schwebt so hoch über dem Klickpunkt (m). */
export const MAGNET_LIFT_M = 4;

/**
 * Beschleunigung zum Magneten (rein, testbar) in m/s²: `strength` · g am Magneten, linear auf 0
 * am Rand des Radius; im innersten Meter gedämpft, damit Objekte nicht durchschießen.
 */
export function magnetAccel(distance: number, radius: number, strength: number): number {
  if (distance >= radius) return 0;
  const core = Math.min(1, distance);
  return strength * 9.81 * (1 - distance / radius) * core;
}

const _d = new Vector3();
// Scratch für den festen Schritt (Spec 11: keine Allokation pro Frame)
const _near: SimBody[] = [];
const _impulse = { x: 0, y: 0, z: 0 };

/** `magnet` (Spec 8): zieht Körper im Radius an; Klick setzt bzw. entfernt den Magneten. */
export function createMagnetTool(): Tool {
  const tt = t.tools.magnet;
  let at: Vector3 | null = null;
  let strength = 2;
  let radius = 25;
  const marker = new Mesh(
    new SphereGeometry(0.6, 16, 12),
    new MeshBasicMaterial({ color: 0xd7263d }),
  );
  const off = (): void => {
    at = null;
    marker.removeFromParent();
  };
  return {
    id: 'magnet',
    name: tt.name,
    tier: 2,
    icon: 'magnet',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'strength',
        label: tt.strength,
        type: 'number',
        min: 0.5,
        max: 10,
        step: 0.5,
        unit: 'g',
        default: 2,
      },
      {
        key: 'radius',
        label: tt.radius,
        type: 'number',
        min: 5,
        max: 60,
        step: 5,
        unit: 'm',
        default: 25,
      },
    ],
    onDeselect: off,
    onPointerDown(hit, ctx, params) {
      strength = num(params.strength, 2);
      radius = num(params.radius, 25);
      if (at && at.distanceTo(hit.local) < 3) return off();
      at = hit.local.clone().add(new Vector3(0, MAGNET_LIFT_M, 0));
      marker.position.copy(at);
      ctx.physics.group.add(marker);
      ctx.physics.wakeNear(at, radius);
    },
    onUpdate(dt, ctx) {
      if (!at || !ctx.physics.ready) return;
      for (const b of ctx.physics.bodiesNear(at, radius, _near)) {
        if (!b.rb || b.kind === 'wrecking-ball') continue;
        _d.subVectors(at, b.pos);
        const a = magnetAccel(_d.length(), radius, strength);
        if (a <= 0) continue;
        if (b.frozen) ctx.physics.unfreeze(b);
        const k = (a * dt * b.rb.mass()) / Math.max(1e-3, _d.length());
        _impulse.x = _d.x * k;
        _impulse.y = _d.y * k;
        _impulse.z = _d.z * k;
        b.rb.applyImpulse(_impulse, true);
      }
    },
  };
}
