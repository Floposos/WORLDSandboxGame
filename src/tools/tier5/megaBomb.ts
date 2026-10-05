import { Vector3 } from 'three';
import { TNT_J_PER_KG } from '../../core/constants';
import { haversineDistance } from '../../core/geo';
import type { GeoPoint } from '../../core/types';
import { craterSize } from '../../physics/blast';
import {
  airburstHeightM,
  ktToKg,
  MEGA_MAX_KT,
  MEGA_MIN_KT,
  mushroomSize,
  yieldRadii,
  type YieldRadii,
} from '../../physics/nuclear';
import { t } from '../../ui/i18n';
import type { GlobeEffects } from '../../world/globeFx/globeEffects';
import { formatEnergy, formatLength, formatTnt, type Detonator } from '../explosions';
import { num, type Tool } from '../Tool';
import type { PhysicsWorld } from '../../physics/world';

/** Die Druckwelle läuft in dieser Zeit bis zur leichten Zerstörung (s; real Minuten, SIMPLIFIED). */
export const MEGA_SHOCK_S = 12;
/** So lange bleiben die Wirkungsringe stehen (s). */
export const MEGA_RINGS_HOLD_S = 90;
/** Bodendetonation: Krater kleiner als bei konventionellem Sprengstoff gleicher Energie. */
const NUCLEAR_CRATER_FACTOR = 0.35;
/** Höchstens so viele Gebäude brechen in Stücke, der Rest stürzt still ein (Rechenzeit). */
const MAX_FRACTURED = 40;

/** Sprengkraft lesbar: kt, ab 1 000 kt in Mt. */
export function formatYieldKt(kt: number): string {
  return formatTnt(ktToKg(kt));
}

/** Auf zwei geltende Ziffern runden (Schieberegler in logarithmischer Teilung). */
export function roundYield(kt: number): number {
  const v = Math.min(MEGA_MAX_KT, Math.max(MEGA_MIN_KT, kt));
  const p = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

/** Bilanz für den Toast: Energie und Wirkungsradien, keine Opferzahlen (Spec 8). */
export function megaSummary(kt: number, r: YieldRadii): string {
  const tnt = ktToKg(kt);
  return t.tools['mega-bomb'].summary
    .replace('{tnt}', formatTnt(tnt))
    .replace('{energy}', formatEnergy(tnt * TNT_J_PER_KG))
    .replace('{fireball}', formatLength(r.fireballM))
    .replace('{heavy}', formatLength(r.heavyM))
    .replace('{light}', formatLength(r.lightM));
}

/** Globus-Effekte der Detonation: Ringe, Druckwelle, Blitz, Pilzwolke, Staub. */
export function megaGlobeEffects(
  fx: GlobeEffects,
  geo: GeoPoint,
  kt: number,
  showRings: boolean,
): YieldRadii {
  const radii = yieldRadii(kt);
  const cloud = mushroomSize(kt);
  const shockMax = radii.lightM * 1.6;
  fx.add({
    geo,
    rings: showRings ? { ...radii, holdS: MEGA_RINGS_HOLD_S } : undefined,
    shock: { maxM: shockMax, speedMs: shockMax / MEGA_SHOCK_S },
    flash: { seconds: 2.5 },
    // Schatten der Wolke von oben: aus dem All als Fleck zu sehen
    dust: { maxM: cloud.capRadiusM * 1.3, growS: 25, alpha: 0.55, holdS: 150 },
  });
  if (showRings) fx.groundRings(geo, radii, shockMax / MEGA_SHOCK_S, MEGA_RINGS_HOLD_S);
  fx.mushroom(geo, cloud);
  return radii;
}

/** Druckwelle in der Blase, falls sie in Reichweite liegt (Explosion im Blasen-Frame). */
function blastInBubble(
  physics: PhysicsWorld | null,
  explosions: Detonator | null,
  geo: GeoPoint,
  kt: number,
  ground: boolean,
  radii: YieldRadii,
): void {
  if (!physics?.frame || !explosions) return;
  const center = physics.bubbleToGeo(new Vector3());
  if (haversineDistance(center, geo) > radii.lightM + physics.radius) return;
  const pos = physics.geoToBubble(geo);
  pos.y = physics.groundY(pos.x, pos.z);
  const tnt = ktToKg(kt);
  const burst = ground ? 0 : airburstHeightM(kt);
  const crater = ground ? craterSize(tnt * NUCLEAR_CRATER_FACTOR ** 3, 0) : null;
  explosions.detonate(pos.setY(pos.y + burst), tnt, {
    burstHeightM: burst,
    source: 'mega-bomb',
    toast: false,
    crater,
    // Im Feuerball bleibt nichts stehen (bei Luftdetonation reicht er nicht ganz zum Boden)
    vaporizeRadiusM: ground ? radii.fireballM : radii.fireballM * 0.6,
    maxBuildings: MAX_FRACTURED,
  });
}

/**
 * `mega-bomb` (Spec 8, Stufe 5): Sprengkraft 1 kt bis 50 Mt. Zeigt die Wirkungsradien als Ringe
 * (Feuerball, schwere und leichte Zerstörung), die Druckwelle als Ring auf dem Globus über die
 * Blase hinaus und eine Pilzwolke. Abstrakt und spielerisch, ohne Opferzahlen. Aus großer Höhe
 * zielt sie direkt auf den Globus (dann nur die Globus-Effekte und, falls in Reichweite, die Blase).
 */
export function createMegaBombTool(): Tool {
  const tt = t.tools['mega-bomb'];
  return {
    id: 'mega-bomb',
    name: tt.name,
    tier: 5,
    icon: 'nuke',
    description: tt.description,
    needsPhysics: true,
    targetMode: 'both',
    params: [
      {
        key: 'yield',
        label: tt.yield,
        type: 'number',
        min: MEGA_MIN_KT,
        max: MEGA_MAX_KT,
        scale: 'log',
        unit: 'kt',
        default: 100,
        format: formatYieldKt,
      },
      {
        key: 'burst',
        label: tt.burst,
        type: 'select',
        options: [
          { value: 'air', label: tt.bursts.air },
          { value: 'ground', label: tt.bursts.ground },
        ],
        default: 'air',
      },
      { key: 'rings', label: tt.rings, type: 'boolean', default: true },
    ],
    onPointerDown(hit, ctx, params) {
      const kt = roundYield(num(params.yield, 100));
      const physics = ctx.physics;
      const target = hit.local.clone();
      target.y = physics.groundY(target.x, target.z);
      const geo = physics.bubbleToGeo(target);
      const radii = megaGlobeEffects(ctx.globeFx, geo, kt, params.rings !== false);
      blastInBubble(physics, ctx.explosions, geo, kt, params.burst === 'ground', radii);
      ctx.toast('info', megaSummary(kt, radii));
    },
    onGlobeTarget(target, ctx, params) {
      const kt = roundYield(num(params.yield, 100));
      const radii = megaGlobeEffects(ctx.globeFx, target.geo, kt, params.rings !== false);
      blastInBubble(ctx.physics, ctx.explosions, target.geo, kt, params.burst === 'ground', radii);
      const cam = ctx.view.position.distanceTo(target.point);
      ctx.audio.explosion(cam, ktToKg(kt));
      ctx.toast('info', megaSummary(kt, radii));
    },
  };
}
