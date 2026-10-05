import type { PerspectiveCamera, Ray, Scene, Vector3 } from 'three';
import type { AudioEngine } from '../audio/audio';
import type { CameraRig } from '../camera/cameraRig';
import type { EventBus, GameEvents } from '../core/events';
import type { FloatingOrigin } from '../core/floatingOrigin';
import type { Rng } from '../core/random';
import type { Settings } from '../core/settings';
import type { GeoPoint } from '../core/types';
import type { PhysicsWorld, SimBody } from '../physics/world';
import type { BuildingService } from '../world/buildings/buildingService';
import type { Effects } from '../vfx/effects';
import type { HeightSampler } from '../world/heightSampler';
import type { Driving } from './driving';
import type { Detonator } from './explosions';

/**
 * Kontext für Werkzeuge (Spec 4.5). Abweichung: `vfx` heißt `effects`; dazu kommen `origin`
 * (Koordinaten), `driving` (Fahrmodus), `toast`, `explosions`, `audio` und `addTask`.
 * `camera` ist der Kameramanager (`CameraRig`).
 */
export interface ToolContext {
  scene: Scene;
  physics: PhysicsWorld;
  terrain: HeightSampler;
  buildings: BuildingService;
  events: EventBus<GameEvents>;
  camera: CameraRig;
  view: PerspectiveCamera;
  origin: FloatingOrigin;
  driving: Driving;
  rng: Rng;
  settings: Settings;
  toast(kind: 'info' | 'warn' | 'error', text: string): void;
  effects: Effects;
  audio: AudioEngine;
  explosions: Detonator;
  /**
   * Läuft in jedem festen Schritt, unabhängig vom gewählten Werkzeug (Zünder, fallende Bombe).
   * Liefert die Funktion true, ist die Aufgabe erledigt.
   */
  addTask(task: (dt: number) => boolean): void;
}

export interface ToolParam {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  default: number | string | boolean;
}

/** Treffer eines Werkzeug-Klicks (Spec M2 `WorldHit`, erweitert um den Blasen-Frame). */
export interface WorldHit {
  /** Weltkoordinaten. */
  point: Vector3;
  normal: Vector3;
  geo: GeoPoint;
  distance: number;
  /** Treffpunkt und Normale im Blasen-Frame der Physik (y = oben). */
  local: Vector3;
  localNormal: Vector3;
  /** Getroffener Körper bzw. Gebäude, falls vorhanden. */
  body: SimBody | null;
  buildingId: number | null;
  /** Der Strahl, mit dem gezielt wurde (Welt). */
  ray: Ray;
}

export type ToolTier = 0 | 1 | 2 | 3 | 4 | 5;
export type ParamValues = Record<string, number | string | boolean>;

export interface Tool {
  id: string;
  /** Deutsch, UI-Text (aus i18n). */
  name: string;
  tier: ToolTier;
  /** Name eines lokalen SVG-Icons (src/ui/icons.tsx). */
  icon: string;
  description: string;
  params: ToolParam[];
  hotkey?: string;
  /** Braucht Physik (Rapier wird beim Auswählen geladen). */
  needsPhysics?: boolean;
  onSelect?(ctx: ToolContext): void;
  onDeselect?(ctx: ToolContext): void;
  onPointerDown?(hit: WorldHit, ctx: ToolContext, params: ParamValues): void;
  onPointerMove?(hit: WorldHit | null, ctx: ToolContext): void;
  onUpdate?(dt: number, ctx: ToolContext): void;
}

/** Registry: Die Werkzeugleiste wird vollständig hieraus erzeugt (Spec 4.5). */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.id)) throw new Error(`Werkzeug doppelt registriert: ${tool.id}`);
    this.tools.set(tool.id, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  all(): Tool[] {
    return [...this.tools.values()];
  }

  byTier(tier: ToolTier): Tool[] {
    return this.all().filter((t) => t.tier === tier);
  }
}

/** Standardwerte der Parameter eines Werkzeugs. */
export function defaultParams(tool: Tool): ParamValues {
  const out: ParamValues = {};
  for (const p of tool.params) out[p.key] = p.default;
  return out;
}

/** Klemmt einen Zahlenparameter auf seinen Bereich (UI-Eingaben, gespeicherte Werte). */
export function clampParam(p: ToolParam, v: unknown): number | string | boolean {
  if (p.type === 'number') {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(p.default);
    return Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n));
  }
  if (p.type === 'boolean') return typeof v === 'boolean' ? v : Boolean(p.default);
  const s = String(v);
  return p.options?.some((o) => o.value === s) ? s : String(p.default);
}

export const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
