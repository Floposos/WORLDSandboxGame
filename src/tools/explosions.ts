import { Vector3 } from 'three';
import type { AudioEngine } from '../audio/audio';
import { TNT_J_PER_KG } from '../core/constants';
import type { EventBus, GameEvents } from '../core/events';
import {
  aabbArea,
  blastImpulse,
  craterSize,
  effectRadius,
  shakeAmount,
  type CraterSize,
} from '../physics/blast';
import type { Destruction } from '../physics/destruction';
import type { PhysicsWorld, SimBody } from '../physics/world';
import type { Effects } from '../vfx/effects';
import { t } from '../ui/i18n';
import type { CraterService } from '../world/craters';

export interface ExplosionDeps {
  physics: PhysicsWorld;
  destruction: Destruction;
  events: EventBus<GameEvents>;
  effects?: Effects | null;
  audio?: AudioEngine | null;
  craters?: CraterService | null;
  /** Kameraposition in Weltkoordinaten (Schallverzögerung, Wackeln). */
  cameraWorld?: () => Vector3;
  reduceMotion?: () => boolean;
}

export interface ExplosionResult {
  tntKg: number;
  /** Bewegte Körper und losgebrochene Gebäude-Stücke. */
  bodies: number;
  fragments: number;
  /** Gebäude, die durch diese Explosion beschädigt oder eingestürzt sind. */
  damagedBuildings: number;
  crater: CraterSize | null;
  radiusM: number;
}

export interface DetonateOptions {
  /** Höhe über Grund (Luftdetonation): kleinerer oder kein Krater. */
  burstHeightM?: number;
  source?: string;
  /** Bilanz-Toast anzeigen (Standard: ja). */
  toast?: boolean;
  /** Eigener Krater statt aus der Ladung (Meteor: Skalierung für Einschläge). */
  crater?: CraterSize | null;
  /** Gebäude, deren Mitte in diesem Umkreis liegt, verdampfen ohne Bruchstücke. */
  vaporizeRadiusM?: number;
  /** Höchstens so viele Gebäude vorab brechen (die nächsten zuerst). */
  maxBuildings?: number;
}

/** Größer werden die Effekte nicht (Partikelgrößen wachsen mit W^(1/3)). */
export const VISUAL_MAX_TNT_KG = 5e6;

/** Schnittstelle für Werkzeuge (ToolContext.explosions). */
export interface Detonator {
  detonate(pos: Vector3, tntKg: number, opts?: DetonateOptions): ExplosionResult;
}

/** Ab dieser Ladung hinterlässt eine Bodendetonation einen Krater (kg TNT). */
export const MIN_CRATER_TNT_KG = 5;

const _d = new Vector3();
const _impulse = { x: 0, y: 0, z: 0 };
const _near: SimBody[] = [];

/**
 * Explosion (Spec 7.3/7.4/7.5/7.6): Druckwelle auf Körper und Gebäude, Krater, Effekte, Ton,
 * Wackeln und das Ereignis `explosion`. Position im Frame der Blase.
 */
export class ExplosionService implements Detonator {
  constructor(private readonly deps: ExplosionDeps) {}

  detonate(pos: Vector3, tntKg: number, opts: DetonateOptions = {}): ExplosionResult {
    const { physics, destruction, events } = this.deps;
    const burst = Math.max(0, opts.burstHeightM ?? 0);
    const radius = effectRadius(tntKg);
    // Zustände vorher: auch ein beschädigtes Gebäude, das jetzt einstürzt, zählt in der Bilanz
    const before = new Map(destruction.statuses);

    // 1. Gebäude: im Kern verdampfen, sonst vorab brechen und Stücke lösen
    if (opts.vaporizeRadiusM) destruction.vaporize(pos, opts.vaporizeRadiusM);
    const fragments = destruction.applyBlast(pos, tntKg, opts.maxBuildings);

    // 2. Körper im Wirkungsradius: Impuls weg vom Zentrum, leicht nach oben
    let bodies = 0;
    for (const b of physics.bodiesNear(pos, radius, _near)) {
      const rb = b.rb;
      if (!rb || b.pinned || b.kind === 'fragment') continue;
      _d.subVectors(b.pos, pos);
      const dist = Math.max(0.3, _d.length());
      const mass = rb.mass();
      const area = bodyArea(b);
      const j = blastImpulse(dist, tntKg, area, mass);
      if (j <= 0) continue;
      if (b.frozen) physics.unfreeze(b);
      _d.normalize();
      _d.y = Math.max(_d.y, 0.25);
      _d.normalize();
      _impulse.x = _d.x * j;
      _impulse.y = _d.y * j;
      _impulse.z = _d.z * j;
      rb.applyImpulse(_impulse, true);
      bodies++;
    }

    // 3. Krater bei Detonation am Boden
    let crater: CraterSize | null = null;
    const ground = pos.clone();
    ground.y -= burst;
    if ((tntKg >= MIN_CRATER_TNT_KG || opts.crater) && this.deps.craters) {
      const size = opts.crater ?? craterSize(tntKg, burst);
      if (size.depthM > 0.05) {
        const geo = physics.bubbleToGeo(ground);
        if (this.deps.craters.add(geo, size) !== null) {
          crater = size;
          physics.rebuildTerrain();
          events.emit('craterCreated', { center: geo, radiusM: size.radiusM, depthM: size.depthM });
        }
      }
    }

    // 4. Effekte, Ton, Wackeln
    this.deps.effects?.explosion(
      pos,
      Math.min(tntKg, VISUAL_MAX_TNT_KG),
      ground.y,
      Math.min(radius, 4 * physics.radius),
    );
    const cam = this.deps.cameraWorld?.();
    if (cam) {
      const camLocal = physics.worldToBubble(cam);
      const dist = camLocal.distanceTo(pos);
      this.deps.audio?.explosion(dist, tntKg);
      if (!this.deps.reduceMotion?.()) this.deps.effects?.addShake(shakeAmount(dist, tntKg));
    }

    events.emit('explosion', {
      posLocal: { x: pos.x, y: pos.y, z: pos.z },
      tntEquivalentKg: tntKg,
      airburstHeightM: burst,
    });
    return {
      tntKg,
      bodies,
      fragments,
      damagedBuildings: changedBuildings(destruction, before),
      crater,
      radiusM: radius,
    };
  }
}

