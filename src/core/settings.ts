import { readJson, writeJson } from './storage';

export type PresetId = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsPreset {
  id: PresetId;
  /** 3d-tiles-renderer errorTarget (Pixel). Höher = gröber. */
  tileErrorTarget: number;
  shadowCascades: 0 | 1 | 3;
  softShadows: boolean;
  maxBodies: number;
  maxParticles: number;
  bubbleRadiusM: number;
}

/** Grafik-Presets laut Spezifikation 6.4. */
export const PRESETS: Record<PresetId, GraphicsPreset> = {
  low: {
    id: 'low',
    tileErrorTarget: 40,
    shadowCascades: 0,
    softShadows: false,
    maxBodies: 300,
    maxParticles: 5_000,
    bubbleRadiusM: 300,
  },
  medium: {
    id: 'medium',
    tileErrorTarget: 20,
    shadowCascades: 1,
    softShadows: false,
    maxBodies: 1_000,
    maxParticles: 20_000,
    bubbleRadiusM: 600,
  },
  high: {
    id: 'high',
    tileErrorTarget: 10,
    shadowCascades: 3,
    softShadows: false,
    maxBodies: 2_500,
    maxParticles: 60_000,
    bubbleRadiusM: 1_000,
  },
  ultra: {
    id: 'ultra',
    tileErrorTarget: 6,
    shadowCascades: 3,
    softShadows: true,
    maxBodies: 5_000,
    maxParticles: 150_000,
    bubbleRadiusM: 1_500,
  },
};

export type ProviderChoice = 'auto' | 'google' | 'cesium-ion' | 'open-data';

export interface Settings {
  preset: PresetId;
  showFps: boolean;
  reduceMotion: boolean;
  masterVolume: number;
  muted: boolean;
  provider: ProviderChoice;
  /** Optionale Keys. Nie loggen, nie ins Repo. */
  keys: { googleMapsKey: string; cesiumIonToken: string };
}

export const DEFAULT_SETTINGS: Settings = {
  preset: 'medium',
  showFps: true,
  reduceMotion: false,
  masterVolume: 0.8,
  muted: false,
  provider: 'auto',
  keys: { googleMapsKey: '', cesiumIonToken: '' },
};

const STORAGE_KEY = 'settings';

/** Keys aus .env.local (nur lokale Entwicklung; der Pages-Build setzt sie nie). */
function envKeys(): Settings['keys'] {
  const env = import.meta.env;
  return {
    googleMapsKey: typeof env.VITE_GOOGLE_MAPS_KEY === 'string' ? env.VITE_GOOGLE_MAPS_KEY : '',
    cesiumIonToken: typeof env.VITE_CESIUM_ION_TOKEN === 'string' ? env.VITE_CESIUM_ION_TOKEN : '',
  };
}

/** Lädt Settings: Defaults ← localStorage ← .env (nur wenn im Storage kein Key gesetzt ist). */
export function loadSettings(): Settings {
  const stored = readJson<Partial<Settings>>(STORAGE_KEY, {});
  const env = envKeys();
  const keys = { ...DEFAULT_SETTINGS.keys, ...(stored.keys ?? {}) };
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    preset: stored.preset && stored.preset in PRESETS ? stored.preset : DEFAULT_SETTINGS.preset,
    keys: {
      googleMapsKey: keys.googleMapsKey || env.googleMapsKey,
      cesiumIonToken: keys.cesiumIonToken || env.cesiumIonToken,
    },
  };
}

export function saveSettings(settings: Settings): boolean {
  return writeJson(STORAGE_KEY, settings);
}

export function presetOf(settings: Settings): GraphicsPreset {
  return PRESETS[settings.preset];
}
