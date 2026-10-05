import { store } from '../../core/store';
import { t } from '../../ui/i18n';
import { syncAttributions } from '../../ui/attributions';
import {
  OPEN_METEO_ATTRIBUTION,
  presetWind,
  WEATHER_PRESETS,
  WeatherClient,
  weatherFromPreset,
  type WeatherPreset,
} from '../../world/weather/weather';
import type { WeatherState } from '../../core/types';
import { num, type Tool } from '../Tool';

/** Himmelsrichtung (16-teilig) einer meteorologischen Windrichtung. */
export function compass(deg: number, names: readonly string[]): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return names[i] ?? '';
}

/** Kurzbeschreibung des übernommenen Wetters für den Toast. */
export function weatherSummary(w: WeatherState): string {
  const tw = t.tools.weather;
  const fmt = (v: number, d = 0): string =>
    v.toLocaleString(t.locale, { maximumFractionDigits: d, minimumFractionDigits: 0 });
  return tw.summary
    .replace('{preset}', tw.presets[w.preset])
    .replace('{temp}', fmt(w.temperatureC, 1))
    .replace('{clouds}', fmt(w.cloudCover * 100))
    .replace('{wind}', fmt(w.windSpeedMs, 1))
    .replace('{dir}', compass(w.windDirectionDeg, tw.compass));
}

export interface WeatherToolOptions {
  client?: WeatherClient;
}

/**
 * `weather` (Spec 8): klar/bewölkt/Regen/Schnee/Gewitter/Nebel, Windrichtung und -stärke sowie
 * „Echtes Wetter übernehmen“ (Open-Meteo, Spec 5.5, Cache 15 min). Wirkt sofort.
 */
export function createWeatherTool(opts: WeatherToolOptions = {}): Tool {
  const tw = t.tools.weather;
  const client = opts.client ?? new WeatherClient();
  return {
    id: 'weather',
    name: tw.name,
    tier: 1,
    icon: 'cloud',
    description: tw.description,
    params: [
      {
        key: 'preset',
        label: tw.preset,
        type: 'select',
        options: WEATHER_PRESETS.map((p) => ({ value: p, label: tw.presets[p] })),
        default: 'clear',
      },
      {
        key: 'windSpeed',
        label: tw.windSpeed,
        type: 'number',
        min: 0,
        max: 40,
        step: 1,
        unit: 'm/s',
        default: 3,
      },
      {
        key: 'windDir',
        label: tw.windDir,
        type: 'number',
        min: 0,
        max: 350,
        step: 10,
        unit: '°',
        default: 250,
      },
      { key: 'real', label: tw.real, type: 'action', default: false },
    ],
    onActivate(env) {
      const w = store.weather.value;
      env.setParams({
        preset: w.preset,
        windSpeed: Math.round(w.windSpeedMs),
        windDir: (Math.round(w.windDirectionDeg / 10) * 10) % 360,
      });
    },
    onParams(params, env) {
      const raw = String(params.preset) as WeatherPreset;
      const preset = WEATHER_PRESETS.includes(raw) ? raw : 'clear';
      const set = num(params.windSpeed, 3);
      const wind = presetWind(store.weather.value.preset, preset, set);
      if (wind !== set) env.setParams({ windSpeed: wind });
      store.weather.value = weatherFromPreset(preset, wind, num(params.windDir, 250));
    },
    async onAction(key, _params, env) {
      if (key !== 'real') return;
      const focus = env.focus();
      env.setBusy(true);
      try {
        const real = await client.current(focus.lat, focus.lon);
        store.weather.value = real.state;
        env.setParams({
          preset: real.state.preset,
          windSpeed: Math.round(real.state.windSpeedMs),
          windDir: (Math.round(real.state.windDirectionDeg / 10) * 10) % 360,
        });
        syncAttributions('weather', [OPEN_METEO_ATTRIBUTION]);
        env.toast('info', weatherSummary(real.state));
      } catch (err) {
        console.warn('[weather]', err);
        env.toast('warn', tw.failed);
      } finally {
        env.setBusy(false);
      }
    },
  };
}
