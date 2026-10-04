import type { ImpulseJoint, RigidBody } from '@dimforge/rapier3d-compat';
import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, Vector3 } from 'three';
import { MATERIALS } from '../../physics/world';
import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

/** Kugelradius aus Masse (Stahl). */
export function ballRadius(massKg: number): number {
  return Math.cbrt((3 * massKg) / (4 * Math.PI * MATERIALS.metal.density));
}

/**
 * `wrecking-ball` (Spec 8): Kranpunkt über dem Ziel, Stahlkugel an einem Seil (Rapier-Seilgelenk),
 * 60° zur Kamera hin ausgelenkt; sie schwingt durch den Klickpunkt.
 */
export function createWreckingBallTool(): Tool {
  const tt = t.tools['wrecking-ball'];
  return {
    id: 'wrecking-ball',
    name: tt.name,
    tier: 2,
    icon: 'wrecking',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'mass',
        label: tt.mass,
        type: 'number',
        min: 500,
        max: 5_000,
        step: 100,
        unit: 'kg',
        default: 2_000,
      },
      {
        key: 'length',
        label: tt.length,
        type: 'number',
        min: 5,
        max: 30,
        step: 1,
        unit: 'm',
        default: 12,
      },
    ],
    onPointerDown(hit, ctx, params) {
      const physics = ctx.physics;
      const R = physics.R;
      const mass = num(params.mass, 2_000);
      const length = num(params.length, 12);
      const r = ballRadius(mass);
      // Kranpunkt: Seillänge über dem Treffpunkt (Kugelmitte streift das Ziel)
      const anchorPos = hit.local.clone().add(new Vector3(0, length + r * 0.5, 0));
      const cam = physics.worldToBubble(ctx.view.position);
      const away = new Vector3(cam.x - hit.local.x, 0, cam.z - hit.local.z);
      if (away.lengthSq() < 1e-6) away.set(1, 0, 0);
      away.normalize();
      const angle = (60 * Math.PI) / 180;
      const ballPos = anchorPos
        .clone()
        .addScaledVector(away, Math.sin(angle) * length)
        .add(new Vector3(0, -Math.cos(angle) * length, 0));

      const anchor: RigidBody = physics.world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(anchorPos.x, anchorPos.y, anchorPos.z),
      );
      const { rb, collider } = physics.createDynamic(
        ballPos.x,
        ballPos.y,
        ballPos.z,
        R.ColliderDesc.ball(r).setDensity(MATERIALS.metal.density).setFriction(0.4),
        (d) => d.setCanSleep(false).setCcdEnabled(true),
      );
      const joint: ImpulseJoint = physics.world.createImpulseJoint(
        R.JointData.rope(length, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
        anchor,
        rb,
        true,
      );
      const body = physics.register(
        'wrecking-ball',
        rb,
        [collider],
        { pool: physics.pools.ball, color: 0x3b3f44, scale: new Vector3(r, r, r) },
        (4 / 3) * Math.PI * r ** 3,
      );
      body.pinned = true;

      // Seil als Linie vom Kranpunkt zur Kugel
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const rope = new Line(geo, new LineBasicMaterial({ color: 0x222222 }));
      rope.frustumCulled = false;
      physics.group.add(rope);
      body.onStep = () => {
        const pos = geo.getAttribute('position') as Float32BufferAttribute;
        pos.setXYZ(0, anchorPos.x, anchorPos.y, anchorPos.z);
        pos.setXYZ(1, body.pos.x, body.pos.y, body.pos.z);
        pos.needsUpdate = true;
      };
      body.onRemove = () => {
        physics.removeJoint(joint);
        physics.world.removeRigidBody(anchor);
        rope.removeFromParent();
        geo.dispose();
      };
    },
  };
}