function changedBuildings(d: Destruction, before: ReadonlyMap<number, string>): number {
  let n = 0;
  for (const [id, status] of d.statuses) if (before.get(id) !== status) n++;
  return n;
}

/** Angriffsfläche eines Körpers: AABB aus der Skalierung, sonst aus dem Volumen. */
function bodyArea(b: SimBody): number {
  if (b.pool) return aabbArea(b.scale.x, b.scale.y, b.scale.z);
  return Math.max(0.2, Math.cbrt(b.volume) ** 2);
}

/** Mehrere Explosionen zu einer Bilanz zusammenfassen (Sprengladungen). */
export function sumResults(list: readonly ExplosionResult[]): ExplosionResult {
  const out: ExplosionResult = {
    tntKg: 0,
    bodies: 0,
    fragments: 0,
    damagedBuildings: 0,
    crater: null,
    radiusM: 0,
  };
  for (const r of list) {
    out.tntKg += r.tntKg;
    out.bodies += r.bodies;
    out.fragments += r.fragments;
    out.damagedBuildings += r.damagedBuildings;
    out.radiusM = Math.max(out.radiusM, r.radiusM);
    if (r.crater && (!out.crater || r.crater.radiusM > out.crater.radiusM)) out.crater = r.crater;
  }
  return out;
}

const fmtNum = (v: number, d: number): string =>
  v.toLocaleString(t.locale, { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** TNT-Menge lesbar: kg, t, kt, Mt. */
export function formatTnt(kg: number): string {
  const steps: [number, string][] = [
    [1e9, 'Mt'],
    [1e6, 'kt'],
    [1e4, 't'],
  ];
  for (const [f, unit] of steps) {
    if (kg >= f) {
      const v = kg / (f === 1e4 ? 1e3 : f);
      return `${fmtNum(v, v < 10 ? 1 : 0)} ${unit}`;
    }
  }
  return `${fmtNum(kg, kg < 10 ? 1 : 0)} kg`;
}

/** Energie lesbar: MJ bis 10⁶ MJ, darüber TJ bzw. PJ. */
export function formatEnergy(joule: number): string {
  const mj = joule / 1e6;
  if (mj < 1e6) return `${fmtNum(mj, mj < 10 ? 1 : 0)} MJ`;
  const tj = joule / 1e12;
  if (tj < 1e4) return `${fmtNum(tj, tj < 10 ? 1 : 0)} TJ`;
  const pj = joule / 1e15;
  return `${fmtNum(pj, pj < 10 ? 1 : 0)} PJ`;
}

/** Bilanz-Toast nach dem Einschlag (Spec M4): Energie, Krater, beschädigte Gebäude. */
export function explosionSummary(r: ExplosionResult): string {
  const fmt = fmtNum;
  return [
    t.explosion.energy
      .replace('{tnt}', formatTnt(r.tntKg))
      .replace('{energy}', formatEnergy(r.tntKg * TNT_J_PER_KG)),
    r.crater
      ? t.explosion.crater.replace('{d}', fmt(r.crater.radiusM * 2, 1))
      : t.explosion.noCrater,
    t.explosion.buildings.replace('{n}', String(r.damagedBuildings)),
  ].join(' · ');
}
