/** Wetterzustand: Voreinstellungen und Echtwetter von Open-Meteo (Spec 5.5, Werkzeug `weather`). */
import { fetchJson, type FetchLike, type SleepFn } from '../../core/net';
import type { WeatherState } from '../../core/types';

export type WeatherPreset = WeatherState['preset'];
export const WEATHER_PRESETS: readonly WeatherPreset[] = [
  'clear',
  'cloudy',
  'rain',
  'snow',
  'storm',
  'fog',
];

/** Standardwerte je Voreinstellung (Wind kommt aus dem Werkzeug). */
const PRESET_BASE: Record<
  WeatherPreset,
  Pick<WeatherState, 'cloudCover' | 'precipitation' | 'intensity'>
> = {
  clear: { cloudCover: 0.05, precipitation: 'none', intensity: 0 },
  cloudy: { cloudCover: 0.8, precipitation: 'none', intensity: 0 },
  rain: { cloudCover: 0.95, precipitation: 'rain', intensity: 0.6 },
  snow: { cloudCover: 0.95, precipitation: 'snow', intensity: 0.6 },
  storm: { cloudCover: 1, precipitation: 'rain', intensity: 1 },
  fog: { cloudCover: 0.6, precipitation: 'none', intensity: 0 },
};

/** Mindestwind beim Wechsel auf „Gewitter“ (m/s, Beaufort 8): Regen fällt sichtbar schräg. */
export const STORM_WIND_MS = 18;

/**
 * Wind nach einem Wechsel der Voreinstellung: Wer auf „Gewitter“ umschaltet, bekommt mindestens
 * {@link STORM_WIND_MS}; sonst bleibt der eingestellte Wind.
 */
export function presetWind(prev: WeatherPreset, next: WeatherPreset, windMs: number): number {
  return next === 'storm' && prev !== 'storm' ? Math.max(windMs, STORM_WIND_MS) : windMs;
}

export const DEFAULT_WEATHER: WeatherState = {
  preset: 'clear',
  ...PRESET_BASE.clear,
  windSpeedMs: 3,
  windDirectionDeg: 250,
  temperatureC: 15,
};

/** Wetter aus Voreinstellung und Wind (Werkzeug ohne Echtwetter). */
export function weatherFromPreset(
  preset: WeatherPreset,
  windSpeedMs: number,
  windDirectionDeg: number,
  temperatureC = preset === 'snow' ? -2 : 15,
): WeatherState {
  const base = PRESET_BASE[preset] ?? PRESET_BASE.clear;
  return {
    preset: PRESET_BASE[preset] ? preset : 'clear',
    ...base,
    windSpeedMs: Math.max(0, windSpeedMs),
    windDirectionDeg: ((windDirectionDeg % 360) + 360) % 360,
    temperatureC,
  };
}

/**
 * Windvektor im ENU-Frame (x = Ost, z = −Nord) in m/s. Die meteorologische Richtung gibt an,
 * woher der Wind kommt; er weht also in die Gegenrichtung.
 */
export function windVector(w: Pick<WeatherState, 'windSpeedMs' | 'windDirectionDeg'>): {
  x: number;
  z: number;
} {
  const a = (w.windDirectionDeg * Math.PI) / 180;
  // Wind aus Norden (0°) weht nach Süden: Nord-Komponente −s, also z = +s
  return { x: -Math.sin(a) * w.windSpeedMs, z: Math.cos(a) * w.windSpeedMs };
}

/** Antwort von Open-Meteo `/v1/forecast?current=…` (nur die genutzten Felder). */
export interface OpenMeteoCurrent {
  current?: {
    time?: string;
    interval?: number;
    temperature_2m?: number;
    precipitation?: number;
    rain?: number;
    snowfall?: number;
    cloud_cover?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    is_day?: number;
    weather_code?: number;
  };
}

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
/**
 * Felder laut Spec 5.5, ergänzt um `weather_code` (WMO): nur daran sind Nebel (45/48) und
 * Gewitter (95–99) zu erkennen (ADR-023).
 */
export const OPEN_METEO_FIELDS =
  'temperature_2m,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m,is_day,weather_code';

export function openMeteoUrl(lat: number, lon: number): string {
  return (
    `${OPEN_METEO_URL}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=${OPEN_METEO_FIELDS}&wind_speed_unit=ms`
  );
}

/** Ab dieser Rate (mm/h) gilt Niederschlag als voll (Intensität 1). */
const FULL_RATE_MM_H = 8;
/** Ab dieser Bewölkung gilt es als „bewölkt“. */
const CLOUDY_FROM = 0.6;

