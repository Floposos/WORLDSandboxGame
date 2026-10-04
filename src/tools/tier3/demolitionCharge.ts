import { Quaternion, Vector3, type Mesh } from 'three';
import { isTyping } from '../../camera/input';
import type { LocalFrame } from '../../core/geo';
import { t } from '../../ui/i18n';
import { explosionSummary, sumResults, type ExplosionResult } from '../explosions';
import { num, type Tool, type ToolContext } from '../Tool';
import { createChargeVisual } from './projectiles';

/** Höchstzahl gleichzeitig gesetzter Ladungen. */
export const MAX_CHARGES = 24;
/** Taste zum gemeinsamen Zünden. */
export const DETONATE_KEY = 'KeyX';

interface Charge {
  mesh: Mesh;
  pos: Vector3;
  tnt: number;
}

const _z = new Vector3(0, 0, 1);

/**
 * `demolition-charge` (Spec 8): Ladungen an Wände heften (Klick) und mit X gemeinsam zünden.
 * Die Taste wirkt auch, wenn danach ein anderes Werkzeug gewählt ist.
 */
export function createDemolitionChargeTool(): Tool {
  const tt = t.tools['demolition-charge'];
  const charges: Charge[] = [];
  let frame: LocalFrame | null = null;
  let ctxRef: ToolContext | null = null;
  let listening = false;

  const clear = (): void => {
    for (const c of charges) c.mesh.removeFromParent();
    charges.length = 0;
  };

  const detonateAll = (): void => {
    const ctx = ctxRef;
    if (!ctx) return;
    if (charges.length === 0 || ctx.physics.frame !== frame) {
      clear();
      ctx.toast('info', tt.none);
      return;
    }
    const list = charges.splice(0);
    const results: ExplosionResult[] = [];
    for (const c of list) {
      c.mesh.removeFromParent();
      const ground = ctx.physics.groundY(c.pos.x, c.pos.z);
      results.push(
        ctx.explosions.detonate(c.pos, c.tnt, {
          burstHeightM: Math.max(0, c.pos.y - ground - 0.3),
          source: 'demolition-charge',
          toast: false,
        }),
      );
    }
    ctx.toast('info', explosionSummary(sumResults(results)));
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== DETONATE_KEY || e.repeat || isTyping(e) || e.ctrlKey || e.metaKey) return;
    if (charges.length === 0) return;
    e.preventDefault();
    detonateAll();
  };

  return {
    id: 'demolition-charge',
    name: tt.name,
    tier: 3,
    icon: 'charge',
    description: tt.description,
    needsPhysics: true,
    hotkey: 'X',
    params: [
      {
        key: 'charge',
        label: tt.charge,
        type: 'number',
        min: 0.5,
        max: 50,
        step: 0.5,
        unit: 'kg',
        default: 5,
      },
    ],
    onPointerDown(hit, ctx, params) {
      const physics = ctx.physics;
      ctxRef = ctx;
      if (!listening) {
        listening = true;
        window.addEventListener('keydown', onKey);
      }
      // Neue Blase: alte Ladungen sind ungültig
      if (physics.frame !== frame) {
        clear();
        frame = physics.frame;
      }
      if (charges.length >= MAX_CHARGES) charges.shift()?.mesh.removeFromParent();
      const mesh = createChargeVisual();
      const n = hit.localNormal.clone().normalize();
      mesh.quaternion.copy(new Quaternion().setFromUnitVectors(_z, n));
      // Rückseite an die Fläche
      mesh.position.copy(hit.local).addScaledVector(n, 0.04);
      physics.group.add(mesh);
      charges.push({
        mesh,
        pos: hit.local.clone().addScaledVector(n, 0.15),
        tnt: num(params.charge, 5),
      });
      ctx.toast('info', tt.placed.replace('{n}', String(charges.length)));
    },
  };
}
