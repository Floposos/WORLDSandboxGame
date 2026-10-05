import { Vector3 } from 'three';
import { t } from '../../ui/i18n';
import { coneOffset, type ConeSize } from '../../world/heightPatches';
import { num, type Tool, type ToolContext } from '../Tool';

/** Flankenneigung: Basisradius = Höhe · 2,4 (≈ 23°, wie ein junger Schlackenkegel). */
export const CONE_RADIUS_FACTOR = 2.4;
/** Gipfelkrater: Anteil am Basisradius. */
export const CONE_CRATER_SHARE = 0.12;
/** So lange wächst der Kegel bis zur vollen Höhe (s). */
export const CONE_GROW_S = 20;
/** So oft wird das Physik-Gelände während des Wachsens neu gebaut (s). */
const TERRAIN_EVERY_S = 1.5;
/** So oft wächst das Mesh (s). */
const MESH_EVERY_S = 0.25;

/** Kegelmaße bei Höhe `h` (m). */
export function coneSize(h: number): ConeSize {
  const radiusM = Math.max(1, h * CONE_RADIUS_FACTOR);
  return { radiusM, heightM: Math.max(0, h), craterM: radiusM * CONE_CRATER_SHARE };
}

/** Wachstum 0…1 über die Zeit: schnell am Anfang, sanft am Ende. */
export function growth(time: number): number {
  const k = Math.min(1, Math.max(0, time / CONE_GROW_S));
  return 1 - (1 - k) ** 2;
}

const _dir = new Vector3();
const _pos = new Vector3();

/** Vulkan an `at` (Blasen-Frame) ausbrechen lassen. */
export function startVolcano(
  ctx: ToolContext,
  at: Vector3,
  heightM: number,
  activeS: number,
): void {
  const physics = ctx.physics;
  const frame = physics.frame;
  const effects = ctx.effects;
  const base = at.clone();
  base.y = physics.groundY(base.x, base.z);
  const geo = physics.bubbleToGeo(base);
  const id = ctx.craters.addCone(geo, coneSize(0.5));
  let time = 0;
  let meshAcc = 0;
  let terrainAcc = 0;
  let lavaAcc = 0;
  let ashAcc = 0;
  let current = 0.5;
  ctx.addTask((dt) => {
    time += dt;
    const growing = time < CONE_GROW_S;
    if (growing) {
      current = Math.max(0.5, heightM * growth(time));
      meshAcc += dt;
      if (meshAcc >= MESH_EVERY_S) {
        meshAcc = 0;
        // Kegel weg (zu viele Patches): Ausbruch endet
        if (!ctx.craters.updateCone(id, coneSize(current))) return true;
      }
    }
    // Neue Blase: der Kegel bleibt im Gelände, der Ausbruch hört auf
    if (physics.frame !== frame) return true;
    terrainAcc += dt;
    if (growing && terrainAcc >= TERRAIN_EVERY_S) {
      terrainAcc = 0;
      physics.rebuildTerrain();
      // Gebäude auf den Flanken werden verschüttet
      ctx.destruction?.vaporize(base, coneSize(current).radiusM * 0.75);
    }
    if (!growing && terrainAcc >= 0) {
      terrainAcc = -Infinity;
      ctx.craters.updateCone(id, coneSize(heightM));
      physics.rebuildTerrain();
      ctx.destruction?.vaporize(base, coneSize(heightM).radiusM * 0.75);
    }
    // Kraterboden des aktuellen Kegels
    const summit = _pos.copy(base);
    summit.y += coneOffset(0, coneSize(current)) + 1;
    if (time > activeS) return true;
    // Aschesäule: dunkle Wolken steigen aus dem Krater und treiben mit dem Wind
    ashAcc += dt * 10;
    while (ashAcc >= 1) {
      ashAcc -= 1;
      _dir.set(effects.range(-0.2, 0.2), 1, effects.range(-0.2, 0.2));
      effects.emit('smoke', summit, _dir, effects.range(8, 16), {
        life: effects.range(18, 32),
        size0: 10,
        size1: effects.range(45, 80),
        r: 0.16,
        g: 0.15,
        b: 0.15,
        a: 0.7,
        drag: 0.12,
        rise: effects.range(4, 8),
        wind: 1,
      });
    }
    // Lavafontäne: glühende Brocken fliegen ballistisch aus dem Krater
    lavaAcc += dt * (growing ? 70 : 35);
    while (lavaAcc >= 1) {
      lavaAcc -= 1;
      const a = effects.range(0, Math.PI * 2);
      const spread = effects.range(0.05, 0.45);
      _dir.set(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize();
      effects.emit('glow', summit, _dir, effects.range(25, 55), {
        life: effects.range(2.5, 5),
        size0: effects.range(1.5, 3.5),
        size1: effects.range(0.8, 1.6),
        r: 1,
        g: effects.range(0.25, 0.5),
        b: 0.05,
        a: 1,
        endTint: 0.3,
        gravity: 1,
        drag: 0.05,
        floor: base.y,
      });
    }
    effects.addShake(growing ? 0.12 : 0.04);
    if (growing) {
      const cam = physics.worldToBubble(ctx.view.position);
      ctx.audio.rumble(cam.distanceTo(base), 1.2);
    }
    return false;
  });
}

/**
 * `volcano` (Spec 8): Ein Kegel wächst aus dem Gelände (Höhen-Patch wie beim Krater), dazu
 * Lavapartikel und eine Rauchsäule. Gebäude auf den Flanken werden verschüttet.
 * SIMPLIFIED: keine fließende Lava, keine Lavabomben als Körper.
 */
export function createVolcanoTool(): Tool {
  const tt = t.tools.volcano;
  return {
    id: 'volcano',
    name: tt.name,
    tier: 4,
    icon: 'volcano',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'height',
        label: tt.height,
        type: 'number',
        min: 20,
        max: 300,
        step: 10,
        unit: 'm',
        default: 120,
      },
      {
        key: 'duration',
        label: tt.duration,
        type: 'number',
        min: 30,
        max: 180,
        step: 10,
        unit: 's',
        default: 90,
      },
    ],
    onPointerDown(hit, ctx, params) {
      startVolcano(ctx, hit.local.clone(), num(params.height, 120), num(params.duration, 90));
      ctx.toast('info', tt.started);
    },
  };
}