const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * Open-Meteo-Antwort → Wetterzustand. Niederschlag ist die Summe über das Intervall
 * (`interval` s, meist 900); daraus wird eine Rate in mm/h und die Intensität 0…1.
 * Wind kommt in m/s (`wind_speed_unit=ms`).
 */
export function weatherFromOpenMeteo(json: OpenMeteoCurrent): WeatherState {
  const c = json.current;
  if (!c) throw new Error('Open-Meteo: Feld "current" fehlt');
  const interval = Math.max(60, finite(c.interval, 900));
  const perHour = 3600 / interval;
  const rain = Math.max(0, finite(c.rain, 0));
  const snow = Math.max(0, finite(c.snowfall, 0)); // cm Neuschnee
  const total = Math.max(0, finite(c.precipitation, rain + snow * 0.7));
  const code = finite(c.weather_code, -1);
  const cloudCover = Math.min(1, Math.max(0, finite(c.cloud_cover, 0) / 100));
  const snowCodes = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const rainCodes = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  let preset: WeatherPreset;
  let precipitation: WeatherState['precipitation'] = 'none';
  if (code >= 95) {
    preset = 'storm';
    precipitation = 'rain';
  } else if (snow > 0 || (snowCodes && total > 0) || (snowCodes && rain === 0)) {
    preset = 'snow';
    precipitation = 'snow';
  } else if (rain > 0 || total > 0 || rainCodes) {
    preset = 'rain';
    precipitation = 'rain';
  } else if (code === 45 || code === 48) {
    preset = 'fog';
  } else {
    preset = cloudCover >= CLOUDY_FROM ? 'cloudy' : 'clear';
  }
  // Schnee: 1 cm Neuschnee ≈ 1 mm Wasser
  const rate = (precipitation === 'snow' ? Math.max(total, snow) : Math.max(total, rain)) * perHour;
  let intensity = precipitation === 'none' ? 0 : Math.min(1, rate / FULL_RATE_MM_H);
  // Laut WMO-Code fällt etwas, die Summe ist aber 0 (Nieselregen): sichtbar, aber schwach
  if (precipitation !== 'none') intensity = Math.max(intensity, preset === 'storm' ? 0.7 : 0.15);
  return {
    preset,
    cloudCover,
    precipitation,
    intensity,
    windSpeedMs: Math.max(0, finite(c.wind_speed_10m, 0)),
    windDirectionDeg: ((finite(c.wind_direction_10m, 0) % 360) + 360) % 360,
    temperatureC: finite(c.temperature_2m, 15),
  };
}

export interface RealWeather {
  state: WeatherState;
  /** Zeitpunkt der Messung laut API (ISO, Ortszeit der Antwort) oder null. */
  time: string | null;
  isDay: boolean | null;
}

/** Cache-Dauer (Spec 5.5). */
export const WEATHER_CACHE_MS = 15 * 60_000;

export interface WeatherClientOptions {
  fetchImpl?: FetchLike;
  sleep?: SleepFn;
  now?: () => number;
}

/**
 * Echtwetter mit 15-Minuten-Cache je Rasterpunkt (0,1°, ≈ 11 km; die Modelle rechnen gröber).
 * Kein Schlüssel nötig.
 */
export class WeatherClient {
  private readonly cache = new Map<string, { at: number; value: RealWeather }>();
  private readonly now: () => number;

  constructor(private readonly opts: WeatherClientOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  static key(lat: number, lon: number): string {
    return `${lat.toFixed(1)},${lon.toFixed(1)}`;
  }

  async current(lat: number, lon: number, signal?: AbortSignal): Promise<RealWeather> {
    const key = WeatherClient.key(lat, lon);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < WEATHER_CACHE_MS) return hit.value;
    const json = await fetchJson<OpenMeteoCurrent>(openMeteoUrl(lat, lon), {
      timeoutMs: 8_000,
      attempts: 2,
      ...(signal ? { signal } : {}),
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
    });
    const value: RealWeather = {
      state: weatherFromOpenMeteo(json),
      time: typeof json.current?.time === 'string' ? json.current.time : null,
      isDay: typeof json.current?.is_day === 'number' ? json.current.is_day === 1 : null,
    };
    this.cache.set(key, { at: this.now(), value });
    return value;
  }
}

/** Pflicht-Attribution, sobald Echtwetter genutzt wurde (CC BY 4.0). */
export const OPEN_METEO_ATTRIBUTION = {
  id: 'open-meteo',
  text: 'Wetterdaten von Open-Meteo.com',
  url: 'https://open-meteo.com/',
  license: 'CC BY 4.0',
};
