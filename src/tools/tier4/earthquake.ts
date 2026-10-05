import { Vector3 } from 'three';
import { STANDARD_GRAVITY } from '../../core/constants';
import { t } from '../../ui/i18n';
import { num, type Tool, type ToolContext } from '../Tool';

/**
 * Spitzenbeschleunigung des Bodens (in g) für die spielerische Stärke 1 bis 10 im Abstand `d`
 * vom Epizentrum: 0,002 g · 10^(0,45 · (M − 1)), höchstens 3 g, mit der Entfernung abnehmend.
 * Stärke 5 ≈ 0,13 g (leichte Schäden), 6 ≈ 0,36 g, 7 ≈ 1 g (schwere Schäden).
 */
export function peakGroundAccelG(magnitude: number, distanceM = 0): number {
  const m = Math.min(10, Math.max(1, magnitude));
  return Math.min(3, 0.002 * 10 ** (0.45 * (m - 1))) / (1 + Math.max(0, distanceM) / 3_000);
}

/** Deterministische Zahl 0…1 aus einer Gebäude-ID (Bauqualität). */
export function buildingQuality(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Tragfähigkeit eines Gebäudes gegen Bodenbeschleunigung (in g): Bauqualität (zufällig je
 * Gebäude, 0,25…1) mal Höhenfaktor (hohe, schlanke Gebäude sind schwächer). 0,13 bis 1,35 g.
 * SIMPLIFIED: ohne Baujahr, Material oder Resonanz.
 */
export function buildingCapacityG(id: number, heightM: number): number {
  return (0.25 + 0.75 * buildingQuality(id)) * (1.3 / (1 + Math.max(0, heightM) / 40));
}

/** Verlauf der Stärke über die Dauer: 2 s Anstieg, Plateau, letztes Drittel Abklingen. */
export function quakeEnvelope(time: number, duration: number): number {
  if (time < 0 || time > duration) return 0;
  const rise = Math.min(1, time / 2);
  const fall = Math.min(1, (duration - time) / (duration / 3));
  return Math.max(0, Math.min(rise, fall));
}

/** So oft werden Gebäude geprüft (s). */
const CHECK_EVERY_S = 0.25;
/** Höchstens so viele Gebäude werden pro Prüfung neu gebrochen. */
const MAX_NEW_PER_CHECK = 4;

const _imp = { x: 0, y: 0, z: 0 };
const _center = new Vector3();

/** Erdbeben mit Epizentrum `center` (Blasen-Frame) starten. */
export function startEarthquake(
  ctx: ToolContext,
  center: Vector3,
  magnitude: number,
  durationS: number,
): void {
  const physics = ctx.physics;
  const frame = physics.frame;
  const effects = ctx.effects;
  const phase = ctx.rng.next() * Math.PI * 2;
  const az = ctx.rng.next() * Math.PI;
  let time = 0;
  let checkAcc = 0;
  const c = center.clone();
  ctx.addTask((dt) => {
    if (physics.frame !== frame) return true;
    time += dt;
    if (time > durationS) return true;
    const env = quakeEnvelope(time, durationS);
    const pga = peakGroundAccelG(magnitude) * env;
    // Bildschirm bebt (die Engine schaltet das bei „Wackeln reduzieren“ ab)
    effects.addShake(Math.min(1, pga * 1.6));
    // Boden schwingt: zwei Frequenzen, quer zueinander, dazu etwas senkrecht
    const w1 = Math.sin(2 * Math.PI * 1.4 * time + phase);
    const w2 = Math.sin(2 * Math.PI * 2.3 * time + phase * 1.7);
    const ax = (Math.cos(az) * w1 - Math.sin(az) * w2 * 0.6) * pga * STANDARD_GRAVITY;
    const az2 = (Math.sin(az) * w1 + Math.cos(az) * w2 * 0.6) * pga * STANDARD_GRAVITY;
    const ay = Math.sin(2 * Math.PI * 3.1 * time) * pga * STANDARD_GRAVITY * 0.3;
    for (const b of physics.allBodies()) {
      const rb = b.rb;
      if (!rb || b.pinned) continue;
      // Nur Körper mit Bodenkontakt (ungefähr): bis 1,5 m über dem Gelände
      const ground = physics.groundY(b.pos.x, b.pos.z);
      if (b.pos.y - ground > Math.cbrt(b.volume) + 1.5) continue;
      if (b.frozen) {
        if (pga < 0.05) continue;
        physics.unfreeze(b);
      }
      const m = rb.mass() * dt;
      _imp.x = ax * m;
      _imp.y = Math.max(0, ay) * m;
      _imp.z = az2 * m;
      rb.applyImpulse(_imp, true);
    }
    // Gebäude über ihrer Tragfähigkeit verlieren Stücke, schwache zuerst, untere Geschosse eher
    checkAcc += dt;
    if (checkAcc >= CHECK_EVERY_S && pga > 0.1) {
      checkAcc = 0;
      _center.copy(c);
      ctx.destruction?.damage(
        _center,
        physics.radius * 1.2,
        {
          building: (bd) => pga > buildingCapacityG(bd.id, bd.height),
          fragment: (_p, rel, dv) => {
            // Überlast des jeweiligen Gebäudes ist hier nicht bekannt: Wahrscheinlichkeit aus
            // der Stärke; das Erdgeschoss versagt eher, Stockwerke darüber fallen nach
            const chance = Math.min(0.5, pga * 0.25) * (rel < 0.35 ? 2 : 0.4);
            if (ctx.rng.next() > chance) return false;
            dv.set(ax * 0.15, 0, az2 * 0.15);
            return true;
          },
        },
        MAX_NEW_PER_CHECK,
      );
    }
    if (pga > 0.02) {
      const cam = physics.worldToBubble(ctx.view.position);
      ctx.audio.rumble(cam.distanceTo(c), Math.min(2, pga * 3));
    }
    return false;
  });
}

/**
 * `earthquake` (Spec 8): Stärke 1 bis 10 (spielerische Skala). Kamera bebt, Körper am Boden
 * bekommen oszillierende Impulse, Gebäude über ihrer Tragfähigkeit stürzen ein, schwache zuerst.
 */
export function createEarthquakeTool(): Tool {
  const tt = t.tools.earthquake;
  const fmt = (v: number, d: number): string =>
    v.toLocaleString(t.locale, { maximumFractionDigits: d, minimumFractionDigits: 0 });
  return {
    id: 'earthquake',
    name: tt.name,
    tier: 4,
    icon: 'quake',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'magnitude',
        label: tt.magnitude,
        type: 'number',
        min: 1,
        max: 10,
        step: 0.5,
        default: 6,
      },
      {
        key: 'duration',
        label: tt.duration,
        type: 'number',
        min: 5,
        max: 60,
        step: 5,
        unit: 's',
        default: 20,
      },
    ],
    onPointerDown(hit, ctx, params) {
      const m = num(params.magnitude, 6);
      startEarthquake(ctx, hit.local, m, num(params.duration, 20));
      ctx.toast(
        'info',
        tt.started.replace('{m}', fmt(m, 1)).replace('{g}', fmt(peakGroundAccelG(m), 2)),
      );
    },
  };
}
