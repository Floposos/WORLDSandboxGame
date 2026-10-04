import { Mesh, MeshBasicMaterial, SphereGeometry, type Vector3 } from 'three';
import { createWall } from '../../physics/bodies';
import { sampleHeightfield } from '../../physics/terrain';
import { t } from '../../ui/i18n';
import { asMaterial, materialParam } from '../shared';
import { num, type Tool } from '../Tool';

/** `place-wall` (Spec 8): Start- und Endpunkt anklicken, Mauer aus stapelbaren Blöcken. */
export function createPlaceWallTool(): Tool {
  const tt = t.tools['place-wall'];
  let start: Vector3 | null = null;
  const marker = new Mesh(
    new SphereGeometry(0.4, 12, 8),
    new MeshBasicMaterial({ color: 0xffd23f, depthTest: false }),
  );
  marker.renderOrder = 10;
  const clear = (): void => {
    start = null;
    marker.removeFromParent();
  };
  return {
    id: 'place-wall',
    name: tt.name,
    tier: 0,
    icon: 'wall',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'height',
        label: tt.height,
        type: 'number',
        min: 0.5,
        max: 6,
        step: 0.5,
        unit: 'm',
        default: 2,
      },
      materialParam(tt.material, 'concrete'),
    ],
    onDeselect: clear,
    onPointerDown(hit, ctx, params) {
      if (!start) {
        start = hit.local.clone();
        marker.position.copy(start);
        ctx.physics.group.add(marker);
        ctx.toast('info', t.tools.wallStart);
        return;
      }
      const a = start;
      clear();
      const hf = ctx.physics.terrainData;
      const groundY = (x: number, z: number): number =>
        hf ? Math.max(sampleHeightfield(hf, x, z), Math.min(a.y, hit.local.y)) : a.y;
      createWall(
        ctx.physics,
        a,
        hit.local,
        num(params.height, 2),
        asMaterial(params.material),
        groundY,
      );
    },
  };
}
