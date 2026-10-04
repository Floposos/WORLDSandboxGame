import { signal } from '@preact/signals';
import type { TimeScale } from './constants';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { GeocodeResult } from '../world/geocoder';
import type { CameraMode } from '../camera/types';
import type { ParamValues, ToolParam, ToolTier } from '../tools/Tool';

/** Was die UI über ein Werkzeug wissen muss (aus der Registry, Spec 4.5). */
export interface ToolInfo {
  id: string;
  name: string;
  tier: ToolTier;
  icon: string;
  description: string;
  params: ToolParam[];
}

export type ProviderState = 'loading' | 'google' | 'cesium-ion' | 'open-data' | 'error';

/** Befehle, die die Engine der UI anbietet (null, solange die Engine lädt). */
export interface EngineApi {
  flyToResult(result: GeocodeResult): Promise<void>;
  restartProviders(): Promise<void>;
  setCameraMode(mode: CameraMode): void;
}

export interface ViewInfo {
  lat: number;
  lon: number;
  /** Kamerahöhe über dem Ellipsoid in m */
  height: number;
  /** Geländehöhe unter der Kamera in m, falls bekannt */
  ground: number | null;
}

/**
 * Globaler Spielzustand als Preact-Signals. Die UI liest direkt daraus,
 * die Engine schreibt hinein. Hot-Path-Daten (Transforms, Partikel) leben
 * NICHT hier, sondern in den jeweiligen Systemen.
 */
export const store = {
  settings: signal<Settings>(loadSettings()),
  timeScale: signal<TimeScale>(1),
  activeToolId: signal<string | null>(null),
  stats: signal({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0, particles: 0 }),
  toasts: signal<Toast[]>([]),
  provider: signal<ProviderState>('loading'),
  view: signal<ViewInfo | null>(null),
  placeName: signal<string | null>(null),
  /** Simulationszeit für Sonnenstand; live = folgt der echten Uhr. */
  simTime: signal<{ timeMs: number; live: boolean }>({ timeMs: Date.now(), live: true }),
  api: signal<EngineApi | null>(null),
  keysDialogOpen: signal(false),
  cameraMode: signal<CameraMode>('globe'),
  tools: signal<ToolInfo[]>([]),
  toolParams: signal<Record<string, ParamValues>>({}),
  physicsState: signal<'idle' | 'loading' | 'ready' | 'error'>('idle'),
  driving: signal(false),
  buildingCount: signal(0),
  /** Eingestürzte Gebäude (M4, HUD). */
  destroyedBuildings: signal(0),
};

/** Setzt einen Parameter des Werkzeugs (UI). */
export function setToolParam(toolId: string, key: string, value: number | string | boolean): void {
  const all = store.toolParams.value;
  store.toolParams.value = { ...all, [toolId]: { ...(all[toolId] ?? {}), [key]: value } };
}

export interface Toast {
  id: number;
  kind: 'info' | 'warn' | 'error';
  text: string;
}

let toastId = 0;

export function pushToast(kind: Toast['kind'], text: string, ttlMs = 6000): void {
  const toast: Toast = { id: ++toastId, kind, text };
  store.toasts.value = [...store.toasts.value.slice(-4), toast];
  setTimeout(() => dismissToast(toast.id), ttlMs);
}

export function dismissToast(id: number): void {
  store.toasts.value = store.toasts.value.filter((t) => t.id !== id);
}

/** Ändert Einstellungen, speichert sie (falls möglich) und gibt zurück, ob gespeichert wurde. */
export function updateSettings(patch: Partial<Settings>): boolean {
  const next = { ...store.settings.value, ...patch };
  store.settings.value = next;
  return saveSettings(next);
}
